import { MetaData, MuralBase, } from '@pragmatic-tech-ai/mural/runtime';
import { DocumentSelectorService } from '@pragmatic-tech-ai/mural/framework/shell/services/document-selector-service.js';
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework/shell/services/content-host-service.js';
// One demo row in a group's list. `Label` is what the ListBox template binds.
export class DemoVM extends MuralBase {
    static IdKey = MuralBase.RegisterProperty(DemoVM, 'Id', '', MetaData.None);
    static LabelKey = MuralBase.RegisterProperty(DemoVM, 'Label', '', MetaData.None);
    static TitleKey = MuralBase.RegisterProperty(DemoVM, 'Title', '', MetaData.None);
    static SubtitleKey = MuralBase.RegisterProperty(DemoVM, 'Subtitle', '', MetaData.None);
    Descriptor;
    constructor(d) {
        super();
        this.set_property_value(DemoVM.IdKey, d.id);
        this.set_property_value(DemoVM.LabelKey, d.title);
        this.set_property_value(DemoVM.TitleKey, d.title);
        this.set_property_value(DemoVM.SubtitleKey, d.subtitle ?? '');
        this.Descriptor = d;
    }
    get Id() { return this.get_property_value(DemoVM.IdKey); }
    get Label() { return this.get_property_value(DemoVM.LabelKey); }
    get Title() { return this.get_property_value(DemoVM.TitleKey); }
    get Subtitle() { return this.get_property_value(DemoVM.SubtitleKey); }
}
// A demo group's content: its demo list (the inherited selector Items) + the
// active demo's page state. Seeded once from an explicit descriptor array (no
// registry, no late-registration subscription) and owns a per-id Visual cache so
// nav-back returns to the same tree. Abstract + Key-less; each concrete subclass
// fixes its demos and declares its own ServiceKey.
export class DemoGroupService extends DocumentSelectorService {
    _cache = new Map();
    // Plain observable state (the service is Observable-based, not a MuralBase):
    // the demo page's title/subtitle/content bind to these by name.
    _title = '';
    _subtitle = '';
    _content = undefined;
    constructor(provider, descriptors) {
        super(provider);
        const sorted = [...descriptors].sort((a, b) => a.title.localeCompare(b.title));
        for (const d of sorted)
            this.Demos.Add(new DemoVM(d));
        if (this.SelectedItem === undefined && this.Demos.Count > 0) {
            this.SelectedItem = this.Demos.Get(0);
        }
    }
    get Demos() { return this.Items; }
    get SelectedDemo() { return this.SelectedItem; }
    get Title() { return this._title; }
    get Subtitle() { return this._subtitle; }
    get Content() { return this._content; }
    instantiate(vm) {
        const hit = this._cache.get(vm.Id);
        if (hit !== undefined)
            return hit;
        const built = vm.Descriptor.factory();
        this._cache.set(vm.Id, built);
        return built;
    }
    OnSelectedItemChanged(item) {
        const sel = item instanceof DemoVM ? item : undefined;
        const content = sel ? this.instantiate(sel) : undefined;
        const oldTitle = this._title, oldSubtitle = this._subtitle, oldContent = this._content;
        this._title = sel?.Title ?? '';
        this._subtitle = sel?.Subtitle ?? '';
        this._content = content;
        this.RaisePropertyChanged('Title', oldTitle, this._title);
        this.RaisePropertyChanged('Subtitle', oldSubtitle, this._subtitle);
        this.RaisePropertyChanged('Content', oldContent, this._content);
        this.Provider.get(ContentHostService.Key)?.View(content);
    }
}
