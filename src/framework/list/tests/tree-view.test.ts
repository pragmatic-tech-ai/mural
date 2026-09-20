import { ModifierKeys, toModifierKeys } from '../../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Application, NoModifiers, ObservableCollection, PointerButton, Rect, Size, type PointerEventInit, type ModifierKeys } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';;
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { ItemsPresenter } from '../../../basic/templates/items-presenter.js';
import { ScrollViewer } from '../../../framework/surfaces/scroll-viewer.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { VirtualizingStackPanel } from '../../../basic/panels/virtualisation/virtualizing-stack-panel.js';
import { CollapsibleStack, TreeView, TreeViewItem } from '../tree-view.js';
import { DataTemplate, HierarchicalDataTemplate } from '../../../basic/templates/data-template.js';
import { TextBlock } from '../../../basic/text-block.js';

function pointer(mods: Partial<ModifierKeys> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
    };
}

// Build the typical "Root → A, B" tree with B having two leaf children
// for tests that need an interesting visible-items list.
function buildFixture()
{
    const tree = new TreeView();
    const root = new TreeViewItem(); root.Header = 'Root';
    const a    = new TreeViewItem(); a.Header    = 'A';
    const b    = new TreeViewItem(); b.Header    = 'B';
    const b1   = new TreeViewItem(); b1.Header   = 'B1';
    const b2   = new TreeViewItem(); b2.Header   = 'B2';
    root.AddChild(a);
    root.AddChild(b);
    b.AddChild(b1);
    b.AddChild(b2);
    tree.AddChild(root);
    return { tree, root, a, b, b1, b2 };
}

// Drill into a TreeViewItem to its clickable row Border — the bubble
// origin for selection and expand actions. Row is at
//   item._outerStack.children[0]  → _row
function rowOf(item: TreeViewItem)
{
    const outerStack = item.visualChildren[0]!;
    return outerStack.visualChildren[0]!;
}

// The chevron sits inside the row inner StackPanel as the second
// child (after the indent spacer).
function chevronOf(item: TreeViewItem)
{
    const row = rowOf(item);
    const inner = row.visualChildren[0]!;
    return inner.visualChildren[1]!;
}

// Spacer = first child of the row's inner horizontal stack — its
// Width DP is how much horizontal indent the row applies.
function spacerOf(item: TreeViewItem)
{
    const row = rowOf(item);
    const inner = row.visualChildren[0]!;
    return inner.visualChildren[0]!;
}

describe('TreeView — composed-markup tree shape', () => {
    beforeEach(() => { initTestApp(); });

    test('AddChild on TreeView attaches root items both visually and logically', () => {
        const tree = new TreeView();
        const a = new TreeViewItem(); a.Header = 'A';
        tree.AddChild(a);

        // logical via the public read-only views. Identity-compare the
        // items rather than deepEqual'ing the full Visual graph (each
        // TreeViewItem holds a circular tree of template parts that
        // would take minutes to diff).
        assert.equal(tree.logicalChildren.length, 1);
        assert.equal(tree.logicalChildren[0], a);
        assert.equal(tree.RootItems.length, 1);
        assert.equal(tree.RootItems[0], a);
        // ItemsControl-shape visual tree: TreeView → ScrollViewer →
        // ScrollContentPresenter → ItemsPresenter → items panel
        // (StackPanel) → root rows. SCP comes from ScrollViewer's
        // default template (since the §11 templated-ScrollViewer
        // refactor); the ItemsPresenter is the slot the ItemsControl
        // base wires the panel into; the StackPanel is built by
        // TreeView.ItemsPanel. Walk through ScrollViewer.ContentPresenter
        // to skip past the template's layout panel.
        const sv = tree.visualChildren[0]!;
        assert.ok(sv instanceof ScrollViewer);
        const presenter = sv.ContentPresenter!.visualChildren[0]!;
        assert.ok(presenter instanceof ItemsPresenter);
        const stack = presenter.visualChildren[0]!;
        assert.ok(stack instanceof StackPanel);
        assert.equal(stack.visualChildren.length, 1);
        assert.equal(stack.visualChildren[0], a);
    });

    test('AddChild on TreeViewItem makes the child its logical child but visual child of the wrapper', () => {
        const parent = new TreeViewItem(); parent.Header = 'P';
        const child  = new TreeViewItem(); child.Header  = 'C';
        parent.AddChild(child);

        assert.deepEqual(parent.logicalChildren, [child]);
        assert.deepEqual(parent.SubItems, [child]);
        // ItemsControl-shape visual tree: TreeViewItem's outer stack
        // hosts the row first, then an ItemsPresenter slotting a
        // CollapsibleStack (the items panel) whose children are the
        // sub-rows.
        const outerStack = parent.visualChildren[0]!;
        const childHost  = outerStack.visualChildren[1]!;
        assert.ok(childHost instanceof ItemsPresenter);
        const childWrap  = childHost.visualChildren[0]!;
        assert.ok(childWrap instanceof CollapsibleStack);
        assert.deepEqual(childWrap.visualChildren, [child]);
    });

    test('TreeView rejects non-TreeViewItem children with a clear error', () => {
        const tree = new TreeView();
        assert.throws(() => tree.AddChild(new TreeView()),
            /TreeView only accepts TreeViewItem/);
    });

    test('TreeViewItem rejects non-TreeViewItem children too', () => {
        const item = new TreeViewItem();
        assert.throws(() => item.AddChild(new TreeView()),
            /TreeViewItem only accepts TreeViewItem/);
    });
});

