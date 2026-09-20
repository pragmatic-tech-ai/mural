import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from '../compile.js';
import { DEFAULT_SYMBOLS } from '../symbol-table.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import { Application, ServiceKey } from '../../runtime/index.js';

// Compiles a `.services:` block on an Application and returns the emitted
// JS. NavigationService / PanelDockService / StatusService resolve via
// DEFAULT_SYMBOLS; DiagramStorageKey is a real ServiceKey token.
function svc(body: string): string
{
    return compile(`
        Application{
            .services: {
                ${body}
            }
            resources: { Border x:root [Fill=#fff] }
        }
    `).js;
}

describe('compile — .services: DI block', () => {
    // Every entry lowers to a lazy `(p) => new Impl(p)` factory: the
    // service ctor takes the provider (the IServiceProvider contract) and
    // resolves its own deps. No eager `addInstance`, no ctor-dep list.

    test('bare entry → lazy singleton factory taking the provider', () => {
        const js = svc('StatusService');
        assert.match(js, /\.Services\.register\(ServiceProvider\.tokenFor\(StatusService\), \(p\) => new StatusService\(p\), 'singleton'\)/);
    });

    test('lifetime prefix → scoped / transient factory registration', () => {
        const js = svc('scoped NavigationService\ntransient PanelDockService');
        assert.match(js, /\.Services\.registerScoped\(ServiceProvider\.tokenFor\(NavigationService\), \(p\) => new NavigationService\(p\)\)/);
        assert.match(js, /\.Services\.registerTransient\(ServiceProvider\.tokenFor\(PanelDockService\), \(p\) => new PanelDockService\(p\)\)/);
    });

    test('explicit singleton keyword reads the same as bare', () => {
        const js = svc('singleton StatusService');
        assert.match(js, /\.Services\.register\(ServiceProvider\.tokenFor\(StatusService\), \(p\) => new StatusService\(p\), 'singleton'\)/);
    });

    test('-> token registers the impl under a different token', () => {
        const js = svc('StatusService -> PanelDockService');
        assert.match(js, /\.Services\.register\(ServiceProvider\.tokenFor\(PanelDockService\), \(p\) => new StatusService\(p\), 'singleton'\)/);
        assert.match(js, /import \{[^}]*PanelDockService/);
    });

    test('full form: scoped Impl -> Token', () => {
        const js = svc('scoped StatusService -> PanelDockService');
        assert.match(js, /\.Services\.registerScoped\(ServiceProvider\.tokenFor\(PanelDockService\), \(p\) => new StatusService\(p\)\)/);
    });

    test('the impl class is imported', () => {
        const js = svc('StatusService');
        assert.match(js, /import \{[^}]*StatusService/);
    });

    test('removed ctor-dependency syntax `Impl(Dep)` is a pointed parse error', () => {
        assert.throws(
            () => svc('PanelDockService(DiagramStorageKey)'),
            /constructor-dependency syntax 'Impl\(\.\.\.\)' was removed/);
    });

    test('inline config seeds a literal through the service setter', () => {
        const js = svc('StatusService { Text: "Ready" }');
        assert.match(js, /const _s = new StatusService\(p\);/);
        assert.match(js, /_s\.Text = "Ready";/);
        assert.match(js, /return _s;/);
    });

    test('inline config injects a service via $service(Token) resolved eagerly from the provider', () => {
        const js = svc('PanelDockService { Target: $service(StatusService) }');
        assert.match(js, /_s\.Target = p\.getRequired\(ServiceProvider\.tokenFor\(StatusService\)\);/);
        // Eager resolution, NOT a reactive ServiceBinding.
        assert.doesNotMatch(js, /ServiceBinding/);
    });

    test('config composes with lifetime + explicit token', () => {
        const js = svc('scoped StatusService { Text: "x" } -> PanelDockService');
        assert.match(js, /\.Services\.registerScoped\(ServiceProvider\.tokenFor\(PanelDockService\), \(p\) => \{ const _s = new StatusService\(p\); _s\.Text = "x"; return _s; \}\)/);
    });

    test('a DataContext binding in config is rejected (no target at factory time)', () => {
        assert.throws(
            () => svc('StatusService { Text: $SomeVmProp }'),
            /only literals or \$service\(Token\) are allowed/);
    });
});

