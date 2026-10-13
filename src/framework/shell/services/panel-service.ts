// panel-service.ts — the SHARED left-panel content primitives.
//
// The service-backed content model (mirrors the demo platform's
// demo-group-services.mts): each Capability names — via its `ServiceKey` — the
// service whose content fills the shell's LEFT PANEL while that capability is
// active. The module's `.services:` block registers the services; the shell
// shows the active one through `Content = $service(NavigationService)
// .ActiveService`, rendered by a `DataTemplate [DataType = PanelService]` the
// app supplies.
//
// This file holds only the SHARED pieces every module builds on: the
// PanelSection row and the PanelService base. The CONCRETE per-capability
// services live with the module that registers them — only that module uses
// them, so they are not shared services.

import {
    MetaData,
    MuralBase,
    ObservableCollection,
    ServiceBase,
    type IServiceProvider,
} from '../../../runtime/index.js';

// One row in a capability's section list. A MuralBase so the panel template binds
// $Label; mirrors the demo's DemoVM row.
export class PanelSection extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        PanelSection, 'Label', '', MetaData.None);

    public constructor(label: string)
    {
        super();
        this.set_property_value(PanelSection.LabelKey, label);
    }

    public get Label(): string { return this.get_property_value(PanelSection.LabelKey); }
}

// Base content service for a capability's left panel. Carries the panel's
// section rows; a single `DataTemplate [DataType = PanelService]` renders
// every subclass via the base-type match (the resource-chain prototype walk).
// The pane header already shows the capability's name (bound to the selected
// destination's Label), so the service supplies only the body.
//
// Abstract and Key-less — a base is never resolved directly; each concrete
// subclass fixes its sections AND declares its own distinct Key. Registration
// (`.services:`) and resolution (`ServiceKey = <class>`) both funnel through
// `ServiceProvider.tokenFor(<class>)` → that class's own Key, landing on one
// per-service token.
export abstract class PanelService extends ServiceBase
{
    private readonly _sections = new ObservableCollection<PanelSection>();

    public constructor(provider: IServiceProvider, sections: readonly string[])
    {
        super(provider);
        for (const s of sections) this._sections.Add(new PanelSection(s));
    }

    public get Sections(): ObservableCollection<PanelSection>
    {
        return this._sections;
    }
}
