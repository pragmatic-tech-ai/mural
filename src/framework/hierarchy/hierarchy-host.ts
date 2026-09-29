import type { HierarchyItemVM } from './hierarchy-item-vm.js';
import type { HierarchyAction } from './hierarchy-action.js';

// The domain seam a HierarchyTreeVM is constructed with and passes to every item. The
// generic VMs stay domain-agnostic; the host (a capability service) routes activation,
// rename commit, delete, action resolution, drop validation/apply, and selection pruning.
export interface HierarchyHost
{
    Activate(vm: HierarchyItemVM): void;
    CommitRename(vm: HierarchyItemVM, newName: string): void;
    Delete(vm: HierarchyItemVM): void;   // key-path Delete; shares the menu path (close-guard inside)
    ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[];
    CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean;
    Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void;
    OnItemRemoved(vm: HierarchyItemVM): void;
}
