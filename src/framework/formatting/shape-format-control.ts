import {
    MetaData,
    MuralBase,
    Panel,
    Visibility,
    Element, type PropertyDescriptor,
    type Disposable,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Brush, Pen } from '../../visual-engine/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { TextBlock } from '../../basic/text-block.js';
import { SliderSpinEdit } from '../../basic/slider-spin-edit.js';
import { type DataTemplate } from '../../basic/templates/data-template.js';
import { ComboBox } from '../list/combo-box.js';
import { CapOption } from './cap-option.js';
import { FillEditor } from './fill-editor.js';
import { PenEditor } from './pen-editor.js';

const EMPTY_CAP_OPTIONS: readonly CapOption[] = Object.freeze([]) as readonly CapOption[];

// PowerPoint-style "Format Shape" pane — one column that combines the
// existing FillEditor (PowerPoint's "Fill" pane) and PenEditor
// (PowerPoint's "Line" pane). Two I/O DPs:
//
//   * Fill   — the shape's interior brush. Forwarded to PART_FillEditor.
//   * Stroke — the shape's outline Pen. Forwarded to PART_PenEditor.
//
// Both DPs are BindsTwoWayByDefault so a TwoWay binding on a consumer-
// side mirror DP (e.g., `DiagramVM.FormatFill`) round-trips edits made
// inside the inner editors back to the consumer without per-consumer
// listener plumbing.
//
// The two sub-editors are wired the same way PenEditor wires its own
// parts: a `_syncing` guard prevents the seed-and-echo loop where an
// external write into Fill / Stroke pushes onto the editor, the editor
// fires its own property change, and the listener re-writes the same
// value back upstream.
//
// Why two editors instead of one combined surface — FillEditor and
// PenEditor each carry a non-trivial state machine (variant tabs,
// body-template swapping, in-place Pen mutation). Composing the two
// keeps each editor's invariants intact and concentrates this control's
// responsibility on routing values between the consumer and the editors.
export class ShapeFormatControl extends TemplatedControl
{
    public static override readonly FillKey   = MuralBase.RegisterProperty<Brush | undefined>(
        ShapeFormatControl, 'Fill',   undefined,
        MetaData.None | MetaData.BindsTwoWayByDefault);
    public static override readonly StrokeKey = MuralBase.RegisterProperty<Pen | undefined>(
        ShapeFormatControl, 'Stroke', undefined,
        MetaData.None | MetaData.BindsTwoWayByDefault);

    // Connector end-cap I/O. Two-way like Fill/Stroke so a consumer's
    // mirror DP (e.g. Diagram.SelectionFormatSourceCap) round-trips a cap
    // chosen in the dropdown back onto the selected connector(s). The
    // VALUE is the DataTemplate to apply at that end (undefined = "None").
    // The dropdown rows come from CapOptions; ShowCaps gates the whole
    // cap section so it only appears for a connector selection. The
    // formatting layer stays domain-agnostic — the consumer supplies the
    // catalog via CapOptions (see the diagram layer's connectorCapOptions()).
    public static readonly SourceCapTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        ShapeFormatControl, 'SourceCapTemplate', undefined,
        MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly TargetCapTemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        ShapeFormatControl, 'TargetCapTemplate', undefined,
        MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly ShowCapsKey = MuralBase.RegisterProperty<boolean>(
        ShapeFormatControl, 'ShowCaps', false, MetaData.None);
    public static readonly CapOptionsKey = MuralBase.RegisterProperty<readonly CapOption[]>(
        ShapeFormatControl, 'CapOptions', EMPTY_CAP_OPTIONS, MetaData.None);

