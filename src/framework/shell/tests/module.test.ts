import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ShellModule, Capability } from '../module.js';
import {
    Application,
    HostKind,
    ServiceKey,
    ServiceProvider,
    ServiceLifetime,
} from '../../../runtime/index.js';

describe('ShellModule / Capability', () => {
    test('Capability holds Name and a ServiceKey naming its content service', () => {
        const cap = new Capability();
        cap.Name = 'Shapes';
        const key = new ServiceKey<unknown>('ShapesService');
        cap.ServiceKey = key;
        assert.equal(cap.Name, 'Shapes');
        assert.equal(cap.ServiceKey, key);
    });

    test('ShellModule.AddChild routes declarative children into Capabilities', () => {
        // Mirrors the compiler's `list` content slot: `ShellModule { Capability … }`
        // emits `_module.AddChild(_capability)`.
        const mod = new ShellModule();
        mod.Name = 'Diagram';
        const a = new Capability(); a.Name = 'Shapes';
        const b = new Capability(); b.Name = 'Layers';
        mod.AddChild(a);
        mod.AddChild(b);

        assert.equal(mod.Name, 'Diagram');
        assert.equal(mod.Capabilities.Count, 2);
        assert.equal(mod.Capabilities.Get(0), a);
        assert.equal(mod.Capabilities.Get(1), b);
    });

    test('satisfies the runtime IShellModule / ICapability contracts', () => {
        // Structural check: Name + an iterable capability list, each with a Name.
        const mod = new ShellModule();
        mod.Name = 'M';
        const cap = new Capability(); cap.Name = 'C';
        mod.AddChild(cap);
        const names = [...mod.Capabilities].map(c => c.Name);
        assert.deepEqual(names, ['C']);
    });
});

describe('ShellModule targets', () => {
    test('defaults to universal (empty targets)', () => {
        const mod = new ShellModule();
        assert.equal(mod.Targets.size, 0);
    });

    test('AddTarget records host kinds the module composes for', () => {
        const Desktop = new HostKind('desktop');
        const Web = new HostKind('web');
        const mod = new ShellModule();
        mod.AddTarget(Desktop);
        mod.AddTarget(Web);
        assert.equal(mod.Targets.size, 2);
        assert.equal(mod.Targets.has(Desktop), true);
        assert.equal(mod.Targets.has(Web), true);
    });
});

describe('module resources merge into Application.Resources', () => {
    function moduleWith(key: string, value: unknown): ShellModule {
        const mod = new ShellModule();
        mod.Resources.Set(key, value);
        return mod;
    }

    test('adding a module merges its dictionary app-global', () => {
        const app = new Application();
        assert.equal(app.Resources.Resolve('@ModIcon'), undefined);

        app.Modules.Add(moduleWith('@ModIcon', 'geom'));
        assert.equal(app.Resources.Resolve('@ModIcon'), 'geom');
    });

    test('removing a module unmerges its dictionary', () => {
        const app = new Application();
        const mod = moduleWith('@ModIcon', 'geom');
        app.Modules.Add(mod);
        assert.equal(app.Resources.Resolve('@ModIcon'), 'geom');

        app.Modules.Remove(mod);
        assert.equal(app.Resources.Resolve('@ModIcon'), undefined);
    });

    test('clearing modules unmerges every module dictionary', () => {
        const app = new Application();
        app.Modules.Add(moduleWith('@A', 1));
        app.Modules.Add(moduleWith('@B', 2));
        assert.equal(app.Resources.Resolve('@A'), 1);
        assert.equal(app.Resources.Resolve('@B'), 2);

        app.Modules.Clear();
        assert.equal(app.Resources.Resolve('@A'), undefined);
        assert.equal(app.Resources.Resolve('@B'), undefined);
    });

    test('leaves non-module (theme) dictionaries in Resources untouched', () => {
        const app = new Application();
        app.Resources.Set('@ThemeToken', 'brand');   // stands in for a theme merge
        const mod = moduleWith('@ModIcon', 'geom');

        app.Modules.Add(mod);
        app.Modules.Remove(mod);

        // Module churn must not disturb resources the app owns directly.
        assert.equal(app.Resources.Resolve('@ThemeToken'), 'brand');
        assert.equal(app.Resources.Resolve('@ModIcon'), undefined);
    });
});

describe('module service registration', () => {
    test('RegisterServices replays recorded registrations into a container', () => {
        const mod = new ShellModule();
        const key = new ServiceKey<{ tag: string }>('Foo');
        mod.AddRegistration(key, () => ({ tag: 'foo' }), ServiceLifetime.Singleton);
        assert.equal(mod.HasServiceRegistrations, true);

        const sp = new ServiceProvider();
        mod.RegisterServices(sp);
        assert.deepEqual(sp.get(key), { tag: 'foo' });
    });

    test('a module that declares no services is a no-op (HasServiceRegistrations=false)', () => {
        const mod = new ShellModule();
        assert.equal(mod.HasServiceRegistrations, false);
        const sp = new ServiceProvider();
        mod.RegisterServices(sp);                 // no throw, registers nothing
        assert.equal(sp.has(new ServiceKey('x')), false);
    });

    test('adding a module composes its services into Application.Services — a singleton shared down the scope tree', () => {
        const app = new Application();
        const key = new ServiceKey<{ n: number }>('Shapes');
        const mod = new ShellModule();
        let builds = 0;
        mod.AddRegistration(key, () => ({ n: ++builds }), ServiceLifetime.Singleton);

        app.Modules.Add(mod);

        const atRoot  = app.Services.get(key);
        const inScope = app.Services.createScope().get(key);
        assert.deepEqual(atRoot, { n: 1 });
        assert.equal(inScope, atRoot);            // same instance across shell scopes
        assert.equal(builds, 1);
    });

    test('a Capability ServiceKey resolves the service its module registered', () => {
        const app = new Application();
        const key = new ServiceKey<{ id: string }>('ShapesService');
        const mod = new ShellModule();
        mod.AddRegistration(key, () => ({ id: 'shapes' }), ServiceLifetime.Singleton);
        const cap = new Capability();
        cap.Name = 'Shapes';
        cap.ServiceKey = key;                     // the capability → service mapping
        mod.AddChild(cap);

        app.Modules.Add(mod);

        // The mapping the shell uses: resolve the capability's ServiceKey.
        assert.deepEqual(app.Services.get(cap.ServiceKey!), { id: 'shapes' });
    });

    test('registration is one-shot per module — re-firing the Modules subscription does not rebuild', () => {
        const app = new Application();
        const key = new ServiceKey<object>('S');
        const mod = new ShellModule();
        let builds = 0;
        mod.AddRegistration(key, () => { builds++; return {}; }, ServiceLifetime.Singleton);

        app.Modules.Add(mod);
        app.Services.get(key);                    // realize the singleton
        app.Modules.Add(new ShellModule());       // fires the subscription again
        app.Services.get(key);
        assert.equal(builds, 1);
    });
});
