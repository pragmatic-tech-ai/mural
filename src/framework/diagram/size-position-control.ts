import { MetaData, MuralBase, Element, type PropertyDescriptor } from '../../runtime/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { PositionAnchor } from './position-anchor.js';

// The "From" dropdown labels (rendered directly as ComboBox string items — no
// item template needed). SelectedFromLabel maps to/from the PositionFrom enum.
const TOP_LEFT_LABEL = 'Top Left Corner';
const CENTER_LABEL   = 'Center';

// The Size & Position editor's brain (view logic only). Raw DPs bind to the
// Diagram's SelectedShape* geometry; the derived DPs the fields bind to
// (Horizontal/Vertical position, Scale %) are kept in sync both ways with a
// reentrancy guard. LockAspectRatio is transient control state.
//
// Note: Width/Height would collide with Visual.Width/Height, so the raw size DPs
// are WidthValue/HeightValue; the WidthValue/HeightValue accessors below carry the shape size
// (used by the conversion logic + tests); Visual.Width/Height are left alone.
export class SizePositionControl extends TemplatedControl
{
    static
    {
        MuralBase.OverrideMetadata(SizePositionControl, Element.DefaultStyleKeyKey, { default_value: SizePositionControl });
    }

    // ── raw (bound to SelectedShape*) ────────────────────────────────────
    public static readonly LeftKey        = MuralBase.RegisterProperty<number>(SizePositionControl, 'Left', 0, MetaData.BindsTwoWayByDefault);
    public static readonly TopKey         = MuralBase.RegisterProperty<number>(SizePositionControl, 'Top', 0, MetaData.BindsTwoWayByDefault);
    public static readonly WidthValueKey  = MuralBase.RegisterProperty<number>(SizePositionControl, 'WidthValue', 0, MetaData.BindsTwoWayByDefault);
    public static readonly HeightValueKey = MuralBase.RegisterProperty<number>(SizePositionControl, 'HeightValue', 0, MetaData.BindsTwoWayByDefault);
    public static readonly RotationKey    = MuralBase.RegisterProperty<number>(SizePositionControl, 'Rotation', 0, MetaData.BindsTwoWayByDefault);
    public static readonly BaseWidthKey   = MuralBase.RegisterProperty<number>(SizePositionControl, 'BaseWidth', 0, MetaData.None);
    public static readonly BaseHeightKey  = MuralBase.RegisterProperty<number>(SizePositionControl, 'BaseHeight', 0, MetaData.None);
    public static readonly HasTargetKey   = MuralBase.RegisterProperty<boolean>(SizePositionControl, 'HasTarget', false, MetaData.None);

    // ── derived (bound to the SpinEdit/ComboBox/Switch fields) ───────────
    public static readonly HorizontalPositionKey = MuralBase.RegisterProperty<number>(SizePositionControl, 'HorizontalPosition', 0, MetaData.BindsTwoWayByDefault);
    public static readonly VerticalPositionKey   = MuralBase.RegisterProperty<number>(SizePositionControl, 'VerticalPosition', 0, MetaData.BindsTwoWayByDefault);
    public static readonly ScaleWidthKey  = MuralBase.RegisterProperty<number>(SizePositionControl, 'ScaleWidth', 100, MetaData.BindsTwoWayByDefault);
    public static readonly ScaleHeightKey = MuralBase.RegisterProperty<number>(SizePositionControl, 'ScaleHeight', 100, MetaData.BindsTwoWayByDefault);
    public static readonly PositionFromKey = MuralBase.RegisterProperty<PositionAnchor>(SizePositionControl, 'PositionFrom', PositionAnchor.TopLeftCorner, MetaData.BindsTwoWayByDefault);
    public static readonly LockAspectRatioKey = MuralBase.RegisterProperty<boolean>(SizePositionControl, 'LockAspectRatio', false, MetaData.BindsTwoWayByDefault);
    // The "From" ComboBox: a static label list + the two-way selected label,
    // mapped to/from PositionFrom so the enum stays the source of truth.
    public static readonly FromLabelsKey = MuralBase.RegisterProperty<readonly string[]>(SizePositionControl, 'FromLabels', undefined as unknown as readonly string[], MetaData.None);
    public static readonly SelectedFromLabelKey = MuralBase.RegisterProperty<string>(SizePositionControl, 'SelectedFromLabel', TOP_LEFT_LABEL, MetaData.BindsTwoWayByDefault);

    private _syncing = false;

    constructor()
    {
        super();
        this.set_property_value(SizePositionControl.FromLabelsKey, [TOP_LEFT_LABEL, CENTER_LABEL]);
        this.applyDefaultStyle();
    }

