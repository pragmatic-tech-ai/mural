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
import { ItemsControl, type ContainerClearedListener, type ContainerPreparedListener } from '../base/items-control.js';
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
// Row discovery + teardown: AddContainerPreparedListener (items-control.ts)
// fires for every fresh container realization, at any depth — this behavior
// re-arms the same prepared/cleared pair on each realized TreeViewItem
// (itself an ItemsControl) so nested rows are covered too. Per-row wiring
// (the rename subscriptions AND the nested listener pair registered on that
// row's own container) is tracked in `_rowTeardown`, keyed by container, and
// disposed the moment that SPECIFIC container clears — collapsing a node
// removes its children from the bound `Children` ObservableCollection
// (Hierarchy.Collapse → removeFromSegment → RemoveAt), which flows straight
// through to ClearContainerForItemOverride on the nested TreeViewItem; without
// per-row teardown keyed this way, repeated expand/collapse cycles would grow
// `_subscriptions` without bound (Fix round 1 — see the task report). Only the
// top-level prepared/cleared registration (against the attached host itself)
// lives for the whole attach, torn down in OnDetached.
//
// KNOWN GAP: a RECYCLED container reused for a DIFFERENT item (virtualizing
// trees only — TreeView.IsVirtualizing opts in, default false) goes through
// RebindContainerForItemOverride, which does NOT fire ContainerPrepared/
// ContainerCleared today, so a recycled row's rename wiring can go stale.
// Acceptable for this task's scope; a follow-up would need a
// container-rebound notification on ItemsControl to close the gap.
export class HierarchyTreeBehavior extends Behavior
{
    private static readonly KeyDownEvent = 'KeyDown';

    public static readonly HierarchyKey = MuralBase.RegisterProperty<Hierarchy | undefined>(
        HierarchyTreeBehavior, 'Hierarchy', undefined, MetaData.None);

    public get Hierarchy(): Hierarchy | undefined { return this.get_property_value(HierarchyTreeBehavior.HierarchyKey); }
    public set Hierarchy(v: Hierarchy | undefined) { this.set_property_value(HierarchyTreeBehavior.HierarchyKey, v); }

    // Lives for the whole attach — the top-level SelectionChanged / KeyDown /
    // container-listener registrations against the host itself.
    private readonly _subscriptions = new CompositeDisposable();
    // Per-row teardown (rename subscriptions + any nested listener pair the
    // row registered on its own container), keyed by container. Disposed and
    // removed the moment ITS container clears — see the class doc comment.
    private readonly _rowTeardown = new Map<Visual, IDisposable>();

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

        this.wireContainerLevel(visual, this._subscriptions);
    }

    public override OnDetached(_visual: Visual): void
    {
        this._subscriptions.dispose();
        this._rowTeardown.clear();
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

    // Arms a container-prepared/cleared pair on `host`. Prepared wires the row
    // (rename subscriptions + recursing into the row's own container as a
    // further level); cleared disposes exactly that row's teardown. The
    // listener-removal itself (NOT the per-row teardown it triggers) is
    // registered against `ownerTeardown` — `this._subscriptions` for the
    // top-level host (lives for the whole attach), or a row's own
    // `_rowTeardown` entry for a nested container (lives only until THAT row
    // clears).
    private wireContainerLevel(host: ItemsControl, ownerTeardown: CompositeDisposable): void
    {
        const prepared: ContainerPreparedListener = (container, item): void =>
        {
            this.wireRow(container, item);
        };
        const cleared: ContainerClearedListener = (container): void =>
        {
            this.clearRow(container);
        };
        host.AddContainerPreparedListener(prepared);
        host.AddContainerClearedListener(cleared);
        ownerTeardown.add(new Disposable(() =>
        {
            host.RemoveContainerPreparedListener(prepared);
            host.RemoveContainerClearedListener(cleared);
        }));
    }

    private wireRow(container: Visual, item: unknown): void
    {
        const rowTeardown = new CompositeDisposable();
        if (item instanceof HierarchyItem)
        {
            this.wireRowEditing(container, item, rowTeardown);
        }
        if (container instanceof ItemsControl)
        {
            this.wireContainerLevel(container, rowTeardown);
        }
        this._rowTeardown.set(container, rowTeardown);
    }

    private clearRow(container: Visual): void
    {
        const teardown = this._rowTeardown.get(container);
        if (teardown === undefined) return;
        this._rowTeardown.delete(container);
        teardown.dispose();
    }

    // Finds the row's EditableTextBlock (the caption cell the default
    // @HierarchyItemTemplate renders as the row's Header) and wires its
    // Committed / Cancelled signals back onto the bound HierarchyItem. The
    // subscriptions are added to `teardown` — the caller's per-row
    // CompositeDisposable, disposed when THIS row's container clears.
    private wireRowEditing(container: Visual, item: HierarchyItem, teardown: CompositeDisposable): void
    {
        const header = (container as unknown as { Header?: unknown }).Header;
        const editable = header instanceof Visual ? HierarchyTreeBehavior.findEditableTextBlock(header) : undefined;
        if (editable === undefined) return;
        const committed: IDisposable = editable.Committed.subscribe(() => item.CommitEdit());
        const cancelled: IDisposable = editable.Cancelled.subscribe(() => item.CancelEdit());
        teardown.add(new Disposable(() =>
        {
            committed.dispose();
            cancelled.dispose();
        }));
    }

    // Depth-first search for an EditableTextBlock under a row's Header
    // Visual — decoupled from the exact template shape (icon-then-caption
    // today) so a future template reorder doesn't break the wiring.
    private static findEditableTextBlock(root: Visual): EditableTextBlock | undefined
    {
        if (root instanceof EditableTextBlock) return root;
        for (const child of root.visualChildren)
        {
            const found = HierarchyTreeBehavior.findEditableTextBlock(child);
            if (found !== undefined) return found;
        }
        return undefined;
    }
}
