import { ApplicationService, ServiceBase, ServiceKey, ServiceProvider, type IServiceProvider } from '../../runtime/index.js';
import { ShellModule } from '../shell/module.js';
import { HierarchyActionDefinition } from './hierarchy-action-contributor.js';
import type { IHierarchyActionContributor } from './hierarchy-action-contributor.js';
import type { HierarchyAction } from './hierarchy-action.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

// Aggregates every composed module's HierarchyActionDefinitions and answers ordered
// action lookups by NODE key. Sibling of HierarchyContributorRegistry (node children);
// this one is the action seam. Populated from `.hierarchyActions:` blocks + live
// Register/RegisterInstance, exactly as the node registry.
export class HierarchyActionContributorRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<HierarchyActionContributorRegistry>('HierarchyActionContributorRegistry');

    // nodeKey -> definitions registered under it (insertion order; sorted on read).
    private readonly byKey = new Map<string, HierarchyActionDefinition[]>();
    // resolved-instance cache, keyed by definition (token resolved lazily on first read).
    private readonly resolved = new Map<HierarchyActionDefinition, IHierarchyActionContributor>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    // Aggregate every composed module's declared action contributors. Tolerant of a
    // MISSING ApplicationService (Provider.get, not getRequired), like the node registry.
    public PopulateFromModules(): void
    {
        const app = this.Provider.get(ApplicationService.Key);
        if (app !== undefined)
        {
            for (const module of app.Modules)
            {
                for (const def of (module as ShellModule).HierarchyActions)
                {
                    this.add(def);
                }
            }
        }
    }

    public Register(def: HierarchyActionDefinition): () => void
    {
        this.add(def);
        return () => this.remove(def);
    }

    public RegisterInstance(contributor: IHierarchyActionContributor): () => void
    {
        const def = new HierarchyActionDefinition();
        def.ActionKeys = [...contributor.ActionKeys];
        this.add(def);
        this.resolved.set(def, contributor);
        return () => this.remove(def);
    }

    // Ordered actions contributed for a node of `nodeKey`. Tokens resolved + cached.
    public ActionsFor(nodeKey: string, node: HierarchyItemVM): readonly HierarchyAction[]
    {
        const defs = this.byKey.get(nodeKey);
        if (defs === undefined) return [];
        const out: HierarchyAction[] = [];
        for (const d of [...defs].sort((a, b) => a.Order - b.Order))
        {
            for (const action of this.resolve(d).ActionsFor(node)) out.push(action);
        }
        return out;
    }

    private add(def: HierarchyActionDefinition): void
    {
        for (const key of def.ActionKeys)
        {
            const list = this.byKey.get(key) ?? [];
            list.push(def);
            this.byKey.set(key, list);
        }
    }

    private remove(def: HierarchyActionDefinition): void
    {
        for (const key of def.ActionKeys)
        {
            const list = this.byKey.get(key);
            if (list === undefined) continue;
            const i = list.indexOf(def);
            if (i >= 0) list.splice(i, 1);
        }
        this.resolved.delete(def);
    }

    private resolve(def: HierarchyActionDefinition): IHierarchyActionContributor
    {
        let hit = this.resolved.get(def);
        if (hit === undefined)
        {
            // `.hierarchyActions:` stores the contributor CLASS in Contributor (like
            // Capability.ServiceKey), but a bare `.services:` entry registers under
            // tokenFor(class) === class.Key. Normalize so a class or a token both resolve.
            const token = ServiceProvider.tokenFor(def.Contributor as unknown as Function);
            hit = this.Provider.getRequired(token) as IHierarchyActionContributor;
            this.resolved.set(def, hit);
        }
        return hit;
    }
}
