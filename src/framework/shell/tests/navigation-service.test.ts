import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ServiceKey, type IServiceProvider } from '../../../runtime/index.js';
import { ShellModule, Capability } from '../module.js';
import {
    NavigationService,
    NavigationDestination,
} from '../services/navigation-service.js';
import type { Geometry } from '../../../visual-engine/index.js';

// A shell's NavigationService opts in to the capability-driven build; the base
// stays type-agnostic and never calls it itself.
class ShellNav extends NavigationService
{
    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }
}

function capability(name: string, icon?: Geometry): Capability
{
    const cap = new Capability();
    cap.Name = name;
    if (icon !== undefined) cap.Icon = icon;
    return cap;
}

function moduleWith(...caps: Capability[]): ShellModule
{
    const mod = new ShellModule();
    for (const c of caps) mod.AddChild(c);
    return mod;
}

describe('NavigationService.PopulateFromModules', () => {
    test('builds a NavigationDestination per capability across every module', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes'), capability('Layers')));
        app.Modules.Add(moduleWith(capability('Outline')));

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        const labels = [...nav.Items].map(i => (i as NavigationDestination).Label);
        assert.deepEqual(labels, ['Shapes', 'Layers', 'Outline']);
    });

    test('a destination carries Label, Icon, and the source Capability back-ref', () => {
        const app = new Application();
        const icon = {} as Geometry;              // identity stand-in for a real Geometry
        const cap = capability('Shapes', icon);
        app.Modules.Add(moduleWith(cap));

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        const dest = nav.Items.Get(0) as NavigationDestination;
        assert.equal(dest.Label, 'Shapes');
        assert.equal(dest.Icon, icon);
        assert.equal(dest.Capability, cap);        // back-ref → its ServiceKey is reachable
    });

    test('is one-shot and owns Items — a rebuild clears the prior destinations', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes')));
        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);
        assert.equal(nav.Items.Count, 1);

        // Second module added after the one-shot build — not reflected until a
        // rebuild (the base is one-shot by design).
        app.Modules.Add(moduleWith(capability('Layers')));
        assert.equal(nav.Items.Count, 1);
    });

    test('base NavigationService stays type-agnostic — no auto-build', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes')));
        // The BASE service, not a subclass that opts in.
        app.Services.register(NavigationService.Key, p => new NavigationService(p));
        const nav = app.Services.getRequired(NavigationService.Key);
        assert.equal(nav.Items.Count, 0);
    });
});

describe('NavigationService.PopulateFromModules — ordering', () => {
    function ordered(name: string, order: number): Capability
    {
        const cap = capability(name);
        cap.Order = order;
        return cap;
    }

    test('honors Capability.Order ascending across modules', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(ordered('A', 30), ordered('B', 10)));
        app.Modules.Add(moduleWith(ordered('C', 20)));

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        const labels = [...nav.Items].map(i => (i as NavigationDestination).Label);
        assert.deepEqual(labels, ['B', 'C', 'A']);
    });

    test('ties keep module × declaration order (stable sort)', () => {
        const app = new Application();
        // No Order set on any capability — all share the default (MAX), so the
        // flattened module × declaration order must survive the sort verbatim.
        app.Modules.Add(moduleWith(capability('Shapes'), capability('Layers')));
        app.Modules.Add(moduleWith(capability('Outline')));

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        const labels = [...nav.Items].map(i => (i as NavigationDestination).Label);
        assert.deepEqual(labels, ['Shapes', 'Layers', 'Outline']);
    });

    test('unset Order falls after explicitly-ordered capabilities, keeping declaration order among the unset', () => {
        const app = new Application();
        // Two unset (default MAX) bracketing one explicitly ordered first.
        app.Modules.Add(moduleWith(capability('Unset1'), ordered('First', 5), capability('Unset2')));

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        const labels = [...nav.Items].map(i => (i as NavigationDestination).Label);
        assert.deepEqual(labels, ['First', 'Unset1', 'Unset2']);
    });
});

