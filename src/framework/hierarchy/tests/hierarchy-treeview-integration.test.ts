import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { instantiate } from '../../../compiler/compile.js';
import { DEFAULT_SYMBOLS } from '../../../compiler/symbol-table.js';
import * as runtime from '../../../runtime/index.js';
import * as basic from '../../../basic/index.js';
import * as engine from '../../../visual-engine/index.js';
import {
    Key, KeyEventArgs, ModifierKeys, ServiceKey, ServiceProvider,
} from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { TreeView } from '../../list/tree-view.js';
import type { HierarchicalDataTemplate } from '../../../basic/index.js';
import { ContextMenuService } from '../../menu/context-menu.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyItem, type IHierarchyItemHost } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { HierarchyTreeBehavior } from '../hierarchy-tree-behavior.js';
import { HierarchyContextMenuBehavior } from '../hierarchy-context-menu.js';
import { HierarchyDropBehavior } from '../hierarchy-drop-behavior.js';
import { HierarchyDragBehavior } from '../hierarchy-drag-behavior.js';
import { EditableTextBlock } from '../../../basic/editable-text-block.js';

// Task 12 — the default TreeView style bundle (@HierarchyItemTemplate via a
// keyed Style) + the behavior bundle (HierarchyTreeBehavior /
// HierarchyContextMenuBehavior / HierarchyDropBehavior, attached through a
// real `.Behaviors:` block compiled by the ACTUAL compiler), wired against a
// REAL Hierarchy bound as DataContext — pinning Review Focus 3
// (independent, by-key overridability) end-to-end.
//
// Goes through compile()/instantiate() (not plain TS construction, unlike
// Tasks 9-11's own tests) because what's under test IS the markup-level
// wiring: `@HierarchyTreeView` / `@HierarchyItemTemplate` resolving through
// the real theme (framework.resources.mu -> MuralFramework -> Pragmatic),
// and each Behavior's `$Hierarchy` / `$Hierarchy.Host` attribute binding
// resolving against the HOST TreeView's DataContext (the compiler fix this
// task adds — compileAttribute's `behaviorHostVar` — not the behavior's
// own, since a Behavior has no DataContext of its own).
//
// Two deliberate harness choices, each forced by something real:
//
// 1. The compiled source is a bare FRAGMENT (`TreeView x:name="t" […] {…}`),
//    NOT `Application{ resources: {…} }`. instantiate() eagerly builds a
//    FRESH, un-themed Application for the latter (out.isApplication ⇒
//    `fn(ctx)` runs immediately) — which would overwrite initTestApp()'s
//    shared, Pragmatic-activated `Application.current`, and TreeViewItem's
//    own constructor-time `applyDefaultStyle()` (tree-view.ts) would then
//    find no theme dictionaries at all. A fragment returns a FACTORY
//    (`() => fn(ctx)`) instead, so `Application.current` stays the shared
//    themed instance the whole time.
//
// 2. DataContext is wired through `$service(HierarchyVmService)` — a
//    service instance registered directly on the ambient
//    `Application.current.Services` (ServiceBinding falls back to the app
//    root when no ancestor publishes its own ServiceScope) — and set as
//    the TreeView's OWN (first) attribute, not inherited from a wrapper
//    element. A child is fully constructed — attributes AND body,
//    including `.Behaviors:` — before it is attached to any parent
//    (SetChild only runs once the child's own compileElement call
//    returns), so DataContext INHERITANCE from an ancestor is not live yet
//    at `.Behaviors:` time; `HierarchyContextMenuBehavior.OnAttached`
//    throws if `Hierarchy` isn't already resolved at that point (Task 10).
//    A direct attribute is a local value, resolved the instant it's set,
//    with no attach-timing dependency — confirmed by first reproducing the
//    throw with DataContext set only AFTER construction, then fixing it
//    this way.

