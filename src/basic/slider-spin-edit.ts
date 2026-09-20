import {
    MetaData,
    MuralBase,
    Element,
    Visibility,
} from '../runtime/index.js';
import { TemplatedControl } from './templated-control.js';
import { Slider } from './slider.js';
import { SpinEdit } from './spin-edit.js';
import { TextBlock } from './text-block.js';

// Slider + numeric-readout combo — the MS-Office "Transparency" editor
// shape: a drag Slider on the left and a SpinEdit (typeable ▴/▾ field) on
// the right, both driving ONE Value, plus an optional trailing Unit label
// ("%"). Drag the slider or type/step the field — they stay in lockstep.
//
// All of Minimum / Maximum / SmallChange / LargeChange forward to BOTH
// children; DecimalPlaces forwards to the SpinEdit and also rounds Value,
// so a DecimalPlaces=0 combo snaps the slider to whole steps as you drag.
//
// Composition lives in the default template (PART_Slider / PART_SpinEdit /
// PART_Unit); this class owns the two-way Value sync + the forwarding, so
// the children carry no per-use wiring.
export class SliderSpinEdit extends TemplatedControl
{
    public static readonly ValueKey         = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'Value',         0,   MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly MinimumKey       = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'Minimum',       0,   MetaData.None);
    public static readonly MaximumKey       = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'Maximum',       100, MetaData.None);
    public static readonly SmallChangeKey   = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'SmallChange',   1,   MetaData.None);
    public static readonly LargeChangeKey   = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'LargeChange',   10,  MetaData.None);
    public static readonly DecimalPlacesKey = MuralBase.RegisterProperty<number>( SliderSpinEdit, 'DecimalPlaces', 0,   MetaData.None);
    public static readonly UnitKey          = MuralBase.RegisterProperty<string>( SliderSpinEdit, 'Unit',          '',  MetaData.None);

    static
    {
        MuralBase.OverrideMetadata(SliderSpinEdit, Element.DefaultStyleKeyKey, { default_value: SliderSpinEdit });
    }

    private readonly _slider: Slider;
    private readonly _spin:   SpinEdit;
    private readonly _unit:   TextBlock | undefined;

    // Re-entry guard for the Value ↔ children sync. A child write pulls
    // into Value, which pushes back to both children; the guard stops the
    // echo from looping.
    private _sync = false;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this._slider = this.GetTemplateChild('PART_Slider')   as Slider;
        this._spin   = this.GetTemplateChild('PART_SpinEdit') as SpinEdit;
        this._unit   = this.GetTemplateChild('PART_Unit')     as TextBlock | undefined;

        // Forward the range + step config to the children before the first
        // Value push so both clamp consistently. Re-forward on change so a
        // bound Minimum / Maximum (etc.) keeps the children in step.
        this.forwardRange();
        this.PropertyChanged(SliderSpinEdit.MinimumKey).subscribe(       () => this.forwardRange());
        this.PropertyChanged(SliderSpinEdit.MaximumKey).subscribe(       () => this.forwardRange());
        this.PropertyChanged(SliderSpinEdit.SmallChangeKey).subscribe(   () => this.forwardRange());
        this.PropertyChanged(SliderSpinEdit.LargeChangeKey).subscribe(   () => this.forwardRange());
        this.PropertyChanged(SliderSpinEdit.DecimalPlacesKey).subscribe( () => this.forwardRange());

        // Unit label — collapse when empty so a unit-less combo shows no
        // trailing gap.
        this.refreshUnit();
        this.PropertyChanged(SliderSpinEdit.UnitKey).subscribe(() => this.refreshUnit());

        // ── Two-way Value sync ──────────────────────────────────────
        // Seed the children from the current Value, then keep all three in
        // lockstep. Each handler runs the full push so a child-driven edit
        // also snaps the OTHER child (and the slider itself, to the rounded
        // Value) within one guarded pass.
        this.pushToChildren();
        this.PropertyChanged(SliderSpinEdit.ValueKey).subscribe(() => {
            if (this._sync) return;
            this._sync = true;
            try { this.pushToChildren(); }
            finally { this._sync = false; }
        });
        this._slider.PropertyChanged(Slider.ValueKey).subscribe(() => {
            if (this._sync) return;
            this._sync = true;
            try { this.Value = this._slider.Value; this.pushToChildren(); }
            finally { this._sync = false; }
        });
        this._spin.PropertyChanged(SpinEdit.ValueKey).subscribe(() => {
            if (this._sync) return;
            this._sync = true;
            try { this.Value = this._spin.Value; this.pushToChildren(); }
            finally { this._sync = false; }
        });
    }

    // ── Public DPs ─────────────────────────────────────────────────

    public get Value(): number { return this.get_property_value(SliderSpinEdit.ValueKey); }
    public set Value(v: number) { this.set_property_value(SliderSpinEdit.ValueKey, this.clampRound(v)); }

    public get Minimum(): number { return this.get_property_value(SliderSpinEdit.MinimumKey); }
    public set Minimum(v: number) { this.set_property_value(SliderSpinEdit.MinimumKey, v); }
    public get Maximum(): number { return this.get_property_value(SliderSpinEdit.MaximumKey); }
    public set Maximum(v: number) { this.set_property_value(SliderSpinEdit.MaximumKey, v); }
    public get SmallChange(): number { return this.get_property_value(SliderSpinEdit.SmallChangeKey); }
    public set SmallChange(v: number) { this.set_property_value(SliderSpinEdit.SmallChangeKey, v); }
    public get LargeChange(): number { return this.get_property_value(SliderSpinEdit.LargeChangeKey); }
    public set LargeChange(v: number) { this.set_property_value(SliderSpinEdit.LargeChangeKey, v); }
    public get DecimalPlaces(): number { return this.get_property_value(SliderSpinEdit.DecimalPlacesKey); }
    public set DecimalPlaces(v: number) { this.set_property_value(SliderSpinEdit.DecimalPlacesKey, v); }
    public get Unit(): string { return this.get_property_value(SliderSpinEdit.UnitKey); }
    public set Unit(v: string) { this.set_property_value(SliderSpinEdit.UnitKey, v); }

    // visualChildren / Measure / Arrange / Render inherited from
    // TemplatedControl — they delegate to templateRoot.

    // ── Internals ──────────────────────────────────────────────────

    private clampRound(v: number): number
    {
        if (Number.isNaN(v)) return this.Value;     // reject NaN — keep prior
        const clamped = Math.max(this.Minimum, Math.min(this.Maximum, v));
        const dp = Math.max(0, Math.floor(this.DecimalPlaces));
        const f = Math.pow(10, dp);
        return Math.round(clamped * f) / f;
    }

    private forwardRange(): void
    {
        this._slider.Minimum = this.Minimum;
        this._slider.Maximum = this.Maximum;
        this._slider.SmallChange = this.SmallChange;
        this._slider.LargeChange = this.LargeChange;
        this._spin.Minimum = this.Minimum;
        this._spin.Maximum = this.Maximum;
        this._spin.SmallChange = this.SmallChange;
        this._spin.LargeChange = this.LargeChange;
        this._spin.DecimalPlaces = this.DecimalPlaces;
    }

    private pushToChildren(): void
    {
        this._slider.Value = this.Value;
        this._spin.Value   = this.Value;
    }

    private refreshUnit(): void
    {
        if (this._unit === undefined) return;
        const u = this.Unit;
        this._unit.Text = u;
        this._unit.Visibility = u.length > 0 ? Visibility.Visible : Visibility.Collapsed;
    }
}
