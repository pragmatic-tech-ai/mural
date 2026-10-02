import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Key, KeyEventArgs, ModifierKeys, ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { EditableTextBlock } from '../../../basic/editable-text-block.js';
import { Hierarchy as HierarchyTemplates } from '../../../../build/framework/hierarchy/hierarchy.template.mu.js';
import { TreeView } from '../../list/tree-view.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandContext } from '../../shell/commands/command-context.js';
import { HierarchyTreeBehavior } from '../hierarchy-tree-behavior.js';

// Task 9 — HierarchyTreeBehavior: selection mirroring + inline-rename wiring.
//
// Drives the behavior against a REAL TreeView whose items are real
// HierarchyItems, bound through the default @HierarchyItemTemplate (the
// same compiled HierarchicalDataTemplate hierarchy-template.test.ts exercises
// directly) — so container realization, the row's EditableTextBlock, and the
// Caption/IsEditing/EditingName bindings are all the genuine article, not
// stand-ins.

interface CommitRenameCall { item: unknown; name: string }

function buildHierarchy(): { hierarchy: Hierarchy; commits: CommitRenameCall[] }
{
    const commits: CommitRenameCall[] = [];
    const host: IHierarchyItemHost = {
        Activate: () => {},
        CommitRename: (item, newName) => { commits.push({ item, name: newName }); },
        OnItemRemoved: () => {},
    };
    const registry = new HierarchyContributorRegistry(new ServiceProvider());
    const hierarchy = new Hierarchy(registry, host);
    return { hierarchy, commits };
}

// Wires a TreeView to a Hierarchy's Roots through the real default row
// template, attaches a fresh HierarchyTreeBehavior BEFORE the ItemsSource is
// set (AddContainerPreparedListener does not replay existing containers —
// see items-control.ts), and returns the realized root rows.
function buildTree(hierarchy: Hierarchy): { tree: TreeView; behavior: HierarchyTreeBehavior }
{
    const tree = new TreeView();
    tree.ItemTemplate = HierarchyTemplates.Clone().HierarchyItemTemplate;
    const behavior = new HierarchyTreeBehavior();
    behavior.Hierarchy = hierarchy;
    tree.AddBehavior(behavior);
    tree.ItemsSource = hierarchy.Roots;
    return { tree, behavior };
}

function captionOf(rowHeader: unknown): EditableTextBlock
{
    const stack = rowHeader as StackPanel;
    return [...stack.Children][1] as EditableTextBlock;
}

