import {
    MetaData,
    MuralBase,
    Point,
    Element, Visual,
    type PropertyDescriptor,
    type Disposable,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import {
    Brush,
    Color,
    GradientStop,
    ImageBrush,
    LinearGradientBrush,
    PatternBrush,
    PatternKind,
    RadialGradientBrush,
    SolidColorBrush,
} from '../../visual-engine/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { Border } from '../../basic/border.js';
import type { PresentationTarget } from '../../visual-engine/index.js';
import { MenuPopupHost, MenuAnchorSide } from '../menu/menu-strip.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';
import { ColorPicker } from './color-picker.js';
import { Slider } from '../../basic/slider.js';
import { ComboBox } from '../list/combo-box.js';

// Brush-shape discriminator. Drives which sub-editor the popup shows
// and which concrete Brush subclass the picker emits on its `Brush` DP.
// Solid is the default — matches the closed-chrome swatch a consumer
// expects when they drop a fresh BrushPicker onto a surface.
export enum BrushPickerVariant
{
    Solid   = 'Solid',
    Linear  = 'Linear',
    Radial  = 'Radial',
    Pattern = 'Pattern',
}

// ComboBox-style brush editor with four flavours behind one Variant DP.
//
// Source-of-truth contract: `Brush` is the output. Every sub-editor DP
// (Color, StartColor, EndColor, Angle, CenterX/Y, PatternKind, …) is a
// flat mirror; OnPropertyChanged on any of them rebuilds the Brush
// instance and pushes it out. Conversely, when an external write sets
// Brush, OnPropertyChanged decomposes it back into the mirror DPs (so
// the popup chrome reflects the bound brush on first open).
//
// The mirror flattens the brush hierarchy on purpose — `$Brush.Stops`
// dotted-path bindings would force the consumer to swap the whole Brush
// instance for every keystroke. Flat DPs let the popup's sliders and
// inputs bind to the picker directly via TemplatedParent and never
// touch the Brush identity.
export class BrushPicker extends TemplatedControl
{
    // ── Output ─────────────────────────────────────────────────────────
    public static readonly BrushKey   = MuralBase.RegisterProperty<Brush | undefined>(BrushPicker, 'Brush',  undefined, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly VariantKey = MuralBase.RegisterProperty<BrushPickerVariant>(BrushPicker, 'Variant', BrushPickerVariant.Solid, MetaData.None);

    // ── Closed-chrome / popup plumbing ─────────────────────────────────
    public static readonly IsDropDownOpenKey = MuralBase.RegisterProperty<boolean>(BrushPicker, 'IsDropDownOpen', false, MetaData.None);
    public static readonly PopupTemplateKey  = MuralBase.RegisterProperty<ControlTemplate | undefined>(BrushPicker, 'PopupTemplate', undefined, MetaData.None);
    // Closed-chrome swatch: a Border whose Fill mirrors the
    // current Brush. Per-instance default so the template's
    // `$$PreviewBrush` binding lands on something the picker can mutate
    // in sync (every BrushPicker gets its own preview instance).
    public static readonly PreviewBrushKey = MuralBase.RegisterProperty<Brush | undefined>(BrushPicker, 'PreviewBrush', undefined, MetaData.None);

    // ── Solid mirror ───────────────────────────────────────────────────
    public static readonly SolidColorKey = MuralBase.RegisterProperty<Color>(BrushPicker, 'SolidColor', Color.Black, MetaData.None);

    // ── Linear mirror ──────────────────────────────────────────────────
    // Reduced to a 2-stop editor (start + end) plus an angle in degrees.
    // The popup paints the gradient at the chosen angle into [0,1]×[0,1]
    // bounding-box coordinates; consumers wanting > 2 stops can mutate
    // the emitted brush externally or swap it for a hand-built one.
    public static readonly LinearStartColorKey = MuralBase.RegisterProperty<Color>( BrushPicker, 'LinearStartColor', Color.Black, MetaData.None);
    public static readonly LinearEndColorKey   = MuralBase.RegisterProperty<Color>( BrushPicker, 'LinearEndColor',   Color.White, MetaData.None);
    public static readonly LinearAngleKey      = MuralBase.RegisterProperty<number>(BrushPicker, 'LinearAngle',      0,           MetaData.None);

    // ── Radial mirror ──────────────────────────────────────────────────
    // 2-stop inner→outer + a single Radius (RadiusX = RadiusY) and
    // center XY in [0,1] BB coords. Same compromise as Linear — full
    // editor for power users can come later behind a Variant=… branch.
    public static readonly RadialInnerColorKey = MuralBase.RegisterProperty<Color>( BrushPicker, 'RadialInnerColor', Color.White, MetaData.None);
    public static readonly RadialOuterColorKey = MuralBase.RegisterProperty<Color>( BrushPicker, 'RadialOuterColor', Color.Black, MetaData.None);
    public static readonly RadialCenterXKey    = MuralBase.RegisterProperty<number>(BrushPicker, 'RadialCenterX',    50,          MetaData.None);
    public static readonly RadialCenterYKey    = MuralBase.RegisterProperty<number>(BrushPicker, 'RadialCenterY',    50,          MetaData.None);
    public static readonly RadialRadiusKey     = MuralBase.RegisterProperty<number>(BrushPicker, 'RadialRadius',     50,          MetaData.None);

    // ── Pattern mirror ─────────────────────────────────────────────────
    public static readonly PatternKindKey       = MuralBase.RegisterProperty<PatternKind>(BrushPicker, 'PatternKind',       PatternKind.Stripes, MetaData.None);
    public static readonly PatternForegroundKey = MuralBase.RegisterProperty<Color>(      BrushPicker, 'PatternForeground', Color.Black,         MetaData.None);
    public static readonly PatternBackgroundKey = MuralBase.RegisterProperty<Color>(      BrushPicker, 'PatternBackground', Color.Transparent,   MetaData.None);
    public static readonly PatternSizeKey       = MuralBase.RegisterProperty<number>(     BrushPicker, 'PatternSize',       8,                   MetaData.None);
    public static readonly PatternAngleKey      = MuralBase.RegisterProperty<number>(     BrushPicker, 'PatternAngle',      0,                   MetaData.None);
    public static readonly PatternStrokeKey     = MuralBase.RegisterProperty<number>(     BrushPicker, 'PatternStroke',     1,                   MetaData.None);

    public get Brush():   Brush | undefined { return this.get_property_value(BrushPicker.BrushKey); }
    public set Brush(v:   Brush | undefined){ this.set_property_value(BrushPicker.BrushKey, v); }
    public get Variant(): BrushPickerVariant { return this.get_property_value(BrushPicker.VariantKey); }
    public set Variant(v: BrushPickerVariant){ this.set_property_value(BrushPicker.VariantKey, v); }
    public get IsDropDownOpen(): boolean { return this.get_property_value(BrushPicker.IsDropDownOpenKey); }
    public set IsDropDownOpen(v: boolean){ this.set_property_value(BrushPicker.IsDropDownOpenKey, v); }
    public get PopupTemplate(): ControlTemplate | undefined { return this.get_property_value(BrushPicker.PopupTemplateKey); }
    public set PopupTemplate(v: ControlTemplate | undefined){ this.set_property_value(BrushPicker.PopupTemplateKey, v); }
    public get PreviewBrush(): Brush | undefined { return this.get_property_value(BrushPicker.PreviewBrushKey); }

    public get SolidColor(): Color { return this.get_property_value(BrushPicker.SolidColorKey); }
    public set SolidColor(v: Color){ this.set_property_value(BrushPicker.SolidColorKey, v); }

    public get LinearStartColor(): Color  { return this.get_property_value(BrushPicker.LinearStartColorKey); }
    public set LinearStartColor(v: Color) { this.set_property_value(BrushPicker.LinearStartColorKey, v); }
    public get LinearEndColor():   Color  { return this.get_property_value(BrushPicker.LinearEndColorKey); }
    public set LinearEndColor(v:   Color) { this.set_property_value(BrushPicker.LinearEndColorKey, v); }
    public get LinearAngle():      number { return this.get_property_value(BrushPicker.LinearAngleKey); }
    public set LinearAngle(v:      number){ this.set_property_value(BrushPicker.LinearAngleKey, v); }

    public get RadialInnerColor(): Color  { return this.get_property_value(BrushPicker.RadialInnerColorKey); }
    public set RadialInnerColor(v: Color) { this.set_property_value(BrushPicker.RadialInnerColorKey, v); }
    public get RadialOuterColor(): Color  { return this.get_property_value(BrushPicker.RadialOuterColorKey); }
    public set RadialOuterColor(v: Color) { this.set_property_value(BrushPicker.RadialOuterColorKey, v); }
    public get RadialCenterX():    number { return this.get_property_value(BrushPicker.RadialCenterXKey); }
    public set RadialCenterX(v:    number){ this.set_property_value(BrushPicker.RadialCenterXKey, v); }
    public get RadialCenterY():    number { return this.get_property_value(BrushPicker.RadialCenterYKey); }
    public set RadialCenterY(v:    number){ this.set_property_value(BrushPicker.RadialCenterYKey, v); }
    public get RadialRadius():     number { return this.get_property_value(BrushPicker.RadialRadiusKey); }
    public set RadialRadius(v:     number){ this.set_property_value(BrushPicker.RadialRadiusKey, v); }

    public get PatternKind():       PatternKind { return this.get_property_value(BrushPicker.PatternKindKey); }
    public set PatternKind(v:       PatternKind){ this.set_property_value(BrushPicker.PatternKindKey, v); }
    public get PatternForeground(): Color  { return this.get_property_value(BrushPicker.PatternForegroundKey); }
    public set PatternForeground(v: Color) { this.set_property_value(BrushPicker.PatternForegroundKey, v); }
    public get PatternBackground(): Color  { return this.get_property_value(BrushPicker.PatternBackgroundKey); }
    public set PatternBackground(v: Color) { this.set_property_value(BrushPicker.PatternBackgroundKey, v); }
    public get PatternSize():       number { return this.get_property_value(BrushPicker.PatternSizeKey); }
    public set PatternSize(v:       number){ this.set_property_value(BrushPicker.PatternSizeKey, v); }
    public get PatternAngle():      number { return this.get_property_value(BrushPicker.PatternAngleKey); }
    public set PatternAngle(v:      number){ this.set_property_value(BrushPicker.PatternAngleKey, v); }
    public get PatternStroke():     number { return this.get_property_value(BrushPicker.PatternStrokeKey); }
    public set PatternStroke(v:     number){ this.set_property_value(BrushPicker.PatternStrokeKey, v); }

    static
    {
        MuralBase.OverrideMetadata(BrushPicker, Element.DefaultStyleKeyKey, { default_value: BrushPicker });
    }

    private _trigger:    Border | undefined;
    private _popupHost:  MenuPopupHost | undefined;
    private _mounted = false;
    private _triggerPressed = false;
    // Re-entry guard. `OnPropertyChanged` calls rebuildBrush, which
    // writes Brush. The Brush write fires OnPropertyChanged again with
    // 'Brush' as the descriptor — without the guard we'd ping-pong
    // forever (rebuild → write Brush → decompose → write mirror DPs →
    // rebuild …). Same shape as ColorPicker._syncing.
    private _syncing = false;
    // Per-mount listener disposers. Each tab handler / embedded
    // ColorPicker two-way wire pushes an unsubscribe closure here;
    // unmountPopup drains them so a re-open binds against a fresh
    // template instance without leaking listeners onto the prior one.
    private _popupListeners: Array<() => void> = [];

    constructor()
    {
        super();
        // Per-instance preview brush so the closed-chrome swatch's
        // Fill landed by `$$PreviewBrush` is mutable in-place.
        this.set_property_value(BrushPicker.PreviewBrushKey, new SolidColorBrush(Color.Black));
        this.applyDefaultStyle();
        // Initial brush rendering — picks up whatever the consumer
        // pre-set on Brush, or builds a Solid Black brush if Brush is
        // still undefined.
        if (this.Brush === undefined)
        {
            this._syncing = true;
            try { this.Brush = this.buildBrushForVariant(); }
            finally { this._syncing = false; }
        }
        else
        {
            this.decomposeBrush(this.Brush);
        }
        this.updatePreviewBrush();
        this.adoptTemplateParts();
    }

    private adoptTemplateParts(): void
    {
        this._trigger = this.GetTemplateChild('PART_SelectionTrigger') as Border | undefined;
        if (this._trigger !== undefined)
        {
            const t = this._trigger;
            t.AddRoutedEventListener('PointerDown', (() => {
                this._triggerPressed = true;
                t._setIsPressed(true);
            }) as (a: unknown) => void);
            t.AddRoutedEventListener('PointerUp', (() => {
                const fire = this._triggerPressed;
                this._triggerPressed = false;
                t._setIsPressed(false);
                if (fire) this.IsDropDownOpen = !this.IsDropDownOpen;
            }) as (a: unknown) => void);
            t.AddRoutedEventListener('PointerLeave', (() => {
                this._triggerPressed = false;
                t._setIsPressed(false);
            }) as (a: unknown) => void);
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== BrushPicker) return;
        const name = descriptor.Name;
        if (name === 'IsDropDownOpen')
        {
            if (newValue === true) this.mountPopup();
            else                    this.unmountPopup();
            return;
        }
        if (name === 'PreviewBrush') return;
        if (name === 'PopupTemplate')
        {
            // Style trigger swapped PopupTemplate (typically because
            // Variant just changed). If the popup is currently open,
            // remount it in place so the new template materialises
            // without forcing the user to re-click — the popup tabs at
            // the top let them swap variants while open.
            if (this._mounted)
            {
                this.unmountPopup();
                this.mountPopup();
            }
            return;
        }
        if (name === 'Variant')
        {
            // Variant change rebuilds the Brush — the new flavour emits
            // a different subclass instance. The PopupTemplate swap is
            // handled separately above (Style trigger).
            if (this._syncing) return;
            this._syncing = true;
            try { this.Brush = this.buildBrushForVariant(); }
            finally { this._syncing = false; }
            this.updatePreviewBrush();
            return;
        }
        if (name === 'Brush')
        {
            if (this._syncing) return;
            this._syncing = true;
            try { this.decomposeBrush(newValue as Brush | undefined); }
            finally { this._syncing = false; }
            this.updatePreviewBrush();
            return;
        }
        // Everything else is a mirror-DP write. Rebuild the Brush, push
        // the new instance out, and refresh the closed-chrome swatch.
        if (this._syncing) return;
        this._syncing = true;
        try { this.Brush = this.buildBrushForVariant(); }
        finally { this._syncing = false; }
        this.updatePreviewBrush();
    }

    // Build a Brush instance reflecting the current mirror DPs +
    // Variant. Called on every mirror-DP write so the bound Brush stays
    // up to date.
    private buildBrushForVariant(): Brush
    {
        switch (this.Variant)
        {
            case BrushPickerVariant.Solid:
                return new SolidColorBrush(this.SolidColor);
            case BrushPickerVariant.Linear:
            {
                const stops = [
                    new GradientStop(this.LinearStartColor, 0),
                    new GradientStop(this.LinearEndColor,   1),
                ];
                const b = new LinearGradientBrush(stops);
                // Convert degrees → start/end points on the unit box.
                // 0° = left→right; 90° = top→bottom; etc.
                const rad = (this.LinearAngle * Math.PI) / 180;
                const dx = Math.cos(rad);
                const dy = Math.sin(rad);
                // Project the unit-box diagonal onto the angle and
                // place start/end on the box boundary so the visible
                // gradient spans the whole fill.
                b.StartPoint = new Point(0.5 - dx * 0.5, 0.5 - dy * 0.5);
                b.EndPoint   = new Point(0.5 + dx * 0.5, 0.5 + dy * 0.5);
                return b;
            }
            case BrushPickerVariant.Radial:
            {
                const stops = [
                    new GradientStop(this.RadialInnerColor, 0),
                    new GradientStop(this.RadialOuterColor, 1),
                ];
                const b = new RadialGradientBrush(stops);
                b.Center  = new Point(this.RadialCenterX / 100, this.RadialCenterY / 100);
                b.RadiusX = this.RadialRadius / 100;
                b.RadiusY = this.RadialRadius / 100;
                return b;
            }
            case BrushPickerVariant.Pattern:
            {
                const b = new PatternBrush(this.PatternKind, this.PatternForeground);
                b.Background      = this.PatternBackground;
                b.Size            = this.PatternSize;
                b.Angle           = this.PatternAngle;
                b.StrokeThickness = this.PatternStroke;
                return b;
            }
        }
    }

    // Reverse the build — given an externally-set Brush, push its
    // properties into the matching mirror DPs and update Variant. We
    // only update the slice that matches the Brush's runtime type;
    // mirror DPs for the other variants stay at whatever they were
    // last (so the picker remembers the user's prior solid colour when
    // they flip to Pattern and back, for example).
    private decomposeBrush(brush: Brush | undefined): void
    {
        if (brush === undefined) return;
        if (brush instanceof SolidColorBrush)
        {
            this.Variant    = BrushPickerVariant.Solid;
            this.SolidColor = brush.Color;
            return;
        }
        if (brush instanceof LinearGradientBrush)
        {
            this.Variant = BrushPickerVariant.Linear;
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
            this.Variant = BrushPickerVariant.Radial;
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
            this.Variant            = BrushPickerVariant.Pattern;
            this.PatternKind        = brush.Kind;
            this.PatternForeground  = brush.Foreground;
            this.PatternBackground  = brush.Background;
            this.PatternSize        = brush.Size;
            this.PatternAngle       = brush.Angle;
            this.PatternStroke      = brush.StrokeThickness;
            return;
        }
        // ImageBrush isn't editable from the picker (no inline image-
        // source UI yet) — drop through silently so the picker stays in
        // its prior Variant rather than throwing.
        if (brush instanceof ImageBrush) return;
    }

    // Rebuild the closed-chrome swatch's Fill. Always uses a
    // fresh Brush instance so SVG renderers see a property change on
    // the swatch Border and re-paint.
    private updatePreviewBrush(): void
    {
        const b = this.Brush ?? new SolidColorBrush(Color.Black);
        this.set_property_value(BrushPicker.PreviewBrushKey, b);
    }

    private mountPopup(): void
    {
        if (this._mounted) return;
        const t = targetOf(this);
        if (t === undefined) return;
        const tpl = this.PopupTemplate;
        if (tpl === undefined) return;

        const inst = tpl.Apply(this);
        const host = inst.root as MenuPopupHost;
        const scrim = host.FindName('PART_Scrim') as ClickAwayScrim | undefined;
        if (scrim !== undefined) scrim.onClick = (): void => { this.IsDropDownOpen = false; };

        host.anchor     = this._trigger ?? this;
        host.anchorSide = MenuAnchorSide.Below;
        const body = host.FindName('PART_PopupBody') as Visual | undefined;
        if (body !== undefined) host.popup = body;

        this._popupHost = host;
        this._mounted = true;
        this.adoptPopupParts(host);
        this.AttachOverlayChild(host);
    }

    private unmountPopup(): void
    {
        if (!this._mounted) return;
        for (const dispose of this._popupListeners) dispose();
        this._popupListeners = [];
        const root = this._popupHost;
        if (root !== undefined) this.DetachOverlayChild(root);
        this._popupHost = undefined;
        this._mounted = false;
    }

    // Wire variant tabs + embedded sub-editors after the popup
    // materialises. Templated bindings flow picker → child via $$ but
    // are hard-coded OneWay, so we install two-way listeners here for
    // every editable child. Each handler bails on `_syncing` so the
    // initial seed writes (which fire listeners as they land) don't
    // ricochet back through this picker.
    private adoptPopupParts(host: MenuPopupHost): void
    {
        const wireTab = (partName: string, target: BrushPickerVariant): void => {
            const tab = host.FindName(partName) as Element | undefined;
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
            this._popupListeners.push(() => {
                tab.RemoveRoutedEventListener('PointerDown', onDown);
                tab.RemoveRoutedEventListener('PointerUp',   onUp);
                tab.RemoveRoutedEventListener('PointerLeave', onLeave);
            });
        };
        wireTab('PART_TabSolid',   BrushPickerVariant.Solid);
        wireTab('PART_TabLinear',  BrushPickerVariant.Linear);
        wireTab('PART_TabRadial',  BrushPickerVariant.Radial);
        wireTab('PART_TabPattern', BrushPickerVariant.Pattern);

        // Embedded ColorPickers expose Color (two-way). Two-way
        // synchronisation is manual because TemplateBinding ($$Foo) is
        // hard-coded OneWay — the markup pre-seeds the ColorPicker with
        // the mirror DP, this wire pushes user edits back into it.
        const wireColor = (
            partName: string,
            read:  () => Color,
            write: (c: Color) => void,
        ): void => {
            const cp = host.FindName(partName) as ColorPicker | undefined;
            if (cp === undefined) return;
            // Seed initial value (markup may have missed it if the
            // mirror DP changed before mount; cheap belt-and-braces).
            this._syncing = true;
            try { cp.Color = read(); }
            finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { write(cp.Color); }
                finally { this._syncing = false; }
                this.Brush = this.buildBrushForVariant();
                this.updatePreviewBrush();
            };
            const key = resolveKey(cp, undefined, 'Color');
            const sub: Disposable = cp.PropertyChanged(key).subscribe(handler);
            this._popupListeners.push(() => sub.dispose());
        };
        wireColor('PART_SolidColor',         () => this.SolidColor,         c => { this.SolidColor         = c; });
        wireColor('PART_LinearStart',        () => this.LinearStartColor,   c => { this.LinearStartColor   = c; });
        wireColor('PART_LinearEnd',          () => this.LinearEndColor,     c => { this.LinearEndColor     = c; });
        wireColor('PART_RadialInner',        () => this.RadialInnerColor,   c => { this.RadialInnerColor   = c; });
        wireColor('PART_RadialOuter',        () => this.RadialOuterColor,   c => { this.RadialOuterColor   = c; });
        wireColor('PART_PatternForeground',  () => this.PatternForeground,  c => { this.PatternForeground  = c; });
        wireColor('PART_PatternBackground',  () => this.PatternBackground,  c => { this.PatternBackground  = c; });

        // Embedded Sliders / ComboBoxes — read Value or SelectedItem
        // and write the matching mirror DP. Same _syncing guard as
        // wireColor; same rebuild-brush follow-through.
        const wireSlider = (
            partName: string,
            read:  () => number,
            write: (v: number) => void,
        ): void => {
            const s = host.FindName(partName) as Slider | undefined;
            if (s === undefined) return;
            this._syncing = true;
            try { s.Value = read(); }
            finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { write(s.Value); }
                finally { this._syncing = false; }
                this.Brush = this.buildBrushForVariant();
                this.updatePreviewBrush();
            };
            const key = resolveKey(s, undefined, 'Value');
            const sub: Disposable = s.PropertyChanged(key).subscribe(handler);
            this._popupListeners.push(() => sub.dispose());
        };
        wireSlider('PART_LinearAngle',   () => this.LinearAngle,    v => { this.LinearAngle   = v; });
        wireSlider('PART_RadialCenterX', () => this.RadialCenterX,  v => { this.RadialCenterX = v; });
        wireSlider('PART_RadialCenterY', () => this.RadialCenterY,  v => { this.RadialCenterY = v; });
        wireSlider('PART_RadialRadius',  () => this.RadialRadius,   v => { this.RadialRadius  = v; });
        wireSlider('PART_PatternSize',   () => this.PatternSize,    v => { this.PatternSize   = v; });
        wireSlider('PART_PatternAngle',  () => this.PatternAngle,   v => { this.PatternAngle  = v; });
        wireSlider('PART_PatternStroke', () => this.PatternStroke,  v => { this.PatternStroke = v; });

        const kindCombo = host.FindName('PART_PatternKind') as ComboBox | undefined;
        if (kindCombo !== undefined)
        {
            // Populate Items here rather than via $PatternKindOptions in
            // the template — there's no consumer DataContext that
            // carries the enum, and a shared resource list would force
            // a String→PatternKind map. PatternKind is a string enum, so
            // the raw enum members ARE the SelectedItem value.
            const kinds: PatternKind[] = [
                PatternKind.Stripes,
                PatternKind.Dots,
                PatternKind.Checker,
                PatternKind.Grid,
                PatternKind.CrossHatch,
            ];
            kindCombo.Items = kinds as unknown as unknown[];
            this._syncing = true;
            try { kindCombo.SelectedItem = this.PatternKind; }
            finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                const sel = kindCombo.SelectedItem as PatternKind | undefined;
                if (sel === undefined) return;
                this._syncing = true;
                try { this.PatternKind = sel; }
                finally { this._syncing = false; }
                this.Brush = this.buildBrushForVariant();
                this.updatePreviewBrush();
            };
            const key = resolveKey(kindCombo, undefined, 'SelectedItem');
            const sub: Disposable = kindCombo.PropertyChanged(key).subscribe(handler);
            this._popupListeners.push(() => sub.dispose());
        }
    }
}

function targetOf(host: Visual): PresentationTarget | undefined
{
    const back = host as unknown as { ['target']?: PresentationTarget };
    return back['target'];
}

// Re-export so consumers can import everything brush-related from one
// barrel entry. ColorPicker / Slider / ComboBox are touched by the
// popup template's compile output; importing them here keeps the
// dependency edge in one place rather than scattered across the
// generated template file.
export { ColorPicker, Slider, ComboBox };