    public get Left(): number { return this.get_property_value(SizePositionControl.LeftKey); }
    public set Left(v: number) { this.set_property_value(SizePositionControl.LeftKey, v); }
    public get Top(): number { return this.get_property_value(SizePositionControl.TopKey); }
    public set Top(v: number) { this.set_property_value(SizePositionControl.TopKey, v); }
    public get WidthValue(): number { return this.get_property_value(SizePositionControl.WidthValueKey); }
    public set WidthValue(v: number) { this.set_property_value(SizePositionControl.WidthValueKey, v); }
    public get HeightValue(): number { return this.get_property_value(SizePositionControl.HeightValueKey); }
    public set HeightValue(v: number) { this.set_property_value(SizePositionControl.HeightValueKey, v); }
    public get Rotation(): number { return this.get_property_value(SizePositionControl.RotationKey); }
    public set Rotation(v: number) { this.set_property_value(SizePositionControl.RotationKey, v); }
    public get BaseWidth(): number { return this.get_property_value(SizePositionControl.BaseWidthKey); }
    public set BaseWidth(v: number) { this.set_property_value(SizePositionControl.BaseWidthKey, v); }
    public get BaseHeight(): number { return this.get_property_value(SizePositionControl.BaseHeightKey); }
    public set BaseHeight(v: number) { this.set_property_value(SizePositionControl.BaseHeightKey, v); }
    public get HasTarget(): boolean { return this.get_property_value(SizePositionControl.HasTargetKey); }
    public set HasTarget(v: boolean) { this.set_property_value(SizePositionControl.HasTargetKey, v); }
    public get HorizontalPosition(): number { return this.get_property_value(SizePositionControl.HorizontalPositionKey); }
    public set HorizontalPosition(v: number) { this.set_property_value(SizePositionControl.HorizontalPositionKey, v); }
    public get VerticalPosition(): number { return this.get_property_value(SizePositionControl.VerticalPositionKey); }
    public set VerticalPosition(v: number) { this.set_property_value(SizePositionControl.VerticalPositionKey, v); }
    public get ScaleWidth(): number { return this.get_property_value(SizePositionControl.ScaleWidthKey); }
    public set ScaleWidth(v: number) { this.set_property_value(SizePositionControl.ScaleWidthKey, v); }
    public get ScaleHeight(): number { return this.get_property_value(SizePositionControl.ScaleHeightKey); }
    public set ScaleHeight(v: number) { this.set_property_value(SizePositionControl.ScaleHeightKey, v); }
    public get PositionFrom(): PositionAnchor { return this.get_property_value(SizePositionControl.PositionFromKey); }
    public set PositionFrom(v: PositionAnchor) { this.set_property_value(SizePositionControl.PositionFromKey, v); }
    public get LockAspectRatio(): boolean { return this.get_property_value(SizePositionControl.LockAspectRatioKey); }
    public set LockAspectRatio(v: boolean) { this.set_property_value(SizePositionControl.LockAspectRatioKey, v); }
    public get FromLabels(): readonly string[] { return this.get_property_value(SizePositionControl.FromLabelsKey); }
    public get SelectedFromLabel(): string { return this.get_property_value(SizePositionControl.SelectedFromLabelKey); }
    public set SelectedFromLabel(v: string) { this.set_property_value(SizePositionControl.SelectedFromLabelKey, v); }

    protected override OnPropertyChanged(d: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(d, oldValue, newValue);
        if (this._syncing) return;
        this._syncing = true;
        try
        {
            switch (d.Name)
            {
                case 'PositionFrom':
                    this.SelectedFromLabel = this.PositionFrom === PositionAnchor.Center ? CENTER_LABEL : TOP_LEFT_LABEL;
                    this._recomputeDerived();
                    break;
                case 'SelectedFromLabel':
                    this.PositionFrom = this.SelectedFromLabel === CENTER_LABEL ? PositionAnchor.Center : PositionAnchor.TopLeftCorner;
                    this._recomputeDerived();
                    break;
                case 'Left': case 'Top': case 'BaseWidth': case 'BaseHeight':
                    this._recomputeDerived();
                    break;
                case 'WidthValue':
                    if (this.LockAspectRatio) this._linkHeight(oldValue as number, newValue as number);
                    this._recomputeDerived();
                    break;
                case 'HeightValue':
                    if (this.LockAspectRatio) this._linkWidth(oldValue as number, newValue as number);
                    this._recomputeDerived();
                    break;
                case 'HorizontalPosition':
                    this.Left = this.PositionFrom === PositionAnchor.Center ? this.HorizontalPosition - this.WidthValue / 2 : this.HorizontalPosition;
                    break;
                case 'VerticalPosition':
                    this.Top = this.PositionFrom === PositionAnchor.Center ? this.VerticalPosition - this.HeightValue / 2 : this.VerticalPosition;
                    break;
                case 'ScaleWidth':
                    if (this.BaseWidth > 0) this.WidthValue = this.BaseWidth * this.ScaleWidth / 100;
                    if (this.LockAspectRatio) this.ScaleHeight = this.ScaleWidth;
                    this._recomputeDerived();
                    break;
                case 'ScaleHeight':
                    if (this.BaseHeight > 0) this.HeightValue = this.BaseHeight * this.ScaleHeight / 100;
                    if (this.LockAspectRatio) this.ScaleWidth = this.ScaleHeight;
                    this._recomputeDerived();
                    break;
            }
        }
        finally { this._syncing = false; }
    }

    private _linkHeight(oldW: number, newW: number): void
    {
        if (oldW > 0 && newW > 0) this.HeightValue = this.HeightValue * (newW / oldW);
    }
    private _linkWidth(oldH: number, newH: number): void
    {
        if (oldH > 0 && newH > 0) this.WidthValue = this.WidthValue * (newH / oldH);
    }
    private _recomputeDerived(): void
    {
        const centered = this.PositionFrom === PositionAnchor.Center;
        this.HorizontalPosition = centered ? this.Left + this.WidthValue / 2 : this.Left;
        this.VerticalPosition   = centered ? this.Top + this.HeightValue / 2 : this.Top;
        this.ScaleWidth  = this.BaseWidth  > 0 ? this.WidthValue  / this.BaseWidth  * 100 : 100;
        this.ScaleHeight = this.BaseHeight > 0 ? this.HeightValue / this.BaseHeight * 100 : 100;
    }
}
