import {
    MetaData,
    MuralBase,
} from '../../../runtime/index.js';

// One inspector panel hosted by the InspectorService. The service manages a
// collection of these (the shell's Inspector region renders them as a pinned,
// collapsible stack — VS-style property panels). Each inspector is presented
// BODY-first through a DataTemplate matched to its runtime type (the same
// implicit-by-type dispatch ContentControl uses); the surrounding titled,
// collapsible chrome is supplied by the InspectorPanel container.
//
// Contract:
//   * Id         — stable identity. The service dedupes by it: Add()-ing an
//                  inspector whose Id already hosts re-surfaces the existing
//                  panel instead of stacking a duplicate.
//   * Title      — the collapsible section header text.
//   * IsExpanded — view state, settable so the host can expand a reused panel
//                  and so the panel's header toggle can round-trip it. Lives on
//                  the inspector (not just the container) so it persists across
//                  container recycling and survives a capability switch.
export interface IInspector
{
    readonly Id: string;
    readonly Title: string;
    IsExpanded: boolean;
}

// Base view-model for a hosted inspector. Concrete inspectors (BoardInspector,
// …) extend this and add their own reactive state; they render through a
// DataTemplate[DataType=<subclass>]. Extends MuralBase so Title / IsExpanded are
// bindable DPs — the InspectorPanel chrome binds `$Title` and round-trips
// `$IsExpanded`, and a markup binding's first segment must be a DP to resolve
// (and stay reactive).
export abstract class Inspector extends MuralBase implements IInspector
{
    public static readonly IdKey         = MuralBase.RegisterProperty<string>(
        Inspector, 'Id',    '', MetaData.None);
    public static readonly TitleKey      = MuralBase.RegisterProperty<string>(
        Inspector, 'Title', '', MetaData.None);
    // BindsTwoWayByDefault: the InspectorPanel header toggle binds this and must
    // push its flips back onto the VM without an explicit Mode.
    public static readonly IsExpandedKey = MuralBase.RegisterProperty<boolean>(
        Inspector, 'IsExpanded', true, MetaData.None | MetaData.BindsTwoWayByDefault);

    // Id / Title are set once by the subclass ctor (via super(id, title)); they
    // identify + label the panel and don't change over its life, so no public
    // setters — the getters back the IInspector contract.
    protected constructor(id: string, title: string)
    {
        super();
        this.set_property_value(Inspector.IdKey,    id);
        this.set_property_value(Inspector.TitleKey, title);
    }

    public get Id():    string { return this.get_property_value(Inspector.IdKey); }
    public get Title(): string { return this.get_property_value(Inspector.TitleKey); }

    public get IsExpanded():  boolean { return this.get_property_value(Inspector.IsExpandedKey); }
    public set IsExpanded(v: boolean) { this.set_property_value(Inspector.IsExpandedKey, v); }
}
