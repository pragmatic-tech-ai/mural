import {
    Application,
    MetaData,
    MuralBase,
    Point,
    Thickness,
    Element, Visual, Visibility, VerticalAlignment,
    type PropertyDescriptor,
    type Disposable,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import {
    Brush,
    Color,
    GradientStop,
    LinearGradientBrush,
    Pen,
    ScaleTransform,
    SolidColorBrush,
} from '../../visual-engine/index.js';
import type { PresentationTarget, PointerEventArgs } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { Canvas } from '../../basic/panels/canvas.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { Orientation } from '../../basic/panels/orientation.js';
import { WrapPanel } from '../../basic/panels/wrap-panel.js';
import { ColorScheme, OFFICE_COLOR_SCHEMES } from './color-scheme.js';
import { Slider } from '../../basic/slider.js';
import { TextBox } from '../../basic/text-box.js';
import { TextBlock } from '../../basic/text-block.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { MenuPopupHost, MenuAnchorSide } from '../menu/menu-strip.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';

// Material 3 swatch palette — retained as a public export for consumers
// that referenced it. The Office-style dropdown no longer uses it: theme
// colours come from the active scheme (authored in the popup template via
// `@token << Lighten/Darken`) and standard colours are a fixed row.
export const MATERIAL_PALETTE: readonly string[] = Object.freeze([
    '#ffebee', '#ffcdd2', '#ef5350', // red
    '#fce4ec', '#f8bbd0', '#ec407a', // pink
    '#f3e5f5', '#e1bee7', '#ab47bc', // purple
    '#ede7f6', '#d1c4e9', '#7e57c2', // deep purple
    '#e3f2fd', '#bbdefb', '#42a5f5', // blue
    '#e0f7fa', '#b2ebf2', '#26c6da', // cyan
    '#e8f5e9', '#c8e6c9', '#66bb6a', // green
    '#f9fbe7', '#f0f4c3', '#d4e157', // lime
    '#fff8e1', '#ffecb3', '#ffca28', // amber
    '#efebe9', '#d7ccc8', '#8d6e63', // brown
]);

// HSV → RGB. h in [0, 360), s and v in [0, 100]. Returns 0..255 channels.
// Standard formula; matches the W3C CSS Color 4 HSV reference.
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number }
{
    const sN = s / 100;
    const vN = v / 100;
    const c = vN * sN;
    const hh = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if      (hh < 1) { r = c; g = x; b = 0; }
    else if (hh < 2) { r = x; g = c; b = 0; }
    else if (hh < 3) { r = 0; g = c; b = x; }
    else if (hh < 4) { r = 0; g = x; b = c; }
    else if (hh < 5) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const m = vN - c;
    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
    };
}

// RGB → HSV. r/g/b in 0..255. Returns h in [0, 360), s/v in [0, 100].
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number }
{
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN);
    const min = Math.min(rN, gN, bN);
    const d = max - min;
    let h: number;
    if (d === 0)         h = 0;
    else if (max === rN) h = ((gN - bN) / d) % 6;
    else if (max === gN) h = (bN - rN) / d + 2;
    else                 h = (rN - gN) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : (d / max) * 100;
    const v = max * 100;
    return { h, s, v };
}

// Retained for source/markup compatibility — existing `[Variant=RGB]`
// authoring (brush-picker / fill-editor embeddings) still compiles. The
// Office dropdown is now the single popup; the advanced RGB/HSV editor
// moved into the "More Colors…" dialog, so Variant no longer swaps the
// dropdown template.
export enum ColorPickerVariant
{
    HSV = 'HSV',
    RGB = 'RGB',
}

// Session-shared "recent colours" — Office surfaces the colours picked
// this session across every picker. Module-level (not per-instance) so a
// colour chosen in one picker shows up in the next one's Recent row.
// Most-recent-first, de-duplicated, capped.
const RECENT_COLORS: string[] = [];
const RECENT_MAX = 10;
function recordRecent(hex: string): void
{
    const existing = RECENT_COLORS.indexOf(hex);
    if (existing !== -1) RECENT_COLORS.splice(existing, 1);
    RECENT_COLORS.unshift(hex);
    if (RECENT_COLORS.length > RECENT_MAX) RECENT_COLORS.length = RECENT_MAX;
}

// Subtle 1px border shared by the programmatically-built recent swatches.
const SWATCH_BORDER = new SolidColorBrush(new Color(0, 0, 0, 40));
// Accent border marking the active scheme row in the gallery, and the
// fallback swatch-hover ring when no theme Primary brush is resolvable.
const ACCENT_BORDER = new SolidColorBrush(Color.FromHex('#4472C4'));
// How much a swatch grows on pointer-over. Small enough to read as a
// lift without overrunning the 2dp inter-swatch gap by much.
const SWATCH_HOVER_SCALE = 1.15;

// Accent-ring + lift hover feedback for a colour swatch. Snapshots the
// swatch's resting border, then on pointer-over swaps in a 2dp accent
// ring (theme Primary, falling back to the Office accent) and scales the
// swatch up around its centre so it pops forward; both revert on leave.
// Returns a disposer that removes the listener and clears any applied
// hover state. Shared by the theme grid, the standard row, and the
// recents — every swatch there is a ClickableBorder whose Fill IS
// the colour it offers, so we can't tint it; the ring/lift stays clear
// of the colour itself. `onPreview(over)` fires on every enter/leave so
// the picker can live-preview the swatch's colour while it's hovered.
function wireSwatchHover(
    sw: ClickableBorder,
    onPreview?: (over: boolean) => void,
): () => void
{
    const restStroke = sw.Stroke;   // the pen carries its own width now
    const accent = (Application.current?.Resources.Resolve('Primary') as Brush | undefined)
        ?? ACCENT_BORDER;

    const clear = (): void => {
        sw.Stroke          = restStroke;
        sw.RenderTransform = undefined;
    };
    const onHover = (): void => {
        if (sw.IsMouseOver)
        {
            sw.Stroke                = new Pen(accent, 2);
            sw.RenderTransformOrigin = new Point(0.5, 0.5);
            sw.RenderTransform       = new ScaleTransform(SWATCH_HOVER_SCALE, SWATCH_HOVER_SCALE);
        }
        else clear();
        onPreview?.(sw.IsMouseOver);
    };

    const sub: Disposable = sw.PropertyChanged(Element.IsMouseOverKey).subscribe(onHover);
    return () => {
        sub.dispose();
        clear();
    };
}