describe('NavigationService.ActiveService', () => {
    test('selecting a destination resolves the wrapped capability\'s service', () => {
        const app = new Application();
        const svc = { tag: 'shapes' };
        const key = new ServiceKey<typeof svc>('ShapesService');
        const cap = capability('Shapes');
        cap.ServiceKey = key;
        app.Modules.Add(moduleWith(cap));
        app.Services.registerInstance(key, svc);

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        // PopulateFromModules auto-selects the first destination → resolve fires.
        assert.equal(nav.SelectedItem instanceof NavigationDestination, true);
        assert.equal(nav.ActiveService, svc);
    });

    test('a selected item that IS a Capability resolves directly', () => {
        const app = new Application();
        const svc = { tag: 'layers' };
        const key = new ServiceKey<typeof svc>('LayersService');
        const cap = capability('Layers');
        cap.ServiceKey = key;
        app.Services.registerInstance(key, svc);

        app.Services.register(NavigationService.Key, p => new NavigationService(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        nav.SelectedItem = cap;                 // a raw Capability, not a destination
        assert.equal(nav.ActiveService, svc);
    });

    test('clears to undefined when the capability names no service', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Plain')));   // no ServiceKey
        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);
        assert.equal(nav.ActiveService, undefined);
    });

    test('re-selecting swaps ActiveService to the new capability\'s service', () => {
        const app = new Application();
        const shapesSvc = { tag: 'shapes' };
        const layersSvc = { tag: 'layers' };
        const shapesKey = new ServiceKey<typeof shapesSvc>('Shapes');
        const layersKey = new ServiceKey<typeof layersSvc>('Layers');
        const shapes = capability('Shapes'); shapes.ServiceKey = shapesKey;
        const layers = capability('Layers'); layers.ServiceKey = layersKey;
        app.Modules.Add(moduleWith(shapes, layers));
        app.Services.registerInstance(shapesKey, shapesSvc);
        app.Services.registerInstance(layersKey, layersSvc);

        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        assert.equal(nav.ActiveService, shapesSvc);   // first, auto-selected
        nav.SelectedItem = nav.Items.Get(1);          // the Layers destination
        assert.equal(nav.ActiveService, layersSvc);
    });
});

describe('NavigationService side-pane visibility', () => {
    test('SidePaneVisible defaults to true', () => {
        const app = new Application();
        app.Services.register(NavigationService.Key, p => new NavigationService(p));
        const nav = app.Services.getRequired(NavigationService.Key);
        assert.equal(nav.SidePaneVisible, true);
    });

    test('ToggleSidePaneCommand flips SidePaneVisible each invocation', () => {
        const app = new Application();
        app.Services.register(NavigationService.Key, p => new NavigationService(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        nav.ToggleSidePaneCommand.Execute(undefined);
        assert.equal(nav.SidePaneVisible, false);
        nav.ToggleSidePaneCommand.Execute(undefined);
        assert.equal(nav.SidePaneVisible, true);
    });

    test('changing SelectedItem forces the pane visible (activity-bar reveal)', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes'), capability('Layers')));
        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        // Hide it, then select another destination — selection reveals the pane.
        nav.ToggleSidePaneCommand.Execute(undefined);
        assert.equal(nav.SidePaneVisible, false);
        nav.SelectedItem = nav.Items.Get(1);
        assert.equal(nav.SidePaneVisible, true);
    });

    test('re-clicking the active destination toggles the pane (VSCode sidebar)', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes'), capability('Layers')));
        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        // Shapes is auto-selected + seeded as the toggle anchor, so the first
        // click of its icon hides, the next reopens.
        const shapes = nav.Items.Get(0) as NavigationDestination;
        assert.equal(nav.SidePaneVisible, true);
        shapes.ActivateCommand!.Execute(undefined);
        assert.equal(nav.SidePaneVisible, false);
        shapes.ActivateCommand!.Execute(undefined);
        assert.equal(nav.SidePaneVisible, true);
    });

    test('clicking a different destination reveals without hiding', () => {
        const app = new Application();
        app.Modules.Add(moduleWith(capability('Shapes'), capability('Layers')));
        app.Services.register(NavigationService.Key, p => new ShellNav(p));
        const nav = app.Services.getRequired(NavigationService.Key);

        // Hide via the header ✕, then click the OTHER icon — it comes forward
        // and the pane shows (never toggles off on a switch).
        nav.ToggleSidePaneCommand.Execute(undefined);
        assert.equal(nav.SidePaneVisible, false);
        const layers = nav.Items.Get(1) as NavigationDestination;
        layers.ActivateCommand!.Execute(undefined);
        assert.equal(nav.SidePaneVisible, true);
        // A second click on that now-active icon hides it (re-click toggle).
        layers.ActivateCommand!.Execute(undefined);
        assert.equal(nav.SidePaneVisible, false);
    });
});
