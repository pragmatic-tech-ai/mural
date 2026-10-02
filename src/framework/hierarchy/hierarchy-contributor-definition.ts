import { MetaData, MuralBase, type ServiceToken } from '../../runtime/index.js';
import type { CommandDefinition } from '../shell/commands/command-definition.js';

// Shared frozen default — DP defaults are shared across instances, so the empty list
// must be immutable (markup replaces it with a fresh array).
const EMPTY_KEYS: readonly string[] = Object.freeze([]);
const EMPTY_ACTIONS: readonly CommandDefinition[] = Object.freeze([]);

// A HierarchyContributor's registration schema — what a module declares in its
// `.hierarchyContributors:` block. A MuralBase so it is DP-backed and declarable in
// markup, the same shape as DocumentDefinition:
//
//     .hierarchyContributors: {
//         HierarchyContributorDefinition
//             [ ParentKeys = [NodeKey.Solution], Contributor = ProjectsListingContributor, Order = 0 ]
//     }
//
// `.hierarchyContributors:` is a generic member-block: each entry lowers to
// `module.HierarchyContributors.Add(def)` (the compiler remaps the lowercase section
// to the PascalCase collection, exactly as `.documents:` → `Documents`).
// HierarchyContributorRegistry aggregates these across every composed module.
export class HierarchyContributorDefinition extends MuralBase
{
    public static readonly ParentKeysKey = MuralBase.RegisterProperty<readonly string[]>(
        HierarchyContributorDefinition, 'ParentKeys', EMPTY_KEYS, MetaData.None);

    public static readonly ContributorKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        HierarchyContributorDefinition, 'Contributor', undefined, MetaData.None);

    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        HierarchyContributorDefinition, 'Order', 0, MetaData.None);

    public static readonly ActionsKey = MuralBase.RegisterProperty<readonly CommandDefinition[]>(
        HierarchyContributorDefinition, 'Actions', EMPTY_ACTIONS, MetaData.None);

    public get ParentKeys(): readonly string[]  { return this.get_property_value(HierarchyContributorDefinition.ParentKeysKey); }
    public set ParentKeys(v: readonly string[]) { this.set_property_value(HierarchyContributorDefinition.ParentKeysKey, v); }

    public get Contributor(): ServiceToken<unknown> | undefined  { return this.get_property_value(HierarchyContributorDefinition.ContributorKey); }
    public set Contributor(v: ServiceToken<unknown> | undefined) { this.set_property_value(HierarchyContributorDefinition.ContributorKey, v); }

    public get Order(): number  { return this.get_property_value(HierarchyContributorDefinition.OrderKey); }
    public set Order(v: number) { this.set_property_value(HierarchyContributorDefinition.OrderKey, v); }

    public get Actions(): readonly CommandDefinition[]  { return this.get_property_value(HierarchyContributorDefinition.ActionsKey); }
    public set Actions(v: readonly CommandDefinition[]) { this.set_property_value(HierarchyContributorDefinition.ActionsKey, v); }
}