describe('instantiate — .services: registers + resolves on Application.Services', () => {
    beforeEach(() => { Application.current = null; });

    // Service classes follow the new contract: every ctor takes the
    // provider and resolves its own collaborators from it. Doc pulls Clock
    // from the provider rather than declaring a markup dep list.
    class Clock
    {
        public static readonly Key = new ServiceKey<Clock>('Clock');
        constructor(_provider: unknown) { /* no deps */ }
        public now(): number { return 7; }
    }
    class Doc
    {
        public static readonly Key = new ServiceKey<Doc>('Doc');
        public readonly clock: Clock;
        constructor(provider: runtime.IServiceProvider)
        {
            this.clock = provider.getRequired(Clock.Key);
        }
    }
    const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine, Clock, Doc };
    // The ad-hoc test classes need a symbol-table entry so the compiler
    // can emit their imports; the path is irrelevant — instantiate pulls
    // them from CTX by name.
    const SYMS = new Map([...DEFAULT_SYMBOLS, ['Clock', 'test'], ['Doc', 'test']]);

    test('bare entry resolves under its static Key; a service self-resolves the same instance', () => {
        const app = instantiate(`Application{
            .services: {
                Clock
                scoped Doc
            }
            resources: {}
        }`, CTX, { symbols: SYMS }) as Application;

        const clock = app.Services.get(Clock.Key) as Clock;
        assert.ok(clock instanceof Clock);
        assert.equal(clock.now(), 7);

        const doc = app.Services.get(Doc.Key) as Doc;
        assert.ok(doc instanceof Doc);
        // Doc's ctor pulled Clock from the injected provider — same singleton.
        assert.equal(doc.clock, clock);
    });
});

describe('instantiate — .services: inline config seeds + injects', () => {
    beforeEach(() => { Application.current = null; });

    // A service with a settable DP (seed target) and a slot for an injected
    // collaborator (injection target). Both ctors take the provider.
    class Greeter extends runtime.MuralBase
    {
        public static readonly Key = new ServiceKey<Greeter>('Greeter');
        public static readonly MsgKey = runtime.MuralBase.RegisterProperty<string>(
            Greeter, 'Msg', '', runtime.MetaData.None);
        constructor(_p: unknown) { super(); }
        public get Msg(): string { return this.get_property_value(Greeter.MsgKey); }
        public set Msg(v: string) { this.set_property_value(Greeter.MsgKey, v); }
    }
    class Consumer extends runtime.MuralBase
    {
        public static readonly Key = new ServiceKey<Consumer>('Consumer');
        public static readonly DepKey = runtime.MuralBase.RegisterProperty<unknown>(
            Consumer, 'Dep', undefined, runtime.MetaData.None);
        constructor(_p: unknown) { super(); }
        public get Dep(): unknown { return this.get_property_value(Consumer.DepKey); }
        public set Dep(v: unknown) { this.set_property_value(Consumer.DepKey, v); }
    }
    const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine, Greeter, Consumer };
    const SYMS = new Map([...DEFAULT_SYMBOLS, ['Greeter', 'test'], ['Consumer', 'test']]);

    test('a literal seeds the DP; $service(Token) injects the resolved instance', () => {
        const app = instantiate(`Application{
            .services: {
                Greeter { Msg: "hello" }
                Consumer { Dep: $service(Greeter) }
            }
            resources: {}
        }`, CTX, { symbols: SYMS }) as Application;

        const greeter = app.Services.get(Greeter.Key) as Greeter;
        assert.equal(greeter.Msg, 'hello', 'literal seeded through the setter');

        const consumer = app.Services.get(Consumer.Key) as Consumer;
        // Injected the SAME singleton the Greeter entry registered.
        assert.equal(consumer.Dep, greeter, 'service injected by $service(Token)');
    });
});