describe('TreeViewItem — expansion behaviour', () => {
    beforeEach(() => { initTestApp(); });

    test('chevron click toggles IsExpanded', () => {
        const item = new TreeViewItem();
        const child = new TreeViewItem();
        item.AddChild(child);
        assert.equal(item.IsExpanded, false);

        const chevron = chevronOf(item);
        const im = new InputManager();
        im.InjectPointerDown(chevron, pointer());
        im.InjectPointerUp  (chevron, pointer());
        assert.equal(item.IsExpanded, true);

        im.InjectPointerDown(chevron, pointer());
        im.InjectPointerUp  (chevron, pointer());
        assert.equal(item.IsExpanded, false);
    });

    test('chevron click stops the row from also selecting (Handled marks the down event)', () => {
        const tree = new TreeView();
        const root = new TreeViewItem();
        const child = new TreeViewItem();
        root.AddChild(child);
        tree.AddChild(root);

        const chevron = chevronOf(root);
        const im = new InputManager();
        im.InjectPointerDown(chevron, pointer());
        im.InjectPointerUp  (chevron, pointer());

        assert.equal(root.IsExpanded, true);
        assert.equal(tree.SelectedItem, undefined,
            'a chevron click must not select the row underneath');
    });

    test('collapsed child rows are arranged at zero size — invisible without detach', () => {
        const { tree, b, b1 } = buildFixture();
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        // b is collapsed by default → b1 should be arranged at 0×0.
        assert.equal(b.IsExpanded, false);
        assert.equal(b1.ArrangedRect.Width,  0);
        assert.equal(b1.ArrangedRect.Height, 0);

        // Expand b and re-flush — b1 should now have non-zero height.
        b.IsExpanded = true;
        target.Flush();
        assert.ok(b1.ArrangedRect.Height > 0);
    });
});

describe('TreeView — depth indent', () => {
    beforeEach(() => { initTestApp(); });

    test('indent spacer width = depth × TreeView.Indent', () => {
        const { tree, root, a, b1 } = buildFixture();
        // Expand both so b1 actually gets measured at a non-zero size.
        root.IsExpanded = true;
        const b = tree.RootItems[0]!.SubItems[1]!;
        b.IsExpanded = true;

        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        // root sits at depth 0 → no indent.
        assert.equal(spacerOf(root).ArrangedRect.Width, 0);
        // a is a direct child of root → depth 1 → 16 DIPs.
        assert.equal(spacerOf(a).ArrangedRect.Width, 16);
        // b1 is a grandchild → depth 2 → 32 DIPs.
        assert.equal(spacerOf(b1).ArrangedRect.Width, 32);
    });

    test('changing TreeView.Indent re-measures the whole subtree', () => {
        const { tree, root, a } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();
        assert.equal(spacerOf(a).ArrangedRect.Width, 16);

        tree.Indent = 24;
        target.Flush();
        assert.equal(spacerOf(a).ArrangedRect.Width, 24);
    });
});