// Mints a FRESH token and points HierarchyVmService.Key at it. Needed
// because initTestApp() hands back ONE shared, process-wide Application
// (see test-app.ts's own doc comment) — so every buildTreeView() call
// registers onto the SAME underlying ServiceProvider. ServiceProvider.get()
// caches a Singleton registration's resolved instance per TOKEN
// (service-provider.ts in todl-runtime) and that cache is never invalidated
// by a later register()/registerInstance() call under the SAME token — so
// re-registering `HierarchyVmService.Key` as a fixed constant across tests
// would silently keep resolving test 1's Hierarchy forever (confirmed while
// debugging this file: `dropBeh.Hierarchy` kept coming back as the FIRST
// test's Hierarchy). A fresh token per call sidesteps that entirely — the
// provider has never seen it, so there is no stale cache entry to hit. The
// todl-runtime cache-invalidation gap itself is out of this task's scope
// (separate package/repo) and is flagged in the task report.
function hierarchyServiceToken(): ServiceKey<{ Hierarchy: Hierarchy }>
{
    HierarchyVmService.Key = new ServiceKey<{ Hierarchy: Hierarchy }>('HierarchyVmService');
    return HierarchyVmService.Key;
}

// Nominal class purely to give `$service(HierarchyVmService)` a compiler
// symbol to resolve against (ServiceProvider.tokenFor(ctor) reads the
// current `Key` — see hierarchyServiceToken() above for why it's rebound
// per call rather than a fixed constant) — the service VALUE is registered
// directly via `registerInstance`, never constructed by the DI container
// itself.
class HierarchyVmService
{
    public static Key = new ServiceKey<{ Hierarchy: Hierarchy }>('HierarchyVmService');
}

const CTX: Record<string, unknown> = {
    ...runtime, ...basic, ...engine,
    TreeView, HierarchyItem, HierarchyTreeBehavior, HierarchyContextMenuBehavior, HierarchyDropBehavior,
    HierarchyDragBehavior,
    HierarchyVmService,
};
const SYMS = new Map([...DEFAULT_SYMBOLS, ['HierarchyVmService', 'test']]);

// `HierarchyItem` / `HierarchyTreeBehavior` / `HierarchyContextMenuBehavior` /
// `HierarchyDropBehavior` aren't in the compiler's DEFAULT_SYMBOLS table
// (only framework/basic built-ins are), so every source string below pulls
// them in the same way hierarchy.template.mu does — an explicit top-level
// `import … from "…"` clause (needed even though CTX already carries the
// runtime value — `instantiate` resolves a bare markup symbol only once the
// compiler has SEEN an import clause for it). instantiate() resolves the
// referenced NAMES off `ctx` regardless of the stated path (compile.ts's own
// doc comment on `instantiate`), so the literal path string below is
// cosmetic for this harness; it mirrors the real package self-reference
// hierarchy.template.mu uses.
const BEHAVIOR_IMPORTS = `
import HierarchyItem from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js"
import HierarchyTreeBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-tree-behavior.js"
import HierarchyContextMenuBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context-menu.js"
import HierarchyDropBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-drop-behavior.js"
import HierarchyDragBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-drag-behavior.js"
`;

function fullHostVm(): { hierarchy: Hierarchy; host: HierarchyHost }
{
    const host: HierarchyHost = {
        Activate: () => {},
        CommitRename: () => {},
        OnItemRemoved: () => {},
        Delete: () => {},
        CanDrop: () => true,
        Drop: () => {},
    };
    const registry = new HierarchyContributorRegistry(new ServiceProvider());
    const hierarchy = new Hierarchy(registry, host as IHierarchyItemHost);
    return { hierarchy, host };
}

