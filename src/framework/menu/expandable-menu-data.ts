// A menu data item that wants a callback the first time its submenu opens — the
// menu analogue of TreeView's ExpandableTreeData (tree-view.ts:1138). The menu
// reads it off the container's bound data and calls it on IsSubmenuOpen→true, so
// a ChildrenContributor submenu populates lazily on open. CommandViewModel
// satisfies it via EnsureExpanded (idempotent, so re-opens are cheap).
export interface ExpandableMenuData
{
    OnSubmenuOpen?(): void;
}
