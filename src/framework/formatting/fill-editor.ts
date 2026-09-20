import {
    MetaData,
    MuralBase,
    Panel,
    Point,
    Visibility,
    Element, Visual,
    type PropertyDescriptor,
    type Disposable,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import {
    AlignmentX,
    AlignmentY,
    BitmapImage,
    Brush,
    Color,
    GradientStop,
    ImageBrush,
    LinearGradientBrush,
    PatternBrush,
    PatternKind,
    RadialGradientBrush,
    SolidColorBrush,
    Stretch,
} from '../../visual-engine/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { Border } from '../../basic/border.js';
import { Slider } from '../../basic/slider.js';
import { SliderSpinEdit } from '../../basic/slider-spin-edit.js';
import { TextBox } from '../../basic/text-box.js';
import { TextBlock } from '../../basic/text-block.js';
import { ColorPicker } from './color-picker.js';
import { ComboBox } from '../list/combo-box.js';

// PowerPoint-style Fill panel variants.
//
// Differs from BrushPickerVariant by adding:
//   * None    — clears the consumer's Fill DP to undefined (no paint).
//   * Picture — ImageBrush flavor with a URI text-input + Stretch combo.
//
// String values mirror the enum-member names so the .mu compiler can
// emit `Variant=Solid`-style literals straight through to the runtime.
export enum FillEditorVariant
{
    None    = 'None',
    Solid   = 'Solid',
    Linear  = 'Linear',
    Radial  = 'Radial',
    Pattern = 'Pattern',
    Picture = 'Picture',
}

// Inline-expanded fill editor. PowerPoint's Format Shape > Fill panel:
//
//   * Variant row (radio-style toggle borders) — None / Solid / Linear /
//     Radial / Pattern / Picture.
//   * Variant-specific body — swapped in / out via a BodyTemplate DP
//     whose value the Style picks from a `when (Variant=…)` chain
//     (same trigger shape as BrushPicker's PopupTemplate swap).
//   * Trailing Opacity slider that maps to Brush.Opacity. Hidden when
//     Variant=None (no brush to operate on).
//
// Source-of-truth contract mirrors PenEditor's: `Fill` is the I/O DP
// (also `BindsTwoWayByDefault`). Each variant carries flat mirror DPs;
// any write to a mirror rebuilds the Brush and pushes it onto Fill.
// External writes to Fill decompose into mirror DPs so the chrome
// reflects whatever brush the consumer hands in.
export class FillEditor extends TemplatedControl
{
    // ── Output ─────────────────────────────────────────────────────────
    public static override readonly FillKey    = MuralBase.RegisterProperty<Brush | undefined>(FillEditor, 'Fill',    undefined,                MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly VariantKey = MuralBase.RegisterProperty<FillEditorVariant>(FillEditor, 'Variant', FillEditorVariant.Solid,  MetaData.None);
    public static readonly FillOpacityKey = MuralBase.RegisterProperty<number>(       FillEditor, 'FillOpacity', 100,                  MetaData.None);
    // Section header text shown above the variant tabs. Defaults to "Fill";
    // set to "" to suppress the header entirely (e.g. when the editor is
    // embedded under another section's title, like the Line section reusing
    // this tabbed editor for its stroke brush).
    public static readonly HeaderKey = MuralBase.RegisterProperty<string>(           FillEditor, 'Header',      'Fill',                MetaData.None);
    // Style trigger picks the variant body and writes it here.
    public static readonly BodyTemplateKey = MuralBase.RegisterProperty<ControlTemplate | undefined>(FillEditor, 'BodyTemplate', undefined, MetaData.None);

    // ── Solid mirror ───────────────────────────────────────────────────
    public static readonly SolidColorKey = MuralBase.RegisterProperty<Color>(FillEditor, 'SolidColor', Color.FromHex('#1976d2'), MetaData.None);

    // ── Linear mirror ──────────────────────────────────────────────────
    public static readonly LinearStartColorKey = MuralBase.RegisterProperty<Color>( FillEditor, 'LinearStartColor', Color.FromHex('#ffffff'), MetaData.None);
    public static readonly LinearEndColorKey   = MuralBase.RegisterProperty<Color>( FillEditor, 'LinearEndColor',   Color.FromHex('#1976d2'), MetaData.None);
    public static readonly LinearAngleKey      = MuralBase.RegisterProperty<number>(FillEditor, 'LinearAngle',      0,                        MetaData.None);

    // ── Radial mirror ──────────────────────────────────────────────────
    public static readonly RadialInnerColorKey = MuralBase.RegisterProperty<Color>( FillEditor, 'RadialInnerColor', Color.FromHex('#ffffff'), MetaData.None);
    public static readonly RadialOuterColorKey = MuralBase.RegisterProperty<Color>( FillEditor, 'RadialOuterColor', Color.FromHex('#1976d2'), MetaData.None);
    public static readonly RadialCenterXKey    = MuralBase.RegisterProperty<number>(FillEditor, 'RadialCenterX',    50,                       MetaData.None);
    public static readonly RadialCenterYKey    = MuralBase.RegisterProperty<number>(FillEditor, 'RadialCenterY',    50,                       MetaData.None);
    public static readonly RadialRadiusKey     = MuralBase.RegisterProperty<number>(FillEditor, 'RadialRadius',     50,                       MetaData.None);

    // ── Pattern mirror ─────────────────────────────────────────────────
    public static readonly PatternKindKey       = MuralBase.RegisterProperty<PatternKind>(FillEditor, 'PatternKind',       PatternKind.Stripes,        MetaData.None);
    public static readonly PatternForegroundKey = MuralBase.RegisterProperty<Color>(      FillEditor, 'PatternForeground', Color.FromHex('#1976d2'),   MetaData.None);
    public static readonly PatternBackgroundKey = MuralBase.RegisterProperty<Color>(      FillEditor, 'PatternBackground', Color.Transparent,          MetaData.None);
    public static readonly PatternSizeKey       = MuralBase.RegisterProperty<number>(     FillEditor, 'PatternSize',       8,                          MetaData.None);
    public static readonly PatternAngleKey      = MuralBase.RegisterProperty<number>(     FillEditor, 'PatternAngle',      0,                          MetaData.None);
    public static readonly PatternStrokeKey     = MuralBase.RegisterProperty<number>(     FillEditor, 'PatternStroke',     1,                          MetaData.None);

    // ── Picture mirror ─────────────────────────────────────────────────
    public static readonly PictureUriKey   = MuralBase.RegisterProperty<string>(    FillEditor, 'PictureUri',   '',                MetaData.None);
    public static readonly PictureStretchKey = MuralBase.RegisterProperty<Stretch>( FillEditor, 'PictureStretch', Stretch.Uniform, MetaData.None);

    public override get Fill():    Brush | undefined  { return this.get_property_value(FillEditor.FillKey); }
    public override set Fill(v:    Brush | undefined) { this.set_property_value(FillEditor.FillKey, v); }
    public get Variant(): FillEditorVariant  { return this.get_property_value(FillEditor.VariantKey); }
    public set Variant(v: FillEditorVariant) { this.set_property_value(FillEditor.VariantKey, v); }
    public get FillOpacity(): number         { return this.get_property_value(FillEditor.FillOpacityKey); }
    public set FillOpacity(v: number)        { this.set_property_value(FillEditor.FillOpacityKey, v); }
    public get Header(): string              { return this.get_property_value(FillEditor.HeaderKey); }
    public set Header(v: string)             { this.set_property_value(FillEditor.HeaderKey, v); }
    public get BodyTemplate(): ControlTemplate | undefined  { return this.get_property_value(FillEditor.BodyTemplateKey); }
    public set BodyTemplate(v: ControlTemplate | undefined) { this.set_property_value(FillEditor.BodyTemplateKey, v); }

    public get SolidColor(): Color  { return this.get_property_value(FillEditor.SolidColorKey); }
    public set SolidColor(v: Color) { this.set_property_value(FillEditor.SolidColorKey, v); }
    public get LinearStartColor(): Color { return this.get_property_value(FillEditor.LinearStartColorKey); }
    public set LinearStartColor(v: Color){ this.set_property_value(FillEditor.LinearStartColorKey, v); }
    public get LinearEndColor():   Color { return this.get_property_value(FillEditor.LinearEndColorKey); }
    public set LinearEndColor(v:   Color){ this.set_property_value(FillEditor.LinearEndColorKey, v); }
    public get LinearAngle():      number{ return this.get_property_value(FillEditor.LinearAngleKey); }
    public set LinearAngle(v:      number){ this.set_property_value(FillEditor.LinearAngleKey, v); }
    public get RadialInnerColor(): Color  { return this.get_property_value(FillEditor.RadialInnerColorKey); }
    public set RadialInnerColor(v: Color) { this.set_property_value(FillEditor.RadialInnerColorKey, v); }
    public get RadialOuterColor(): Color  { return this.get_property_value(FillEditor.RadialOuterColorKey); }
    public set RadialOuterColor(v: Color) { this.set_property_value(FillEditor.RadialOuterColorKey, v); }
    public get RadialCenterX():    number { return this.get_property_value(FillEditor.RadialCenterXKey); }
    public set RadialCenterX(v:    number){ this.set_property_value(FillEditor.RadialCenterXKey, v); }
    public get RadialCenterY():    number { return this.get_property_value(FillEditor.RadialCenterYKey); }
    public set RadialCenterY(v:    number){ this.set_property_value(FillEditor.RadialCenterYKey, v); }
    public get RadialRadius():     number { return this.get_property_value(FillEditor.RadialRadiusKey); }
    public set RadialRadius(v:     number){ this.set_property_value(FillEditor.RadialRadiusKey, v); }
    public get PatternKind():       PatternKind { return this.get_property_value(FillEditor.PatternKindKey); }
    public set PatternKind(v:       PatternKind){ this.set_property_value(FillEditor.PatternKindKey, v); }
    public get PatternForeground(): Color  { return this.get_property_value(FillEditor.PatternForegroundKey); }
    public set PatternForeground(v: Color) { this.set_property_value(FillEditor.PatternForegroundKey, v); }
    public get PatternBackground(): Color  { return this.get_property_value(FillEditor.PatternBackgroundKey); }
    public set PatternBackground(v: Color) { this.set_property_value(FillEditor.PatternBackgroundKey, v); }
    public get PatternSize():       number { return this.get_property_value(FillEditor.PatternSizeKey); }
    public set PatternSize(v:       number){ this.set_property_value(FillEditor.PatternSizeKey, v); }
    public get PatternAngle():      number { return this.get_property_value(FillEditor.PatternAngleKey); }
    public set PatternAngle(v:      number){ this.set_property_value(FillEditor.PatternAngleKey, v); }
    public get PatternStroke():     number { return this.get_property_value(FillEditor.PatternStrokeKey); }
    public set PatternStroke(v:     number){ this.set_property_value(FillEditor.PatternStrokeKey, v); }
    public get PictureUri():     string  { return this.get_property_value(FillEditor.PictureUriKey); }
    public set PictureUri(v:     string) { this.set_property_value(FillEditor.PictureUriKey, v); }
    public get PictureStretch(): Stretch { return this.get_property_value(FillEditor.PictureStretchKey); }
    public set PictureStretch(v: Stretch){ this.set_property_value(FillEditor.PictureStretchKey, v); }

    static
    {
        MuralBase.OverrideMetadata(FillEditor, Element.DefaultStyleKeyKey, { default_value: FillEditor });
    }

    private _syncing = false;
    private _headerText: TextBlock | undefined;
    private _headerRule: Visual    | undefined;
    private _tabSolid:   Border    | undefined;
    private _tabNone:    Border    | undefined;
    private _tabLinear:  Border    | undefined;
    private _tabRadial:  Border    | undefined;
    private _tabPattern: Border    | undefined;
    private _tabPicture: Border    | undefined;
    private _bodyHost:   Border    | undefined;
    private _bodyRoot:   Visual    | undefined;
    private _opacityEdit:    SliderSpinEdit | undefined;
    // Typed as Panel — the template renders this as a Grid for the
    // label/editor 2-column layout. We only touch Visibility from
    // here, so the narrower interface is enough.
    private _opacityRow:     Panel      | undefined;
    // Subscriptions for parts inside the swappable body. Drained on every
    // body re-apply so we don't leak handlers on the prior body's
    // ColorPickers / Sliders.
    private _bodyListeners: Disposable[] = [];
    // Re-seed closures for the body's controls — one per part, each pushing the
    // current mirror-DP value into its control. Run at wire time AND after every
    // external Fill decompose (reseedBody) so the body reflects the CURRENT fill
    // — e.g. as the diagram selection changes — not just the value present when
    // the body template was applied. Without this the pickers/sliders were
    // wired one-way (seed once, listen for user edits) and went stale on reselect.
    private _bodySeeds: Array<() => void> = [];
    // Tab + opacity teardown closures — installed once at template
    // apply time. Stored separately so a BodyTemplate swap doesn't
    // tear them down.
    private _persistentListeners: Array<() => void> = [];

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptTemplateParts();
        // Seed the chrome from whatever Fill the consumer pre-set.
        // Fill=undefined → Variant=None → whole section stays collapsed
        // until a real brush arrives via a later binding push. We used
        // to auto-build a default Solid brush here, but that left the
        // editor stuck on Solid for genuinely unbound consumers (e.g.,
        // the diagrammer's "nothing selected" state) and pushed an
        // unrequested brush back upstream.
        this.decomposeFill(this.Fill);
        this.refreshTabHighlight();
        this.refreshOpacityRowVisibility();
        this.applyBodyTemplate();
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== FillEditor) return;
        const name = descriptor.Name;

        if (name === 'Variant')
        {
            this.refreshTabHighlight();
            this.refreshOpacityRowVisibility();
            if (this._syncing) return;
            this._syncing = true;
            try { this.Fill = this.buildFillForVariant(); }
            finally { this._syncing = false; }
            return;
        }
        if (name === 'BodyTemplate')
        {
            this.applyBodyTemplate();
            return;
        }
        if (name === 'Header')
        {
            this.refreshHeader();
            return;
        }
        if (name === 'Fill')
        {
            if (this._syncing) return;
            this._syncing = true;
            try { this.decomposeFill(newValue as Brush | undefined); }
            finally { this._syncing = false; }
            // Refresh the live body controls to the freshly decomposed mirror
            // DPs (decomposeFill may set them after the body was applied, and a
            // same-variant reselect never re-applies the body at all).
            this.reseedBody();
            return;
        }
        if (name === 'FillOpacity')
        {
            // FillOpacity mirrors brush.Opacity as a 0..100 percent. The
            // editor shows TRANSPARENCY (MS-Office convention), the inverse:
            // transparency = 100 − opacity. Push the inverted value into the
            // editor regardless of _syncing so an external decomposeFill
            // (under _syncing) still refreshes the chrome; the editor's own
            // listener guards on _syncing so this write doesn't echo back.
            if (this._opacityEdit !== undefined)
            {
                const prev = this._syncing;
                this._syncing = true;
                try { this._opacityEdit.Value = 100 - (newValue as number); }
                finally { this._syncing = prev; }
            }
            // A direct external FillOpacity write rebuilds + reassigns Fill
            // so the TwoWay binding propagates (see the editor handler note).
            // Skipped under _syncing — that path is decomposeFill reflecting
            // an inbound brush, which must not echo back.
            if (!this._syncing)
            {
                this._syncing = true;
                try { this.Fill = this.buildFillForVariant(); }
                finally { this._syncing = false; }
            }
            return;
        }
        // Mirror DP write → rebuild and push.
        if (this._syncing) return;
        this._syncing = true;
        try { this.Fill = this.buildFillForVariant(); }
        finally { this._syncing = false; }
    }

    // Apply the Header DP to PART_Header: set its text and collapse the
    // row entirely when Header is empty (so an embedded editor reusing
    // this template — the Line section's stroke brush — doesn't show a
    // second section title under the owning "Line" header).
    private refreshHeader(): void
    {
        if (this._headerText === undefined) return;
        const header = this.Header;
        this._headerText.Text       = header;
        const vis = header.length > 0 ? Visibility.Visible : Visibility.Collapsed;
        this._headerText.Visibility = vis;
        // The header rule tracks the header: an embedded editor reusing
        // this template with Header="" (the Line section's stroke brush)
        // shows neither the title nor the divider under it.
        if (this._headerRule !== undefined) this._headerRule.Visibility = vis;
    }

    private adoptTemplateParts(): void
    {
        this._headerText = this.GetTemplateChild('PART_Header')     as TextBlock | undefined;
        this._headerRule = this.GetTemplateChild('PART_HeaderRule') as Visual    | undefined;
        this.refreshHeader();
        this._tabNone    = this.GetTemplateChild('PART_TabNone')    as Border | undefined;
        this._tabSolid   = this.GetTemplateChild('PART_TabSolid')   as Border | undefined;
        this._tabLinear  = this.GetTemplateChild('PART_TabLinear')  as Border | undefined;
        this._tabRadial  = this.GetTemplateChild('PART_TabRadial')  as Border | undefined;
        this._tabPattern = this.GetTemplateChild('PART_TabPattern') as Border | undefined;
        this._tabPicture = this.GetTemplateChild('PART_TabPicture') as Border | undefined;
        this._bodyHost   = this.GetTemplateChild('PART_BodyHost')   as Border | undefined;
        this._opacityEdit    = this.GetTemplateChild('PART_OpacityEdit')    as SliderSpinEdit | undefined;
        this._opacityRow     = this.GetTemplateChild('PART_OpacityRow')     as Panel      | undefined;

        const wireTab = (tab: Border | undefined, target: FillEditorVariant): void => {
            if (tab === undefined) return;
            let pressed = false;
            const onDown = ((): void => {
                pressed = true;
                tab._setIsPressed(true);
            }) as (a: unknown) => void;
            const onUp = ((): void => {
                const fire = pressed;
                pressed = false;
                tab._setIsPressed(false);
                if (fire) this.Variant = target;
            }) as (a: unknown) => void;
            const onLeave = ((): void => {
                pressed = false;
                tab._setIsPressed(false);
            }) as (a: unknown) => void;
            tab.AddRoutedEventListener('PointerDown', onDown);
            tab.AddRoutedEventListener('PointerUp',   onUp);
            tab.AddRoutedEventListener('PointerLeave', onLeave);
            this._persistentListeners.push(() => {
                tab.RemoveRoutedEventListener('PointerDown', onDown);
                tab.RemoveRoutedEventListener('PointerUp',   onUp);
                tab.RemoveRoutedEventListener('PointerLeave', onLeave);
            });
        };
        wireTab(this._tabNone,    FillEditorVariant.None);
        wireTab(this._tabSolid,   FillEditorVariant.Solid);
        wireTab(this._tabLinear,  FillEditorVariant.Linear);
        wireTab(this._tabRadial,  FillEditorVariant.Radial);
        wireTab(this._tabPattern, FillEditorVariant.Pattern);
        wireTab(this._tabPicture, FillEditorVariant.Picture);

        if (this._opacityEdit !== undefined)
        {
            const s = this._opacityEdit;
            // The editor reads TRANSPARENCY = 100 − opacity (MS-Office).
            this._syncing = true;
            try { s.Value = 100 - this.FillOpacity; }
            finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                const opacity = 100 - s.Value;
                this._syncing = true;
                try { this.FillOpacity = opacity; }
                finally { this._syncing = false; }
                // Rebuild + reassign Fill (same as every other editor
                // handler) so the TwoWay binding pushes a fresh brush to
                // the consumer. An in-place `brush.Opacity =` mutates the
                // shared instance without firing the binding, so a shape
                // that receives Fill by value never re-renders.
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(s, undefined, 'Value');
            const sub = s.PropertyChanged(key).subscribe(handler);
            this._persistentListeners.push(() => sub.dispose());
        }
    }

    // Active-tab highlight is handled by Style triggers in the
    // template (each tab's Fill flips when `Variant=…` matches).
    // This method exists for parity with the other refresh hooks but
    // does no imperative work — kept so the OnPropertyChanged path
    // stays explicit when triggers grow later.
    private refreshTabHighlight(): void { /* trigger-driven */ }

    // When Variant=None the variant body + transparency row collapse —
    // there's no brush to operate on — but the section header and the
    // variant tab row stay visible so the user can click a tab to
    // switch back to a brush. The whole-section collapse (used in the
    // "no shape selected" empty state) lives in ShapeFormatControl,
    // which flips PART_Editors at that level; FillEditor alone never
    // hides its own tabs. Visibility=Collapsed zeroes the DesiredSize
    // and suppresses paint + hit-test — no margin caching, no leaking
    // children, no manual layout poking.
    private refreshOpacityRowVisibility(): void
    {
        const v = this.Variant === FillEditorVariant.None
            ? Visibility.Collapsed
            : Visibility.Visible;
        if (this._bodyHost   !== undefined) this._bodyHost.Visibility   = v;
        if (this._opacityRow !== undefined) this._opacityRow.Visibility = v;
    }

    // Materialise the variant body into PART_BodyHost. The Style picks
    // the BodyTemplate (a ControlTemplate) on every Variant change;
    // we Apply it with this FillEditor as templatedParent so $$
    // bindings inside resolve against our mirror DPs, then slot the
    // applied root into PART_BodyHost's Child.
    private applyBodyTemplate(): void
    {
        const host = this._bodyHost;
        if (host === undefined) return;
        for (const sub of this._bodyListeners) sub.dispose();
        this._bodyListeners = [];
        this._bodySeeds = [];
        host.SetChild(undefined);
        this._bodyRoot = undefined;
        const tpl = this.BodyTemplate;
        if (tpl === undefined) return;
        const inst = tpl.Apply(this);
        const root = inst.root as Visual;
        host.SetChild(root);
        this._bodyRoot = root;
        this.wireBodyParts();
    }

    // Push every body control back to its current mirror-DP value. Called after
    // an external Fill decompose so the swappable body reflects the new fill (a
    // diagram reselect hands the editor a fresh Fill but never re-applies the
    // body when the variant is unchanged). Runs under _syncing so each control's
    // own change listener bails instead of echoing back into the mirror DPs.
    private reseedBody(): void
    {
        if (this._bodySeeds.length === 0) return;
        const prev = this._syncing;
        this._syncing = true;
        try { for (const seed of this._bodySeeds) seed(); }
        finally { this._syncing = prev; }
    }

    private wireBodyParts(): void
    {
        const root = this._bodyRoot;
        if (root === undefined) return;
        // Each Apply() gives the body root its own NameScope, so the
        // body-template PART_ names live there — not on this Visual's
        // surrounding scope. Look them up against the body root.
        const find = <T>(name: string): T | undefined => root.FindName(name) as T | undefined;

        // Embedded ColorPickers — same wiring shape as BrushPicker's
        // popup wiring.
        const wireColor = (
            partName: string,
            read:  () => Color,
            write: (c: Color) => void,
        ): void => {
            const cp = find<ColorPicker>(partName);
            if (cp === undefined) return;
            const seed = (): void => { cp.Color = read(); };
            this._syncing = true;
            try { seed(); }
            finally { this._syncing = false; }
            this._bodySeeds.push(seed);
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { write(cp.Color); }
                finally { this._syncing = false; }
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(cp, undefined, 'Color');
            this._bodyListeners.push(cp.PropertyChanged(key).subscribe(handler));
        };
        wireColor('PART_SolidColor',        () => this.SolidColor,        c => { this.SolidColor        = c; });
        wireColor('PART_LinearStart',       () => this.LinearStartColor,  c => { this.LinearStartColor  = c; });
        wireColor('PART_LinearEnd',         () => this.LinearEndColor,    c => { this.LinearEndColor    = c; });
        wireColor('PART_RadialInner',       () => this.RadialInnerColor,  c => { this.RadialInnerColor  = c; });
        wireColor('PART_RadialOuter',       () => this.RadialOuterColor,  c => { this.RadialOuterColor  = c; });
        wireColor('PART_PatternForeground', () => this.PatternForeground, c => { this.PatternForeground = c; });
        wireColor('PART_PatternBackground', () => this.PatternBackground, c => { this.PatternBackground = c; });

        const wireSlider = (
            partName: string,
            read:  () => number,
            write: (v: number) => void,
        ): void => {
            const s = find<Slider>(partName);
            if (s === undefined) return;
            const seed = (): void => { s.Value = read(); };
            this._syncing = true;
            try { seed(); }
            finally { this._syncing = false; }
            this._bodySeeds.push(seed);
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { write(s.Value); }
                finally { this._syncing = false; }
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(s, undefined, 'Value');
            this._bodyListeners.push(s.PropertyChanged(key).subscribe(handler));
        };
        wireSlider('PART_LinearAngle',   () => this.LinearAngle,   v => { this.LinearAngle   = v; });
        wireSlider('PART_RadialCenterX', () => this.RadialCenterX, v => { this.RadialCenterX = v; });
        wireSlider('PART_RadialCenterY', () => this.RadialCenterY, v => { this.RadialCenterY = v; });
        wireSlider('PART_RadialRadius',  () => this.RadialRadius,  v => { this.RadialRadius  = v; });
        wireSlider('PART_PatternSize',   () => this.PatternSize,   v => { this.PatternSize   = v; });
        wireSlider('PART_PatternAngle',  () => this.PatternAngle,  v => { this.PatternAngle  = v; });
        wireSlider('PART_PatternStroke', () => this.PatternStroke, v => { this.PatternStroke = v; });

        const kindCombo = find<ComboBox>('PART_PatternKind');
        if (kindCombo !== undefined)
        {
            kindCombo.Items = [
                PatternKind.Stripes, PatternKind.Dots, PatternKind.Checker,
                PatternKind.Grid,    PatternKind.CrossHatch,
            ] as unknown[];
            const seedKind = (): void => { kindCombo.SelectedItem = this.PatternKind; };
            this._syncing = true;
            try { seedKind(); }
            finally { this._syncing = false; }
            this._bodySeeds.push(seedKind);
            const handler = (): void => {
                if (this._syncing) return;
                const sel = kindCombo.SelectedItem as PatternKind | undefined;
                if (sel === undefined) return;
                this._syncing = true;
                try { this.PatternKind = sel; }
                finally { this._syncing = false; }
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(kindCombo, undefined, 'SelectedItem');
            this._bodyListeners.push(kindCombo.PropertyChanged(key).subscribe(handler));
        }

        const uriBox = find<TextBox>('PART_PictureUri');
        if (uriBox !== undefined)
        {
            const seedUri = (): void => { uriBox.Text = this.PictureUri; };
            this._syncing = true;
            try { seedUri(); }
            finally { this._syncing = false; }
            this._bodySeeds.push(seedUri);
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { this.PictureUri = uriBox.Text; }
                finally { this._syncing = false; }
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(uriBox, undefined, 'Text');
            this._bodyListeners.push(uriBox.PropertyChanged(key).subscribe(handler));
        }

        const stretchCombo = find<ComboBox>('PART_PictureStretch');
        if (stretchCombo !== undefined)
        {
            stretchCombo.Items = [
                Stretch.None, Stretch.Fill, Stretch.Uniform, Stretch.UniformToFill,
            ] as unknown[];
            const seedStretch = (): void => { stretchCombo.SelectedItem = this.PictureStretch; };
            this._syncing = true;
            try { seedStretch(); }
            finally { this._syncing = false; }
            this._bodySeeds.push(seedStretch);
            const handler = (): void => {
                if (this._syncing) return;
                const sel = stretchCombo.SelectedItem as Stretch | undefined;
                if (sel === undefined) return;
                this._syncing = true;
                try { this.PictureStretch = sel; }
                finally { this._syncing = false; }
                this.Fill = this.buildFillForVariant();
            };
            const key = resolveKey(stretchCombo, undefined, 'SelectedItem');
            this._bodyListeners.push(stretchCombo.PropertyChanged(key).subscribe(handler));
        }
    }

    private buildFillForVariant(): Brush | undefined
    {
        const opacity = this.FillOpacity / 100;
        switch (this.Variant)
        {
            case FillEditorVariant.None:
                return undefined;
            case FillEditorVariant.Solid:
            {
                const b = new SolidColorBrush(this.SolidColor);
                b.Opacity = opacity;
                return b;
            }
            case FillEditorVariant.Linear:
            {
                const b = new LinearGradientBrush([
                    new GradientStop(this.LinearStartColor, 0),
                    new GradientStop(this.LinearEndColor,   1),
                ]);
                const rad = (this.LinearAngle * Math.PI) / 180;
                const dx = Math.cos(rad);
                const dy = Math.sin(rad);
                b.StartPoint = new Point(0.5 - dx * 0.5, 0.5 - dy * 0.5);
                b.EndPoint   = new Point(0.5 + dx * 0.5, 0.5 + dy * 0.5);
                b.Opacity = opacity;
                return b;
            }
            case FillEditorVariant.Radial:
            {
                const b = new RadialGradientBrush([
                    new GradientStop(this.RadialInnerColor, 0),
                    new GradientStop(this.RadialOuterColor, 1),
                ]);
                b.Center  = new Point(this.RadialCenterX / 100, this.RadialCenterY / 100);
                b.RadiusX = this.RadialRadius / 100;
                b.RadiusY = this.RadialRadius / 100;
                b.Opacity = opacity;
                return b;
            }
            case FillEditorVariant.Pattern:
            {
                const b = new PatternBrush(this.PatternKind, this.PatternForeground);
                b.Background      = this.PatternBackground;
                b.Size            = this.PatternSize;
                b.Angle           = this.PatternAngle;
                b.StrokeThickness = this.PatternStroke;
                b.Opacity         = opacity;
                return b;
            }
            case FillEditorVariant.Picture:
            {
                if (this.PictureUri === '') return undefined;
                const b = new ImageBrush(new BitmapImage(this.PictureUri));
                b.Stretch    = this.PictureStretch;
                b.AlignmentX = AlignmentX.Center;
                b.AlignmentY = AlignmentY.Center;
                b.Opacity    = opacity;
                return b;
            }
        }
    }

    // Decompose an externally-set Fill into mirror DPs. Only the slice
    // matching the brush type is updated; mirror DPs for the other
    // variants stay at whatever they were so the user's prior solid
    // colour survives a flip to Pattern and back.
    private decomposeFill(brush: Brush | undefined): void
    {
        if (brush === undefined)
        {
            this.Variant = FillEditorVariant.None;
            return;
        }
        // Opacity rides on every brush — track it regardless of subclass.
        this.FillOpacity = Math.round(brush.Opacity * 100);
        if (brush instanceof SolidColorBrush)
        {
            this.Variant    = FillEditorVariant.Solid;
            this.SolidColor = brush.Color;
            return;
        }
        if (brush instanceof LinearGradientBrush)
        {
            this.Variant = FillEditorVariant.Linear;
            const stops = brush.GradientStops;
            if (stops.length > 0) this.LinearStartColor = stops[0]!.Color;
            if (stops.length > 1) this.LinearEndColor   = stops[stops.length - 1]!.Color;
            const dx = brush.EndPoint.X - brush.StartPoint.X;
            const dy = brush.EndPoint.Y - brush.StartPoint.Y;
            this.LinearAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return;
        }
        if (brush instanceof RadialGradientBrush)
        {
            this.Variant = FillEditorVariant.Radial;
            const stops = brush.GradientStops;
            if (stops.length > 0) this.RadialInnerColor = stops[0]!.Color;
            if (stops.length > 1) this.RadialOuterColor = stops[stops.length - 1]!.Color;
            this.RadialCenterX = brush.Center.X * 100;
            this.RadialCenterY = brush.Center.Y * 100;
            this.RadialRadius  = brush.RadiusX * 100;
            return;
        }
        if (brush instanceof PatternBrush)
        {
            this.Variant            = FillEditorVariant.Pattern;
            this.PatternKind        = brush.Kind;
            this.PatternForeground  = brush.Foreground;
            this.PatternBackground  = brush.Background;
            this.PatternSize        = brush.Size;
            this.PatternAngle       = brush.Angle;
            this.PatternStroke      = brush.StrokeThickness;
            return;
        }
        if (brush instanceof ImageBrush)
        {
            this.Variant        = FillEditorVariant.Picture;
            this.PictureUri     = (brush.ImageSource as BitmapImage | undefined)?.Uri ?? '';
            this.PictureStretch = brush.Stretch;
            return;
        }
    }
}
