import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, HostKind, ServiceKey, ServiceLifetime } from '../../index.js';
import { ShellModule, Capability } from '../../../framework/shell/module.js';

const Desktop = new HostKind('desktop');
const Web     = new HostKind('web');

function serviceModule(id: string, targets: HostKind[]): { mod: ShellModule; key: ServiceKey<{ id: string }> }
{
    const mod = new ShellModule();
    mod.Name = id;
    for (const t of targets) mod.AddTarget(t);
    const key = new ServiceKey<{ id: string }>(id);
    mod.AddRegistration(key, () => ({ id }), ServiceLifetime.Singleton);
    const cap = new Capability();
    cap.Name = id;
    mod.AddChild(cap);
    return { mod, key };
}

describe('Application host-kind composition', () => {
    test('AddModule composes an admitted module (its services + capability appear)', () => {
        const app = new Application(Desktop);
        const { mod, key } = serviceModule('diagram', [Desktop, Web]);
        app.AddModule(mod);
        assert.deepEqual(app.Services.get(key), { id: 'diagram' });
        assert.equal(app.Modules.Count, 1);
    });

    test('AddModule skips a module the host does not admit', () => {
        const app = new Application(Web);
        const { mod, key } = serviceModule('desktopOnly', [Desktop]);
        app.AddModule(mod);
        assert.equal(app.Services.get(key), undefined);
        assert.equal(app.Modules.Count, 0);          // never surfaced to registries
    });

    test('no host kind ⇒ AddModule composes everything (backward compatible)', () => {
        const app = new Application();
        const { mod, key } = serviceModule('any', [Desktop]);
        app.AddModule(mod);
        assert.deepEqual(app.Services.get(key), { id: 'any' });
        assert.equal(app.Modules.Count, 1);
    });

    test('universal module composes under any host kind', () => {
        const app = new Application(Web);
        const { mod, key } = serviceModule('core', []);
        app.AddModule(mod);
        assert.deepEqual(app.Services.get(key), { id: 'core' });
    });
});
