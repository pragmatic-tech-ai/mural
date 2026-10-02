import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import {
    Key,
    KeyEventArgs,
    ModifierKeys,
    NoModifiers,
    Panel,
    PointerButton,
    RelayCommand,
    ServiceKey,
    ServiceProvider,
    type ICommand,
    type PointerEventInit,
} from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { InputManager } from '../../../framework/index.js';
import { ContextMenuService } from '../../menu/context-menu.js';
import { HierarchyContextMenu, HierarchyContextMenuBehavior } from '../hierarchy-context-menu.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContext } from '../hierarchy-context.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { IHierarchyItemHost } from '../hierarchy-item.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import type { CommandContext } from '../../shell/commands/command-context.js';
import { CommandViewModel } from '../../shell/commands/command-view-model.js';

// Task 10 — HierarchyContextMenu + HierarchyContextMenuBehavior.
//
// Mirrors the CommandContextMenu lifecycle harness
// (../../menu/tests/command-context-menu-lifecycle.test.ts) but drives the
// menu through a REAL Hierarchy's contributed actions (the Task 4
// HierarchyItem.BuildActions → Hierarchy.BuildActions path exercised in
// hierarchy-actions.test.ts) rather than a fixed CommandDefinition root list.

class Root extends Panel {}

function noopHost(): IHierarchyItemHost
{
    return { Activate: () => {}, CommitRename: () => {}, OnItemRemoved: () => {} };
}

function spec(key: string, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: {}, Caption: caption, IsExpandable: false };
}

function action(id: string, title: string, key: string, order: number): CommandDefinition
{
    const def = new CommandDefinition();
    def.Id = id; def.Title = title; def.Context = HierarchyContext.For(key); def.Order = order;
    return def;
}

function rightClick(): PointerEventInit
{
    return {
        HostX: 50, HostY: 30,
        Button: PointerButton.Secondary, Buttons: 2,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
    };
}

// Two sibling contributors under 'solution': 'project' (actions Rename +
// Build, Build carrying a declared submenu child — Review Focus 1) and
// 'folder' (action Delete) — distinct Key ⇒ distinct action set, so
// switching the live selection between them is an observable difference in
// BuildActions' output, not just a different VM identity.
function setup(): { hierarchy: Hierarchy; executed: string[] }
{
    const executed: string[] = [];
    const sp = new ServiceProvider();

    const kProj = new ServiceKey<IHierarchyContributor>('proj');
    const proj: IHierarchyContributor = {
        ParentKeys: ['solution'],
        Order: 0,
        Contribute: () => new NodeContribution([spec('project', 'MyProj')]),
        Resolve: (id: string, _c: CommandContext): ICommand | undefined => new RelayCommand(() => executed.push(id)),
    };
    sp.registerInstance(kProj, proj);

    const kFolder = new ServiceKey<IHierarchyContributor>('folder-contributor');
    const folder: IHierarchyContributor = {
        ParentKeys: ['solution'],
        Order: 1,
        Contribute: () => new NodeContribution([spec('folder', 'MyFolder')]),
        Resolve: (id: string, _c: CommandContext): ICommand | undefined => new RelayCommand(() => executed.push(id)),
    };
    sp.registerInstance(kFolder, folder);

    const registry = new HierarchyContributorRegistry(sp);

    const build = action('build', 'Build', 'project', 20);
    build.AddChild(action('build.verbose', 'Verbose', 'project', 0));

    const projDef = new HierarchyContributorDefinition();
    projDef.ParentKeys = ['solution']; projDef.Contributor = kProj; projDef.Order = 0;
    projDef.Actions = [action('rename', 'Rename', 'project', 10), build];
    registry.Register(projDef);

    const folderDef = new HierarchyContributorDefinition();
    folderDef.ParentKeys = ['solution']; folderDef.Contributor = kFolder; folderDef.Order = 1;
    folderDef.Actions = [action('delete', 'Delete', 'folder', 10)];
    registry.Register(folderDef);

    const hierarchy = new Hierarchy(registry, noopHost(), { Services: new ServiceProvider() });
    return { hierarchy, executed };
}

// Builds a Root host with a HierarchyContextMenuBehavior already attached
// (so the menu is created + registered via ContextMenuService before the
// first open) and returns the menu + its internal `built` array.
interface ContextMenuInternals { built: CommandViewModel[] }