// Compiles the fragment `TreeView x:name="t" [ DataContext = $service(
// HierarchyVmService), Style = @HierarchyTreeView<extraAttrs> ] { <body> }`
// and runs its factory. `hierarchy` is registered on the shared, already-
// themed Application's Services right before the factory runs, so
// `$service(HierarchyVmService)` (and therefore `$Hierarchy` / `$Hierarchy.
// Host` inside `<body>`) resolve to THIS call's Hierarchy. `extraAttrs`
// lets a test add e.g. `, ItemsSource = $Hierarchy.Roots` to the TreeView's
// OWN attribute list (compiles before `<body>` — used by the ordering
// tests to reproduce the wrong authoring order).
function buildTreeView(hierarchy: Hierarchy, extraAttrs: string, body: string): TreeView
{
    const app = initTestApp();
    app.Services.registerInstance(hierarchyServiceToken(), { Hierarchy: hierarchy });

    const src = BEHAVIOR_IMPORTS + `
        TreeView [ DataContext = $service(HierarchyVmService), Style = @HierarchyTreeView${extraAttrs} ] {
            ${body}
        }
    `;
    const factory = instantiate(src, CTX, { symbols: SYMS }) as () => TreeView;
    return factory();
}

const DEFAULT_BUNDLE_BODY = `
    .Behaviors: {
        HierarchyTreeBehavior        [ Hierarchy = $Hierarchy ]
        HierarchyContextMenuBehavior [ Hierarchy = $Hierarchy ]
        HierarchyDropBehavior        [ Hierarchy = $Hierarchy, Host = $Hierarchy.Host ]
        HierarchyDragBehavior        [ Hierarchy = $Hierarchy ]
    }
    ItemsSource: $Hierarchy.Roots
`;

describe('Default TreeView integration (Task 12)', () =>
{
    beforeEach(() => { initTestApp(); });

    test('binding ItemsSource = Hierarchy.Roots + the default style + the default .Behaviors: bundle wires everything', () =>
    {
        const { hierarchy, host } = fullHostVm();
        const root = hierarchy.NewItem('n', { Caption: 'root' });
        hierarchy.Roots.Add(root);

        const tree = buildTreeView(hierarchy, '', DEFAULT_BUNDLE_BODY);

        // 1. @HierarchyTreeView resolved ItemTemplate = @HierarchyItemTemplate
        //    (same shared instance the ancestor resource chain itself holds).
        const expectedTemplate = tree.TryFindResource('HierarchyItemTemplate');
        assert.ok(expectedTemplate !== undefined, 'the theme resolves @HierarchyItemTemplate at all');
        assert.equal(tree.ItemTemplate, expectedTemplate, 'the keyed Style set ItemTemplate to @HierarchyItemTemplate');

        // 2. ItemsSource bound through DataContext.
        assert.equal(tree.ItemsSource, hierarchy.Roots, 'ItemsSource = $Hierarchy.Roots resolved');

        // 3. All four behaviors attached, each correctly wired from the SAME
        //    $Hierarchy (and $Hierarchy.Host) binding — not four independent
        //    reads that could drift.
        assert.equal(tree.Behaviors.length, 4);
        const [treeBeh, menuBeh, dropBeh, dragBeh] = tree.Behaviors as
            [HierarchyTreeBehavior, HierarchyContextMenuBehavior, HierarchyDropBehavior, HierarchyDragBehavior];
        assert.ok(treeBeh instanceof HierarchyTreeBehavior);
        assert.equal(treeBeh.Hierarchy, hierarchy);
        assert.ok(menuBeh instanceof HierarchyContextMenuBehavior);
        assert.equal(menuBeh.Hierarchy, hierarchy);
        assert.ok(dropBeh instanceof HierarchyDropBehavior);
        assert.equal(dropBeh.Hierarchy, hierarchy);
        assert.equal(dropBeh.Host, host, '$Hierarchy.Host resolved to the real HierarchyHost, via Hierarchy.Host (Task 12 getter)');
        assert.ok(dragBeh instanceof HierarchyDragBehavior);
        assert.equal(dragBeh.Hierarchy, hierarchy);

        // 4. The row for the pre-existing root item actually realized through
        //    @HierarchyItemTemplate (end-to-end, not just "a template object
        //    exists somewhere"). RootItems holds the realized TreeViewItem
        //    CONTAINERS (tree-view.ts: "live read-only view of the realized
        //    TreeViewItem containers"), not the bound data items, so recover
        //    the data item through the generator before comparing — asserting
        //    the container itself against `root` would always be false AND,
        //    because the container is a circular Visual reachable from the
        //    whole themed Application, blow up assert's failure-diff
        //    formatter (confirmed while debugging this test).
        const [rowContainer] = tree.RootItems;
        const rowItem = tree.Generator.ItemFromContainer(rowContainer);
        assert.equal(rowItem, root);
    });

    test('override ONLY the data template (a custom ItemTemplate) — the default .Behaviors: bundle still attaches and still wires', () =>
    {
        const { hierarchy, host } = fullHostVm();

        const tree = buildTreeView(hierarchy, '', `
            ItemTemplate: DataTemplate [DataType = HierarchyItem] { TextBlock [ Text = $Caption ] }
            ${DEFAULT_BUNDLE_BODY}
        `);

        const [, , dropBeh] = tree.Behaviors as
            [HierarchyTreeBehavior, HierarchyContextMenuBehavior, HierarchyDropBehavior, HierarchyDragBehavior];
        assert.equal(tree.Behaviors.length, 4, 'all four default behaviors are still attached');
        assert.equal(dropBeh.Hierarchy, hierarchy);
        assert.equal(dropBeh.Host, host);

        const resolvedTemplate = tree.ItemTemplate as HierarchicalDataTemplate | undefined;
        assert.notEqual(resolvedTemplate, tree.TryFindResource('HierarchyItemTemplate'),
            'the app-supplied ItemTemplate (a local value) wins over the Style setter — DP-tier precedence');
    });

    test('override ONLY the behavior bundle (no .Behaviors: at all) — the default style still resolves @HierarchyItemTemplate', () =>
    {
        const { hierarchy } = fullHostVm();

        const tree = buildTreeView(hierarchy, '', '');

        assert.equal(tree.Behaviors.length, 0, 'no behaviors attached — the app chose not to use the default bundle');
        const expectedTemplate = tree.TryFindResource('HierarchyItemTemplate');
        assert.equal(tree.ItemTemplate, expectedTemplate, 'the keyed @HierarchyTreeView style still set the default ItemTemplate');
    });
});

