import {
    MetaData,
    MuralBase,
} from '../../../runtime/index.js';
import {
    type Brush,
    type Pen,
} from '../../../visual-engine/index.js';

// DataContext handed to a connector cap template at instantiation. The
// connector owns one per end, keeps it synced from its own `Stroke`, and
// sets it as the cap visual's DataContext — so a cap authored in markup
// can bind its paint to the connector that owns it:
//
//   * filled caps  → `Fill   = $Brush`   (the connector's stroke colour)
//   * stroked caps → `Stroke = $Pen`     (the connector's full Pen)
//
// `Brush` is `Stroke.Brush` lifted out so filled caps don't need a dotted
// binding path. `Pen` is the connector's Stroke verbatim so open caps
// inherit its thickness / dash too.
//
// This is the v1 shape of the deferred `ConnectorCapDataContext` from
// § 3.6 of [docs/connectors.md](../../../../docs/connectors.md):
// just the paint surface, no per-instance geometry data yet.
export class ConnectorCapDataContext extends MuralBase
{
    public static readonly BrushKey = MuralBase.RegisterProperty<Brush | undefined>(
        ConnectorCapDataContext, 'Brush', undefined, MetaData.None);
    public static readonly PenKey = MuralBase.RegisterProperty<Pen | undefined>(
        ConnectorCapDataContext, 'Pen', undefined, MetaData.None);

    public get Brush(): Brush | undefined { return this.get_property_value(ConnectorCapDataContext.BrushKey); }
    public set Brush(v: Brush | undefined) { this.set_property_value(ConnectorCapDataContext.BrushKey, v); }
    public get Pen(): Pen | undefined { return this.get_property_value(ConnectorCapDataContext.PenKey); }
    public set Pen(v: Pen | undefined) { this.set_property_value(ConnectorCapDataContext.PenKey, v); }
}
