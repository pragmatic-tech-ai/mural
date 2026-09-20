import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from '../compile.js';
import { DEFAULT_SYMBOLS } from '../symbol-table.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import { Application, MuralBase, MetaData, ServiceKey } from '../../runtime/index.js';
import { TextBlock } from '../../basic/index.js';

describe('compile — $service(Token) binding emit', () => {
    test('$service(Token).path → ServiceBinding(tokenFor(Token), "path")', () => {
        const js = compile(`
            Application{ resources: {
                TextBlock x:root [Text=$service(StatusService).Text]
            } }
        `).js;
        // Target-aware: the target var is passed first so the binding can
        // read the target's inherited ServiceScope.
        assert.match(js, /ServiceBinding\(_\w+\d*, ServiceProvider\.tokenFor\(StatusService\), "Text"\)/);
        assert.match(js, /import \{[^}]*ServiceBinding/);
    });

    test('$service(Token) with no path → empty-path ServiceBinding (the service itself)', () => {
        const js = compile(`
            Application{ resources: {
                PageView x:root [Content=$service(NavigationService)]
            } }
        `).js;
        assert.match(js, /ServiceBinding\(_\w+\d*, ServiceProvider\.tokenFor\(NavigationService\), ""\)/);
    });
});

describe('instantiate — $service binding resolves + reacts', () => {
    beforeEach(() => { Application.current = null; });

    class Status extends MuralBase
    {
        public static readonly Key = new ServiceKey<Status>('Status');
        public static readonly MsgKey = MuralBase.RegisterProperty<string>(Status, 'Msg', '', MetaData.None);
        public get Msg(): string { return this.get_property_value(Status.MsgKey); }
        public set Msg(v: string) { this.set_property_value(Status.MsgKey, v); }
    }
    const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine, Status };
    const SYMS = new Map([...DEFAULT_SYMBOLS, ['Status', 'test']]);

    test('binds a TextBlock to a service DP and updates reactively', () => {
        const app = instantiate(`Application{
            .services: { Status }
            resources: {
                TextBlock x:root [Text=$service(Status).Msg]
            }
        }`, CTX, { symbols: SYMS }) as Application;

        const tb = app.Resources.Root as InstanceType<typeof TextBlock>;
        assert.ok(tb instanceof TextBlock);
        // Seeded empty, bound from the resolved service.
        assert.equal(tb.Text, '');

        // Mutating the service DP flows through the binding.
        const status = app.Services.get(Status.Key) as Status;
        status.Msg = 'Saving…';
        assert.equal(tb.Text, 'Saving…');
    });
});
