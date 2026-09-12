import {
    MetaData, MuralBase, ObservableCollection,
    type Visual, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime';
import { DocumentSelectorService } from '@pragmatic-tech-ai/mural/framework/shell/services/document-selector-service.js';
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework/shell/services/content-host-service.js';
import type { DemoDescriptor } from './demo-descriptor.mjs';

// One demo row in a group's list. `Label` is what the ListBox template binds.
export class DemoVM extends MuralBase
{
    static readonly IdKey       = MuralBase.RegisterProperty<string>(DemoVM, 'Id',       '', MetaData.None);
    static readonly LabelKey    = MuralBase.RegisterProperty<string>(DemoVM, 'Label',    '', MetaData.None);
    static readonly TitleKey    = MuralBase.RegisterProperty<string>(DemoVM, 'Title',    '', MetaData.None);
    static readonly SubtitleKey = MuralBase.RegisterProperty<string>(DemoVM, 'Subtitle', '', MetaData.None);

    readonly Descriptor: DemoDescriptor;

    constructor(d: DemoDescriptor) {
        super();
        this.set_property_value(DemoVM.IdKey,       d.id);
        this.set_property_value(DemoVM.LabelKey,    d.title);
        this.set_property_value(DemoVM.TitleKey,    d.title);
        this.set_property_value(DemoVM.SubtitleKey, d.subtitle ?? '');
        this.Descriptor = d;
    }

    get Id():       string { return this.get_property_value(DemoVM.IdKey); }
    get Label():    string { return this.get_property_value(DemoVM.LabelKey); }
    get Title():    string { return this.get_property_value(DemoVM.TitleKey); }
    get Subtitle(): string { return this.get_property_value(DemoVM.SubtitleKey); }
}

// A demo group's content: its demo list (the inherited selector Items) + the
// active demo's page state. Seeded once from an explicit descriptor array (no
// registry, no late-registration subscription) and owns a per-id Visual cache so
// nav-back returns to the same tree. Abstract + Key-less; each concrete subclass
// fixes its demos and declares its own ServiceKey.
export abstract class DemoGroupService extends DocumentSelectorService
{
    static readonly TitleKey    = MuralBase.RegisterProperty<string>(DemoGroupService, 'Title', '', MetaData.None);
    static readonly SubtitleKey = MuralBase.RegisterProperty<string>(DemoGroupService, 'Subtitle', '', MetaData.None);
    static readonly ContentKey  = MuralBase.RegisterProperty<Visual | undefined>(
        DemoGroupService, 'Content', undefined, MetaData.None);

    private readonly _cache = new Map<string, Visual>();

    constructor(provider: IServiceProvider, descriptors: readonly DemoDescriptor[]) {
        super(provider);
        const sorted = [...descriptors].sort((a, b) => a.title.localeCompare(b.title));
        for (const d of sorted) this.Demos.Add(new DemoVM(d));
        if (this.SelectedItem === undefined && this.Demos.Count > 0) {
            this.SelectedItem = this.Demos.Get(0);
        }
    }

    get Demos():        ObservableCollection<DemoVM> { return this.Items as unknown as ObservableCollection<DemoVM>; }
    get SelectedDemo(): DemoVM | undefined           { return this.SelectedItem as DemoVM | undefined; }
    get Title():        string                       { return this.get_property_value(DemoGroupService.TitleKey); }
    get Subtitle():     string                       { return this.get_property_value(DemoGroupService.SubtitleKey); }
    get Content():      Visual | undefined           { return this.get_property_value(DemoGroupService.ContentKey); }

    private instantiate(vm: DemoVM): Visual {
        const hit = this._cache.get(vm.Id);
        if (hit !== undefined) return hit;
        const built = vm.Descriptor.factory();
        this._cache.set(vm.Id, built);
        return built;
    }

    protected override OnSelectedItemChanged(item: object | undefined): void {
        const sel = item instanceof DemoVM ? item : undefined;
        const content = sel ? this.instantiate(sel) : undefined;
        this.set_property_value(DemoGroupService.TitleKey,    sel?.Title ?? '');
        this.set_property_value(DemoGroupService.SubtitleKey, sel?.Subtitle ?? '');
        this.set_property_value(DemoGroupService.ContentKey,  content);
        this.Provider.get(ContentHostService.Key)?.View(content);
    }
}
