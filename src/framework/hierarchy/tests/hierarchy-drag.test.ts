import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DragDropEffects,
    Element,
    Rect,
    ServiceProvider,
    Size,
    Visual,
} from '../../../runtime/index.js';
import { ItemsControl } from '../../base/items-control.js';
import { HierarchyDragBehavior } from '../hierarchy-drag-behavior.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyItem, type IHierarchyItemHost } from '../hierarchy-item.js';
import { HierarchyItemsDrop } from '../hierarchy-drop.js';
import type { DropData } from '../hierarchy-provider.js';

// Stand-in row visual — same trick `hierarchy-drop-behavior.test.ts` and
// `list-reorder-behavior.test.ts` use: never attached as a real visual
// child, just stamped directly with an ArrangedRect and the bound item.
class StubRow extends Element
{
    public stampRect(r: Rect): void { this['_arrangedRect'] = r; }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
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
// 20px-tall ArrangedRect stacked vertically — mirrors hierarchy-drop-
// behavior.test.ts's buildTree.
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

describe('HierarchyDragBehavior', () =>
{
    test('OnAttached sets IsDraggable on every already-realized row container', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, rows } = buildTree(hierarchy, 2);
        const behavior = new HierarchyDragBehavior();
        behavior.Hierarchy = hierarchy;
        ic.AddBehavior(behavior);

        assert.equal(rows[0]!.IsDraggable, true);
        assert.equal(rows[1]!.IsDraggable, true);
    });

    test('dragging a selected row returns a DragStartSpec stamping the WHOLE selection', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items, rows } = buildTree(hierarchy, 3);
        const [row0, row1] = items as [HierarchyItem, HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0);
        hierarchy.Selection.Add(row1);

        const behavior = new HierarchyDragBehavior();
        behavior.Hierarchy = hierarchy;
        ic.AddBehavior(behavior);

        const spec = rows[0]!.OnDragStart!(rows[0]!);
        assert.ok(spec !== null, 'drag starts for a selected row');
        assert.equal(spec!.effects, DragDropEffects.Move);
        assert.ok(spec!.data.Has(HierarchyItemsDrop.Kind));
        const drop = spec!.data.Get<DropData>(HierarchyItemsDrop.Kind)!;
        assert.deepEqual(HierarchyItemsDrop.ItemsOf(drop), [row0.Id, row1.Id]);
    });

    test('dragging a row NOT in the selection returns null — nothing to drag', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items, rows } = buildTree(hierarchy, 2);
        const [row0] = items as [HierarchyItem, HierarchyItem];
        hierarchy.Selection.Add(row0);

        const behavior = new HierarchyDragBehavior();
        behavior.Hierarchy = hierarchy;
        ic.AddBehavior(behavior);

        const spec = rows[1]!.OnDragStart!(rows[1]!);
        assert.equal(spec, null);
    });

    test('OnDetached clears IsDraggable / OnDragStart on every row', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic, items, rows } = buildTree(hierarchy, 1);
        const [row0] = items as [HierarchyItem];
        hierarchy.Selection.Add(row0);

        const behavior = new HierarchyDragBehavior();
        behavior.Hierarchy = hierarchy;
        ic.AddBehavior(behavior);
        behavior.OnDetached(ic);

        assert.equal(rows[0]!.IsDraggable, false);
        assert.equal(rows[0]!.OnDragStart, undefined);
    });

    test('a row realized AFTER attach (via AddContainerPreparedListener) is wired too', () =>
    {
        const hierarchy = buildHierarchy();
        const { ic } = buildTree(hierarchy, 0);
        const behavior = new HierarchyDragBehavior();
        behavior.Hierarchy = hierarchy;
        ic.AddBehavior(behavior);

        const item = hierarchy.NewItem('row', { Caption: 'late' });
        const row = new StubRow();
        ic.PrepareContainerForItemOverride(row, item, 0);

        assert.equal(row.IsDraggable, true, 'late-realized row picked up IsDraggable via the listener');
        hierarchy.Selection.Add(item);
        const spec = row.OnDragStart!(row);
        assert.ok(spec !== null);
    });
});
