import {
    Behavior,
    CompositeDisposable,
    Disposable,
    Key,
    MetaData,
    MuralBase,
    Visual,
    type IDisposable,
    type KeyEventArgs,
} from '../../runtime/index.js';
import { ItemsControl, type ContainerPreparedListener } from '../base/items-control.js';
import { Selector } from '../list/selector.js';
import { EditableTextBlock } from '../../basic/editable-text-block.js';
import { Hierarchy } from './hierarchy.js';
import { HierarchyItem } from './hierarchy-item.js';

// HierarchyTreeBehavior — attaches to a TreeView (or any Selector hosting
// HierarchyItem rows) and keeps a Hierarchy model's selection + inline-rename
// state mirrored against the live tree. Expansion / collapse / activation are
// already auto-wired by TreeView straight onto HierarchyItem.OnExpand /
// OnCollapse / OnActivate (see tree-view.ts's ExpandableTreeData hook) — this
// behavior deliberately leaves those alone and owns only:
//
//   1. Selection mirroring — every SelectionChanged on the host pushes the
//      current SelectedItems (the tree's data items, which ARE HierarchyItems
//      when the host is bound to a Hierarchy's Roots/Children) into
//      Hierarchy.SyncSelection, anchored on the last-selected row — WPF/VS
//      Code parity (the most recent click/extend is the active row).
//
//   2. Inline rename — F2 begins editing the Hierarchy's current Anchor.
//      Each realized row's EditableTextBlock (the caption cell
//      @HierarchyItemTemplate renders — see hierarchy.template.mu) is wired
//      so its Committed / Cancelled signal calls back into the row's bound
//      HierarchyItem.CommitEdit() / CancelEdit().
//
// Authored as a standalone Behavior (not baked into TreeView) so it can
// attach from markup via a `Behaviors { HierarchyTreeBehavior [Hierarchy=$Nav] }`
// block — Task 12 wires the default TreeView template + this behavior
// together into the shared solution-explorer shell.
//
// Row discovery: AddContainerPreparedListener (items-control.ts) fires for
// EVERY fresh container realization, at any depth — this behavior re-arms
// the same listener on each realized TreeViewItem (itself an ItemsControl)
// so nested rows are covered too. KNOWN GAP: a RECYCLED container reused for
// a DIFFERENT item (virtualizing trees only — TreeView.IsVirtualizing opts
// in, default false) goes through RebindContainerForItemOverride, which does
// NOT fire this listener today, so a recycled row's rename wiring can go
// stale. Acceptable for this task's scope; a follow-up would need a
// container-rebound notification on ItemsControl to close the gap.
export class HierarchyTreeBehavior extends Behavior
{
    private static readonly KeyDownEvent = 'KeyDown';

    public static readonly HierarchyKey = MuralBase.RegisterProperty<Hierarchy | undefined>(
        HierarchyTreeBehavior, 'Hierarchy', undefined, MetaData.None);

    public get Hierarchy(): Hierarchy | undefined { return this.get_property_value(HierarchyTreeBehavior.HierarchyKey); }
    public set Hierarchy(v: Hierarchy | undefined) { this.set_property_value(HierarchyTreeBehavior.HierarchyKey, v); }

    private readonly _subscriptions = new CompositeDisposable();

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof Selector))
        {
            throw new Error('HierarchyTreeBehavior must attach to a Selector (TreeView or similar)');
        }

        const onSelectionChanged = (): void => this.SyncSelectionFromTree(visual);
        visual.AddSelectionChangedListener(onSelectionChanged);
        this._subscriptions.add(new Disposable(() => visual.RemoveSelectionChangedListener(onSelectionChanged)));

        const onKeyDown = (args: unknown): void => this.HandleKeyDown(args as KeyEventArgs);
        visual.AddRoutedEventListener(HierarchyTreeBehavior.KeyDownEvent, onKeyDown);
        this._subscriptions.add(new Disposable(() => visual.RemoveRoutedEventListener(HierarchyTreeBehavior.KeyDownEvent, onKeyDown)));

        this.WireContainerTree(visual);
    }

    public override OnDetached(_visual: Visual): void
    {
        this._subscriptions.dispose();
    }

    // Thin dispatcher the SelectionChanged listener calls — kept as its own
    // method (rather than an inline closure doing the work) so it stays
    // directly callable/testable without round-tripping a real selection
    // gesture.
    public SyncSelectionFromTree(tree: Selector): void
    {
        const hierarchy = this.Hierarchy;
        if (hierarchy === undefined) return;
        const items = tree.SelectedItems as readonly HierarchyItem[];
        hierarchy.SyncSelection(items, items[items.length - 1]);
    }

    // Thin dispatcher the KeyDown listener calls.
    public HandleKeyDown(args: KeyEventArgs): void
    {
        if (args.Handled || args.Key !== Key.F2) return;
        const anchor = this.Hierarchy?.Anchor;
        if (anchor === undefined) return;
        anchor.BeginEdit();
        args.Handled = true;
    }

    // Arms a container-prepared listener on `host` and re-arms the same
    // wiring on every TreeViewItem it realizes (itself an ItemsControl),
    // so nested rows at any depth get covered as they're realized — not
    // just the top level.
    private WireContainerTree(host: ItemsControl): void
    {
        const listener: ContainerPreparedListener = (container, item): void =>
        {
            this.WireRow(container, item);
        };
        host.AddContainerPreparedListener(listener);
        this._subscriptions.add(new Disposable(() => host.RemoveContainerPreparedListener(listener)));
    }

    private WireRow(container: Visual, item: unknown): void
    {
        if (item instanceof HierarchyItem)
        {
            this.WireRowEditing(container, item);
        }
        if (container instanceof ItemsControl)
        {
            this.WireContainerTree(container);
        }
    }

    // Finds the row's EditableTextBlock (the caption cell the default
    // @HierarchyItemTemplate renders as the row's Header) and wires its
    // Committed / Cancelled signals back onto the bound HierarchyItem.
    private WireRowEditing(container: Visual, item: HierarchyItem): void
    {
        const header = (container as unknown as { Header?: unknown }).Header;
        const editable = header instanceof Visual ? HierarchyTreeBehavior.FindEditableTextBlock(header) : undefined;
        if (editable === undefined) return;
        const committed: IDisposable = editable.Committed.subscribe(() => item.CommitEdit());
        const cancelled: IDisposable = editable.Cancelled.subscribe(() => item.CancelEdit());
        this._subscriptions.add(new Disposable(() =>
        {
            committed.dispose();
            cancelled.dispose();
        }));
    }

    // Depth-first search for an EditableTextBlock under a row's Header
    // Visual — decoupled from the exact template shape (icon-then-caption
    // today) so a future template reorder doesn't break the wiring.
    private static FindEditableTextBlock(root: Visual): EditableTextBlock | undefined
    {
        if (root instanceof EditableTextBlock) return root;
        for (const child of root.visualChildren)
        {
            const found = HierarchyTreeBehavior.FindEditableTextBlock(child);
            if (found !== undefined) return found;
        }
        return undefined;
    }
}
