import { MetaData, MuralBase, ObservableCollection, ServiceKey } from '../../../runtime/index.js';
import { ToolboxPage } from './toolbox-page.js';
import type { ToolboxItem } from './toolbox-item.js';

// The palette's structure — pages of items — held as a singleton in
// Application.current.Services. Pure structure: no visual-resolution or
// drop logic lives here. Populated by Board first-init (Shapes) and by
// apps (Plexus, Spec B).
export class ToolboxRepository extends MuralBase
{
    public static readonly Key = new ServiceKey<ToolboxRepository>('ToolboxRepository');

    public static readonly PagesKey = MuralBase.RegisterProperty<ObservableCollection<ToolboxPage>>(
        ToolboxRepository, 'Pages', undefined as unknown as ObservableCollection<ToolboxPage>, MetaData.None);

    constructor()
    {
        super();
        this.set_property_value(ToolboxRepository.PagesKey, new ObservableCollection<ToolboxPage>());
    }

    public get Pages(): ObservableCollection<ToolboxPage> { return this.get_property_value(ToolboxRepository.PagesKey); }

    // Get-or-create a page by id. A second call with the same id returns the
    // existing page (Title is not overwritten).
    public EnsurePage(id: string, title: string): ToolboxPage
    {
        for (let i = 0; i < this.Pages.Count; i++)
        {
            const p = this.Pages.Get(i)!;
            if (p.Id === id) return p;
        }
        const page = new ToolboxPage(id, title);
        this.Pages.Add(page);
        return page;
    }

    // First item across all pages whose Id matches, else undefined. The drop
    // router's lookup.
    public ItemById(id: string): ToolboxItem | undefined
    {
        for (let i = 0; i < this.Pages.Count; i++)
        {
            const items = this.Pages.Get(i)!.Items;
            for (let j = 0; j < items.Count; j++)
            {
                const it = items.Get(j)!;
                if (it.Id === id) return it;
            }
        }
        return undefined;
    }

    public RemovePage(id: string): void
    {
        for (let i = 0; i < this.Pages.Count; i++)
        {
            if (this.Pages.Get(i)!.Id === id) { this.Pages.RemoveAt(i); return; }
        }
    }

    public Clear(): void { this.Pages.Clear(); }
}