describe('TreeView — selection (multi-select via Ctrl / Shift)', () => {
    beforeEach(() => { initTestApp(); });

    test('plain click selects one item and moves the anchor', () => {
        const { tree, root, a } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());

        assert.equal(tree.SelectedItem, a);
        assert.deepEqual(tree.SelectedItems, [a]);
        assert.equal(a.IsSelected, true);
    });

    test('plain click on a different row clears the previous selection', () => {
        const { tree, root, a, b } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        im.InjectPointerDown(rowOf(b), pointer());
        im.InjectPointerUp  (rowOf(b), pointer());

        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, true);
        assert.deepEqual(tree.SelectedItems, [b]);
    });

    test('Ctrl+click toggles individual rows without clearing the rest', () => {
        const { tree, root, a, b } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        // Plain click on a — anchor=a, selection={a}.
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        // Ctrl+click on b — selection={a, b}.
        im.InjectPointerDown(rowOf(b), pointer({ Control: true }));
        im.InjectPointerUp  (rowOf(b), pointer({ Control: true }));

        const sel = tree.SelectedItems;
        assert.equal(sel.length, 2);
        assert.ok(sel.includes(a));
        assert.ok(sel.includes(b));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);

        // Ctrl+click on a again — deselects a, keeps b.
        im.InjectPointerDown(rowOf(a), pointer({ Control: true }));
        im.InjectPointerUp  (rowOf(a), pointer({ Control: true }));
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, true);
        assert.deepEqual(tree.SelectedItems, [b]);
    });

    test('Shift+click extends the selection from anchor to the clicked row, visible-order', () => {
        const { tree, root, a, b, b1, b2 } = buildFixture();
        root.IsExpanded = true;
        b.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        // Visible order: root, a, b, b1, b2.
        const im = new InputManager();
        // Plain click on a — anchor=a.
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        // Shift+click on b2 — range [a, b, b1, b2].
        im.InjectPointerDown(rowOf(b2), pointer({ Shift: true }));
        im.InjectPointerUp  (rowOf(b2), pointer({ Shift: true }));

        const sel = new Set(tree.SelectedItems);
        assert.equal(sel.size, 4);
        assert.ok(sel.has(a));
        assert.ok(sel.has(b));
        assert.ok(sel.has(b1));
        assert.ok(sel.has(b2));
        assert.ok(!sel.has(root));
    });

    test('Shift+click skips collapsed subtrees (visible-order range, not document order)', () => {
        const { tree, root, a, b, b1, b2 } = buildFixture();
        root.IsExpanded = true;
        // b is collapsed — b1 + b2 are NOT visible.
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        im.InjectPointerDown(rowOf(b), pointer({ Shift: true }));
        im.InjectPointerUp  (rowOf(b), pointer({ Shift: true }));

        const sel = new Set(tree.SelectedItems);
        assert.equal(sel.size, 2);
        assert.ok(sel.has(a));
        assert.ok(sel.has(b));
        assert.ok(!sel.has(b1), 'b1 is in a collapsed subtree — not visible, not selected');
        assert.ok(!sel.has(b2));
    });

    test('SelectionChanged fires on every selection-modifying click', () => {
        const { tree, root, a, b } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        let fired = 0;
        tree.AddSelectionChangedListener(() => { fired++; });

        const im = new InputManager();
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        im.InjectPointerDown(rowOf(b), pointer({ Control: true }));
        im.InjectPointerUp  (rowOf(b), pointer({ Control: true }));
        assert.equal(fired, 2);
    });

    test('ClearSelection drops every selected item AND fires SelectionChanged', () => {
        const { tree, root, a, b } = buildFixture();
        root.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(rowOf(a), pointer());
        im.InjectPointerUp  (rowOf(a), pointer());
        im.InjectPointerDown(rowOf(b), pointer({ Control: true }));
        im.InjectPointerUp  (rowOf(b), pointer({ Control: true }));
        assert.equal(tree.SelectedItems.length, 2);

        let fired = 0;
        tree.AddSelectionChangedListener(() => { fired++; });
        tree.ClearSelection();

        assert.equal(tree.SelectedItems.length, 0);
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, false);
        assert.equal(fired, 1);
    });

    test('removing a subtree purges its items from the selection set', () => {
        const { tree, root, b, b1, b2 } = buildFixture();
        root.IsExpanded = true;
        b.IsExpanded = true;
        const target = new HeadlessTarget(300, 400);
        target.Content = tree;
        target.Flush();

        // Select b1 and b2.
        const im = new InputManager();
        im.InjectPointerDown(rowOf(b1), pointer());
        im.InjectPointerUp  (rowOf(b1), pointer());
        im.InjectPointerDown(rowOf(b2), pointer({ Control: true }));
        im.InjectPointerUp  (rowOf(b2), pointer({ Control: true }));
        assert.equal(tree.SelectedItems.length, 2);

        // Remove b — b1 + b2 should leave the selection set with them.
        root.RemoveChild(b);
        assert.equal(tree.SelectedItems.length, 0);
        assert.equal(b1.IsSelected, false);
        assert.equal(b2.IsSelected, false);
    });
});

