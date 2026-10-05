import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import {
    Binding,
    NoModifiers,
    Panel,
    PointerButton,
    RelayCommand,
    type ICommand,
    type IServiceProvider,
    type PointerEventInit,
    type ServiceToken,
} from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { HeadlessTarget, Visual } from '../../../visual-engine/index.js';
import { HierarchicalDataTemplate } from '../../../basic/index.js';
import { ContextMenu } from '../context-menu.js';
import { MenuItem } from '../menu-strip.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import { CommandContext } from '../../shell/commands/command-context.js';
import { CommandViewModel } from '../../shell/commands/command-view-model.js';
import { CommandMenuBuilder } from '../../shell/commands/command-menu-builder.js';
import type { ICommandDispatcher } from '../../shell/commands/command-dispatcher.js';

class Root extends Panel {}

// A dispatcher that mints a fresh RelayCommand per id — mirrors the live
// dispatcher's "resolve a command bound to the active document" shape.
class FakeDispatcher implements ICommandDispatcher
{
    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        return new RelayCommand(() => {}, () => true, { Text: commandId });
    }
}

// No ChildrenContributor in this tree, so the provider is never consulted.
class FakeProvider implements IServiceProvider
{
    public get<T>(_token: ServiceToken<T>): T | undefined { return undefined; }
    public getRequired<T>(_token: ServiceToken<T>): T { throw new Error('not used'); }
    public has(_token: ServiceToken<unknown>): boolean { return false; }
}

