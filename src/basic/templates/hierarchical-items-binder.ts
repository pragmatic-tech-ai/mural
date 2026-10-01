import { ItemsControl } from '../../framework/base/items-control.js';
import { DataTemplate, HierarchicalDataTemplate } from './data-template.js';
import { DataTemplateSelector } from './data-template-selector.js';
import { Visual } from '../../runtime/index.js';

// The one place that turns a resolved HierarchicalDataTemplate into a child
// container's item-binding — shared by TreeView and (A2) the Menu family, so
// both surfaces recurse a hierarchical VM tree identically. Extracted verbatim
// from TreeView's private bindTreeItem recursion.
export class HierarchicalItemsBinder
{
    // If item's resolved template (in owner's scope) is a HierarchicalDataTemplate,
    // point `child` at the item's child items and propagate the template downward
    // (so the nested ItemsControl re-resolves + recurses), and return true.
    // Otherwise (flat item) return false and leave `child` untouched.
    public static BindChildItems(owner: ItemsControl, item: unknown, child: ItemsControl): boolean
    {
        const tmpl = HierarchicalItemsBinder.ResolveItemTemplate(owner, item);
        if (!(tmpl instanceof HierarchicalDataTemplate))
        {
            return false;
        }
        child.ItemTemplate = (tmpl.itemTemplate ?? tmpl) as never;
        // Propagate the selector so it's re-consulted at every depth, not just
        // the roots. Undefined when the consumer only set a plain ItemTemplate
        // — harmless.
        child.ItemTemplateSelector = owner.ItemTemplateSelector;
        // Bind the LIVE children collection as ItemsSource rather than snapshotting
        // it into Items with `[...]`. A plain array fires no change events, so
        // incremental mutations on a nested node (e.g. deleting a file under a
        // folder) never reached the row — the collection changed but the tree
        // didn't. Setting ItemsSource wraps the source in a CollectionView that
        // subscribes to its ObservableCollection, so nested add/remove now update
        // the tree in place (matching how the root binds ItemsSource = Root.Children).
        child.ItemsSource = tmpl.itemsSelector(item);
        return true;
    }

    // Mirror of tree-view's resolveItemTemplate: selector wins over ItemTemplate
    // (ListBox parity); a Visual item resolves no template (WPF parity —
    // templates apply to DATA, not to a UIElement item).
    public static ResolveItemTemplate(owner: ItemsControl, item: unknown): DataTemplate | undefined
    {
        if (item instanceof Visual)
        {
            return undefined;
        }
        return DataTemplateSelector.resolve(owner.ItemTemplateSelector, item, owner) ?? owner.ItemTemplate;
    }
}
