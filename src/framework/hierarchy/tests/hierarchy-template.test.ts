import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Application, ObservableCollection } from '../../../runtime/index.js';
import { EditableTextBlock, Shape, StackPanel, type HierarchicalDataTemplate } from '../../../basic/index.js';
import { RectangleGeometry } from '../../../visual-engine/index.js';
import { Hierarchy } from '../../../../build/framework/hierarchy/hierarchy.template.mu.js';
import { HierarchyItem, type HierarchyItemInit, type IHierarchyItemHost, type IHierarchyItemOwner } from '../hierarchy-item.js';
import { ItemIdAllocator } from '../item-id.js';
import type { CommandViewModel } from '../../shell/commands/command-view-model.js';

// Mirrors hierarchy-item.test.ts's fakes — a bare owner/host pair is enough
// to construct a standalone HierarchyItem for template rendering; none of
// the owner/host callbacks are exercised by Apply() itself.
const alloc = new ItemIdAllocator();

function fakeHost(over: Partial<IHierarchyItemHost> = {}): IHierarchyItemHost
{
    return {
        Activate: () => {},
        CommitRename: () => {},
        OnItemRemoved: () => {},
        ...over,
    };
}

function fakeOwner(over: Partial<IHierarchyItemOwner> = {}): IHierarchyItemOwner
{
    return {
        NewItem: (key, init) => new HierarchyItem(alloc.Mint(), key, fakeOwner(), fakeHost(), init),
        Realize: () => {},
        Collapse: () => {},
        CanonicalNameOf: () => '/',
        BuildActions: () => new ObservableCollection<CommandViewModel>(),
        OnItemDisposed: () => {},
        ...over,
    };
}

function makeItem(init: HierarchyItemInit = {}): HierarchyItem
{
    return new HierarchyItem(alloc.Mint(), 'node', fakeOwner(), fakeHost(), init);
}

// Resolves the row template and applies it the same way a container
// generator does (items-control.ts:647-648): Apply() builds the subtree,
// then the caller pins DataContext = the data item.
function applyRow(item: HierarchyItem): StackPanel
{
    const template = Hierarchy.Clone().HierarchyItemTemplate as HierarchicalDataTemplate;
    const root = template.Apply(item) as StackPanel;
    root.DataContext = item;
    return root;
}

function iconOf(root: StackPanel): Shape
{
    return [...root.Children][0] as Shape;
}

function captionOf(root: StackPanel): EditableTextBlock
{
    return [...root.Children][1] as EditableTextBlock;
}

describe('@HierarchyItemTemplate — default HierarchicalDataTemplate over HierarchyItem', () =>
{
    beforeEach(() => { initTestApp(); });

    test('renders a two-child row: an icon slot then the caption EditableTextBlock', () =>
    {
        const item = makeItem({ Caption: 'src' });
        const root = applyRow(item);

        assert.equal(root.Children.Count, 2, 'icon slot + caption');
        assert.ok(iconOf(root) instanceof Shape, 'icon slot is a Shape');
        assert.ok(captionOf(root) instanceof EditableTextBlock, 'caption renders through EditableTextBlock');
    });

    test('caption path: EditableTextBlock.Text reflects $Caption and tracks live changes', () =>
    {
        const item = makeItem({ Caption: 'alpha' });
        const root = applyRow(item);

        assert.equal(captionOf(root).Text, 'alpha');
        item.Caption = 'beta';
        assert.equal(captionOf(root).Text, 'beta', 'DataContextBinding re-fires on the VM property change');
    });

    test('caption path: IsEditing tracks $IsEditing through BeginEdit / CancelEdit', () =>
    {
        const item = makeItem({ Caption: 'alpha' });
        const root = applyRow(item);

        assert.equal(captionOf(root).IsEditing, false);
        item.BeginEdit();
        assert.equal(captionOf(root).IsEditing, true, 'IsEditing flips with the item entering edit mode');
        item.CancelEdit();
        assert.equal(captionOf(root).IsEditing, false, 'IsEditing flips back on CancelEdit');
    });

    // BeginEdit writes HierarchyItem's private `_editingName` field directly
    // (no PropertyChanged) — seeding EditingText-before-flipping-IsEditing is
    // Task 9's rename behavior, not this static template binding (see the
    // task-8 brief). What the template DOES own is the plain $EditingName
    // binding itself: an explicit EditingName write (through the public
    // setter, which DOES notify) must still reach EditableTextBlock.
    test('caption path: EditingText follows $EditingName on an explicit EditingName write', () =>
    {
        const item = makeItem({ Caption: 'alpha' });
        const root = applyRow(item);

        assert.equal(captionOf(root).EditingText, '', 'starts at the DP default — BeginEdit was never called');
        item.EditingName = 'typed-value';
        assert.equal(captionOf(root).EditingText, 'typed-value', 'DataContextBinding carries the explicit write through');
    });

    test('itemsselector = Children: ItemsOf yields exactly the item\'s own Children', () =>
    {
        const parent = makeItem({ Caption: 'parent' });
        const child  = makeItem({ Caption: 'child' });
        parent.Children.Add(child);

        const template = Hierarchy.Clone().HierarchyItemTemplate as HierarchicalDataTemplate;
        const yielded = [...template.ItemsOf(parent)];
        assert.deepEqual(yielded, parent.Children.ToArray());
    });

    test('DR10 — IconKey = "" renders an empty (present but geometry-less) icon slot', () =>
    {
        const item = makeItem({ Caption: 'no-icon', IconKey: '' });
        const root = applyRow(item);

        const icon = iconOf(root);
        assert.ok(icon instanceof Shape, 'icon slot still present');
        assert.equal(icon.Geometry, undefined, 'empty key -> no Geometry -> Shape paints nothing');
    });

    test('DR10 — an unresolved IconKey also renders an empty icon slot', () =>
    {
        const item = makeItem({ Caption: 'missing-icon', IconKey: 'no-such-resource-key' });
        const root = applyRow(item);

        assert.equal(iconOf(root).Geometry, undefined, 'unresolved key -> no Geometry');
    });

    test('DR10 — a registered IconKey resolves through Application.Resources to its Geometry', () =>
    {
        const geometry = new RectangleGeometry();
        Application.current!.Resources.Set('sample-icon', geometry);
        try
        {
            const item = makeItem({ Caption: 'has-icon', IconKey: 'sample-icon' });
            const root = applyRow(item);

            assert.equal(iconOf(root).Geometry, geometry, 'IconKey resolved through the resource system');
        }
        finally
        {
            Application.current!.Resources.Delete('sample-icon');
        }
    });
});