    // Per-end cap size multipliers (Connector.SourceCapScale / TargetCapScale).
    // Two-way like the cap templates so a consumer mirror DP round-trips the
    // slider edit back onto the selected connector(s). 1 = authored size.
    public static readonly SourceCapScaleKey = MuralBase.RegisterProperty<number>(
        ShapeFormatControl, 'SourceCapScale', 1,
        MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly TargetCapScaleKey = MuralBase.RegisterProperty<number>(
        ShapeFormatControl, 'TargetCapScale', 1,
        MetaData.None | MetaData.BindsTwoWayByDefault);

    public override get Fill():   Brush | undefined  { return this.get_property_value(ShapeFormatControl.FillKey); }
    public override set Fill(v:   Brush | undefined) { this.set_property_value(ShapeFormatControl.FillKey, v); }
    public override get Stroke(): Pen | undefined    { return this.get_property_value(ShapeFormatControl.StrokeKey); }
    public override set Stroke(v: Pen | undefined)   { this.set_property_value(ShapeFormatControl.StrokeKey, v); }
    public get SourceCapTemplate(): DataTemplate | undefined { return this.get_property_value(ShapeFormatControl.SourceCapTemplateKey); }
    public set SourceCapTemplate(v: DataTemplate | undefined) { this.set_property_value(ShapeFormatControl.SourceCapTemplateKey, v); }
    public get TargetCapTemplate(): DataTemplate | undefined { return this.get_property_value(ShapeFormatControl.TargetCapTemplateKey); }
    public set TargetCapTemplate(v: DataTemplate | undefined) { this.set_property_value(ShapeFormatControl.TargetCapTemplateKey, v); }
    public get ShowCaps():   boolean                 { return this.get_property_value(ShapeFormatControl.ShowCapsKey); }
    public set ShowCaps(v:   boolean)                { this.set_property_value(ShapeFormatControl.ShowCapsKey, v); }
    public get CapOptions(): readonly CapOption[]    { return this.get_property_value(ShapeFormatControl.CapOptionsKey); }
    public set CapOptions(v: readonly CapOption[])   { this.set_property_value(ShapeFormatControl.CapOptionsKey, v); }
    public get SourceCapScale(): number              { return this.get_property_value(ShapeFormatControl.SourceCapScaleKey); }
    public set SourceCapScale(v: number)             { this.set_property_value(ShapeFormatControl.SourceCapScaleKey, v); }
    public get TargetCapScale(): number              { return this.get_property_value(ShapeFormatControl.TargetCapScaleKey); }
    public set TargetCapScale(v: number)             { this.set_property_value(ShapeFormatControl.TargetCapScaleKey, v); }

    static {
        MuralBase.OverrideMetadata(ShapeFormatControl, Element.DefaultStyleKeyKey, { default_value: ShapeFormatControl });
    }

    private _syncing = false;
    private _fillEditor: FillEditor | undefined;
    private _penEditor:  PenEditor  | undefined;
    // Empty-state parts. When both Fill and Stroke are undefined (the
    // consumer's "no shape selected" signal) PART_Editors flips to
    // Visibility=Collapsed (zero slot, no paint, no hit) and
    // PART_EmptyMessage flips Visible. Symmetric flip when a brush
    // flows in.
    private _editors:        StackPanel | undefined;
    private _emptyMessage:   TextBlock  | undefined;
    // Connector cap section. PART_CapSection collapses unless ShowCaps;
    // the two combos pick the per-end cap template from CapOptions.
    private _capSection:     Panel      | undefined;
    private _sourceCapCombo: ComboBox   | undefined;
    private _targetCapCombo: ComboBox   | undefined;
    private _sourceCapScale: SliderSpinEdit | undefined;
    private _targetCapScale: SliderSpinEdit | undefined;
    private _partListeners: Disposable[] = [];

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptTemplateParts();
    }

    private adoptTemplateParts(): void
    {
        this._fillEditor = this.GetTemplateChild('PART_FillEditor') as FillEditor | undefined;
        this._penEditor  = this.GetTemplateChild('PART_PenEditor')  as PenEditor  | undefined;
        this._editors      = this.GetTemplateChild('PART_Editors')      as StackPanel | undefined;
        this._emptyMessage = this.GetTemplateChild('PART_EmptyMessage') as TextBlock  | undefined;
        this._capSection     = this.GetTemplateChild('PART_CapSection')   as Panel      | undefined;
        this._sourceCapCombo = this.GetTemplateChild('PART_SourceCap')    as ComboBox   | undefined;
        this._targetCapCombo = this.GetTemplateChild('PART_TargetCap')    as ComboBox   | undefined;
        this._sourceCapScale = this.GetTemplateChild('PART_SourceCapScale') as SliderSpinEdit | undefined;
        this._targetCapScale = this.GetTemplateChild('PART_TargetCapScale') as SliderSpinEdit | undefined;
        this.refreshEmptyState();
        this.refreshCapVisibility();
        this.wireCapCombos();
        this.wireCapScales();

        if (this._fillEditor !== undefined)
        {
            const fe = this._fillEditor;
            // Seed the editor with whatever the consumer pre-set on
            // Fill. Done under _syncing so the editor's own
            // OnPropertyChanged('Fill') round-trip is suppressed.
            this._syncing = true;
            try { fe.Fill = this.Fill; } finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { this.Fill = fe.Fill; } finally { this._syncing = false; }
            };
            const key = resolveKey(fe, undefined, 'Fill');
            this._partListeners.push(fe.PropertyChanged(key).subscribe(handler));
        }