// Plain data records — the data-driven tree binds these through
// ItemTemplate / ItemTemplateSelector / HierarchicalDataTemplate.
interface Node { Name: string; children?: Node[]; }

// ── Root-level UI virtualization (IsVirtualizing) ───────────────────────
// M1: opting a TreeView into virtualization swaps its ROOT ItemsPanel for a
// VirtualizingStackPanel, so only the root rows whose vertical band meets the
// viewport realize as TreeViewItems. (Nested-level virtualization — each
// expanded TreeViewItem's children — is a separate increment.)
describe('TreeView — root-level virtualization (IsVirtualizing)', () =>
{
    beforeEach(() => { initTestApp(); });

    function bigTree(n: number): TreeView
    {
        const tree = new TreeView();
        tree.IsVirtualizing = true;
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Node).Name),
            (d) => (d as Node).children,
        );
        tree.ItemsSource = Array.from({ length: n }, (_, i) => ({ Name: `n${i}` })) as Node[];
        return tree;
    }

    test('opting in swaps the root ItemsPanel to a VirtualizingStackPanel', () =>
    {
        const plain = new TreeView();
        assert.ok(plain.ItemsPanelInstance instanceof StackPanel, 'default is a plain StackPanel');
        assert.ok(!(plain.ItemsPanelInstance instanceof VirtualizingStackPanel));

        const virt = bigTree(5);
        assert.ok(virt.ItemsPanelInstance instanceof VirtualizingStackPanel, 'opt-in swaps to VSP');
    });

    test('only the root rows intersecting the viewport realize as TreeViewItems', () =>
    {
        const tree = bigTree(40);
        const vsp = tree.ItemsPanelInstance as VirtualizingStackPanel;
        // Viewport y = 30..90 over the 20px per-row estimate → root indices 1..4.
        vsp.Viewport = new Rect(0, 30, 100, 60);
        vsp.Measure(new Size(100, 60));

        assert.deepEqual(vsp.RealizedIndices, [1, 2, 3, 4]);
        // Only those 4 rows exist as containers (not all 40), and each is a
        // TreeViewItem logically parented to the tree — virtualization elided
        // the rest.
        assert.equal(tree.logicalChildren.length, 4);
        for (const c of tree.logicalChildren) assert.ok(c instanceof TreeViewItem);
    });

    test('scrolling the viewport recycles offscreen rows and realizes a later band', () =>
    {
        const tree = bigTree(40);
        const vsp = tree.ItemsPanelInstance as VirtualizingStackPanel;
        vsp.Viewport = new Rect(0, 0, 100, 40);      // near the top
        vsp.Measure(new Size(100, 40));
        const near = vsp.RealizedIndices;
        assert.ok(near.includes(0), 'row 0 realizes near the top');
        assert.ok(near.length <= 4, `only a small band realizes, got ${near.length}`);

        // Scroll far down. Independent of the exact per-row height (real
        // TreeViewItems don't measure to the 20px estimate), the top rows must
        // recycle and a strictly-lower contiguous band must realize.
        vsp.Viewport = new Rect(0, 400, 100, 40);
        vsp.Measure(new Size(100, 40));
        const far = vsp.RealizedIndices;
        assert.ok(!far.includes(0) && !far.includes(1), 'top rows recycled after scrolling down');
        assert.ok(far.length > 0 && far.length <= 4, 'a small band realizes after scrolling');
        assert.ok(Math.min(...far) > Math.max(...near), 'the scrolled band sits below the initial band');
        for (let i = 1; i < far.length; i++) assert.equal(far[i], far[i - 1]! + 1, 'realized band is contiguous');
    });

    test('turning virtualization back off restores the plain StackPanel', () =>
    {
        const tree = bigTree(12);
        tree.IsVirtualizing = false;
        assert.ok(tree.ItemsPanelInstance instanceof StackPanel);
        assert.ok(!(tree.ItemsPanelInstance instanceof VirtualizingStackPanel));
        // Non-virtual → every root row materialized.
        assert.equal(tree.RootItems.length, 12);
    });
});

