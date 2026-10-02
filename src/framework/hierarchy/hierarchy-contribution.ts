import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import type { HierarchyItem, HierarchyItemInit } from './hierarchy-item.js';
import type { IHierarchyProvider } from './hierarchy-provider.js';

// A node a NodeContribution asks the model to intern as a keyed child. ExtObject
// is the interning identity (one HierarchyItem per (parent, ExtObject)).
export interface HierarchyNodeSpec extends HierarchyItemInit
{
    readonly Key: string;
    readonly ExtObject: unknown;
}

export abstract class HierarchyContribution
{
}

export class NodeContribution extends HierarchyContribution
{
    constructor(public readonly Nodes: readonly HierarchyNodeSpec[])
    {
        super();
    }
}

export class ProviderContribution extends HierarchyContribution
{
    constructor(public readonly Provider: IHierarchyProvider)
    {
        super();
    }
}

// Contributes children for its ParentKeys and, as the owner of those node keys,
// dispatches their commands (ICommandDispatcher.Resolve).
export interface IHierarchyContributor extends ICommandDispatcher
{
    readonly ParentKeys: readonly string[];
    readonly Order: number;
    Contribute(parent: HierarchyItem): HierarchyContribution;
}