describe('HierarchyTreeBehavior', () => {
    beforeEach(() => { initTestApp(); });

    test('a tree selection change mirrors SelectedItems into Hierarchy.SyncSelection, anchored on the last-selected row', () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        const b = hierarchy.NewItem('b', { Caption: 'Beta' });
        hierarchy.Roots.Add(a);
        hierarchy.Roots.Add(b);
        const { tree } = buildTree(hierarchy);

        const [rowA, rowB] = tree.RootItems;
        tree.HandleContainerClick(rowA!, ModifierKeys.None);
        tree.HandleContainerClick(rowB!, ModifierKeys.Control);

        assert.deepEqual(hierarchy.Selection.ToArray(), [a, b], 'both rows land in Hierarchy.Selection, in click order');
        assert.equal(hierarchy.Anchor, b, 'the last-selected row becomes the anchor');
    });

    test('a single-click selection replaces the selection and anchor (Extended-mode plain click)', () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        const b = hierarchy.NewItem('b', { Caption: 'Beta' });
        hierarchy.Roots.Add(a);
        hierarchy.Roots.Add(b);
        const { tree } = buildTree(hierarchy);

        const [rowA, rowB] = tree.RootItems;
        tree.HandleContainerClick(rowA!, ModifierKeys.None);
        assert.deepEqual(hierarchy.Selection.ToArray(), [a]);
        assert.equal(hierarchy.Anchor, a);

        tree.HandleContainerClick(rowB!, ModifierKeys.None);
        assert.deepEqual(hierarchy.Selection.ToArray(), [b], 'a plain click clears the prior selection');
        assert.equal(hierarchy.Anchor, b);
    });

    test('F2 on the tree begins editing the Hierarchy anchor item', () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree } = buildTree(hierarchy);

        tree.HandleContainerClick(tree.RootItems[0]!, ModifierKeys.None);
        assert.equal(hierarchy.Anchor, a);
        assert.equal(a.IsEditing, false);

        const keyArgs = new KeyEventArgs('KeyDown', tree, {
            Key: Key.F2, KeyText: 'F2', Code: 'F2', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        tree.FireRoutedListeners('KeyDown', keyArgs);

        assert.equal(keyArgs.Handled, true, 'F2 is consumed');
        assert.equal(a.IsEditing, true, 'the anchor item enters edit mode');
        assert.equal(a.EditingName, 'Alpha', 'BeginEdit seeds EditingName from Caption');
    });

    test('F2 with no selection/anchor is a no-op and leaves the key unhandled', () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree } = buildTree(hierarchy);

        const keyArgs = new KeyEventArgs('KeyDown', tree, {
            Key: Key.F2, KeyText: 'F2', Code: 'F2', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        tree.FireRoutedListeners('KeyDown', keyArgs);

        assert.equal(keyArgs.Handled, false);
        assert.equal(a.IsEditing, false);
    });

    test("a row's EditableTextBlock Committed calls the bound item's CommitEdit, which routes to the host", () => {
        const { hierarchy, commits } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree } = buildTree(hierarchy);

        const editable = captionOf(tree.RootItems[0]!.Header);
        assert.ok(editable instanceof EditableTextBlock, 'the row renders its caption through EditableTextBlock');

        a.BeginEdit();
        assert.equal(editable.IsEditing, true, 'the template binds $IsEditing through to the row editor');

        editable.EditingText = 'Alpha Renamed';
        editable.Commit();

        assert.equal(commits.length, 1);
        assert.equal(commits[0]!.item, a);
        assert.equal(commits[0]!.name, 'Alpha Renamed');
        assert.equal(a.IsEditing, false, 'CommitEdit leaves edit mode');
    });

    test("a row's EditableTextBlock Cancelled calls the bound item's CancelEdit without notifying the host", () => {
        const { hierarchy, commits } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree } = buildTree(hierarchy);

        const editable = captionOf(tree.RootItems[0]!.Header);

        a.BeginEdit();
        assert.equal(editable.IsEditing, true);

        editable.EditingText = 'Discarded';
        editable.Cancel();

        assert.equal(commits.length, 0, 'CancelEdit never calls host.CommitRename');
        assert.equal(a.IsEditing, false, 'CancelEdit leaves edit mode');
    });

    test('OnDetached stops mirroring selection and stops handling F2', () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree, behavior } = buildTree(hierarchy);

        const rowA = tree.RootItems[0]!;
        tree.HandleContainerClick(rowA, ModifierKeys.None);
        assert.deepEqual(hierarchy.Selection.ToArray(), [a], 'sanity: mirroring works before detach');

        tree.RemoveBehavior(behavior);

        // Ctrl-click the already-selected row to toggle it OFF at the tree
        // level; if the listener were still attached this would mirror
        // through to an EMPTY Hierarchy.Selection.
        tree.HandleContainerClick(rowA, ModifierKeys.Control);
        assert.deepEqual(tree.SelectedItems, [], 'sanity: the tree itself did deselect');
        assert.deepEqual(hierarchy.Selection.ToArray(), [a], 'selection no longer mirrors after detach');

        const keyArgs = new KeyEventArgs('KeyDown', tree, {
            Key: Key.F2, KeyText: 'F2', Code: 'F2', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        tree.FireRoutedListeners('KeyDown', keyArgs);
        assert.equal(keyArgs.Handled, false, 'F2 no longer handled after detach');
        assert.equal(a.IsEditing, false);
    });

    // Fix round 2 — Critical: OnDetached must DISPOSE every still-live row's
    // teardown, not just drop the Map. The round-1 fix moved per-row rename
    // subscriptions into `_rowTeardown`, keyed by container and disposed on
    // that row's ClearContainerForItemOverride — but OnDetached originally
    // only called `_rowTeardown.clear()`, which discards the Map's
    // IDisposable values WITHOUT calling .dispose() on them. Detaching while
    // a row is still realized (the ordinary case — e.g. the test above,
    // which detaches with root row `a` still realized) leaked that row's
    // Committed/Cancelled subscriptions.
    test("OnDetached releases a still-realized row's rename subscriptions too", () => {
        const { hierarchy } = buildHierarchy();
        const a = hierarchy.NewItem('a', { Caption: 'Alpha' });
        hierarchy.Roots.Add(a);
        const { tree, behavior } = buildTree(hierarchy);

        const editable = captionOf(tree.RootItems[0]!.Header);
        assert.equal(editable.Committed.subscriberCount, 1, 'sanity: the row is wired before detach');
        assert.equal(editable.Cancelled.subscriberCount, 1, 'sanity: the row is wired before detach');

        tree.RemoveBehavior(behavior);

        assert.equal(editable.Committed.subscriberCount, 0, 'OnDetached released the Committed subscription');
        assert.equal(editable.Cancelled.subscriberCount, 0, 'OnDetached released the Cancelled subscription');
    });

    // Fix round 1 — Critical: collapsing a node must release that row's
    // rename subscriptions immediately (not just on OnDetached). Collapsing
    // removes the child HierarchyItem from the bound `Children`
    // ObservableCollection (Hierarchy.Collapse → removeFromSegment →
    // RemoveAt), which flows straight through to
    // ClearContainerForItemOverride on the nested TreeViewItem — the
    // ordinary default (non-virtualizing) collapse path. Before the fix,
    // per-row Committed/Cancelled subscriptions (and the nested
    // container-prepared listener they registered) lived only in the
    // top-level `_subscriptions`, released only on OnDetached — so this
    // path leaked a subscription (and kept the detached row + its
    // HierarchyItem reachable) on every expand/collapse cycle.
    test('collapsing an expanded node releases that row\'s rename subscriptions (no growth across repeated expand/collapse cycles)', () => {
        const host: IHierarchyItemHost = { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
        const childKey = new ServiceKey<IHierarchyContributor>('child-contributor');
        const sp = new ServiceProvider();
        const contributor: IHierarchyContributor = {
            ParentKeys: ['parent'],
            Order: 0,
            // A fresh ExtObject per Contribute() call means NO interning across
            // expand/collapse cycles — each expand mints a genuinely new child
            // HierarchyItem (and container), which is what makes "does the OLD
            // row's subscription actually release" an observable question.
            Contribute: () => new NodeContribution([{ Key: 'child', ExtObject: {}, Caption: 'Child', IsExpandable: false }]),
            Resolve: (_id: string, _ctx: CommandContext) => undefined,
        };
        sp.registerInstance(childKey, contributor);
        const registry = new HierarchyContributorRegistry(sp);
        const def = new HierarchyContributorDefinition();
        def.ParentKeys = ['parent']; def.Contributor = childKey; def.Order = 0;
        registry.Register(def);

        const hierarchy = new Hierarchy(registry, host);
        const parent = hierarchy.NewItem('parent', { Caption: 'Parent', IsExpandable: true });
        hierarchy.Roots.Add(parent);
        const { tree } = buildTree(hierarchy);

        // Expand → realize the real 'child' row, capture its EditableTextBlock,
        // assert exactly one subscriber each signal → collapse → return it so
        // the caller can assert the subscriptions were released.
        function expandCollapseOnce(): EditableTextBlock
        {
            parent.OnExpand();
            const parentRow = tree.RootItems[0]!;
            const childRow = parentRow.SubItems[0]!;
            const editable = captionOf(childRow.Header);
            assert.equal(editable.Committed.subscriberCount, 1, 'expanding wires exactly one Committed subscriber');
            assert.equal(editable.Cancelled.subscriberCount, 1, 'expanding wires exactly one Cancelled subscriber');
            parent.OnCollapse();
            return editable;
        }

        const first = expandCollapseOnce();
        assert.equal(first.Committed.subscriberCount, 0, 'collapsing releases the Committed subscription');
        assert.equal(first.Cancelled.subscriberCount, 0, 'collapsing releases the Cancelled subscription');

        // Repeat several cycles — a leak would show the subscriber count of
        // each cycle's OWN (freshly minted) row staying >0 after its collapse,
        // or the prior cycle's row never reaching 0 in the first place. Every
        // cycle must independently start at 1 (fresh wiring) and end at 0
        // (fresh teardown) — no accumulation across cycles.
        for (let i = 0; i < 3; i++)
        {
            const editable = expandCollapseOnce();
            assert.equal(editable.Committed.subscriberCount, 0, `cycle ${i}: Committed released`);
            assert.equal(editable.Cancelled.subscriberCount, 0, `cycle ${i}: Cancelled released`);
        }
    });
});
