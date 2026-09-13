import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceLifetime, type IServiceContainer } from '@pragmatic-tech-ai/todl-runtime';
import { HostKind } from '../host-kind.js';
import type { IModule } from '../module.js';
import { CompositionRoot } from '../composition-root.js';

const Desktop = new HostKind('desktop');
const Web     = new HostKind('web');
const Cli     = new HostKind('cli');

// A minimal IModule that registers one instance under a ServiceKey.
class FakeModule implements IModule {
    public readonly key: ServiceKey<{ id: string }>;
    private readonly _id: string;
    constructor(public readonly Targets: ReadonlySet<HostKind>, id: string) {
        this.key = new ServiceKey<{ id: string }>(id);
        this._id = id;
    }
    RegisterServices(container: IServiceContainer): void {
        container.register(this.key, () => ({ id: this._id }), ServiceLifetime.Singleton);
    }
}

describe('CompositionRoot.Admits', () => {
    test('no host kind ⇒ admits everything', () => {
        const root = new CompositionRoot();
        const m = new FakeModule(new Set([Desktop]), 'a');
        root.AddModule(m);
        assert.deepEqual(root.Provider.get(m.key), { id: 'a' });
    });

    test('universal module (empty targets) composes for any host', () => {
        const root = new CompositionRoot(Web);
        const m = new FakeModule(new Set(), 'u');
        root.AddModule(m);
        assert.deepEqual(root.Provider.get(m.key), { id: 'u' });
    });

    test('targeted module composes only when the host is in its targets', () => {
        const root = new CompositionRoot(Cli);
        const match  = new FakeModule(new Set([Cli, Web]), 'match');
        const reject = new FakeModule(new Set([Desktop]), 'reject');
        root.AddModule(match);
        root.AddModule(reject);
        assert.deepEqual(root.Provider.get(match.key), { id: 'match' });
        assert.equal(root.Provider.get(reject.key), undefined);
    });
});

describe('CompositionRoot composition', () => {
    test('a rejected module leaves the provider untouched (never registered)', () => {
        const root = new CompositionRoot(Web);
        const reject = new FakeModule(new Set([Desktop]), 'x');
        root.AddModule(reject);
        assert.equal(root.Provider.has(reject.key), false);
    });

    test('CLI usage: compose plain modules and resolve, no shell', () => {
        const root = new CompositionRoot(Cli);
        const core = new FakeModule(new Set(), 'core');
        const cliOnly = new FakeModule(new Set([Cli]), 'cli');
        root.AddModule(core);
        root.AddModule(cliOnly);
        assert.equal(root.Provider.getRequired(core.key).id, 'core');
        assert.equal(root.Provider.getRequired(cliOnly.key).id, 'cli');
    });
});