// Office-style colour picker. Closed: a small swatch + the hex label
// inside a clickable border. Open: a dropdown with a No-Color entry, a
// Theme-Colors grid (base row + tint/shade rows derived from the active
// scheme), a Standard-Colors row, a session Recent-Colors row, and a
// "More Colors…" entry that opens the advanced editor dialog (2D HS box +
// brightness rail + RGB/alpha sliders + hex).
//
// Source-of-truth contract: Color is the bound value. The dialog's
// sliders + hex input each drive their channel DPs; OnPropertyChanged
// here recomputes Color and pushes derived values back to the rest of the
// DPs, with a guarded _syncing flag breaking the feedback loop. Swatch
// clicks in the dropdown commit a colour directly (and record a recent).
export class ColorPicker extends TemplatedControl
{
    public static readonly ColorKey      = MuralBase.RegisterProperty<Color>(  ColorPicker, 'Color',      Color.Black,            MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly ColorHexKey   = MuralBase.RegisterProperty<string>( ColorPicker, 'ColorHex',   '#000000',              MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly HueKey        = MuralBase.RegisterProperty<number>( ColorPicker, 'Hue',        0,                      MetaData.None);
    public static readonly SaturationKey = MuralBase.RegisterProperty<number>( ColorPicker, 'Saturation', 0,                      MetaData.None);
    public static readonly BrightnessKey = MuralBase.RegisterProperty<number>( ColorPicker, 'Brightness', 0,                      MetaData.None);
    public static readonly RedKey        = MuralBase.RegisterProperty<number>( ColorPicker, 'Red',        0,                      MetaData.None);
    public static readonly GreenKey      = MuralBase.RegisterProperty<number>( ColorPicker, 'Green',      0,                      MetaData.None);
    public static readonly BlueKey       = MuralBase.RegisterProperty<number>( ColorPicker, 'Blue',       0,                      MetaData.None);
    public static readonly AlphaKey      = MuralBase.RegisterProperty<number>( ColorPicker, 'Alpha',      255,                    MetaData.None);
    public static readonly VariantKey    = MuralBase.RegisterProperty<ColorPickerVariant>(ColorPicker, 'Variant', ColorPickerVariant.HSV, MetaData.None);
    public static readonly IsDropDownOpenKey = MuralBase.RegisterProperty<boolean>(ColorPicker, 'IsDropDownOpen', false,          MetaData.None);
    public static readonly IsMoreColorsOpenKey = MuralBase.RegisterProperty<boolean>(ColorPicker, 'IsMoreColorsOpen', false,      MetaData.None);
    public static readonly PopupTemplateKey  = MuralBase.RegisterProperty<ControlTemplate | undefined>(ColorPicker, 'PopupTemplate', undefined, MetaData.None);
    public static readonly MoreColorsTemplateKey = MuralBase.RegisterProperty<ControlTemplate | undefined>(ColorPicker, 'MoreColorsTemplate', undefined, MetaData.None);
    // The predefined base-colour set the Theme-Colors grid is built from
    // (one column per base colour, plus its tint/shade rows). Defaults to
    // ColorScheme.Default (the Office palette); set per-picker or share one
    // via a keyed resource (`[ColorScheme=@AppColors]`).
    public static readonly ColorSchemeKey = MuralBase.RegisterProperty<ColorScheme>(ColorPicker, 'ColorScheme', ColorScheme.Default, MetaData.None);
    public static readonly IsSchemeGalleryOpenKey = MuralBase.RegisterProperty<boolean>(ColorPicker, 'IsSchemeGalleryOpen', false, MetaData.None);
    public static readonly SchemeGalleryTemplateKey = MuralBase.RegisterProperty<ControlTemplate | undefined>(ColorPicker, 'SchemeGalleryTemplate', undefined, MetaData.None);
    // Per-instance default — the DP system shares its `default_value`
    // across every registered control, so we slot a fresh
    // SolidColorBrush in the ctor BEFORE applyDefaultStyle so the
    // template's `$SwatchBrush` binding lands on a brush nobody else
    // touches. Mutating the brush's Color in sync is then safe.
    public static readonly SwatchBrushKey = MuralBase.RegisterProperty<SolidColorBrush | undefined>(ColorPicker, 'SwatchBrush', undefined, MetaData.None);

    public get Color():      Color  { return this.get_property_value(ColorPicker.ColorKey); }
    public set Color(v:      Color) { this.set_property_value(ColorPicker.ColorKey, v); }
    public get ColorHex():   string { return this.get_property_value(ColorPicker.ColorHexKey); }
    public set ColorHex(v:   string){ this.set_property_value(ColorPicker.ColorHexKey, v); }
    public get Hue():        number { return this.get_property_value(ColorPicker.HueKey); }
    public set Hue(v:        number){ this.set_property_value(ColorPicker.HueKey, v); }
    public get Saturation(): number { return this.get_property_value(ColorPicker.SaturationKey); }
    public set Saturation(v: number){ this.set_property_value(ColorPicker.SaturationKey, v); }
    public get Brightness(): number { return this.get_property_value(ColorPicker.BrightnessKey); }
    public set Brightness(v: number){ this.set_property_value(ColorPicker.BrightnessKey, v); }
    public get Red():        number { return this.get_property_value(ColorPicker.RedKey); }
    public set Red(v:        number){ this.set_property_value(ColorPicker.RedKey, v); }
    public get Green():      number { return this.get_property_value(ColorPicker.GreenKey); }
    public set Green(v:      number){ this.set_property_value(ColorPicker.GreenKey, v); }
    public get Blue():       number { return this.get_property_value(ColorPicker.BlueKey); }
    public set Blue(v:       number){ this.set_property_value(ColorPicker.BlueKey, v); }
    public get Alpha():      number { return this.get_property_value(ColorPicker.AlphaKey); }
    public set Alpha(v:      number){ this.set_property_value(ColorPicker.AlphaKey, v); }
    public get Variant():    ColorPickerVariant { return this.get_property_value(ColorPicker.VariantKey); }
    public set Variant(v:    ColorPickerVariant){ this.set_property_value(ColorPicker.VariantKey, v); }
    public get IsDropDownOpen(): boolean { return this.get_property_value(ColorPicker.IsDropDownOpenKey); }
    public set IsDropDownOpen(v: boolean){ this.set_property_value(ColorPicker.IsDropDownOpenKey, v); }
    public get IsMoreColorsOpen(): boolean { return this.get_property_value(ColorPicker.IsMoreColorsOpenKey); }
    public set IsMoreColorsOpen(v: boolean){ this.set_property_value(ColorPicker.IsMoreColorsOpenKey, v); }
    public get PopupTemplate():  ControlTemplate | undefined { return this.get_property_value(ColorPicker.PopupTemplateKey); }
    public set PopupTemplate(v:  ControlTemplate | undefined){ this.set_property_value(ColorPicker.PopupTemplateKey, v); }
    public get MoreColorsTemplate(): ControlTemplate | undefined { return this.get_property_value(ColorPicker.MoreColorsTemplateKey); }
    public set MoreColorsTemplate(v: ControlTemplate | undefined){ this.set_property_value(ColorPicker.MoreColorsTemplateKey, v); }
    public get ColorScheme():    ColorScheme { return this.get_property_value(ColorPicker.ColorSchemeKey); }
    public set ColorScheme(v:    ColorScheme){ this.set_property_value(ColorPicker.ColorSchemeKey, v); }
    public get IsSchemeGalleryOpen(): boolean { return this.get_property_value(ColorPicker.IsSchemeGalleryOpenKey); }
    public set IsSchemeGalleryOpen(v: boolean){ this.set_property_value(ColorPicker.IsSchemeGalleryOpenKey, v); }
    public get SchemeGalleryTemplate(): ControlTemplate | undefined { return this.get_property_value(ColorPicker.SchemeGalleryTemplateKey); }
    public set SchemeGalleryTemplate(v: ControlTemplate | undefined){ this.set_property_value(ColorPicker.SchemeGalleryTemplateKey, v); }
    public get SwatchBrush():    SolidColorBrush | undefined { return this.get_property_value(ColorPicker.SwatchBrushKey); }

    static
    {
        MuralBase.OverrideMetadata(ColorPicker, Element.DefaultStyleKeyKey, { default_value: ColorPicker });
    }

    private _trigger:    Border | undefined;
    private _syncing = false;

    // Dropdown (Office menu) state.
    private _dropdownHost:    MenuPopupHost | undefined;
    private _dropdownMounted = false;
    private _dropdownListeners: Array<() => void> = [];
    private _themeGrid:       StackPanel | undefined;  // theme-colours container, rebuilt from ColorScheme
    private _schemeNameLabel: TextBlock  | undefined;  // dropdown's scheme-button caption
    private _schemeRow:       Visual     | undefined;  // Color-Scheme row; anchors the gallery fly-out

    // Swatch hover-preview state. Captured when the dropdown opens: moving
    // the pointer over a swatch previews its colour by writing Color live
    // (the same mechanism the More Colors dialog uses while dragging), and
    // the snapshot restores the pre-hover colour when the pointer leaves
    // without a click. _previewSource tracks which swatch owns the active
    // preview so that sliding straight from one swatch to the next doesn't
    // revert the incoming preview — order-agnostic across enter/leave.
    private _previewSnapshot: Color           | undefined;
    private _previewSource:   ClickableBorder | undefined;

    // Scheme gallery (Office "Colors" list) state.
    private _galleryHost:    MenuPopupHost | undefined;
    private _galleryMounted = false;
    private _galleryListeners: Array<() => void> = [];

    // More Colors… dialog state. Snapshot taken on open so Cancel (or a
    // click-away) can restore the colour the user started from.
    private _moreHost:    MenuPopupHost | undefined;
    private _moreMounted = false;
    private _moreSnapshot: Color | undefined;
    private _moreListeners: Array<() => void> = [];
    // Modal state — set by OpenMoreColorsModal so the More Colors editor
    // opens centred (a stand-alone dialog) and a caller can await the picked
    // colour. _moreResolve settles that promise on OK (hex) / Cancel (undefined).
    private _moreCentered = false;
    private _moreResolve: ((hex: string | undefined) => void) | undefined;

    // Dialog edit parts — only present while the More Colors dialog is
    // mounted. Wired by adoptDialogEditParts; cleared in unmountMoreColors.
    private _rSlider:    Slider  | undefined;
    private _gSlider:    Slider  | undefined;
    private _blueSlider: Slider  | undefined;
    private _aSlider:    Slider  | undefined;
    private _hexInput:   TextBox | undefined;
    // 2D gradient box parts. The box's hue + saturation fill brushes are
    // static (built once at mount); the rail's fill brush is rebuilt
    // whenever Hue or Saturation moves.
    private _hsBox:        Canvas | undefined;
    private _hsBoxOverlay: Border | undefined;
    private _hsBoxCursor:  Border | undefined;
    private _vRail:        Canvas | undefined;
    private _vRailFill:    Border | undefined;
    private _vRailCursor:  Border | undefined;

    constructor()
    {
        super();
        // Per-instance swatch brush — must land BEFORE the template
        // resolves its `$SwatchBrush` binding.
        this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(Color.Black));
        this.applyDefaultStyle();
        // Seed the derived DPs from the initial Color value so the
        // dialog widgets land in sync the first time it's opened.
        this.syncFromColor();
        this.adoptTemplateParts();
    }

    private adoptTemplateParts(): void
    {
        // PART_SelectionTrigger is a ClickableBorder, which owns its own
        // press-state ladder + release semantics; we only need its click.
        this._trigger = this.GetTemplateChild('PART_SelectionTrigger') as Border | undefined;
        const trigger = this._trigger;
        if (trigger instanceof ClickableBorder)
        {
            trigger.onClick = (): void => { this.IsDropDownOpen = !this.IsDropDownOpen; };
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== ColorPicker) return;
        switch (descriptor.Name)
        {
            case 'Color':           this.onColorChanged(newValue as Color); break;
            case 'ColorHex':        this.onHexChanged(newValue as string);  break;
            case 'Hue':
            case 'Saturation':
            case 'Brightness':      this.onHsvChanged();                    break;
            case 'Red':
            case 'Green':
            case 'Blue':
            case 'Alpha':           this.onRgbaChanged();                   break;
            case 'IsDropDownOpen':
                if (newValue === true) this.mountDropdown();
                else                    this.unmountDropdown();
                break;
            case 'IsMoreColorsOpen':
                if (newValue === true) this.mountMoreColors();
                else                    this.unmountMoreColors();
                break;
            case 'ColorScheme':
                // Rebuild the theme grid + refresh the scheme caption if the
                // dropdown is open.
                if (this._dropdownMounted && this._themeGrid !== undefined)
                {
                    this.buildThemeGrid(this._themeGrid);
                }
                if (this._schemeNameLabel !== undefined)
                {
                    this._schemeNameLabel.Text = (newValue as ColorScheme).Name;
                }
                break;
            case 'IsSchemeGalleryOpen':
                if (newValue === true) this.mountSchemeGallery();
                else                    this.unmountSchemeGallery();
                break;
        }
    }

    private onColorChanged(c: Color): void
    {
        if (this._syncing) return;
        this._syncing = true;
        try
        {
            const hsv = rgbToHsv(c.R, c.G, c.B);
            this.Hue        = hsv.h;
            this.Saturation = hsv.s;
            this.Brightness = hsv.v;
            this.Red        = c.R;
            this.Green      = c.G;
            this.Blue       = c.B;
            this.Alpha      = c.A;
            this.ColorHex   = c.ToHex();
            this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(c));
            this.pushAllToDialog();
            this.refreshGradientBox();
        }
        finally { this._syncing = false; }
    }

