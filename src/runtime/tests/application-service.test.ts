import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    ApplicationService,
    ResourceDictionary,
    type ICapability,
    type IShellModule,
} from '../index.js';

// Minimal IShellModule stand-in — the app service only reads the collection,
// not the module internals, so Name / empty capabilities / a dictionary suffice.
class FakeModule implements IShellModule
{
    public readonly Capabilities: Iterable<ICapability> = [];
    public readonly Resources = new ResourceDictionary();
    constructor(public readonly Name: string) { }
}

describe('ApplicationService — the application self-service', () => {
    test('resolves from the container and fronts the Application instance', () => {
        const app = new Application();
        const svc = app.Services.getRequired(ApplicationService.Key);
        assert.equal(svc.Instance, app);
    });

    test('is a singleton — same instance on every resolve', () => {
        const app = new Application();
        const a = app.Services.getRequired(ApplicationService.Key);
        const b = app.Services.getRequired(ApplicationService.Key);
        assert.equal(a, b);
    });

    test('resolves through a child scope', () => {
        const app = new Application();
        const scope = app.Services.createScope();
        assert.equal(scope.getRequired(ApplicationService.Key).Instance, app);
    });

    test('Modules is the LIVE collection — modules added after resolve are visible', () => {
        const app = new Application();
        const svc = app.Services.getRequired(ApplicationService.Key);   // resolve BEFORE any module
        assert.equal([...svc.Modules].length, 0);

        app.Modules.Add(new FakeModule('Board'));
        app.Modules.Add(new FakeModule('Layers'));

        assert.deepEqual([...svc.Modules].map(m => m.Name), ['Board', 'Layers']);
    });

    test('IsInitialized mirrors the Application lifecycle', () => {
        const app = new Application();
        const svc = app.Services.getRequired(ApplicationService.Key);
        assert.equal(svc.IsInitialized, false);

        app.initialize();   // no theme — just flips the initialized flag
        assert.equal(svc.IsInitialized, true);
    });
});
