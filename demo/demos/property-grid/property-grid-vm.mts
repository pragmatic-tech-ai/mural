// PropertyGridVM — backs the property-grid demo.
//
// Exposes two PropertyGrid configurations so the template can show both
// bag implementations side-by-side:
//
//   DpTarget / DpDescriptors  — DpPropertyBag over a tiny MuralBase
//                               subclass (SampleDpObject) that has three
//                               typed DPs (Text, Count, IsActive).
//
//   MapTarget / MapDescriptors — MapPropertyBag over a plain object with
//                                mixed kinds: text, number, boolean, enum.
//
// The VM class itself is the template's DataContext (MuralBase → DataTemplate
// auto-resolution by type name). SampleDpObject is defined inline as a static
// nested class — no module-level symbols.
import { MuralBase, MetaData } from '@pragmatic-tech-ai/mural/runtime';
import {
    DpPropertyBag,
    MapPropertyBag,
    GridProperty,
    type IPropertyBag,
    type PropertyAccessor,
} from '@pragmatic-tech-ai/mural/framework';

// ── Sample DP target ────────────────────────────────────────────────────────
// A minimal MuralBase subclass with three typed dependency properties.
// DpPropertyBag.constructor enumerates these via MuralBase.EnumerateProperties.
class SampleDpObject extends MuralBase
{
    static LabelKey    = MuralBase.RegisterProperty<string> (SampleDpObject, 'Label',    'Hello', MetaData.None);
    static CountKey    = MuralBase.RegisterProperty<number> (SampleDpObject, 'Count',    0,       MetaData.None);
    static IsActiveKey = MuralBase.RegisterProperty<boolean>(SampleDpObject, 'IsActive', true,    MetaData.None);

    get Label():    string  { return this.get_property_value(SampleDpObject.LabelKey); }
    set Label(v:    string)  { this.set_property_value(SampleDpObject.LabelKey, v); }
    get Count():    number  { return this.get_property_value(SampleDpObject.CountKey); }
    set Count(v:    number)  { this.set_property_value(SampleDpObject.CountKey, v); }
    get IsActive(): boolean { return this.get_property_value(SampleDpObject.IsActiveKey); }
    set IsActive(v: boolean) { this.set_property_value(SampleDpObject.IsActiveKey, v); }
}

// ── Demo VM ─────────────────────────────────────────────────────────────────
export class PropertyGridVM extends MuralBase
{
    // DP-backed bag
    static DpDescriptorsKey = MuralBase.RegisterProperty<readonly GridProperty[] | undefined>(
        PropertyGridVM, 'DpDescriptors', undefined, MetaData.None,
    );
    static DpTargetKey = MuralBase.RegisterProperty<IPropertyBag | undefined>(
        PropertyGridVM, 'DpTarget', undefined, MetaData.None,
    );

    // Map-backed bag
    static MapDescriptorsKey = MuralBase.RegisterProperty<readonly GridProperty[] | undefined>(
        PropertyGridVM, 'MapDescriptors', undefined, MetaData.None,
    );
    static MapTargetKey = MuralBase.RegisterProperty<IPropertyBag | undefined>(
        PropertyGridVM, 'MapTarget', undefined, MetaData.None,
    );

    get DpDescriptors(): readonly GridProperty[] | undefined {
        return this.get_property_value(PropertyGridVM.DpDescriptorsKey);
    }
    get DpTarget(): IPropertyBag | undefined {
        return this.get_property_value(PropertyGridVM.DpTargetKey);
    }
    get MapDescriptors(): readonly GridProperty[] | undefined {
        return this.get_property_value(PropertyGridVM.MapDescriptorsKey);
    }
    get MapTarget(): IPropertyBag | undefined {
        return this.get_property_value(PropertyGridVM.MapTargetKey);
    }

    constructor()
    {
        super();
        this.buildDpGrid();
        this.buildMapGrid();
    }

    private buildDpGrid(): void
    {
        const target = new SampleDpObject();
        const bag    = new DpPropertyBag(target);

        // Auto-derive descriptors from the DPs, then override categories.
        const overrides = new Map<string, GridProperty>([
            ['Label',    GridProperty.text  ('Label',    { displayName: 'Label',     category: 'General' })],
            ['Count',    GridProperty.number('Count',    { displayName: 'Count',     category: 'General' })],
            ['IsActive', GridProperty.bool  ('IsActive', { displayName: 'Is Active', category: 'General' })],
        ]);
        const descs = GridProperty.describeDpTarget(target, overrides);

        this.set_property_value(PropertyGridVM.DpDescriptorsKey, Object.freeze(descs));
        this.set_property_value(PropertyGridVM.DpTargetKey, bag);
    }

    private buildMapGrid(): void
    {
        // Plain data — held as instance state so the bag can mutate it.
        const data: { [k: string]: unknown } = {
            Name:     'Architecture',
            Priority: 2,
            Archived: false,
            Status:   'Active',
        };

        const accessors = new Map<string, PropertyAccessor>([
            ['Name',     { get: () => data['Name'],     set: v => { data['Name']     = v; } }],
            ['Priority', { get: () => data['Priority'], set: v => { data['Priority'] = v; } }],
            ['Archived', { get: () => data['Archived'], set: v => { data['Archived'] = v; } }],
            ['Status',   { get: () => data['Status'],   set: v => { data['Status']   = v; } }],
        ]);

        const bag = new MapPropertyBag(accessors);

        const descs: readonly GridProperty[] = Object.freeze([
            GridProperty.text  ('Name',     { displayName: 'Name',     category: 'Identity' }),
            GridProperty.number('Priority', { displayName: 'Priority', category: 'Identity', min: 1, max: 5 }),
            GridProperty.bool  ('Archived', { displayName: 'Archived', category: 'State'    }),
            GridProperty.enumOf('Status',   ['Active', 'Draft', 'Archived'], { displayName: 'Status', category: 'State' }),
        ]);

        this.set_property_value(PropertyGridVM.MapDescriptorsKey, descs);
        this.set_property_value(PropertyGridVM.MapTargetKey, bag);
    }
}