describe('TreeView — data-bound templates (ItemTemplate + selector + factory)', () => {
    beforeEach(() => { initTestApp(); });

    test('ItemTemplate factory becomes the row header Visual (not just displayString)', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Node).Name));
        tree.ItemsSource = [{ Name: 'root' }] as Node[];

        const header = tree.RootItems[0]!.Header;
        assert.ok(header instanceof TextBlock, 'header should be the template Visual');
        assert.equal((header as TextBlock).Text, 'root');
    });

    test('no template → falls back to the Name/Label/Text display-string convention', () => {
        const tree = new TreeView();
        tree.ItemsSource = [{ Name: 'plain' }] as Node[];
        assert.equal(tree.RootItems[0]!.Header, 'plain');
    });

    test('ItemTemplateSelector is consulted per item and wins over ItemTemplate', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new DataTemplate((d) => new TextBlock(`fallback:${(d as Node).Name}`));
        tree.ItemTemplateSelector = (item) =>
            (item as Node).Name === 'special'
                ? new DataTemplate((d) => new TextBlock(`picked:${(d as Node).Name}`))
                : undefined;
        tree.ItemsSource = [{ Name: 'special' }, { Name: 'other' }] as Node[];

        assert.equal((tree.RootItems[0]!.Header as TextBlock).Text, 'picked:special');
        assert.equal((tree.RootItems[1]!.Header as TextBlock).Text, 'fallback:other');
    });

    test('HierarchicalDataTemplate applies its factory as the header AND recurses to children', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Node).Name),
            (d) => (d as Node).children,
        );
        tree.ItemsSource = [{ Name: 'root', children: [{ Name: 'child' }] }] as Node[];

        const root = tree.RootItems[0]!;
        assert.equal((root.Header as TextBlock).Text, 'root');
        // The child container is realized from the parent's projected Items;
        // its header comes from the same recursive template's factory.
        assert.equal((root.SubItems[0]!.Header as TextBlock).Text, 'child');
    });

    test('ItemTemplateSelector propagates down the tree so it applies at every level', () => {
        const tree = new TreeView();
        // A selector (no plain ItemTemplate) that returns a hierarchical
        // template for every node — the selector must be re-consulted for
        // the nested child, not just the roots.
        tree.ItemTemplateSelector = () => new HierarchicalDataTemplate(
            (d) => new TextBlock(`n:${(d as Node).Name}`),
            (d) => (d as Node).children,
        );
        tree.ItemsSource = [{ Name: 'root', children: [{ Name: 'child' }] }] as Node[];

        const root = tree.RootItems[0]!;
        assert.equal((root.Header as TextBlock).Text, 'n:root');
        assert.equal((root.SubItems[0]!.Header as TextBlock).Text, 'n:child');
    });

    test('a nested item removed from a live ObservableCollection disappears from the tree', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Node).Name),
            (d) => (d as Node).children,
        );
        // Children is a LIVE ObservableCollection (as real consumers use) — not a
        // static array — so removing an item must fire a change the row reflects.
        const kids = new ObservableCollection<Node>();
        for (const n of [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }]) kids.Add(n);
        tree.ItemsSource = [{ Name: 'root', children: kids as unknown as Node[] }] as Node[];

        const root = tree.RootItems[0]!;
        assert.deepEqual(root.SubItems.map((s) => (s.Header as TextBlock).Text), ['a', 'b', 'c']);

        kids.RemoveAt(1);   // remove 'b'
        assert.deepEqual(
            root.SubItems.map((s) => (s.Header as TextBlock).Text), ['a', 'c'],
            'the removed nested row should be gone (live-collection reactivity)');
    });
});

