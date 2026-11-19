import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import {
    Application,
    DataContextBinding,
    MetaData,
    MuralBase,
    NoModifiers,
    Panel,
    PointerButton,
    ServiceBinding,
    ServiceProvider,
    type PointerEventInit,
} from '../../runtime/index.js';
import { InputManager } from '../index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { ContextMenu } from '../menu/context-menu.js';
import { MenuItem } from '../menu/menu-strip.js';
import { PanelDockService } from '../shell/services/panel-dock-service.js';
import { BoardInspector } from '../board/board-inspector.js';

// A stand-in for BoardDocument: carries an `Inspector` DP the menu's
// CommandParameter binds ($Inspector), like BoardDocument.Inspector.
class FakeDoc extends MuralBase
{
    public static readonly InspectorKey = MuralBase.RegisterProperty<BoardInspector>(
        FakeDoc, 'Inspector', undefined as unknown as BoardInspector, MetaData.None);
    constructor() { super(); this.set_property_value(FakeDoc.InspectorKey, new BoardInspector()); }
    public get Inspector(): BoardInspector { return this.get_property_value(FakeDoc.InspectorKey); }
}

class Root extends Panel {}

function rightClick(): PointerEventInit
{
    return {
        HostX: 50, HostY: 30,
        Button: PointerButton.Secondary, Buttons: 2,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
    };
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// Reproduces the Plexus wiring: a host (the Board) with an inherited
// ServiceScope + a BoardDocument DataContext, an attached ContextMenu whose
// "Format Shape" item binds Command=$service(PanelDockService).AddPanelCommand
// and CommandParameter=$Inspector. Verifies both bindings resolve THROUGH the
// overlay-mounted menu to the shell-scoped service + the document's inspector.
describe('Inspector — Format Shape context menu resolves through the overlay', () =>
{
    beforeEach(() => { initTestApp(); });

    test('the menu item adds the document inspector to the SCOPED PanelDockService', async () =>
    {
        // A child scope registering PanelDockService scoped — the shell shape.
        const scope = Application.current.Services.createScope();
        scope.registerScoped(PanelDockService.Key, (p) => new PanelDockService(p));
        const svc = scope.get(PanelDockService.Key)!;

        const target = new HeadlessTarget(400, 300);
        const root = new Root();
        target.Content = root;

        // Host publishes the scope + the document, like the shell + Board.
        root.ServiceScope = scope;
        const doc = new FakeDoc();
        root.DataContext = doc;

        const cm = new ContextMenu();
        const mi = new MenuItem();
        mi.Header = 'Format Shape';
        mi.set_property_value(
            MenuItem.CommandKey,
            ServiceBinding(mi, ServiceProvider.tokenFor(PanelDockService), 'AddPanelCommand') as never);
        mi.set_property_value(
            MenuItem.CommandParameterKey,
            DataContextBinding(mi, 'Inspector') as never);
        cm.Items = [mi];
        root.ContextMenu = cm;

        const im = new InputManager();
        im.InjectPointerDown(root, rightClick());
        assert.equal(cm.IsOpen, true, 'menu opened');
        await settle();

        // Diagnosis: did the bindings resolve through the overlay?
        assert.equal(mi.CommandParameter, doc.Inspector, '$Inspector resolved to the document inspector');
        assert.equal(mi.Command, svc.AddPanelCommand, '$service resolved to the scoped PanelDockService');

        // Fire it as MenuItem activation would.
        mi.Command!.Execute(mi.CommandParameter);
        assert.equal(svc.Panels.Count, 1, 'inspector added to the region-bound service');
        assert.equal(svc.Panels.Get(0), doc.Inspector, 'the exact document inspector');
    });

    // The REAL shell condition: the host (Board) does NOT own a local
    // ServiceScope — it INHERITS one from an ancestor (the shell). DataContext,
    // by contrast, is a local value on the host (set by its DataTemplate). This
    // reproduces the reported failure if overlay children only pick up the host's
    // LOCAL inherited-DP values, not its effective (walked-up) ones.
    test('resolves when ServiceScope is INHERITED by the host (not local)', async () =>
    {
        const scope = Application.current.Services.createScope();
        scope.registerScoped(PanelDockService.Key, (p) => new PanelDockService(p));
        const svc = scope.get(PanelDockService.Key)!;

        const target = new HeadlessTarget(400, 300);
        const outer = new Root();
        target.Content = outer;
        // Scope lives on an ANCESTOR — the host inherits it.
        outer.ServiceScope = scope;

        const host = new Root();
        outer.AddChild(host);
        const doc = new FakeDoc();
        host.DataContext = doc;   // DataContext local on the host, like the Board

        const cm = new ContextMenu();
        const mi = new MenuItem();
        mi.Header = 'Format Shape';
        mi.set_property_value(
            MenuItem.CommandKey,
            ServiceBinding(mi, ServiceProvider.tokenFor(PanelDockService), 'AddPanelCommand') as never);
        mi.set_property_value(
            MenuItem.CommandParameterKey,
            DataContextBinding(mi, 'Inspector') as never);
        cm.Items = [mi];
        host.ContextMenu = cm;

        const im = new InputManager();
        im.InjectPointerDown(host, rightClick());
        assert.equal(cm.IsOpen, true, 'menu opened');
        await settle();

        assert.equal(mi.CommandParameter, doc.Inspector, '$Inspector resolved (DataContext is local)');
        assert.equal(mi.Command, svc.AddPanelCommand,
            '$service resolved through the INHERITED ServiceScope');
    });

    // The real activation path: clicking the item runs MenuItem.activate(), which
    // CLOSES the popup (detaching the item, nulling its $service/$path bindings)
    // and THEN invokes the command. Regression for the ordering bug where Command
    // / CommandParameter were read AFTER the close and came back undefined — so
    // the invocation silently dropped even though everything resolved while open.
    test('activating the item (close-then-invoke) still runs the command', async () =>
    {
        const scope = Application.current.Services.createScope();
        scope.registerScoped(PanelDockService.Key, (p) => new PanelDockService(p));
        const svc = scope.get(PanelDockService.Key)!;

        const target = new HeadlessTarget(400, 300);
        const outer = new Root();
        target.Content = outer;
        outer.ServiceScope = scope;
        const host = new Root();
        outer.AddChild(host);
        const doc = new FakeDoc();
        host.DataContext = doc;

        const cm = new ContextMenu();
        const mi = new MenuItem();
        mi.Header = 'Format Shape';
        mi.set_property_value(
            MenuItem.CommandKey,
            ServiceBinding(mi, ServiceProvider.tokenFor(PanelDockService), 'AddPanelCommand') as never);
        mi.set_property_value(
            MenuItem.CommandParameterKey,
            DataContextBinding(mi, 'Inspector') as never);
        cm.Items = [mi];
        host.ContextMenu = cm;

        new InputManager().InjectPointerDown(host, rightClick());
        await settle();

        // Activate exactly as a pointer click / Enter would (the shared path).
        (mi as unknown as { activate(): void }).activate();

        assert.equal(cm.IsOpen, false, 'menu closed on activation');
        assert.equal(svc.Panels.Count, 1, 'command still fired after the close');
        assert.equal(svc.Panels.Get(0), doc.Inspector, 'added the document inspector');
    });
});