// Recursively collect every MenuItem in a visual subtree (copied from the
// ContextMenu harness).
function findMenuItems(v: Visual, out: MenuItem[] = []): MenuItem[]
{
    if (v instanceof MenuItem) out.push(v);
    for (const c of (v as unknown as { visualChildren: Visual[] }).visualChildren ?? [])
        findMenuItems(c, out);
    return out;
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

// The keyed hierarchical template the shell authors in `.mu` as
// `CommandMenuItemTemplate`, reconstructed in TS the way the TreeView tests do
// (tree-view.test.ts:429): a factory that produces the per-item MenuItem plus a
// child-selector over the live Children collection. $Title / $Command bind by
// read; $IsChecked binds reactively so a VM toggle flips the rendered row.
function commandMenuItemTemplate(): HierarchicalDataTemplate
{
    return new HierarchicalDataTemplate(
        (d) =>
        {
            const vm = d as CommandViewModel;
            const mi = new MenuItem();
            mi.Header      = vm.Title;
            mi.Command     = vm.Command;
            mi.IsCheckable = vm.IsToggle;
            // Reactive binding — proves the rendered row tracks the VM's INPC.
            mi.set_property_value(MenuItem.IsCheckedKey, new Binding(vm as unknown as never, 'IsChecked'));
            return mi;
        },
        (d) => (d as CommandViewModel).Children,
        undefined,
        undefined,
        CommandViewModel,
    );
}

function def(id: string, title: string): CommandDefinition
{
    const d = new CommandDefinition();
    d.Id = id;
    d.Title = title;
    return d;
}

describe('Menu family renders a CommandViewModel tree via HierarchicalDataTemplate', () =>
{
    beforeEach(() => { initTestApp(); });

    function openMenu(cm: ContextMenu, root: Root): HeadlessTarget
    {
        const target = new HeadlessTarget(400, 300);
        target.Content = root;
        root.ContextMenu = cm;
        const im = new InputManager();
        im.InjectPointerDown(root, rightClick());
        target.Flush();
        return target;
    }

    test('a top MenuItem renders with Header = VM Title and Command = VM command', () =>
    {
        const root = new Root();
        const dispatcher = new FakeDispatcher();
        const builder = new CommandMenuBuilder(dispatcher, new FakeProvider(), new CommandContext());

        const fileDef = def('file', 'File');
        fileDef.AddChild(def('file.new', 'New'));
        fileDef.AddChild(def('file.open', 'Open'));
        const fileVm = builder.Build(fileDef);

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [fileVm] as unknown as never;

        openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const topMi = gen.ContainerFromItem(fileVm);
        assert.ok(topMi instanceof MenuItem, 'top container is a MenuItem (not a ContentPresenter)');
        assert.equal(topMi.Header, 'File', 'Header reflects the VM Title');
        assert.equal(topMi.Command, fileVm.Command, 'Command is the VM command');
    });

    test('opening a parent submenu fires OnSubmenuOpen → EnsureExpanded, realizing child MenuItems', () =>
    {
        const root = new Root();
        const builder = new CommandMenuBuilder(new FakeDispatcher(), new FakeProvider(), new CommandContext());

        const fileDef = def('file', 'File');
        fileDef.AddChild(def('file.new', 'New'));
        fileDef.AddChild(def('file.open', 'Open'));
        const fileVm = builder.Build(fileDef);

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [fileVm] as unknown as never;

        const target = openMenu(cm, root);

        // Lazily populated — children are not realized before the submenu opens.
        assert.equal(fileVm.Children.Count, 0, 'children unrealized before submenu open');

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const topMi = gen.ContainerFromItem(fileVm) as MenuItem;

        topMi.IsSubmenuOpen = true;   // the submenu-open hook → OnSubmenuOpen → EnsureExpanded
        target.Flush();

        assert.equal(fileVm.Children.Count, 2, 'EnsureExpanded populated Children on submenu open');

        const childVms = fileVm.Children.ToArray();
        const childGen = (topMi as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const newMi = childGen.ContainerFromItem(childVms[0]);
        assert.ok(newMi instanceof MenuItem, 'child container is a MenuItem');
        assert.equal(newMi.Header, 'New', 'child MenuItem shows the child Title');

        // The recursive findMenuItems helper also sees the realized child rows.
        // The submenu popup is mounted on the overlay (detached from topMi), so
        // walk its popup container — where the child rows actually render.
        const popup = (topMi as unknown as { _popupContainer?: Visual })._popupContainer;
        assert.ok(popup !== undefined, 'submenu popup container resolved');
        const realized = findMenuItems(popup).map(m => m.Header);
        assert.ok(realized.includes('New') && realized.includes('Open'),
            `submenu rows realized, got ${JSON.stringify(realized)}`);
    });

    test('a REAL click (activate()) opens an unrealized parent\'s submenu — not gated on the pre-expand empty itemCount()', () =>
    {
        // Regression: MenuItem.activate() / OnPointerEnter / OnKeyDown used to
        // gate "is this a submenu parent" on itemCount() (this.Items.Count), but
        // a HierarchicalDataTemplate-bound CommandViewModel's ItemsSource is set
        // to its (still-empty, lazy) Children at container-prepare time —
        // itemCount() reads 0 until EnsureExpanded has already run, and nothing
        // but IsSubmenuOpen=true ever runs it. A real click could therefore never
        // open a not-yet-expanded command submenu: activate() fell through to the
        // leaf branch and executed/closed instead. The fix reads the bound data's
        // own HasChildren (CommandViewModel.HasChildren) as a fallback.
        const root = new Root();
        const builder = new CommandMenuBuilder(new FakeDispatcher(), new FakeProvider(), new CommandContext());

        const fileDef = def('file', 'File');
        fileDef.AddChild(def('file.new', 'New'));
        const fileVm = builder.Build(fileDef);

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [fileVm] as unknown as never;

        openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const topMi = gen.ContainerFromItem(fileVm) as MenuItem;

        assert.equal(fileVm.Children.Count, 0, 'precondition: unrealized before any interaction');

        (topMi as unknown as { activate(): void }).activate();

        assert.equal(topMi.IsSubmenuOpen, true,
            'activate() opened the submenu even though itemCount() was 0 pre-expand');
        assert.equal(fileVm.Children.Count, 1, 'EnsureExpanded ran as a side effect of the real click');
    });

    test('hovering a data-driven sibling closes the previously-open submenu (regression: HierarchicalDataTemplate menus)', () =>
    {
        // The reported bug: in a data-driven context menu (ItemsSource of
        // CommandViewModels, rendered through HierarchicalDataTemplate), opening one
        // parent's flyout and then moving onto a different parent left BOTH submenus
        // open. closeSiblingSubmenus only walked the owner's logical Items — which for
        // a data-driven menu hold the view-models, never MenuItem — so no sibling was
        // ever closed. It must also walk the generated containers in the visual panel.
        const root = new Root();
        const builder = new CommandMenuBuilder(new FakeDispatcher(), new FakeProvider(), new CommandContext());

        const aDef = def('a', 'Run Agent / Skill'); aDef.AddChild(def('a.x', 'graphify'));
        const bDef = def('b', 'Build'); bDef.AddChild(def('b.x', 'Debug'));
        const aVm = builder.Build(aDef);
        const bVm = builder.Build(bDef);

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [aVm, bVm] as unknown as never;

        const target = openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const aMi = gen.ContainerFromItem(aVm) as MenuItem;
        const bMi = gen.ContainerFromItem(bVm) as MenuItem;

        aMi.IsSubmenuOpen = true;
        target.Flush();
        assert.equal(aMi.IsSubmenuOpen, true, 'precondition: A (data-driven) submenu open');

        // Move onto sibling B — the generated container, not a declarative MenuItem.
        (bMi as unknown as { OnPointerEnter(x: unknown): void }).OnPointerEnter({});

        assert.equal(aMi.IsSubmenuOpen, false, 'hovering data-driven sibling B closed A\'s open submenu');
    });

    test('a toggle VM renders a checkable, checked MenuItem', () =>
    {
        const root = new Root();
        const dispatcher = new FakeDispatcher();

        const toggleVm = new CommandViewModel(def('bold', 'Bold'), dispatcher.Resolve('bold', new CommandContext())!, true);
        toggleVm.IsChecked = true;

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [toggleVm] as unknown as never;

        openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const toggleMi = gen.ContainerFromItem(toggleVm);
        assert.ok(toggleMi instanceof MenuItem, 'toggle container is a MenuItem');
        assert.equal(toggleMi.IsCheckable, true, 'IsCheckable reflects IsToggle');
        assert.equal(toggleMi.IsChecked, true, 'IsChecked reflects the VM');
    });

    test('ClearContainerForItemOverride nulls a generated MenuItem container state', () =>
    {
        const root = new Root();
        const builder = new CommandMenuBuilder(new FakeDispatcher(), new FakeProvider(), new CommandContext());

        const fileDef = def('file', 'File');
        fileDef.AddChild(def('file.new', 'New'));
        const fileVm = builder.Build(fileDef);

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [fileVm] as unknown as never;

        openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const topMi = gen.ContainerFromItem(fileVm) as MenuItem;
        assert.equal(topMi.DataContext, fileVm, 'precondition: DataContext pinned to the VM');
        assert.notEqual(topMi.ItemsSource, undefined, 'precondition: child ItemsSource wired');

        // Clearing a container the factory generated must undo the DataContext +
        // ItemsSource it set (so a long-lived VM doesn't leak through a recycled row).
        cm.ClearContainerForItemOverride(topMi, fileVm);
        assert.equal(topMi.DataContext, undefined, 'DataContext nulled on clear');
        assert.equal(topMi.ItemsSource, undefined, 'ItemsSource nulled on clear');
    });

    test('flipping the VM IsChecked updates the rendered MenuItem.IsChecked (Observable binding)', () =>
    {
        const root = new Root();
        const dispatcher = new FakeDispatcher();

        const toggleVm = new CommandViewModel(def('bold', 'Bold'), dispatcher.Resolve('bold', new CommandContext())!, true);
        toggleVm.IsChecked = true;

        const cm = new ContextMenu();
        cm.ItemTemplate = commandMenuItemTemplate();
        cm.ItemsSource = [toggleVm] as unknown as never;

        const target = openMenu(cm, root);

        const gen = (cm as unknown as { Generator: { ContainerFromItem(i: unknown): Visual | undefined } }).Generator;
        const toggleMi = gen.ContainerFromItem(toggleVm) as MenuItem;
        assert.equal(toggleMi.IsChecked, true, 'precondition: checked');

        toggleVm.IsChecked = false;
        target.Flush();

        assert.equal(toggleMi.IsChecked, false, 'rendered row tracked the VM toggle');
    });
});