// ── Nested-level virtualization (M2) ────────────────────────────────────
// An expanded row's children realize through a nested VirtualizingStackPanel
// that shares the outer viewport: only the child rows whose absolute band meets
// the window materialize, and collapsing recycles them.
describe('TreeView — nested-level virtualization', () =>
{
    beforeEach(() => { initTestApp(); });

    test('an expanded row virtualizes its children through a nested VSP; collapse clears them', () =>
    {
        const tree = new TreeView();
        tree.IsVirtualizing = true;
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Node).Name),
            (d) => (d as Node).children,
        );
        const children = Array.from({ length: 40 }, (_, i) => ({ Name: `c${i}` }));
        tree.ItemsSource = [{ Name: 'root', children }] as Node[];

        const rootVsp = tree.ItemsPanelInstance as VirtualizingStackPanel;
        const box = new Rect(0, 0, 100, 100);
        const pump = (): void =>
        {
            rootVsp.Viewport = box;
            rootVsp.Measure(new Size(100, 100));
            rootVsp.Arrange(box);
        };

        pump();     // realize the root row + EnableVirtualization on it
        const rootItem = tree.RootItems[0]!;
        rootItem.IsExpanded = true;
        pump(); pump(); pump();   // converge viewport propagation → nested realization

        const nested = rootItem.ItemsPanelInstance as VirtualizingStackPanel;
        assert.ok(nested instanceof VirtualizingStackPanel, 'expanded row hosts a nested VSP');
        const realized = nested.RealizedIndices;
        assert.ok(realized.length > 0, 'some children realize');
        assert.ok(realized.length < 40, `only a viewport slice realizes, got ${realized.length}`);
        assert.ok(realized.includes(0), 'the top child realizes (root sits at the top)');

        rootItem.IsExpanded = false;
        pump();
        assert.deepEqual(nested.RealizedIndices, [], 'collapse recycles the nested children');
    });
});

