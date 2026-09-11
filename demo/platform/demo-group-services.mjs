// demo-group-services.mts — per-group content services for the demo platform.
//
// The service-backed content model: each demo GROUP is its OWN service, named
// by its capability's `ServiceKey` in demo-platform.module.mu. When a group's
// rail item is selected, the NavigationService resolves the capability's service
// (NavigationService.ActiveService) and the shell's content host renders it
// through the `DataTemplate [DataType = DemoGroupService]` in platform.mu (a
// demo ListBox + PageView).
//
// Each service is an app-root singleton (registered by the module's `.services:`
// block), so a group keeps its selected-demo + page state across rail switches.
// A concrete subclass fixes its group name — matching the registry `group` field
// and the capability's Name — and the CLASS ITSELF is the DI token
// (class-as-token, NO static Key): the module registers under
// `ServiceProvider.tokenFor(AnimationsService)` and the capability's
// `ServiceKey = AnimationsService` resolves the very same token. Adding a static
// Key would split those two sites, so these services deliberately omit one.
//
// Supersedes the GroupVM-as-destination model in demo-navigation-service.mts:
// the content is now a resolved service, not a NavigationDestination subclass,
// so the base NavigationService (no createDestination override) is enough.
import { MetaData, MuralBase, ServiceKey, } from '@pragmatic-tech-ai/mural/runtime';
import { DocumentSelectorService } from '@pragmatic-tech-ai/mural/framework/shell/services/document-selector-service.js';
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework/shell/services/content-host-service.js';
import { allDemos, instantiateDemo, onDemoRegistered } from './registry.mjs';
// Insert `item` into `coll` at the position that keeps it sorted by `cmp`
// (stable: ties land after existing equal entries), so demos land alphabetically
// whether they arrive in the initial snapshot or stream in late.
function insertSorted(coll, item, cmp) {
    let i = 0;
    while (i < coll.Count && cmp(coll.Get(i), item) <= 0)
        i++;
    coll.Insert(i, item);
}
// One demo row. `Label` is the display string the list template binds. The
// content host's ListBox renders each of these through the
// `DataTemplate [DataType = DemoVM]` in platform.mu.
export class DemoVM extends MuralBase {
    static IdKey = MuralBase.RegisterProperty(DemoVM, 'Id', '', MetaData.None);
    static LabelKey = MuralBase.RegisterProperty(DemoVM, 'Label', '', MetaData.None);
    static TitleKey = MuralBase.RegisterProperty(DemoVM, 'Title', '', MetaData.None);
    static SubtitleKey = MuralBase.RegisterProperty(DemoVM, 'Subtitle', '', MetaData.None);
    // The raw registry definition, carried for instantiateDemo lookup — the
    // Visual is built lazily from this on first activation.
    Definition;
    constructor(def) {
        super();
        this.set_property_value(DemoVM.IdKey, def.id);
        this.set_property_value(DemoVM.LabelKey, def.title);
        this.set_property_value(DemoVM.TitleKey, def.title);
        this.set_property_value(DemoVM.SubtitleKey, def.subtitle ?? '');
        this.Definition = def;
    }
    get Id() { return this.get_property_value(DemoVM.IdKey); }
    get Label() { return this.get_property_value(DemoVM.LabelKey); }
    get Title() { return this.get_property_value(DemoVM.TitleKey); }
    get Subtitle() { return this.get_property_value(DemoVM.SubtitleKey); }
}
// The content a group's rail item shows: the group's demo list + active-demo
// page state. A DocumentSelectorService — the demos ARE the selectable items,
// the active demo IS the selection — so the inherited `Items` / `SelectedItem`
// DPs back the list, and OnSelectedItemChanged is where a pick derives the
// page state. Abstract and Key-less (a base is never resolved directly); each
// concrete subclass fixes the group name AND declares its own distinct Key
// (see below).
//
//   DemoGroupService (extends DocumentSelectorService)
//     ├─ Items: ObservableCollection<object>   the group's demo rows (DemoVM)
//     ├─ SelectedItem   TwoWay ⇆ the demo ListBox; the active demo
//     └─ Title / Subtitle / Content   derived from the selection (Content lazy)
export class DemoGroupService extends DocumentSelectorService {
    static TitleKey = MuralBase.RegisterProperty(DemoGroupService, 'Title', '', MetaData.None);
    static SubtitleKey = MuralBase.RegisterProperty(DemoGroupService, 'Subtitle', '', MetaData.None);
    static ContentKey = MuralBase.RegisterProperty(DemoGroupService, 'Content', undefined, MetaData.None);
    // The group this service owns — the registry `group` value / capability Name.
    GroupName;
    // Registry subscription, dropped on Dispose.
    _unsubscribeRegistry;
    constructor(provider, groupName) {
        // super() creates the stable inherited Items collection.
        super(provider);
        this.GroupName = groupName;
        // Snapshot this group's demos from the registry; late registrations
        // arrive via the subscription below. Import-order independent.
        for (const def of allDemos()) {
            if (def.group === groupName)
                this.addDemo(def);
        }
        this._unsubscribeRegistry = onDemoRegistered(def => {
            if (def.group === this.GroupName)
                this.addDemo(def);
        });
    }
    // Typed views over the inherited selector DPs (the rows are DemoVMs). The
    // markup binds the real DPs `$Items` / `$SelectedItem`; these are TS-side
    // conveniences only.
    get Demos() { return this.Items; }
    get SelectedDemo() { return this.SelectedItem; }
    get Title() { return this.get_property_value(DemoGroupService.TitleKey); }
    get Subtitle() { return this.get_property_value(DemoGroupService.SubtitleKey); }
    get Content() { return this.get_property_value(DemoGroupService.ContentKey); }
    // Slot a demo into this group (sorted); select the first so the group never
    // renders empty. Private — only the ctor + registry subscription call it.
    addDemo(def) {
        insertSorted(this.Demos, new DemoVM(def), (a, b) => a.Title.localeCompare(b.Title));
        if (this.SelectedItem === undefined)
            this.SelectedItem = this.Demos.Get(0);
    }
    // Selection changed (list click TwoWay or auto-select) — derive the page
    // state and present the demo. Overrides the base default (which would View
    // the DemoVM ROW via its label template); a group instead builds the demo's
    // Visual (lazy, cached by the registry) and Views THAT in the content host,
    // so PART_ContentHost (`$service(ContentHostService).Content`) shows the demo.
    OnSelectedItemChanged(item) {
        const sel = item instanceof DemoVM ? item : undefined;
        const content = sel ? instantiateDemo(sel.Id) : undefined;
        this.set_property_value(DemoGroupService.TitleKey, sel?.Title ?? '');
        this.set_property_value(DemoGroupService.SubtitleKey, sel?.Subtitle ?? '');
        this.set_property_value(DemoGroupService.ContentKey, content);
        this.Provider.get(ContentHostService.Key)?.View(content);
    }
    dispose() {
        this._unsubscribeRegistry();
        super.dispose();
    }
}
// The five concrete group services. Each fixes its group name (matching its
// capability's Name in demo-platform.module.mu) and declares its OWN distinct
// Key — five services, five tokens. Registration and resolution both funnel
// through `ServiceProvider.tokenFor(<class>)` → that class's own Key, so the
// module's `.services:` block and each capability's `ServiceKey = <class>` land
// on the same per-service token. No `override`: the abstract DocumentSelectorService
// base carries no Key, so nothing is inherited or shared.
export class AnimationsService extends DemoGroupService {
    static Key = new ServiceKey('AnimationsService');
    constructor(provider) { super(provider, 'Animation'); }
}
export class ControlsService extends DemoGroupService {
    static Key = new ServiceKey('ControlsService');
    constructor(provider) { super(provider, 'Controls'); }
}
export class DemosService extends DemoGroupService {
    static Key = new ServiceKey('DemosService');
    constructor(provider) { super(provider, 'Demos'); }
}
export class PatternsService extends DemoGroupService {
    static Key = new ServiceKey('PatternsService');
    constructor(provider) { super(provider, 'Patterns'); }
}
export class StylesService extends DemoGroupService {
    static Key = new ServiceKey('StylesService');
    constructor(provider) { super(provider, 'Styles & Triggers'); }
}
