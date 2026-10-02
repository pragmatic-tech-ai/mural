import type { HierarchyItem, IHierarchyItemHost } from './hierarchy-item.js';

// The domain seam a Hierarchy is constructed with and passes to every item:
// routes activation, rename commit, delete, drop validation/apply, and removal.
// (Action resolution moved to the command machinery — see Hierarchy.BuildActions.)
export interface HierarchyHost extends IHierarchyItemHost
{
    Delete(item: HierarchyItem): void;
    CanDrop(target: HierarchyItem, dragged: readonly HierarchyItem[]): boolean;
    Drop(target: HierarchyItem, dragged: readonly HierarchyItem[]): void;
}
