import { ApplicationService, ServiceBase, ServiceKey, type IServiceProvider } from '../../runtime/index.js';
import { ShellModule } from '../shell/module.js';
import type { HierarchyContributorDefinition } from './hierarchy-contributor-definition.js';
import type { IHierarchyContributor } from './hierarchy-node.js';

// Aggregates every composed module's declared HierarchyContributorDefinitions and
// answers ordered contributor lookups by parent family key. Definitions flow module →
// service exactly as DocumentDefinitions flow into DocumentTypeRegistry. Also supports
// runtime Register for live contributions; both feeds raise the Changed notification
// (PropertyChanged('Contributors')) so a HierarchyModel re-contributes already-realized
// keyed nodes.
export class HierarchyContributorRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<HierarchyContributorRegistry>('HierarchyContributorRegistry');
    private static readonly ChangedProp = 'Contributors';

    // parentKey -> definitions registered under it (insertion order; sorted on read).
    private readonly byParent = new Map<string, HierarchyContributorDefinition[]>();
    // resolved-instance cache, keyed by definition (token resolved lazily on first For).
    private readonly resolved = new Map<HierarchyContributorDefinition, IHierarchyContributor>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    // Aggregate every composed module's declared hierarchy contributors. Tolerant of a
    // MISSING ApplicationService (Provider.get, not getRequired): a bare-provider unit
    // test that drives Register directly constructs without an Application; production
    // always registers ApplicationService, so this populates as DocumentTypeRegistry does.
    public PopulateFromModules(): void
    {
        const app = this.Provider.get(ApplicationService.Key);
        if (app !== undefined)
        {
            for (const module of app.Modules)
            {
                for (const def of (module as ShellModule).HierarchyContributors)
                {
                    this.add(def);
                }
            }
        }
        this.raiseChanged();
    }

    // Live registration. Returns a remover that unregisters the definition and raises
    // Changed — a HierarchyModel keyed to an already-realized parent re-contributes.
    public Register(def: HierarchyContributorDefinition): () => void
    {
        this.add(def);
        this.raiseChanged();
        return () =>
        {
            this.remove(def);
            this.raiseChanged();
        };
    }

    // Signal that a live contributor's OUTPUT changed (its data, not its registration) so a
    // subscribed HierarchyModel re-contributes realized keyed nodes. The register/unregister
    // paths raise the same notification internally; this exposes it to contributors.
    public NotifyContributionsChanged(): void
    {
        this.raiseChanged();
    }

    // Contributors registered for `parentKey`, ordered by Order (ascending). Tokens are
    // resolved + cached on first read.
    public For(parentKey: string): readonly IHierarchyContributor[]
    {
        const defs = this.byParent.get(parentKey);
        if (defs === undefined) return [];
        return [...defs]
            .sort((a, b) => a.Order - b.Order)
            .map((d) => this.resolve(d));
    }

    private add(def: HierarchyContributorDefinition): void
    {
        for (const key of def.ParentKeys)
        {
            const list = this.byParent.get(key) ?? [];
            list.push(def);
            this.byParent.set(key, list);
        }
    }

    private remove(def: HierarchyContributorDefinition): void
    {
        for (const key of def.ParentKeys)
        {
            const list = this.byParent.get(key);
            if (list === undefined) continue;
            const i = list.indexOf(def);
            if (i >= 0) list.splice(i, 1);
        }
        this.resolved.delete(def);
    }

    private resolve(def: HierarchyContributorDefinition): IHierarchyContributor
    {
        let hit = this.resolved.get(def);
        if (hit === undefined)
        {
            hit = this.Provider.getRequired(def.Contributor!) as IHierarchyContributor;
            this.resolved.set(def, hit);
        }
        return hit;
    }

    private raiseChanged(): void
    {
        this.RaisePropertyChanged(HierarchyContributorRegistry.ChangedProp, undefined, undefined);
    }
}