describe('TreeView — nested collection mutation rebinds recycled rows', () => {
    beforeEach(() => { initTestApp(); });

    interface Mut { Name: string; children: ObservableCollection<Mut>; }
    function mnode(name: string, kids: Mut[] = []): Mut
    {
        const c = new ObservableCollection<Mut>();
        for (const k of kids) c.Add(k);
        return { Name: name, children: c };
    }

    test('a virtualizing nested row cleared + refilled shows the new items, not the stale one', () => {
        const tree = new TreeView();
        tree.IsVirtualizing = true;
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Mut).Name),
            (d) => (d as Mut).children,
        );
        // Root row seeded with one "Loading…" sentinel child (the lazy-load shape).
        const version = mnode('0.1.0', [mnode('Loading…')]);
        tree.ItemsSource = [version] as Mut[];
        const target = new HeadlessTarget(250, 400);
        target.Content = tree;
        target.Flush();

        tree.RootItems[0]!.IsExpanded = true;
        target.Flush(); target.Flush(); target.Flush();

        // Lazy-load completes: clear the sentinel, add the real children.
        version.children.Clear();
        version.children.Add(mnode('Concepts'));
        version.children.Add(mnode('Relationships'));
        target.Flush(); target.Flush(); target.Flush();

        const texts = tree.RootItems[0]!.SubItems.map(
            (s) => (s.Header instanceof TextBlock ? (s.Header as TextBlock).Text : String(s.Header)));
        assert.ok(!texts.includes('Loading…'), `stale sentinel left behind: ${JSON.stringify(texts)}`);
        assert.deepEqual(texts, ['Concepts', 'Relationships']);
    });

    // A branch row realized INSIDE an already-virtualizing parent must still
    // present a chevron even though — being collapsed and virtualizing — none
    // of its children are realized yet. Regression: refreshChevron read the
    // realized-container count (SubItems.length, 0 when collapsed+virtualizing)
    // instead of the bound item count, so a nested group with children looked
    // like an empty leaf and couldn't be expanded (the "Concepts folder is
    // empty" symptom). The panel-swap teardown in EnableVirtualization is what
    // exposed the asymmetry: it recycles the transiently-realized children and
    // re-runs refreshChevron with SubItems back to 0.
    test('a nested virtualizing branch with children still shows an expand chevron', () => {
        const tree = new TreeView();
        tree.IsVirtualizing = true;
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as Mut).Name),
            (d) => (d as Mut).children,
        );
        // MuralBase → lazy Version (seeded Loading…). The Version's children carry
        // a Group ('Concepts') that itself has entity children pre-populated.
        const version = mnode('0.1.0', [mnode('Loading…')]);
        const model = mnode('tech-architecture', [version]);
        tree.ItemsSource = [model] as Mut[];
        const target = new HeadlessTarget(250, 400);
        target.Content = tree;
        target.Flush();

        tree.RootItems[0]!.IsExpanded = true;
        target.Flush(); target.Flush(); target.Flush();
        const versionItem = tree.RootItems[0]!.SubItems[0]!;

        versionItem.IsExpanded = true;
        target.Flush();
        version.children.Clear();
        const concepts = mnode('Concepts', Array.from({ length: 28 }, (_, i) => mnode(`concept-${i}`)));
        version.children.Add(concepts);
        target.Flush(); target.Flush(); target.Flush();

        const conceptsItem = versionItem.SubItems.find(
            (s) => (s.Header instanceof TextBlock ? (s.Header as TextBlock).Text : '') === 'Concepts')!;
        assert.ok(conceptsItem !== undefined, 'the Concepts group row realized');
        const glyph = (conceptsItem as unknown as { _chevronGlyph: { Geometry: unknown } })._chevronGlyph;
        assert.ok(glyph.Geometry !== undefined,
            'a nested branch with 28 children must present a chevron (else it reads as an empty leaf)');

        // And it actually expands to reveal the entities.
        conceptsItem.IsExpanded = true;
        target.Flush(); target.Flush(); target.Flush();
        assert.ok(conceptsItem.SubItems.length > 0, 'expanding the group realizes its entity rows');
    });
});

describe('TreeViewItem — OnExpand data hook', () => {
    beforeEach(() => { initTestApp(); });

    test('expanding a data-bound row invokes the data item OnExpand()', () => {
        const tree = new TreeView();
        let fired = 0;
        const data = { Name: 'root', children: [{ Name: 'child' }], OnExpand() { fired++; } };
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [data];

        const root = tree.RootItems[0]!;
        assert.equal(fired, 0);
        root.IsExpanded = true;
        assert.equal(fired, 1, 'OnExpand fires when the row expands');
    });

    test('a data item without OnExpand expands without throwing', () => {
        const tree = new TreeView();
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [{ Name: 'root', children: [{ Name: 'c' }] }];

        const root = tree.RootItems[0]!;
        assert.doesNotThrow(() => { root.IsExpanded = true; });
    });

    test('composed-markup rows (no bound data) expand without throwing', () => {
        const item = new TreeViewItem();
        item.AddChild(new TreeViewItem());
        assert.doesNotThrow(() => { item.IsExpanded = true; });
    });
});

describe('TreeViewItem — OnActivate data hook (double-click)', () => {
    beforeEach(() => { initTestApp(); });

    test('double-clicking a data-bound row invokes the data item OnActivate()', () => {
        const tree = new TreeView();
        let fired = 0;
        const data = { Name: 'root', children: [], OnActivate() { fired++; } };
        tree.ItemTemplate = new HierarchicalDataTemplate(
            (d) => new TextBlock((d as { Name: string }).Name),
            (d) => (d as { children?: unknown[] }).children,
        );
        tree.ItemsSource = [data];
        const target = new HeadlessTarget(250, 400);
        target.Content = tree;
        target.Flush();

        const im = new InputManager();
        const row = rowOf(tree.RootItems[0]!);
        im.InjectPointerDown(row, pointer());                          // single → no activate
        assert.equal(fired, 0);
        im.InjectPointerDown(row, { ...pointer(), IsDoubleClick: true }); // double → activate
        assert.equal(fired, 1, 'OnActivate fires on a double-click press');
    });
});