        if (this._penEditor !== undefined)
        {
            const pe = this._penEditor;
            this._syncing = true;
            try { pe.Pen = this.Stroke; } finally { this._syncing = false; }
            const handler = (): void => {
                if (this._syncing) return;
                this._syncing = true;
                try { this.Stroke = pe.Pen; } finally { this._syncing = false; }
            };
            const key = resolveKey(pe, undefined, 'Pen');
            this._partListeners.push(pe.PropertyChanged(key).subscribe(handler));
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== ShapeFormatControl) return;
        // Refresh empty-state on every Fill / Stroke write regardless of
        // _syncing — the consumer-side clear (Fill = undefined when no
        // shape is selected) is what flips the state.
        if (descriptor.Name === 'Fill' || descriptor.Name === 'Stroke')
        {
            this.refreshEmptyState();
        }
        // Cap-section DPs. ShowCaps + CapOptions refresh regardless of the
        // _syncing guard (they're consumer-driven structural changes, not
        // editor echoes).
        if (descriptor.Name === 'ShowCaps')
        {
            this.refreshCapVisibility();
        }
        else if (descriptor.Name === 'CapOptions')
        {
            this.populateCapCombos();
        }
        if (this._syncing) return;
        // External writes (consumer set Fill / Stroke) → push the new
        // value into the matching editor under _syncing so the
        // editor's own property-change listener bails without echoing.
        this._syncing = true;
        try {
            switch (descriptor.Name)
            {
                case 'Fill':
                    if (this._fillEditor !== undefined) this._fillEditor.Fill = newValue as Brush | undefined;
                    break;
                case 'Stroke':
                    if (this._penEditor !== undefined)  this._penEditor.Pen   = newValue as Pen   | undefined;
                    break;
                case 'SourceCapTemplate':
                    this.selectCapOption(this._sourceCapCombo, newValue as DataTemplate | undefined);
                    break;
                case 'TargetCapTemplate':
                    this.selectCapOption(this._targetCapCombo, newValue as DataTemplate | undefined);
                    break;
                case 'SourceCapScale':
                    if (this._sourceCapScale !== undefined) this._sourceCapScale.Value = newValue as number;
                    break;
                case 'TargetCapScale':
                    if (this._targetCapScale !== undefined) this._targetCapScale.Value = newValue as number;
                    break;
            }
        } finally { this._syncing = false; }
    }

    // Toggle PART_Editors / PART_EmptyMessage via the Visibility DP.
    // Both Fill and Stroke undefined → no shape is selected → collapse
    // the editor stack, reveal the placeholder. Either present → reveal
    // the editors, collapse the placeholder. Visibility=Collapsed zeroes
    // the DesiredSize and suppresses paint + hit-test in one shot — no
    // RemoveChild dance and no Height=0 leak.
    private refreshEmptyState(): void
    {
        const empty = this.Fill === undefined && this.Stroke === undefined;
        const editors = this._editors;
        if (editors !== undefined)
        {
            editors.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        }
        const msg = this._emptyMessage;
        if (msg !== undefined)
        {
            msg.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    // ShowCaps gates the whole cap section — it only makes sense for a
    // connector selection, which the consumer signals via ShowCaps.
    private refreshCapVisibility(): void
    {
        const section = this._capSection;
        if (section !== undefined)
        {
            section.Visibility = this.ShowCaps ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    // Populate both cap combos from CapOptions and two-way wire each
    // combo's SelectedItem to the matching cap-template DP. Re-run when
    // CapOptions changes (the consumer typically sets it once, but a late
    // assignment must still populate the dropdowns).
    private wireCapCombos(): void
    {
        this.populateCapCombos();
        this.wireCapCombo(this._sourceCapCombo,
            () => this.SourceCapTemplate,
            v  => { this.SourceCapTemplate = v; });
        this.wireCapCombo(this._targetCapCombo,
            () => this.TargetCapTemplate,
            v  => { this.TargetCapTemplate = v; });
    }

    // Two-way wire each end's size SliderSpinEdit to the matching
    // *CapScale DP — seed the editor from the DP, push editor edits back.
    // Guarded by _syncing so an external DP write (the seed) doesn't echo.
    private wireCapScales(): void
    {
        this.wireCapScale(this._sourceCapScale,
            () => this.SourceCapScale,
            v  => { this.SourceCapScale = v; });
        this.wireCapScale(this._targetCapScale,
            () => this.TargetCapScale,
            v  => { this.TargetCapScale = v; });
    }

    private wireCapScale(
        edit: SliderSpinEdit | undefined,
        get:  () => number,
        set:  (v: number) => void,
    ): void
    {
        if (edit === undefined) return;
        this._syncing = true;
        try { edit.Value = get(); } finally { this._syncing = false; }
        const handler = (): void => {
            if (this._syncing) return;
            this._syncing = true;
            try { set(edit.Value); } finally { this._syncing = false; }
        };
        const key = resolveKey(edit, undefined, 'Value');
        this._partListeners.push(edit.PropertyChanged(key).subscribe(handler));
    }

    private populateCapCombos(): void
    {
        const options = this.CapOptions as readonly CapOption[] as unknown[];
        // CRITICAL: set Items under the _syncing guard. Assigning combo.Items
        // makes the ComboBox re-evaluate its selection and fire a SelectedItem
        // change — which is NOT a user pick. If the cap-template handler treats
        // it as one and writes it back through the TwoWay cap binding while that
        // binding's source is still an unresolved forward reference (the demo's
        // `$nodes.SelectionFormatTargetCap`, where the Diagram is constructed
        // later in the markup), the writeback fails and effective-value.ts
        // DISPOSES the binding — permanently. A later genuine pick then writes
        // only locally and never reaches the diagram, so the connector's caps
        // never update. Guarding population makes the handler bail on the
        // spurious change and keeps the binding alive for real selections.
        const wasSyncing = this._syncing;
        this._syncing = true;
        try
        {
            if (this._sourceCapCombo !== undefined) this._sourceCapCombo.Items = options;
            if (this._targetCapCombo !== undefined) this._targetCapCombo.Items = options;
        }
        finally { this._syncing = wasSyncing; }
        // Re-seed each combo's selection against the current DP value now
        // that the item set is known.
        this.selectCapOption(this._sourceCapCombo, this.SourceCapTemplate);
        this.selectCapOption(this._targetCapCombo, this.TargetCapTemplate);
    }

    private wireCapCombo(
        combo: ComboBox | undefined,
        get:   () => DataTemplate | undefined,
        set:   (v: DataTemplate | undefined) => void,
    ): void
    {
        if (combo === undefined) return;
        this.selectCapOption(combo, get());
        const handler = (): void => {
            if (this._syncing) return;
            const sel = combo.SelectedItem as CapOption | undefined;
            this._syncing = true;
            try { set(sel !== undefined ? sel.Template : undefined); } finally { this._syncing = false; }
        };
        const key = resolveKey(combo, undefined, 'SelectedItem');
        this._partListeners.push(combo.PropertyChanged(key).subscribe(handler));
    }

    // Select the option whose Template IS the given template (identity —
    // the catalog hands out the same @-keyed DataTemplate instance the
    // connector already holds, so reference equality matches). undefined
    // maps to the "None" option (Template === undefined).
    private selectCapOption(combo: ComboBox | undefined, tpl: DataTemplate | undefined): void
    {
        if (combo === undefined) return;
        const opts = (combo.Items ?? []) as CapOption[];
        const found = opts.find(o => o.Template === tpl);
        this._syncing = true;
        try { combo.SelectedItem = found; } finally { this._syncing = false; }
    }
}