    private onHexChanged(hex: string): void
    {
        if (this._syncing) return;
        let parsed: Color;
        try { parsed = Color.FromHex(hex); }
        catch { return; }
        this._syncing = true;
        try
        {
            this.Color = parsed;
            const hsv = rgbToHsv(parsed.R, parsed.G, parsed.B);
            this.Hue        = hsv.h;
            this.Saturation = hsv.s;
            this.Brightness = hsv.v;
            this.Red        = parsed.R;
            this.Green      = parsed.G;
            this.Blue       = parsed.B;
            this.Alpha      = parsed.A;
            this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(parsed));
            this.pushChannelsToSliders();
            this.refreshGradientBox();
            // Deliberately NOT pushing back to PART_HexInput — the user
            // is mid-edit; rewriting their own text would clobber the
            // cursor and surprise them.
        }
        finally { this._syncing = false; }
    }

    private onHsvChanged(): void
    {
        if (this._syncing) return;
        const rgb = hsvToRgb(this.Hue, this.Saturation, this.Brightness);
        // Preserve the current Alpha — HSV sliders don't touch it.
        const c = new Color(rgb.r, rgb.g, rgb.b, this.Alpha);
        this._syncing = true;
        try
        {
            this.Color    = c;
            this.ColorHex = c.ToHex();
            this.Red      = c.R;
            this.Green    = c.G;
            this.Blue     = c.B;
            this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(c));
            this.pushHexToInput();
            this.refreshGradientBox();
            // HSV is the source for this edit; no need to push back to it.
        }
        finally { this._syncing = false; }
    }

    private onRgbaChanged(): void
    {
        if (this._syncing) return;
        const c = new Color(this.Red, this.Green, this.Blue, this.Alpha);
        this._syncing = true;
        try
        {
            this.Color    = c;
            this.ColorHex = c.ToHex();
            const hsv = rgbToHsv(c.R, c.G, c.B);
            this.Hue        = hsv.h;
            this.Saturation = hsv.s;
            this.Brightness = hsv.v;
            this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(c));
            this.pushHexToInput();
            this.refreshGradientBox();
            // RGBA sliders ARE the source; no need to push back to them.
        }
        finally { this._syncing = false; }
    }

    // Programmatic writes into the dialog's edit parts. Each guarded write
    // happens within a _syncing window, so the corresponding listener on
    // the part bails before it tries to write back into the picker.
    private pushChannelsToSliders(): void
    {
        if (!this._moreMounted) return;
        if (this._rSlider    !== undefined) this._rSlider.Value    = this.Red;
        if (this._gSlider    !== undefined) this._gSlider.Value    = this.Green;
        if (this._blueSlider !== undefined) this._blueSlider.Value = this.Blue;
        if (this._aSlider    !== undefined) this._aSlider.Value    = this.Alpha;
    }

    private pushHexToInput(): void
    {
        if (!this._moreMounted) return;
        if (this._hexInput !== undefined) this._hexInput.Text = this.ColorHex;
    }

    private pushAllToDialog(): void
    {
        this.pushChannelsToSliders();
        this.pushHexToInput();
    }

    // Initial seed — called from the ctor BEFORE any popup is mounted, so
    // we mirror the starting Color value across the derived DPs without
    // going through the property-change handlers (which bail on _syncing).
    private syncFromColor(): void
    {
        const c = this.Color;
        const hsv = rgbToHsv(c.R, c.G, c.B);
        this._syncing = true;
        try
        {
            this.Hue        = hsv.h;
            this.Saturation = hsv.s;
            this.Brightness = hsv.v;
            this.Red        = c.R;
            this.Green      = c.G;
            this.Blue       = c.B;
            this.Alpha      = c.A;
            this.ColorHex   = c.ToHex();
            this.set_property_value(ColorPicker.SwatchBrushKey, new SolidColorBrush(c));
        }
        finally { this._syncing = false; }
    }

    // ── Office dropdown ────────────────────────────────────────────────

    private mountDropdown(): void
    {
        if (this._dropdownMounted) return;
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

        this._dropdownHost = host;
        this._dropdownMounted = true;
        this.wireDropdownParts(host);
        this.AttachOverlayChild(host);
    }

    private wireDropdownParts(host: MenuPopupHost): void
    {
        // Baseline for swatch hover-preview: the colour we restore to when
        // the pointer leaves a swatch without committing. Cleared on commit
        // (so the pick sticks) and consumed by unmountDropdown on close.
        this._previewSnapshot = this.Color;
        this._previewSource   = undefined;

        // Theme grid: built from the ColorScheme (one column per base
        // colour + its tint/shade rows). Standard row: fixed swatches
        // authored in markup. Both commit the swatch's own colour.
        // Scheme button: caption shows the active scheme; clicking opens the
        // Office "Colors" gallery.
        const schemeButton = host.FindName('PART_SchemeButton') as ClickableBorder | undefined;
        this._schemeNameLabel = host.FindName('PART_SchemeName') as TextBlock | undefined;
        this._schemeRow = schemeButton;
        if (this._schemeNameLabel !== undefined) this._schemeNameLabel.Text = this.ColorScheme.Name;
        if (schemeButton !== undefined)
        {
            // Side-flyout submenu: keep the dropdown mounted so the gallery
            // opens alongside it (anchored to this row, opening right).
            schemeButton.onClick = (): void => {
                this.IsSchemeGalleryOpen = true;
            };
            this._dropdownListeners.push(() => { schemeButton.onClick = undefined; });
        }

        const themeGrid = host.FindName('PART_ThemeGrid') as StackPanel | undefined;
        this._themeGrid = themeGrid;
        if (themeGrid !== undefined) this.buildThemeGrid(themeGrid);

        const standardRow = host.FindName('PART_StandardRow') as Visual | undefined;
        const swatches: ClickableBorder[] = [];
        if (standardRow !== undefined) collectSwatches(standardRow, swatches);
        for (const sw of swatches)
        {
            const c = colorOfSwatch(sw);
            sw.onClick = (): void => {
                if (c !== undefined) this.commitColor(c);
            };
            this._dropdownListeners.push(() => { sw.onClick = undefined; });
            this._dropdownListeners.push(wireSwatchHover(sw, over => {
                if (c === undefined) return;
                if (over) this.previewSwatch(sw, c);
                else      this.endPreviewSwatch(sw);
            }));
        }

        // No Color — clears to a transparent sentinel.
        const noColor = host.FindName('PART_NoColor') as ClickableBorder | undefined;
        if (noColor !== undefined)
        {
            noColor.onClick = (): void => { this.commitNoColor(); };
            this._dropdownListeners.push(() => { noColor.onClick = undefined; });
        }

        // More Colors… — close the dropdown and open the editor dialog.
        const more = host.FindName('PART_MoreColors') as ClickableBorder | undefined;
        if (more !== undefined)
        {
            more.onClick = (): void => {
                this.IsDropDownOpen = false;
                this.IsMoreColorsOpen = true;
            };
            this._dropdownListeners.push(() => { more.onClick = undefined; });
        }

        // Recent colours — populated from the session-shared list; the
        // whole section collapses when there's nothing to show.
        const section = host.FindName('PART_RecentSection') as Visual | undefined;
        const row     = host.FindName('PART_RecentRow') as WrapPanel | undefined;
        this.populateRecents(section, row);
    }

    // Build the Theme-Colors grid from the ColorScheme: one column per
    // base colour, a base row plus one row per tint then per shade. Swatch
    // width is derived from the column count so the rows fill the popup's
    // content width regardless of how many colours the scheme carries.
    private buildThemeGrid(grid: StackPanel): void
    {
        for (const child of [...grid.visualChildren]) grid.RemoveChild(child);

        const scheme = this.ColorScheme;
        const n = scheme.Colors.length;
        const gap = 2;
        // Popup body Width 268 − padding (@Spacing3 ×2) − border (1 ×2).
        const content = 242;
        const w = Math.max(10, Math.min(28, Math.floor((content - (n - 1) * gap) / n)));

        for (let row = 0; row < scheme.RowCount; row++)
        {
            const rowPanel = new StackPanel();
            rowPanel.Orientation = Orientation.Horizontal;
            // Gap below the base row separates it from the tint/shade ladder.
            if (row === 0) rowPanel.Margin = new Thickness(0, 0, 0, 8);
            for (let col = 0; col < n; col++)
            {
                const color = scheme.ColorAt(col, row);
                const sw = new ClickableBorder();
                sw.Width  = w;
                sw.Height = row === 0 ? 16 : 14;
                if (row === 0) sw.CornerRadius = 2;
                sw.Stroke          = new Pen(SWATCH_BORDER, 1);
                sw.Margin = new Thickness(0, 0, col === n - 1 ? 0 : gap, 0);
                sw.Fill = new SolidColorBrush(color);
                sw.onClick = (): void => { this.commitColor(color); };
                // Hover ring + lift plus a live colour preview. Not
                // disposer-tracked: buildThemeGrid clears every child (and
                // its listeners) before a rebuild.
                wireSwatchHover(sw, over =>
                    over ? this.previewSwatch(sw, color) : this.endPreviewSwatch(sw));
                rowPanel.AddChild(sw);
            }
            grid.AddChild(rowPanel);
        }
    }

    private unmountDropdown(): void
    {
        if (!this._dropdownMounted) return;
        // Closing without a pick (Escape / click-away while a swatch is
        // still previewing) restores the pre-hover colour. A commit already
        // cleared the snapshot, so its pick survives this.
        if (this._previewSnapshot !== undefined) this.Color = this._previewSnapshot;
        this._previewSnapshot = undefined;
        this._previewSource   = undefined;
        if (this._dropdownHost !== undefined) this.DetachOverlayChild(this._dropdownHost);
        for (const dispose of this._dropdownListeners) dispose();
        this._dropdownListeners = [];
        this._themeGrid        = undefined;
        this._schemeNameLabel  = undefined;
        this._schemeRow        = undefined;
        this._dropdownHost     = undefined;
        this._dropdownMounted  = false;
    }

    // ── Scheme gallery (Office "Colors") ───────────────────────────────

    private mountSchemeGallery(): void
    {
        if (this._galleryMounted) return;
        const t = targetOf(this);
        if (t === undefined) return;
        const tpl = this.SchemeGalleryTemplate;
        if (tpl === undefined) return;

        const inst = tpl.Apply(this);
        const host = inst.root as MenuPopupHost;
        const scrim = host.FindName('PART_Scrim') as ClickAwayScrim | undefined;
        if (scrim !== undefined) scrim.onClick = (): void => { this.IsSchemeGalleryOpen = false; };

        // Side-flyout: anchor to the Color-Scheme row (kept alive by the
        // still-open dropdown) and open to its right, like a nested menu.
        // Fall back to the trigger/below when the row isn't available.
        if (this._schemeRow !== undefined)
        {
            host.anchor     = this._schemeRow;
            host.anchorSide = MenuAnchorSide.Right;
        }
        else
        {
            host.anchor     = this._trigger ?? this;
            host.anchorSide = MenuAnchorSide.Below;
        }
        const body = host.FindName('PART_PopupBody') as Visual | undefined;
        if (body !== undefined) host.popup = body;

        const list = host.FindName('PART_SchemeList') as StackPanel | undefined;
        if (list !== undefined) this.buildSchemeList(list);

        this._galleryHost = host;
        this._galleryMounted = true;
        this.AttachOverlayChild(host);
    }

    // One selectable row per built-in scheme: a mini preview strip of the
    // scheme's base colours + its name; the active scheme is marked. Picking
    // one applies it and returns to the dropdown so the new grid is visible.
    private buildSchemeList(list: StackPanel): void
    {
        for (const child of [...list.visualChildren]) list.RemoveChild(child);
        const current = this.ColorScheme;
        // Hover state-layer — the M3 OnSurface @ 8% overlay the menu rows
        // use. Resolved once off the active theme (stable while the gallery
        // is open); each row tints its Fill on IsMouseOver and clears
        // it on leave, giving the same hover feedback as a MenuItem.
        const hover = Application.current?.Resources.Resolve('StateHoverOverlay') as Brush | undefined;
        for (const scheme of OFFICE_COLOR_SCHEMES)
        {
            const row = new ClickableBorder();
            row.CornerRadius    = 4;
            row.Stroke          = new Pen(scheme === current ? ACCENT_BORDER : SWATCH_BORDER, 1);
            row.Padding = new Thickness(4);
            row.Margin  = new Thickness(0, 0, 0, 2);

            if (hover !== undefined)
            {
                const onHover = (): void => {
                    row.Fill = row.IsMouseOver ? hover : undefined;
                };
                const sub = row.PropertyChanged(Element.IsMouseOverKey).subscribe(onHover);
                this._galleryListeners.push(() => sub.dispose());
            }

            const rowContent = new StackPanel();
            rowContent.Orientation = Orientation.Horizontal;

            const preview = new StackPanel();
            preview.Orientation = Orientation.Horizontal;
            preview.Margin = new Thickness(0, 0, 8, 0);
            for (const color of scheme.Colors)
            {
                const chip = new Border();
                chip.Width  = 11;
                chip.Height = 16;
                chip.Stroke          = new Pen(SWATCH_BORDER, 1);
                chip.Fill = new SolidColorBrush(color);
                preview.AddChild(chip);
            }
            rowContent.AddChild(preview);

            const label = new TextBlock(scheme.Name);
            label.VerticalAlignment = VerticalAlignment.Center;
            rowContent.AddChild(label);

            row.SetChild(rowContent);
            row.onClick = (): void => {
                this.ColorScheme = scheme;
                this.IsSchemeGalleryOpen = false;
                this.IsDropDownOpen = true;   // back to the dropdown, new grid
            };
            list.AddChild(row);
        }
    }

    private unmountSchemeGallery(): void
    {
        if (!this._galleryMounted) return;
        if (this._galleryHost !== undefined) this.DetachOverlayChild(this._galleryHost);
        for (const dispose of this._galleryListeners) dispose();
        this._galleryListeners = [];
        this._galleryHost    = undefined;
        this._galleryMounted = false;
    }

    // Build the recent-colour swatches into PART_RecentRow. Collapses the
    // surrounding section when the list is empty so the dropdown doesn't
    // carry a dangling header.
    private populateRecents(section: Visual | undefined, row: WrapPanel | undefined): void
    {
        if (row === undefined) return;
        for (const child of [...row.visualChildren]) row.RemoveChild(child);
        for (const hex of RECENT_COLORS)
        {
            const sw = new ClickableBorder();
            sw.Width  = 22;
            sw.Height = 16;
            sw.CornerRadius = 2;
            sw.Stroke       = new Pen(SWATCH_BORDER, 1);
            sw.Margin = new Thickness(0, 0, 2, 2);
            const c = Color.FromHex(hex);
            sw.Fill = new SolidColorBrush(c);
            sw.onClick = (): void => { this.commitColor(c); };
            // Hover ring + lift plus a live colour preview. Not
            // disposer-tracked: populateRecents clears every child (and its
            // listeners) before a rebuild.
            wireSwatchHover(sw, over =>
                over ? this.previewSwatch(sw, c) : this.endPreviewSwatch(sw));
            row.AddChild(sw);
        }
        if (section !== undefined)
        {
            section.Visibility = RECENT_COLORS.length === 0
                ? Visibility.Collapsed
                : Visibility.Visible;
        }
    }

    // Live-preview a hovered swatch's colour by writing Color, exactly as
    // the More Colors dialog previews while dragging. The pre-hover colour
    // was snapshotted when the dropdown opened; endPreviewSwatch restores
    // it. No-op until a baseline exists (dropdown closed / no snapshot).
    private previewSwatch(sw: ClickableBorder, c: Color): void
    {
        if (this._previewSnapshot === undefined) return;
        this._previewSource = sw;
        this.Color = c;
    }

    // Pointer left a swatch: revert to the snapshot — but only if this
    // swatch still owns the preview. When the pointer slides straight onto
    // another swatch, that swatch's enter has already claimed _previewSource,
    // so this stale leave must not clobber the incoming preview.
    private endPreviewSwatch(sw: ClickableBorder): void
    {
        if (this._previewSource !== sw) return;
        this._previewSource = undefined;
        if (this._previewSnapshot !== undefined) this.Color = this._previewSnapshot;
    }

    // Drop the preview baseline so the pending close (unmountDropdown) keeps
    // the just-committed colour instead of reverting to the snapshot.
    private clearPreviewBaseline(): void
    {
        this._previewSnapshot = undefined;
        this._previewSource   = undefined;
    }

    // Commit a chosen colour: set it, record a recent, and close the
    // dropdown (Office dismisses the menu on a swatch pick).
    private commitColor(c: Color): void
    {
        this.clearPreviewBaseline();
        this.Color = c;
        recordRecent(c.ToHex());
        this.IsDropDownOpen = false;
    }

    // "No Color" → transparent sentinel (alpha 0). Most fill consumers
    // treat a fully-transparent brush as "no fill". The editing alpha is
    // restored to fully-opaque so a subsequent channel edit (RGB / HSV /
    // hex / swatch) yields an opaque colour rather than inheriting the
    // sentinel's zero alpha — Office revives opacity when you paint a
    // colour after "No Fill". Alpha stays user-controlled only via the
    // dialog's alpha slider (or an 8-digit hex).
    private commitNoColor(): void
    {
        this.clearPreviewBaseline();
        this.Color = Color.Transparent;
        this._syncing = true;
        try { this.Alpha = 255; }
        finally { this._syncing = false; }
        this.IsDropDownOpen = false;
    }

    // ── More Colors… dialog ────────────────────────────────────────────

    private mountMoreColors(): void
    {
        if (this._moreMounted) return;
        const t = targetOf(this);
        if (t === undefined) return;
        const tpl = this.MoreColorsTemplate;
        if (tpl === undefined) return;

        this._moreSnapshot = this.Color;

        const inst = tpl.Apply(this);
        const host = inst.root as MenuPopupHost;
        // Click-away cancels (restores the snapshot), matching Office's
        // modal-dialog dismissal.
        const scrim = host.FindName('PART_Scrim') as ClickAwayScrim | undefined;
        if (scrim !== undefined) scrim.onClick = (): void => { this.cancelMoreColors(); };

        host.anchor     = this._trigger ?? this;
        host.anchorSide = MenuAnchorSide.Below;
        // Modal invocation (OpenMoreColorsModal): centre the editor in the
        // surface instead of anchoring it below the picker.
        host.centered   = this._moreCentered;
        const body = host.FindName('PART_PopupBody') as Visual | undefined;
        if (body !== undefined) host.popup = body;

        this._moreHost = host;
        this._moreMounted = true;
        this.adoptDialogEditParts(host);
        this.AttachOverlayChild(host);
    }

    // Open the extended "More Colors" editor as a stand-alone CENTRED modal and
    // resolve with the committed hex (OK) or undefined (Cancel / click-away). The
    // picker must already be mounted (in the tree / on an overlay) so the editor
    // can reach a presentation target. Lets a caller use the full HS / RGB / hex
    // editor as a one-surface colour dialog without wrapping the picker in another
    // dialog.
    public OpenMoreColorsModal(initialHex?: string): Promise<string | undefined>
    {
        if (initialHex !== undefined && initialHex !== '') this.ColorHex = initialHex;
        this._moreCentered = true;
        return new Promise<string | undefined>(resolve =>
        {
            this._moreResolve = resolve;
            this.IsMoreColorsOpen = true;
        });
    }

    // Settle a pending OpenMoreColorsModal promise exactly once.
    private resolveMore(hex: string | undefined): void
    {
        const resolve = this._moreResolve;
        this._moreResolve = undefined;
        resolve?.(hex);
    }

    // Bind the dialog's edit parts in both directions. _moreMounted is set
    // BEFORE this runs so the initial seed writes (which fire the slider /
    // textbox listeners) bail through the _syncing guard.
    private adoptDialogEditParts(host: MenuPopupHost): void
    {
        this._rSlider    = host.FindName('PART_RSlider')  as Slider  | undefined;
        this._gSlider    = host.FindName('PART_GSlider')  as Slider  | undefined;
        this._blueSlider = host.FindName('PART_BSlider')  as Slider  | undefined;
        this._aSlider    = host.FindName('PART_ASlider')  as Slider  | undefined;
        this._hexInput   = host.FindName('PART_HexInput') as TextBox | undefined;

        // Seed initial values — guarded so the resulting Value-change
        // listeners don't re-write the same value back into the picker.
        this._syncing = true;
        try
        {
            if (this._rSlider    !== undefined) this._rSlider.Value    = this.Red;
            if (this._gSlider    !== undefined) this._gSlider.Value    = this.Green;
            if (this._blueSlider !== undefined) this._blueSlider.Value = this.Blue;
            if (this._aSlider    !== undefined) this._aSlider.Value    = this.Alpha;
            if (this._hexInput   !== undefined) this._hexInput.Text    = this.ColorHex;
        }
        finally { this._syncing = false; }

        const wire = (
            part:   Slider | TextBox | undefined,
            prop:   string,
            apply:  () => void,
        ): void => {
            if (part === undefined) return;
            const handler = (): void => {
                if (this._syncing) return;
                apply();
            };
            const key = resolveKey(part, undefined, prop);
            const sub = part.PropertyChanged(key).subscribe(handler);
            this._moreListeners.push(() => sub.dispose());
        };

        wire(this._rSlider,    'Value', () => { this.Red      = this._rSlider!.Value; });
        wire(this._gSlider,    'Value', () => { this.Green    = this._gSlider!.Value; });
        wire(this._blueSlider, 'Value', () => { this.Blue     = this._blueSlider!.Value; });
        wire(this._aSlider,    'Value', () => { this.Alpha    = this._aSlider!.Value; });
        wire(this._hexInput,   'Text',  () => { this.ColorHex = this._hexInput!.Text; });

        // 2D gradient box + brightness rail.
        this.adoptGradientBoxParts(host);

        // OK / Cancel.
        const ok = host.FindName('PART_MoreOk') as ClickableBorder | undefined;
        if (ok !== undefined)
        {
            ok.onClick = (): void => { this.commitMoreColors(); };
            this._moreListeners.push(() => { ok.onClick = undefined; });
        }
        const cancel = host.FindName('PART_MoreCancel') as ClickableBorder | undefined;
        if (cancel !== undefined)
        {
            cancel.onClick = (): void => { this.cancelMoreColors(); };
            this._moreListeners.push(() => { cancel.onClick = undefined; });
        }
    }

    private commitMoreColors(): void
    {
        const hex = this.ColorHex;
        recordRecent(hex);
        // Settle BEFORE closing — IsMoreColorsOpen=false runs unmountMoreColors,
        // whose safety-net resolve would otherwise win with undefined.
        this.resolveMore(hex);
        this.IsMoreColorsOpen = false;
    }

    private cancelMoreColors(): void
    {
        if (this._moreSnapshot !== undefined) this.Color = this._moreSnapshot;
        this.resolveMore(undefined);
        this.IsMoreColorsOpen = false;
    }

    // Wire the Office-style 2D hue/saturation box and the vertical
    // brightness rail. Both are Canvas-rooted; the static rainbow + the
    // white desaturation overlay paint via Border.Fill, and the
    // rail's gradient gets rebuilt whenever Hue or Saturation moves.
    private adoptGradientBoxParts(host: MenuPopupHost): void
    {
        this._hsBox        = host.FindName('PART_HsBox')        as Canvas | undefined;
        const hsBoxHue     = host.FindName('PART_HsBoxHue')     as Border | undefined;
        this._hsBoxOverlay = host.FindName('PART_HsBoxOverlay') as Border | undefined;
        this._hsBoxCursor  = host.FindName('PART_HsBoxCursor')  as Border | undefined;
        this._vRail        = host.FindName('PART_VRail')        as Canvas | undefined;
        this._vRailFill    = host.FindName('PART_VRailFill')    as Border | undefined;
        this._vRailCursor  = host.FindName('PART_VRailCursor')  as Border | undefined;

        if (hsBoxHue !== undefined)           hsBoxHue.Fill           = buildHueRainbowBrush();
        if (this._hsBoxOverlay !== undefined) this._hsBoxOverlay.Fill = buildWhiteOverlayBrush();

        this.refreshGradientBox();
        this.wireGradientBoxPointer();
        this.wireBrightnessRailPointer();
    }

    private wireGradientBoxPointer(): void
    {
        const box = this._hsBox;
        if (box === undefined) return;
        const onMove = (args: PointerEventArgs, dragging: boolean): void => {
            if (!dragging) return;
            const origin = hostOriginOf(box);
            const w = box.ArrangedRect.Width;
            const h = box.ArrangedRect.Height;
            if (w <= 0 || h <= 0) return;
            const u = clamp01((args.HostX - origin.x) / w);
            const v = clamp01((args.HostY - origin.y) / h);
            this.applyHueSat(u * 360, (1 - v) * 100);
        };
        let dragging = false;
        const onDown = (args: PointerEventArgs): void => {
            dragging = true;
            args.CapturePointer(box);
            onMove(args, true);
            args.Handled = true;
        };
        const onMovePointer = (args: PointerEventArgs): void => { onMove(args, dragging); };
        const onUp = (args: PointerEventArgs): void => {
            if (!dragging) return;
            dragging = false;
            args.ReleasePointerCapture();
            args.Handled = true;
        };
        box.AddRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
        box.AddRoutedEventListener('PointerMove', onMovePointer as (a: unknown) => void);
        box.AddRoutedEventListener('PointerUp',   onUp as (a: unknown) => void);
        this._moreListeners.push(() => {
            box.RemoveRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
            box.RemoveRoutedEventListener('PointerMove', onMovePointer as (a: unknown) => void);
            box.RemoveRoutedEventListener('PointerUp',   onUp as (a: unknown) => void);
        });
    }

    private wireBrightnessRailPointer(): void
    {
        const rail = this._vRail;
        if (rail === undefined) return;
        let dragging = false;
        const apply = (args: PointerEventArgs): void => {
            const origin = hostOriginOf(rail);
            const h = rail.ArrangedRect.Height;
            if (h <= 0) return;
            const v = clamp01((args.HostY - origin.y) / h);
            this.Brightness = (1 - v) * 100;
        };
        const onDown = (args: PointerEventArgs): void => {
            dragging = true;
            args.CapturePointer(rail);
            apply(args);
            args.Handled = true;
        };
        const onMove = (args: PointerEventArgs): void => { if (dragging) apply(args); };
        const onUp = (args: PointerEventArgs): void => {
            if (!dragging) return;
            dragging = false;
            args.ReleasePointerCapture();
            args.Handled = true;
        };
        rail.AddRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
        rail.AddRoutedEventListener('PointerMove', onMove as (a: unknown) => void);
        rail.AddRoutedEventListener('PointerUp',   onUp as (a: unknown) => void);
        this._moreListeners.push(() => {
            rail.RemoveRoutedEventListener('PointerDown', onDown as (a: unknown) => void);
            rail.RemoveRoutedEventListener('PointerMove', onMove as (a: unknown) => void);
            rail.RemoveRoutedEventListener('PointerUp',   onUp as (a: unknown) => void);
        });
    }

    // Batched H/S write — bypasses the per-DP cascade so onHsvChanged
    // only runs once for a single pointer move.
    private applyHueSat(h: number, s: number): void
    {
        if (this._syncing) return;
        this._syncing = true;
        try
        {
            this.Hue        = h;
            this.Saturation = s;
        }
        finally { this._syncing = false; }
        this.onHsvChanged();
    }

    // Reposition cursors + rebuild the rail's vertical gradient. Called
    // whenever Hue / Saturation / Brightness move, regardless of source.
    private refreshGradientBox(): void
    {
        if (!this._moreMounted) return;
        if (this._hsBox !== undefined && this._hsBoxCursor !== undefined)
        {
            const w = this._hsBox.Width  ?? 220;
            const h = this._hsBox.Height ?? 140;
            const cw = this._hsBoxCursor.Width  ?? 12;
            const ch = this._hsBoxCursor.Height ?? 12;
            Canvas.SetLeft(this._hsBoxCursor, (this.Hue / 360) * w - cw / 2);
            Canvas.SetTop( this._hsBoxCursor, ((100 - this.Saturation) / 100) * h - ch / 2);
        }
        if (this._vRail !== undefined && this._vRailCursor !== undefined)
        {
            const railW = this._vRail.Width  ?? 20;
            const railH = this._vRail.Height ?? 140;
            const cw    = this._vRailCursor.Width  ?? 26;
            const ch    = this._vRailCursor.Height ?? 4;
            Canvas.SetLeft(this._vRailCursor, (railW - cw) / 2);
            Canvas.SetTop( this._vRailCursor, ((100 - this.Brightness) / 100) * railH - ch / 2);
        }
        if (this._vRailFill !== undefined)
        {
            this._vRailFill.Fill = buildRailBrush(this.Hue, this.Saturation);
        }
    }

    private unmountMoreColors(): void
    {
        if (!this._moreMounted) return;
        if (this._moreHost !== undefined) this.DetachOverlayChild(this._moreHost);
        for (const dispose of this._moreListeners) dispose();
        this._moreListeners = [];
        this._rSlider       = undefined;
        this._gSlider       = undefined;
        this._blueSlider    = undefined;
        this._aSlider       = undefined;
        this._hexInput      = undefined;
        this._hsBox         = undefined;
        this._hsBoxOverlay  = undefined;
        this._hsBoxCursor   = undefined;
        this._vRail         = undefined;
        this._vRailFill     = undefined;
        this._vRailCursor   = undefined;
        this._moreHost      = undefined;
        this._moreMounted   = false;
        this._moreSnapshot  = undefined;
        this._moreCentered  = false;
        // Safety net: if the editor closed without a commit/cancel path (e.g.
        // IsMoreColorsOpen cleared externally), settle any pending modal promise.
        this.resolveMore(undefined);
    }
}

