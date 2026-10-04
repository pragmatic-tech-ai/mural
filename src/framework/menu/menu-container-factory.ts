import { Visual } from '../../runtime/index.js';
import { ItemsControl } from '../base/items-control.js';
import { HierarchicalItemsBinder } from '../../basic/templates/hierarchical-items-binder.js';
import { HierarchicalDataTemplate } from '../../basic/templates/data-template.js';
import { MenuItem } from './menu-strip.js';

// The one place that turns a resolved HierarchicalDataTemplate into a per-item
// MenuItem container for the Menu family (MenuItem / MenuStrip / ContextMenu) —
// the menu analogue of TreeView's wrapTreeItem + bindTreeItem recursion. All
// three menu controls delegate their GetContainerForItemOverride /
// RebindContainerForItemOverride here so a hierarchical CommandViewModel tree
// renders recursively and identically on every menu surface.
//
// The hierarchical branch engages ONLY when the resolved template is a
// HierarchicalDataTemplate AND its root is a MenuItem; every other case returns
// undefined / false so the base ItemsControl ContentPresenter path (the existing
// flat toolbar split-button menu rows, plain DataTemplate items) is untouched.
export class MenuContainerFactory
{
    // Build the container for `item` when it should recurse as a MenuItem; return
    // undefined to let the caller fall back to super.GetContainerForItemOverride
    // (own-container Visuals, flat/plain templates, non-MenuItem template roots).
    public static GetContainer(owner: ItemsControl, item: unknown): Visual | undefined
    {
        // A Visual item is its own container — the base handles it.
        if (item instanceof Visual)
        {
            return undefined;
        }
        const tmpl = HierarchicalItemsBinder.ResolveItemTemplate(owner, item);
        if (!(tmpl instanceof HierarchicalDataTemplate))
        {
            // Flat / plain DataTemplate (e.g. the toolbar split-button's
            // CommandMenuRowTemplate) — base ContentPresenter path.
            return undefined;
        }
        const root = tmpl.Apply(item);
        if (!(root instanceof MenuItem))
        {
            // A hierarchical template whose root isn't a MenuItem can't carry a
            // submenu's ItemsSource — defer to the base rather than crash.
            return undefined;
        }
        // Pin the DataContext so the row's $Title / $Command / $IsChecked bindings
        // resolve, then wire the child ItemsSource + propagate the template so the
        // nested MenuItem re-enters this factory and the tree recurses.
        root.DataContext = item;
        HierarchicalItemsBinder.BindChildItems(owner, item, root);
        return root;
    }

    // Re-point a recycled MenuItem container at `item` (DataContext + child
    // binding). Returns true when handled; false lets the caller fall back to
    // super.RebindContainerForItemOverride. The row's content follows the
    // DataContext bindings authored in the template, so re-pointing it flips the
    // whole row to the new data.
    public static RebindContainer(owner: ItemsControl, container: Visual, item: unknown): boolean
    {
        if (!(container instanceof MenuItem))
        {
            return false;
        }
        const tmpl = HierarchicalItemsBinder.ResolveItemTemplate(owner, item);
        if (!(tmpl instanceof HierarchicalDataTemplate))
        {
            return false;
        }
        container.DataContext = item;
        HierarchicalItemsBinder.BindChildItems(owner, item, container);
        return true;
    }

    // Undo the DataContext + ItemsSource that GetContainer / RebindContainer set
    // on a GENERATED MenuItem container, so a long-lived data VM doesn't leak
    // through a cleared/recycled row. Called from each control's
    // ClearContainerForItemOverride before the base nulls `_itemsControlData`.
    //
    // Safe guard — only touch state WE set. A generated container is a MenuItem
    // we created FOR a distinct data item, so the base `_itemsControlData` stamp
    // names that item and is NOT the container itself. An authored own-container
    // MenuItem (IsItemItsOwnContainerOverride → the item IS the container) has
    // `_itemsControlData === container`; clearing its DataContext / ItemsSource
    // would wipe author-set state, so we leave those untouched.
    public static ClearContainer(_owner: ItemsControl, container: Visual): void
    {
        if (!(container instanceof MenuItem))
        {
            return;
        }
        const data = (container as unknown as { _itemsControlData?: unknown })._itemsControlData;
        if (data === undefined || data === container)
        {
            return;
        }
        container.DisposeCommandSource();
        container.DataContext = undefined;
        container.ItemsSource = undefined;
    }
}
