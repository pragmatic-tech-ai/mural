import { MetaData, MuralBase, type ServiceToken } from '../../runtime/index.js';
import type { HierarchyAction } from './hierarchy-action.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

// Shared frozen default — DP defaults are shared across instances, so the empty list
// must be immutable (markup replaces it with a fresh array).
const EMPTY_KEYS: readonly string[] = Object.freeze([]);

// Contributes context-menu actions for nodes of the given `Key`s. The design's
// "owner base + keyed additions" both register through this one seam (the file/project
// contributors register for their own keys; app modules add contributors for the same
// keys), merged by Order. Symmetric with IHierarchyContributor, but keyed by the
// target node's OWN Key (not ParentKeys).
export interface IHierarchyActionContributor
{
    readonly ActionKeys: readonly string[];
    ActionsFor(node: HierarchyItemVM): readonly HierarchyAction[];
}

// Registration schema for a `.hierarchyActions:` block entry. DP-backed MuralBase so it
// is declarable in markup, the same shape as HierarchyContributorDefinition.
export class HierarchyActionDefinition extends MuralBase
{
    public static readonly ActionKeysKey = MuralBase.RegisterProperty<readonly string[]>(
        HierarchyActionDefinition, 'ActionKeys', EMPTY_KEYS, MetaData.None);

    public static readonly ContributorKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        HierarchyActionDefinition, 'Contributor', undefined, MetaData.None);

    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        HierarchyActionDefinition, 'Order', 0, MetaData.None);

    public get ActionKeys(): readonly string[]  { return this.get_property_value(HierarchyActionDefinition.ActionKeysKey); }
    public set ActionKeys(v: readonly string[]) { this.set_property_value(HierarchyActionDefinition.ActionKeysKey, v); }

    public get Contributor(): ServiceToken<unknown> | undefined  { return this.get_property_value(HierarchyActionDefinition.ContributorKey); }
    public set Contributor(v: ServiceToken<unknown> | undefined) { this.set_property_value(HierarchyActionDefinition.ContributorKey, v); }

    public get Order(): number  { return this.get_property_value(HierarchyActionDefinition.OrderKey); }
    public set Order(v: number) { this.set_property_value(HierarchyActionDefinition.OrderKey, v); }
}