function buildHost(hierarchy: Hierarchy): { target: HeadlessTarget; root: Root; menu: HierarchyContextMenu; internals: ContextMenuInternals }
{
    const target = new HeadlessTarget(400, 300);
    const root = new Root();
    target.Content = root;

    const behavior = new HierarchyContextMenuBehavior();
    behavior.Hierarchy = hierarchy;
    root.AddBehavior(behavior);

    const menu = ContextMenuService.GetContextMenu(root) as HierarchyContextMenu;
    return { target, root, menu, internals: menu as unknown as ContextMenuInternals };
}

describe('HierarchyContextMenu — per-open BuildActions / dispose-on-close', () =>
{
    beforeEach(() => { initTestApp(); });

    test('opening the menu twice yields distinct CommandViewModel instances that reflect the current selection\'s actions', () =>
    {
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const [project, folder] = hierarchy.Roots.ToArray();
        const { target, root, menu, internals } = buildHost(hierarchy);
        const im = new InputManager();

        // Open #1 — anchored on 'project': Rename + Build.
        hierarchy.SelectSingle(project!);
        im.InjectPointerDown(root, rightClick());
        target.Flush();
        assert.equal(menu.IsOpen, true, 'precondition: menu open');
        const firstOpenVms = [...internals.built];
        assert.deepEqual(firstOpenVms.map(vm => vm.Title), ['Rename', 'Build']);

        menu.IsOpen = false;
        target.Flush();

        // Open #2 — same anchor, same selection: a fresh build still mints
        // NEW instances (no retained state across opens), per DR9.
        hierarchy.SelectSingle(project!);
        im.InjectPointerDown(root, rightClick());
        target.Flush();
        const secondOpenSameAnchor = [...internals.built];
        assert.deepEqual(secondOpenSameAnchor.map(vm => vm.Title), ['Rename', 'Build']);
        for (const vm of firstOpenVms) assert.ok(!secondOpenSameAnchor.includes(vm), 'distinct VM instances across opens with the same selection');

        menu.IsOpen = false;
        target.Flush();

        // Open #3 — selection changed to 'folder': the menu reflects the NEW
        // live selection, not whatever was built for 'project'.
        hierarchy.SelectSingle(folder!);
        im.InjectPointerDown(root, rightClick());
        target.Flush();
        const thirdOpenNewAnchor = [...internals.built];
        assert.deepEqual(thirdOpenNewAnchor.map(vm => vm.Title), ['Delete'],
            'opening over a different selection builds that selection\'s own actions');
        for (const vm of [...firstOpenVms, ...secondOpenSameAnchor]) assert.ok(!thirdOpenNewAnchor.includes(vm));
    });

    test('close disposes every built VM; repeated open/close cycles release the rendered row\'s IsChecked subscription back to baseline', () =>
    {
        // HONEST leak signal, same reasoning as CommandContextMenu's own
        // disposal test: the real shipped @CommandMenuItemTemplate wires
        // `IsChecked = $IsChecked` (a DataContextBinding) on every rendered
        // row regardless of whether the row is a toggle, subscribing to
        // CommandViewModel.PropertyChanged('IsChecked') for as long as the
        // container's DataContext stays pinned to that VM. TearDown clearing
        // the container's DataContext (MenuContainerFactory.ClearContainer)
        // is what lets that subscription release; the Signal's
        // subscriberCount returning to 0 after every close is the
        // measurable proof nothing leaks across repeated opens.
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const [project] = hierarchy.Roots.ToArray();
        hierarchy.SelectSingle(project!);
        const { target, root, menu, internals } = buildHost(hierarchy);
        const im = new InputManager();

        const N = 3;
        for (let cycle = 0; cycle < N; cycle++)
        {
            im.InjectPointerDown(root, rightClick());
            target.Flush();
            assert.equal(internals.built.length, 2, `cycle ${cycle}: built has Rename + Build`);

            const vm = internals.built[0]!;
            const signal = vm.PropertyChanged('IsChecked');
            assert.equal(signal.subscriberCount, 1, `cycle ${cycle}: the rendered row's IsChecked binding subscribed`);

            menu.IsOpen = false;
            target.Flush();
            assert.equal(internals.built.length, 0, `cycle ${cycle}: built cleared after close`);
            assert.equal(menu.ItemsSource, undefined, `cycle ${cycle}: ItemsSource cleared after close`);
            assert.equal(signal.subscriberCount, 0, `cycle ${cycle}: closing released the subscription back to baseline`);
        }
    });

    test('a submenu with declared Children populates on submenu-open and disposes those children on menu close (Review Focus 1)', () =>
    {
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const [project] = hierarchy.Roots.ToArray();
        hierarchy.SelectSingle(project!);
        const { target, root, menu, internals } = buildHost(hierarchy);
        const im = new InputManager();

        im.InjectPointerDown(root, rightClick());
        target.Flush();

        const buildVm = internals.built.find(vm => vm.Title === 'Build')!;
        assert.equal(buildVm.Children.Count, 0, 'precondition: submenu not yet realized');

        buildVm.EnsureExpanded();
        assert.equal(buildVm.Children.Count, 1, 'submenu-open realized the declared child');
        const childVm = buildVm.Children.ToArray()[0]!;
        assert.equal(childVm.Definition.Id, 'build.verbose');

        let childDisposed = false;
        const originalDispose = childVm.dispose.bind(childVm);
        childVm.dispose = (): void => { childDisposed = true; originalDispose(); };

        menu.IsOpen = false;
        target.Flush();

        assert.equal(childDisposed, true, 'closing the menu disposed the realized submenu child too (recursive TearDown)');
        assert.equal(buildVm.Children.Count, 0, 'the recursive dispose cleared the submenu Children collection');
    });

    test('the context-menu keyboard key opens the menu through the SAME BuildActions path as right-click (Review Focus 2)', () =>
    {
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const [project] = hierarchy.Roots.ToArray();
        hierarchy.SelectSingle(project!);
        const { target, root, menu, internals } = buildHost(hierarchy);

        // The right-click path's expected content, captured independently so
        // the keyboard assertion below isn't just re-deriving the same call.
        const im = new InputManager();
        im.InjectPointerDown(root, rightClick());
        target.Flush();
        const viaPointer = internals.built.map(vm => vm.Title);
        menu.IsOpen = false;
        target.Flush();

        assert.equal(menu.IsOpen, false, 'precondition: closed before the keyboard gesture');
        const keyArgs = new KeyEventArgs('KeyDown', root, {
            Key: Key.Apps, KeyText: 'ContextMenu', Code: 'ContextMenu', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        root.FireRoutedListeners('KeyDown', keyArgs);
        target.Flush();

        assert.equal(keyArgs.Handled, true, 'the context-menu key is consumed');
        assert.equal(menu.IsOpen, true, 'keyboard invocation opened the menu');
        assert.deepEqual(internals.built.map(vm => vm.Title), viaPointer,
            'keyboard open built the identical action set the right-click path built, through BuildActions');
    });

    test('a key other than the dedicated context-menu key is left unhandled', () =>
    {
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const [project] = hierarchy.Roots.ToArray();
        hierarchy.SelectSingle(project!);
        const { root, menu } = buildHost(hierarchy);

        const keyArgs = new KeyEventArgs('KeyDown', root, {
            Key: Key.F2, KeyText: 'F2', Code: 'F2', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        root.FireRoutedListeners('KeyDown', keyArgs);

        assert.equal(keyArgs.Handled, false);
        assert.equal(menu.IsOpen, false);
    });

    test('OnDetached removes the attached ContextMenu', () =>
    {
        const { hierarchy } = setup();
        hierarchy.SeedRoot('solution');
        const target = new HeadlessTarget(400, 300);
        const root = new Root();
        target.Content = root;

        const behavior = new HierarchyContextMenuBehavior();
        behavior.Hierarchy = hierarchy;
        root.AddBehavior(behavior);
        assert.notEqual(ContextMenuService.GetContextMenu(root), undefined, 'precondition: menu attached');

        root.RemoveBehavior(behavior);
        assert.equal(ContextMenuService.GetContextMenu(root), undefined, 'OnDetached detaches the ContextMenu');

        const keyArgs = new KeyEventArgs('KeyDown', root, {
            Key: Key.Apps, KeyText: 'ContextMenu', Code: 'ContextMenu', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        root.FireRoutedListeners('KeyDown', keyArgs);
        assert.equal(keyArgs.Handled, false, 'the keyboard listener no longer fires after detach');
    });
});
