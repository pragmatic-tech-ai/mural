import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DataObject,
    DragDropEffects,
    DragEventArgs,
    NoModifiers,
    Rect,
    Size,
    ServiceProvider,
    Element,
    Visual,
} from '../../../runtime/index.js';
import { ItemsControl } from '../../base/items-control.js';
import { HierarchyDropBehavior } from '../hierarchy-drop-behavior.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyItem, type IHierarchyItemHost } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { HierarchyItemsDrop } from '../hierarchy-drop.js';

// Stand-in row visual whose ArrangedRect we can stamp directly, same trick
// `list-reorder-behavior.test.ts` uses — these rows are never attached as
// real visual children, so GetVisualParent() returns undefined and the
// behavior's offset walk collapses to the stamped rect's own Y.
class StubRow extends Element
{
    public stampRect(r: Rect): void { this['_arrangedRect'] = r; }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
}

// Stand-in NESTED-capable row — same ArrangedRect-stamping trick as StubRow,
// but itself an ItemsControl (as TreeViewItem is) so it can host stamped
// sub-rows via `_containers`, with a settable `IsExpanded` duck-typed the
// same way `HierarchyDropBehavior.isExpanded` reads TreeViewItem.IsExpanded.
// Its own stamped ArrangedRect spans its WHOLE subtree (own header + every
// nested descendant), matching how a real expanded TreeViewItem's
// ArrangedRect.Height behaves — resolveTarget must look past that span into
// the nested rows to find the deepest match.
class StubContainerRow extends ItemsControl
{
    public IsExpanded = false;
    public stampRect(r: Rect): void { this['_arrangedRect'] = r; }
    public stampChildren(rows: readonly Visual[]): void
    {
        (this as unknown as { _containers: Visual[] })._containers = [...rows];
    }
}

function noopItemHost(): IHierarchyItemHost
{
    return {
        Activate: () => { },
        CommitRename: () => { },
        OnItemRemoved: () => { },
    };
}

function buildHierarchy(): Hierarchy
{
    const registry = new HierarchyContributorRegistry(new ServiceProvider());
    return new Hierarchy(registry, noopItemHost());
}

// One row per item, stamped with the item under `_itemsControlData` (the
// same stamp ItemsControl.PrepareContainerForItemOverride writes) and a
// 20px-tall ArrangedRect stacked vertically — row i spans hostY [i*20, i*20+20).
function buildTree(hierarchy: Hierarchy, count: number): { ic: ItemsControl; items: HierarchyItem[]; rows: StubRow[] }
{
    const ic = new ItemsControl();
    const items: HierarchyItem[] = [];
    const rows: StubRow[] = [];
    for (let i = 0; i < count; i++)
    {
        const item = hierarchy.NewItem('row', { Caption: `row${i}` });
        items.push(item);
        const row = new StubRow();
        row.stampRect(new Rect(0, i * 20, 100, 20));
        (row as unknown as { _itemsControlData?: unknown })._itemsControlData = item;
        rows.push(row);
    }
    (ic as unknown as { _containers: Visual[] })._containers = rows;
    return { ic, items, rows };
}

class FakeHierarchyHost implements HierarchyHost
{
    public accept = true;
    public readonly canDropCalls: Array<{ target: HierarchyItem; dragged: readonly HierarchyItem[] }> = [];
    public readonly dropCalls: Array<{ target: HierarchyItem; dragged: readonly HierarchyItem[] }> = [];

    public Activate(): void { }
    public CommitRename(): void { }
    public OnItemRemoved(): void { }
    public Delete(): void { }

    public CanDrop(target: HierarchyItem, dragged: readonly HierarchyItem[]): boolean
    {
        this.canDropCalls.push({ target, dragged });
        return this.accept;
    }

    public Drop(target: HierarchyItem, dragged: readonly HierarchyItem[]): void
    {
        this.dropCalls.push({ target, dragged });
    }
}

function dragArgs(kind: 'DragOver' | 'Drop', hostY: number, data: DataObject): DragEventArgs
{
    return new DragEventArgs(kind, new StubRow(), {
        HostX: 0, HostY: hostY,
        Data: data,
        AllowedEffects: DragDropEffects.Move,
        Modifiers: NoModifiers,
    });
}

function hierarchyItemsDropData(ids: readonly number[]): DataObject
{
    return new DataObject().Set(HierarchyItemsDrop.Kind, HierarchyItemsDrop.For(ids));
}

