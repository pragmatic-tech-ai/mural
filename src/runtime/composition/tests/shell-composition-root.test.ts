import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, HostKind, ServiceKey, ServiceLifetime, type IModule } from '../../index.js';
import type { IServiceContainer } from '@pragmatic-tech-ai/todl-runtime';
import { ShellModule, Capability } from '../../../framework/shell/module.js';

const Desktop = new HostKind('desktop');

// A plain IModule — Targets + RegisterServices only, with NONE of the shell
// members (Capabilities / Resources / HasServiceRegistrations). This is the
// shape a headless engine module (e.g. a non-UI package's IModule) has.
class PlainModule implements IModule
{
    public readonly Targets: ReadonlySet<HostKind>;
    constructor(private readonly key: ServiceKey<{ id: string }>, private readonly id: string, targets: HostKind[])
    {
        this.Targets = new Set(targets);
    }
    public RegisterServices(container: IServiceContainer): void
    {
        container.register(this.key, () => ({ id: this.id }), ServiceLifetime.Singleton);
    }
}

describe('ShellCompositionRoot module routing', () => {
    test('a plain IModule registers its services and does NOT enter Modules', () => {
        const app = new Application();
        const key = new ServiceKey<{ id: string }>('engine');
        app.AddModule(new PlainModule(key, 'engine', []));
        assert.deepEqual(app.Services.get(key), { id: 'engine' });   // RegisterServices ran
        assert.equal(app.Modules.Count, 0);                          // not a shell module
    });

    test('a plain IModule is admitted / skipped by host kind like any module', () => {
        const app = new Application(Desktop);
        const key = new ServiceKey<{ id: string }>('webOnly');
        const web = new HostKind('web');
        app.AddModule(new PlainModule(key, 'webOnly', [web]));       // targets web, host is desktop
        assert.equal(app.Services.get(key), undefined);             // not admitted → never registered
    });

    test('a shell module still enters Modules and registers its services', () => {
        const app = new Application();
        const mod = new ShellModule();
        mod.Name = 'diagram';
        const key = new ServiceKey<{ id: string }>('diagram');
        mod.AddRegistration(key, () => ({ id: 'diagram' }), ServiceLifetime.Singleton);
        const cap = new Capability();
        cap.Name = 'diagram';
        mod.AddChild(cap);

        app.AddModule(mod);
        assert.deepEqual(app.Services.get(key), { id: 'diagram' });
        assert.equal(app.Modules.Count, 1);                          // shell module surfaced to registries
    });

    test('a shell + a plain module compose onto the same root', () => {
        const app = new Application();
        const shell = new ShellModule();
        shell.Name = 'shell';
        const shellKey = new ServiceKey<{ id: string }>('shellSvc');
        shell.AddRegistration(shellKey, () => ({ id: 'shellSvc' }), ServiceLifetime.Singleton);
        const engineKey = new ServiceKey<{ id: string }>('engineSvc');

        app.AddModule(shell);
        app.AddModule(new PlainModule(engineKey, 'engineSvc', []));

        assert.deepEqual(app.Services.get(shellKey), { id: 'shellSvc' });
        assert.deepEqual(app.Services.get(engineKey), { id: 'engineSvc' });
        assert.equal(app.Modules.Count, 1);                          // only the shell module
    });
});