describe('Default TreeView integration — ordering (Review Focus 3 / ruling 5)', () =>
{
    beforeEach(() => { initTestApp(); });

    function captionOf(header: unknown): EditableTextBlock
    {
        const stack = header as { Children: Iterable<unknown> };
        return [...stack.Children][1] as EditableTextBlock;
    }

    test('`.Behaviors:` BEFORE `ItemsSource:` (both as body items) wires rename on an already-live row', () =>
    {
        const { hierarchy } = fullHostVm();
        const root = hierarchy.NewItem('n', { Caption: 'root' });
        hierarchy.Roots.Add(root);

        const tree = buildTreeView(hierarchy, '', DEFAULT_BUNDLE_BODY);

        // RootItems already IS the realized container (see the note on the
        // "wires everything" test above) — no ContainerFromItem round-trip
        // needed/possible here (that expects a DATA item, not a container).
        const [container] = tree.RootItems;
        const editable = captionOf((container as unknown as { Header: unknown }).Header);
        assert.equal(editable.Committed.subscriberCount, 1,
            'the pre-existing row IS wired for rename — .Behaviors: ran before the ItemsSource slot-assign realized it');
    });

    test('`ItemsSource` compiled as an ATTRIBUTE (attrs always precede body items) leaves an already-live row unwired', () =>
    {
        // Reproduces the ACTUAL defect, not just its symptom: an attribute
        // compiles before any body item (compileElement's attrs loop runs
        // before compileElementBody), so `TreeView [ ItemsSource = … ] {
        // .Behaviors: {…} }` realizes the pre-existing row BEFORE the
        // Behavior attaches — exactly the late-attach gap Task 9 documented
        // (AddContainerPreparedListener never replays existing containers).
        const { hierarchy } = fullHostVm();
        const root = hierarchy.NewItem('n', { Caption: 'root' });
        hierarchy.Roots.Add(root);

        const tree = buildTreeView(hierarchy, ', ItemsSource = $Hierarchy.Roots', `
            .Behaviors: {
                HierarchyTreeBehavior [ Hierarchy = $Hierarchy ]
            }
        `);

        const [container] = tree.RootItems;
        const editable = captionOf((container as unknown as { Header: unknown }).Header);
        assert.equal(editable.Committed.subscriberCount, 0,
            'the attribute-ordered ItemsSource realized the row before .Behaviors: attached — this row is NOT wired');
    });
});

