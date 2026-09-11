import {
    MetaData,
    MuralBase,
    Thickness,
    VerticalAlignment,
    Element,
    type KeyEventArgs,
    Key,
} from '../runtime/index.js';
import { ClickableBorder } from './clickable-border.js';
import { TemplatedControl } from './templated-control.js';
import { TextBox } from './text-box.js';
import { TextBlock } from './text-block.js';

// Resource-dictionary key — matches the `x:key` literal in
// controls.template.mu's DefaultSpinEdit entry.


// Numeric up/down editor — the WPF / DevExpress NumericUpDown analog.
// Composes an inner TextBox (single-line, holds the formatted display)
// with a right-edge column of ▴ / ▾ buttons that step the value by
// SmallChange. ArrowUp / ArrowDown reach the same path; PageUp /
// PageDown step by LargeChange.
//
// DPs:
//   Value         — the numeric value. Writes are clamped to
//                   [Minimum, Maximum]; NaN writes are rejected (the
//                   previous value is preserved).
//   Minimum       — lower bound (default -Number.MAX_VALUE — effectively
//                   unbounded).
//   Maximum       — upper bound (default +Number.MAX_VALUE).
//   SmallChange   — increment for the ▴/▾ buttons and Arrow keys
//                   (default 1).
//   LargeChange   — increment for PageUp / PageDown (default 10).
//   DecimalPlaces — display precision used by both formatting and
//                   commit-time rounding (default 0). The user can
//                   type extra decimals; the committed value is
//                   rounded to this precision before clamping.
//   IsReadOnly    — when true, every value-mutating path is gated:
//                   buttons, Arrow / Page keys, and Enter-commits of
//                   typed text. The inner TextBox is also flipped
//                   IsReadOnly so the user can't change its display.
//
// Text <-> Value protocol:
//   * Value→Text:  every Value change reformats and writes the inner
//                  TextBox's Text. Happens whether or not the user is
//                  mid-edit — a click on ▴ while the user has typed
//                  garbage commits the (clamped) Value and overwrites
//                  the in-progress garbage. WPF NumericUpDown does the
//                  same.
//   * Text→Value:  on COMMIT events only — the inner TextBox loses
//                  focus (blur), or the user presses Enter while
//                  focused. If the typed text parses to a finite
//                  number, Value is rounded-to-DecimalPlaces, clamped,
//                  and written; else Text reverts to the formatted
//                  current Value.
//
// Layout:
//
//   ┌────────────────┬─┐
//   │   42           │▴│
//   │                ├─┤
//   │                │▾│
//   └────────────────┴─┘
//
// The outer Border (PART_Border) is the field chrome; its Stroke
// reacts to the INNER TextBox's IsFocused / IsMouseOver flags so a
// click into the value text turns the outline blue (Material Outlined
// look). The inner TextBox's own Border is flipped to zero thickness
// at construction so the user sees one outline, not two concentric
// outlines.
enum SpinStep
{
    Small = 'small',
    Large = 'large',
}

export class SpinEdit extends TemplatedControl
{
    // BindsTwoWayByDefault: a numeric editor's committed Value round-trips to
    // its bound source without an explicit Mode, matching Slider.Value and the
    // WPF convention for value editors.
    public static readonly ValueKey         = MuralBase.RegisterProperty<number>( SpinEdit, 'Value',         0,                  MetaData.BindsTwoWayByDefault);
    public static readonly MinimumKey       = MuralBase.RegisterProperty<number>( SpinEdit, 'Minimum',       -Number.MAX_VALUE,  MetaData.None);
    public static readonly MaximumKey       = MuralBase.RegisterProperty<number>( SpinEdit, 'Maximum',       Number.MAX_VALUE,   MetaData.None);
    public static readonly SmallChangeKey   = MuralBase.RegisterProperty<number>( SpinEdit, 'SmallChange',   1,                  MetaData.None);
    public static readonly LargeChangeKey   = MuralBase.RegisterProperty<number>( SpinEdit, 'LargeChange',   10,                 MetaData.None);
    public static readonly DecimalPlacesKey = MuralBase.RegisterProperty<number>( SpinEdit, 'DecimalPlaces', 0,                  MetaData.None);
    public static readonly IsReadOnlyKey    = MuralBase.RegisterProperty<boolean>(SpinEdit, 'IsReadOnly',    false,              MetaData.None);

