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
import { DpPropertyBag, MapPropertyBag, GridProperty, } from '@pragmatic-tech-ai/mural/framework';
// ── Sample DP target ────────────────────────────────────────────────────────
// A minimal MuralBase subclass with three typed dependency properties.
// DpPropertyBag.constructor enumerates these via MuralBase.EnumerateProperties.
class SampleDpObject extends MuralBase {
    static LabelKey = MuralBase.RegisterProperty(SampleDpObject, 'Label', 'Hello', MetaData.None);
    static CountKey = MuralBase.RegisterProperty(SampleDpObject, 'Count', 0, MetaData.None);
    static IsActiveKey = MuralBase.RegisterProperty(SampleDpObject, 'IsActive', true, MetaData.None);
    get Label() { return this.get_property_value(SampleDpObject.LabelKey); }
    set Label(v) { this.set_property_value(SampleDpObject.LabelKey, v); }
    get Count() { return this.get_property_value(SampleDpObject.CountKey); }
    set Count(v) { this.set_property_value(SampleDpObject.CountKey, v); }
    get IsActive() { return this.get_property_value(SampleDpObject.IsActiveKey); }
    set IsActive(v) { this.set_property_value(SampleDpObject.IsActiveKey, v); }
}
// ── Demo VM ─────────────────────────────────────────────────────────────────
export class PropertyGridVM extends MuralBase {
    // DP-backed bag
    static DpDescriptorsKey = MuralBase.RegisterProperty(PropertyGridVM, 'DpDescriptors', undefined, MetaData.None);
    static DpTargetKey = MuralBase.RegisterProperty(PropertyGridVM, 'DpTarget', undefined, MetaData.None);
    // Map-backed bag
    static MapDescriptorsKey = MuralBase.RegisterProperty(PropertyGridVM, 'MapDescriptors', undefined, MetaData.None);
    static MapTargetKey = MuralBase.RegisterProperty(PropertyGridVM, 'MapTarget', undefined, MetaData.None);
    get DpDescriptors() {
        return this.get_property_value(PropertyGridVM.DpDescriptorsKey);
    }
    get DpTarget() {
        return this.get_property_value(PropertyGridVM.DpTargetKey);
    }
    get MapDescriptors() {
        return this.get_property_value(PropertyGridVM.MapDescriptorsKey);
    }
    get MapTarget() {
        return this.get_property_value(PropertyGridVM.MapTargetKey);
    }
    constructor() {
        super();
        this.buildDpGrid();
        this.buildMapGrid();
    }
    buildDpGrid() {
        const target = new SampleDpObject();
        const bag = new DpPropertyBag(target);
        // Auto-derive descriptors from the DPs, then override categories.
        const overrides = new Map([
            ['Label', GridProperty.text('Label', { displayName: 'Label', category: 'General' })],
            ['Count', GridProperty.number('Count', { displayName: 'Count', category: 'General' })],
            ['IsActive', GridProperty.bool('IsActive', { displayName: 'Is Active', category: 'General' })],
        ]);
        const descs = GridProperty.describeDpTarget(target, overrides);
        this.set_property_value(PropertyGridVM.DpDescriptorsKey, Object.freeze(descs));
        this.set_property_value(PropertyGridVM.DpTargetKey, bag);
    }
    buildMapGrid() {
        // Plain data — held as instance state so the bag can mutate it.
        const data = {
            Name: 'Architecture',
            Priority: 2,
            Archived: false,
            Status: 'Active',
        };
        const accessors = new Map([
            ['Name', { get: () => data['Name'], set: v => { data['Name'] = v; } }],
            ['Priority', { get: () => data['Priority'], set: v => { data['Priority'] = v; } }],
            ['Archived', { get: () => data['Archived'], set: v => { data['Archived'] = v; } }],
            ['Status', { get: () => data['Status'], set: v => { data['Status'] = v; } }],
        ]);
        const bag = new MapPropertyBag(accessors);
        const descs = Object.freeze([
            GridProperty.text('Name', { displayName: 'Name', category: 'Identity' }),
            GridProperty.number('Priority', { displayName: 'Priority', category: 'Identity', min: 1, max: 5 }),
            GridProperty.bool('Archived', { displayName: 'Archived', category: 'State' }),
            GridProperty.enumOf('Status', ['Active', 'Draft', 'Archived'], { displayName: 'Status', category: 'State' }),
        ]);
        this.set_property_value(PropertyGridVM.MapDescriptorsKey, descs);
        this.set_property_value(PropertyGridVM.MapTargetKey, bag);
    }
}