describe('Default TreeView integration — keyboard context-menu row-anchored placement (Task 12 gap fix)', () =>
{
    beforeEach(() => { initTestApp(); });

    // Mounts the compiled TreeView AS a real PresentationTarget's own
    // Content and runs a layout pass — needed for `ArrangedRect` to hold
    // anything but a zero rect, and for `visual`'s `_target` to resolve
    // (HandleKeyDown bails out without one). Mirrors tree-view.test.ts's
    // own fixtures (`target.Content = tree; target.Flush()`) — a plain
    // `Panel` wrapper (the generic base, not a layout-arranging subclass
    // like StackPanel) does NOT propagate a nonzero size to its child, so
    // the TreeView must be the target's Content directly, not nested one
    // level under a wrapper.
    function mount(tree: TreeView): void
    {
        const target = new HeadlessTarget(400, 300);
        target.Content = tree;
        target.Flush();
    }

    function openedFixedPoint(tree: TreeView): { x: number; y: number } | undefined
    {
        const menu = ContextMenuService.GetContextMenu(tree);
        return (menu as unknown as { _popupHost?: { fixedPoint?: { x: number; y: number } } })
            ._popupHost?.fixedPoint;
    }

    function pressContextMenuKey(tree: TreeView): KeyEventArgs
    {
        const args = new KeyEventArgs('KeyDown', tree, {
            Key: Key.Apps, KeyText: 'ContextMenu', Code: 'ContextMenu', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        tree.FireRoutedListeners('KeyDown', args);
        return args;
    }

    test('the anchored row has a realized container — the menu opens at ITS bottom-left, not the host origin', () =>
    {
        const { hierarchy } = fullHostVm();
        const root = hierarchy.NewItem('n', { Caption: 'root' });
        hierarchy.Roots.Add(root);

        const tree = buildTreeView(hierarchy, '', DEFAULT_BUNDLE_BODY);
        mount(tree);
        hierarchy.SelectSingle(root);

        const args = pressContextMenuKey(tree);

        assert.equal(args.Handled, true, 'the context-menu key is consumed');
        const point = openedFixedPoint(tree);
        assert.ok(point !== undefined, 'the menu opened (fixedPoint was set)');
        assert.ok(point!.y > 0,
            'row-anchored: y is the realized row\'s bottom edge, not the host\'s own (0,0) origin');
    });

    test('no Anchor (nothing selected/focused) falls back to the host origin — no crash, no stale position', () =>
    {
        const { hierarchy } = fullHostVm();
        const root = hierarchy.NewItem('n', { Caption: 'root' });
        hierarchy.Roots.Add(root);

        const tree = buildTreeView(hierarchy, '', DEFAULT_BUNDLE_BODY);
        mount(tree);
        // Deliberately no SelectSingle — Hierarchy.Anchor stays undefined.

        const args = pressContextMenuKey(tree);

        assert.equal(args.Handled, true, 'the context-menu key is still consumed with no anchor');
        assert.deepEqual(openedFixedPoint(tree), { x: 0, y: 0 },
            'falls back to the host origin exactly as before this fix, rather than throwing');
    });
});