    public get IsEditFocused(): boolean { return this.get_property_value(SpinEdit.IsEditFocusedKey); }
    public get IsEditHovered(): boolean { return this.get_property_value(SpinEdit.IsEditHoveredKey); }
    // Surface the inner TextBox's IsFocused / IsMouseOver onto SpinEdit
    // itself so the DefaultSpinEdit template can trigger on these to
    // swap PART_Border.Stroke — no imperative refreshChrome
    // routine reaching into the inner TextBox. The forwarding listeners
    // wired in the ctor keep these DPs synced.
    private static readonly _IsEditFocusedPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        SpinEdit, 'IsEditFocused', false, MetaData.None);
    public  static readonly IsEditFocusedKey  = SpinEdit._IsEditFocusedPriv;
    private static readonly _IsEditHoveredPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        SpinEdit, 'IsEditHovered', false, MetaData.None);
    public  static readonly IsEditHoveredKey  = SpinEdit._IsEditHoveredPriv;

    static {
        MuralBase.OverrideMetadata(SpinEdit, Element.DefaultStyleKeyKey, { default_value: SpinEdit });
    }

    // Template parts — all resolved from DefaultSpinEdit in the
    // controls theme.
    private readonly _textBox:    TextBox;
    private readonly _upButton:   ClickableBorder;
    private readonly _downButton: ClickableBorder;

    // Cross-listener guard. When syncTextFromValue writes the inner
    // TextBox's Text DP, any Text → commit listener would otherwise
    // re-parse and try to set Value, looping. The guard short-circuits
    // commitText for the duration of the sync write.
    private _suppressTextSync = false;

    constructor()
    {
        super();

        // applyDefaultStyle resolves Style[TargetType=SpinEdit] from the
        // active theme dictionary → writes Template DP → TemplatedControl's
        // rebuildTemplate materialises @DefaultSpinEdit and attaches root.
        this.applyDefaultStyle();
        this._textBox    = this.GetTemplateChild('PART_TextBox') as TextBox;
        this._upButton   = this.GetTemplateChild('PART_Up')      as ClickableBorder;
        this._downButton = this.GetTemplateChild('PART_Down')    as ClickableBorder;

        // Hide the inner TextBox's own outline — the outer PART_Border is THE
        // visible field outline. Clearing Stroke suppresses the inner border's
        // paint AND its layout reserve (the border width now rides on the Stroke
        // pen; an undefined pen reserves and paints nothing).
        this._textBox.InnerBorder.Stroke = undefined;
        // Tighten the inner TextBox's vertical padding. The default
        // (12,8) is sized for a comfortable multi-line editor; in
        // SpinEdit's field-shaped chrome (~32 DIP tall by convention)
        // that padding leaves only ~14 DIP for an ~16.8 DIP line, which
        // makes the caret rect taller than the viewport — caret-into-
        // view would then jitter the editor's vertical offset on every
        // ▴ / ▾ click. Half the vertical padding gives the line real
        // headroom even in a 32-DIP chrome.
        this._textBox.InnerBorder.Padding = new Thickness(12, 4, 12, 4);
        // Centre the inner TextBox vertically in the DockPanel's
        // last-child slot. With default Stretch the TextBox fills the
        // full chrome height and its editor paints at the TOP of that
        // area — single-line value text would then sit glued to the
        // top instead of optically centred. Center mode arranges the
        // TextBox at its DesiredSize (one line + reduced padding),
        // centred vertically — text reads as centred in the field
        // regardless of how much taller the chrome is than the line.
        this._textBox.VerticalAlignment = VerticalAlignment.Center;

        // Value-font forwarding. The inner TextBox's default Style pins its
        // FontSize (M3 Body Large) at the Style tier, which out-ranks a plain
        // inherited `TextBlock.FontSize` set on the SpinEdit. Forward it
        // explicitly (Local on the inner TextBox) so a `TextBlock.FontSize=…`
        // on the SpinEdit actually resizes the value text. No-ops until the
        // consumer sets one — the TextBox's own Style default stands.
        this.PropertyChanged(TextBlock.FontSizeKey).subscribe(() => {
            this._textBox.FontSize = this.get_property_value(TextBlock.FontSizeKey) as number;
        });

        // ── Spin buttons ───────────────────────────────────────────
        // Commit the in-progress typed text first so the increment
        // applies on top of the user's intended value, not the prior
        // committed one. (Typing "3.14" then clicking ▴ with DP=0
        // becomes 3 → 4, not stale-value + 1.)
        this._upButton.onClick   = (): void => {
            this.commitText();
            this.step(+1, SpinStep.Small);
        };
        this._downButton.onClick = (): void => {
            this.commitText();
            this.step(-1, SpinStep.Small);
        };

        // ── Inner TextBox focus / hover forwarded as own DPs ───────
        // SpinEdit isn't focusable itself — focus lives on the composed
        // TextBox. Surface that state as IsEditFocused / IsEditHovered
        // on SpinEdit so the DefaultSpinEdit template can trigger on
        // them to swap PART_Border.Stroke (see basic.resources.mu).
        // No imperative `_border.Stroke =` writes from this class.
        const forwardFocus = (): void =>
        {
            this.set_property_value_with_key(SpinEdit._IsEditFocusedPriv, this._textBox.IsFocused);
        };
        const forwardHover = (): void =>
        {
            this.set_property_value_with_key(SpinEdit._IsEditHoveredPriv, this._textBox.IsMouseOver);
        };
        this._textBox.PropertyChanged(Element.IsFocusedKey).subscribe(forwardFocus);
        this._textBox.PropertyChanged(Element.IsMouseOverKey).subscribe(forwardHover);
        forwardFocus();
        forwardHover();

        // ── Text <-> Value plumbing ─────────────────────────────────
        // Initial sync of the display from the default Value.
        this.syncTextFromValue();
        // Reformat the display on every Value change — button click,
        // arrow / Page key, programmatic write.
        this.PropertyChanged(SpinEdit.ValueKey).subscribe(() => {
            this.syncTextFromValue();
        });
        // Blur commits whatever the user typed. We care only about
        // false→true transitions of IsFocused going OUT.
        this._textBox.PropertyChanged(Element.IsFocusedKey).subscribe(({ newValue }) => {
            if (newValue === false) this.commitText();
        });

        // ── IsReadOnly forwarding ───────────────────────────────────
        // Match the inner TextBox so the display can't be typed into
        // either. Forwarded on every change (incl. the initial value).
        this._textBox.IsReadOnly = this.IsReadOnly;
        this.PropertyChanged(SpinEdit.IsReadOnlyKey).subscribe(({ newValue }) => {
            this._textBox.IsReadOnly = newValue as boolean;
        });
    }

    // ── Public DPs ─────────────────────────────────────────────────

    public get Value(): number { return this.get_property_value(SpinEdit.ValueKey); }
    public set Value(v: number)
    {
        const clamped = this.clamp(v);
        this.set_property_value(SpinEdit.ValueKey, clamped);
    }

    public get Minimum(): number { return this.get_property_value(SpinEdit.MinimumKey); }
    public set Minimum(v: number) { this.set_property_value(SpinEdit.MinimumKey, v); }
    public get Maximum(): number { return this.get_property_value(SpinEdit.MaximumKey); }
    public set Maximum(v: number) { this.set_property_value(SpinEdit.MaximumKey, v); }
    public get SmallChange(): number { return this.get_property_value(SpinEdit.SmallChangeKey); }
    public set SmallChange(v: number) { this.set_property_value(SpinEdit.SmallChangeKey, v); }
    public get LargeChange(): number { return this.get_property_value(SpinEdit.LargeChangeKey); }
    public set LargeChange(v: number) { this.set_property_value(SpinEdit.LargeChangeKey, v); }
    public get DecimalPlaces(): number { return this.get_property_value(SpinEdit.DecimalPlacesKey); }
    public set DecimalPlaces(v: number) { this.set_property_value(SpinEdit.DecimalPlacesKey, v); }
    public get IsReadOnly(): boolean { return this.get_property_value(SpinEdit.IsReadOnlyKey); }
    public set IsReadOnly(v: boolean) { this.set_property_value(SpinEdit.IsReadOnlyKey, v); }

    // visualChildren / propagate_target_to_visual_children /
    // MeasureOverride / ArrangeOverride / RenderOverride all inherited
    // from TemplatedControl — they delegate to templateRoot (the outer
    // PART_Border).

    // ── Keyboard ────────────────────────────────────────────────────
    //
    // Handled in the TUNNEL phase so we intercept Arrow / Page / Enter
    // BEFORE the focused inner TextBox processes them — TextBox's own
    // ArrowUp / ArrowDown would otherwise step the caret to start / end
    // of the single-line text, and Enter would bubble through.
    protected override OnPreviewKeyDown(args: KeyEventArgs): void
    {
        if (args.Handled) return;
        switch (args.Key)
        {
            case Key.Up:
                if (!this.IsReadOnly) { this.commitText(); this.step(+1, SpinStep.Small); }
                args.Handled = true; return;
            case Key.Down:
                if (!this.IsReadOnly) { this.commitText(); this.step(-1, SpinStep.Small); }
                args.Handled = true; return;
            case Key.PageUp:
                if (!this.IsReadOnly) { this.commitText(); this.step(+1, SpinStep.Large); }
                args.Handled = true; return;
            case Key.PageDown:
                if (!this.IsReadOnly) { this.commitText(); this.step(-1, SpinStep.Large); }
                args.Handled = true; return;
            case Key.Return:
                this.commitText();
                args.Handled = true; return;
        }
    }

    // ── Internals ──────────────────────────────────────────────────

    private step(direction: -1 | 1, mode: SpinStep): void
    {
        if (this.IsReadOnly) return;
        const delta = mode === SpinStep.Large ? this.LargeChange : this.SmallChange;
        this.Value = this.Value + direction * delta;
    }

    private clamp(v: number): number
    {
        // Reject NaN writes — keep the prior value. A consumer who binds
        // a TVM property to Value and lets it transiently become NaN
        // (intermediate parse, etc.) would otherwise corrupt SpinEdit's
        // state permanently.
        if (Number.isNaN(v)) return this.Value;
        return Math.max(this.Minimum, Math.min(this.Maximum, v));
    }

    private formatValue(v: number): string
    {
        // toFixed handles negative / zero / very small values uniformly;
        // floor() guards against a fractional DecimalPlaces write from
        // upstream binding.
        const dp = Math.max(0, Math.floor(this.DecimalPlaces));
        // A binding can transiently deliver undefined / null / NaN before its
        // source resolves (DataContext not yet set, forward ref) — e.g. a
        // `Value = $Setting.Value` row materialised before it is slotted into
        // the tree. Fall back to 0 for display rather than crashing on
        // `.toFixed`; the real value paints as soon as the binding resolves.
        const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
        return n.toFixed(dp);
    }

    private parseValue(text: string): number | undefined
    {
        const trimmed = text.trim();
        if (trimmed.length === 0) return undefined;
        // Number() accepts JS number literals (incl. "1e3", "Infinity").
        // The finite check rejects Infinity / NaN — both of which would
        // corrupt the clamped value path downstream.
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return undefined;
        return n;
    }

    private syncTextFromValue(): void
    {
        this._suppressTextSync = true;
        this._textBox.Text = this.formatValue(this.Value);
        this._suppressTextSync = false;
    }

    private commitText(): void
    {
        // Re-entry guard: when syncTextFromValue writes Text, any
        // hypothetical Text-listener chain that called back into
        // commitText would loop on the very same TextBox.Text we just
        // assigned. Real Text changes (user typing) flow through
        // unaffected.
        if (this._suppressTextSync) return;
        const parsed = this.parseValue(this._textBox.Text);
        if (parsed === undefined)
        {
            // Invalid text — restore display from current Value.
            this.syncTextFromValue();
            return;
        }
        // Round to DP precision BEFORE clamping so user "1.999" with
        // DecimalPlaces=0 commits as 2 (the rounded value), then is
        // clamped against Min/Max. Reverse order would clamp 1.999
        // first then round, which produces the same number here but
        // misbehaves at the bounds (1.999 at Maximum=1 would round to
        // 2 after clamping to 1 — silly).
        const dp = Math.max(0, Math.floor(this.DecimalPlaces));
        const factor = Math.pow(10, dp);
        const rounded = Math.round(parsed * factor) / factor;
        this.Value = rounded;
        // Always re-sync — even if Value didn't change. (Example:
        // current Value=2 with DP=0, user types "2.0" and blurs.
        // parseValue → 2, set Value=2 → no PropertyChanged → no
        // syncTextFromValue listener → Text stays "2.0". We want "2".)
        this.syncTextFromValue();
    }
}