function targetOf(host: Visual): PresentationTarget | undefined
{
    const back = host as unknown as { ['target']?: PresentationTarget };
    return back['target'];
}

// Depth-first collect of swatch ClickableBorders under a container. Grid
// swatches are leaves (no children), so we don't recurse into a matched
// ClickableBorder.
function collectSwatches(root: Visual, out: ClickableBorder[]): void
{
    for (const child of root.visualChildren)
    {
        if (child instanceof ClickableBorder) out.push(child);
        else collectSwatches(child, out);
    }
}

// The resolved colour a swatch paints, or undefined when its Fill
// isn't a solid colour (e.g. a token that resolved to a non-solid brush).
function colorOfSwatch(sw: Border): Color | undefined
{
    const bg = sw.Fill;
    return bg instanceof SolidColorBrush ? bg.Color : undefined;
}

function clamp01(v: number): number
{
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Walk up the visual chain summing each ancestor's ArrangedRect origin
// to translate a Visual's local coordinate frame to host space — the
// same pattern Slider.primaryOrigin uses.
function hostOriginOf(visual: Visual): { x: number; y: number }
{
    let x = 0;
    let y = 0;
    let cur: Visual | undefined = visual;
    while (cur !== undefined)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// Horizontal rainbow at full saturation + value — the bottom layer of
// the 2D HS box. Six hue stops + a closing red so the gradient wraps
// without a banding break.
function buildHueRainbowBrush(): LinearGradientBrush
{
    const brush = new LinearGradientBrush([
        new GradientStop(new Color(255, 0,   0),   0    ),
        new GradientStop(new Color(255, 255, 0),   1 / 6),
        new GradientStop(new Color(0,   255, 0),   2 / 6),
        new GradientStop(new Color(0,   255, 255), 3 / 6),
        new GradientStop(new Color(0,   0,   255), 4 / 6),
        new GradientStop(new Color(255, 0,   255), 5 / 6),
        new GradientStop(new Color(255, 0,   0),   1    ),
    ]);
    brush.StartPoint = new Point(0, 0);
    brush.EndPoint   = new Point(1, 0);
    return brush;
}

// Vertical transparent-to-white overlay — sits over the rainbow brush
// to desaturate toward the bottom of the box, so Y=0 reads as the pure
// hue and Y=max reads as white. Office-classic colour-dialog feel.
function buildWhiteOverlayBrush(): LinearGradientBrush
{
    const brush = new LinearGradientBrush([
        new GradientStop(new Color(255, 255, 255, 0  ), 0),
        new GradientStop(new Color(255, 255, 255, 255), 1),
    ]);
    brush.StartPoint = new Point(0, 0);
    brush.EndPoint   = new Point(0, 1);
    return brush;
}

// Vertical gradient for the brightness rail: top stop is the picker's
// current (H, S) at V=100; bottom stop is black. As the user drags H/S
// the rail's top stop re-tints to track the chosen hue.
function buildRailBrush(hue: number, saturation: number): LinearGradientBrush
{
    const top = hsvToRgb(hue, saturation, 100);
    const brush = new LinearGradientBrush([
        new GradientStop(new Color(top.r, top.g, top.b), 0),
        new GradientStop(new Color(0,     0,     0    ), 1),
    ]);
    brush.StartPoint = new Point(0, 0);
    brush.EndPoint   = new Point(0, 1);
    return brush;
}