describe('HierarchyDropBehavior', () =>
{
    test('OnAttached sets AllowDrop on the host', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic } = buildTree(hierarchy, 2);
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = new FakeHierarchyHost();
        ic.AddBehavior(behavior);
        assert.equal(ic.AllowDrop, true);
    });

    test('a target the host accepts sets Effect=Move on DragOver and calls Host.Drop on Drop', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items } = buildTree(hierarchy, 2);
        const [row0, row1] = items as [HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0); // row0 is the dragged item

        const host = new FakeHierarchyHost();
        host.accept = true;
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = host;
        ic.AddBehavior(behavior);

        const data = hierarchyItemsDropData([row0.Id]);
        // hostY=25 lands inside row1's span [20, 40) — row1 is the drop target.
        const over = dragArgs('DragOver', 25, data);
        ic.FireRoutedListeners('DragOver', over);
        assert.equal(over.Effect, DragDropEffects.Move);
        assert.equal(host.canDropCalls.length, 1);
        assert.equal(host.canDropCalls[0]!.target, row1);
        assert.deepEqual(host.canDropCalls[0]!.dragged, [row0]);

        const drop = dragArgs('Drop', 25, data);
        ic.FireRoutedListeners('Drop', drop);
        assert.equal(host.dropCalls.length, 1);
        assert.equal(host.dropCalls[0]!.target, row1);
        assert.deepEqual(host.dropCalls[0]!.dragged, [row0]);
    });

    test('a drop over a NESTED descendant row resolves to that row, not the root ancestor', () =>
    {
        const hierarchy = buildHierarchy();
        const ic = new ItemsControl();
        const parentItem = hierarchy.NewItem('row', { Caption: 'parent' });
        const childItem = hierarchy.NewItem('row', { Caption: 'child' });
        hierarchy.Selection.Add(parentItem); // the dragged item — irrelevant to target resolution

        // Root row: expanded, its stamped span [0, 40) covers its own
        // header band [0, 20) PLUS its nested child's band [20, 40) — same
        // shape a real expanded TreeViewItem's ArrangedRect.Height has.
        const parentRow = new StubContainerRow();
        parentRow.IsExpanded = true;
        parentRow.stampRect(new Rect(0, 0, 100, 40));
        (parentRow as unknown as { _itemsControlData?: unknown })._itemsControlData = parentItem;

        // Nested child row: its own header band is hostY [20, 40) — stamped
        // with an ABSOLUTE host Y (not parent-relative), matching the other
        // stub rows in this file (GetVisualParent() returns undefined since
        // none of these are attached as real visual children).
        const childRow = new StubRow();
        childRow.stampRect(new Rect(0, 20, 100, 20));
        (childRow as unknown as { _itemsControlData?: unknown })._itemsControlData = childItem;
        parentRow.stampChildren([childRow]);

        (ic as unknown as { _containers: Visual[] })._containers = [parentRow];

        const host = new FakeHierarchyHost();
        host.accept = true;
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = host;
        ic.AddBehavior(behavior);

        const data = hierarchyItemsDropData([parentItem.Id]);

        // hostY=25 lands inside the NESTED child's own header band [20, 40)
        // — it must resolve to the child, not the parent whose stamped span
        // also happens to cover [0, 40).
        const over = dragArgs('DragOver', 25, data);
        ic.FireRoutedListeners('DragOver', over);
        assert.equal(host.canDropCalls.length, 1);
        assert.equal(host.canDropCalls[0]!.target, childItem);

        // hostY=5 lands inside the PARENT's own header band [0, 20) — still
        // resolves to the parent (non-regression: the child's band doesn't
        // swallow the whole subtree span).
        const overParent = dragArgs('DragOver', 5, data);
        ic.FireRoutedListeners('DragOver', overParent);
        assert.equal(host.canDropCalls.length, 2);
        assert.equal(host.canDropCalls[1]!.target, parentItem);
    });

    test('a target the host rejects leaves Effect unset and does not call Drop', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items } = buildTree(hierarchy, 2);
        const [row0, row1] = items as [HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0);

        const host = new FakeHierarchyHost();
        host.accept = false;
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = host;
        ic.AddBehavior(behavior);

        const data = hierarchyItemsDropData([row0.Id]);
        const over = dragArgs('DragOver', 25, data);
        ic.FireRoutedListeners('DragOver', over);
        assert.equal(over.Effect, DragDropEffects.None);
        assert.equal(host.canDropCalls.length, 1);
        assert.equal(host.canDropCalls[0]!.target, row1);

        const drop = dragArgs('Drop', 25, data);
        ic.FireRoutedListeners('Drop', drop);
        assert.equal(host.dropCalls.length, 0);
    });

    test('a payload without the hierarchy-items drop kind is ignored entirely', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items } = buildTree(hierarchy, 2);
        const [row0] = items as [HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0);

        const host = new FakeHierarchyHost();
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = host;
        ic.AddBehavior(behavior);

        const data = new DataObject().Set('text/plain', 'not a hierarchy drop');
        const over = dragArgs('DragOver', 25, data);
        ic.FireRoutedListeners('DragOver', over);
        assert.equal(over.Effect, DragDropEffects.None);
        assert.equal(host.canDropCalls.length, 0);

        const drop = dragArgs('Drop', 25, data);
        ic.FireRoutedListeners('Drop', drop);
        assert.equal(host.dropCalls.length, 0);
    });

    test('OnDetached removes the listeners — a subsequent DragOver no longer reaches the host', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items } = buildTree(hierarchy, 2);
        const [row0] = items as [HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0);

        const host = new FakeHierarchyHost();
        const behavior = new HierarchyDropBehavior();
        behavior.Hierarchy = hierarchy;
        behavior.Host = host;
        ic.AddBehavior(behavior);
        behavior.OnDetached(ic);

        const data = hierarchyItemsDropData([row0.Id]);
        ic.FireRoutedListeners('DragOver', dragArgs('DragOver', 25, data));
        assert.equal(host.canDropCalls.length, 0);
    });
});
