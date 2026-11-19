// ConnectorCreateBehavior state-machine tests. The behavior now speaks
// side-anchored endpoints (Node + PortSide) — the named-port shape
// stayed in the framework for consumers with custom port catalogs, but
// the drag-create gesture itself works side-to-side. See
// connector-interactions-behavior.ts for the side-bar UI that drives it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import {
    type ConnectorCreatedArgs,
    ConnectorCreateBehavior,
    attachConnectorCreate,
} from '../behaviors/connector-create-behavior.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';
import { RoutingMode } from '../routing/router.js';
// Side-effect imports — registers the routers used by the transient
// Connector's recompute.
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

function newBoard(): Board
{
    Application.current = null;
    new Application();
    return new Board();
}

function fig(left: number, top: number): Figure
{
    const f = new Figure();
    f.Left = left;
    f.Top  = top;
    f.Width  = 80;
    f.Height = 80;
    f.ExplicitPorts = [];      // skip default-provider ports for predictable resolution
    return f;
}

// ── Begin → transient state ──────────────────────────────────────────

describe('ConnectorCreateBehavior — BeginCreate', () => {
    test('materializes a transient with side-anchored Source', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);
        assert.equal(behavior.IsActive, false);
        behavior.BeginCreate(f, PortSide.E, new Point(300, 200));

        assert.equal(behavior.IsActive, true);
        const t = behavior.TransientConnector!;
        assert.ok(t instanceof Connector);
        assert.equal(t.Source!.Node, f);
        assert.equal(t.Source!.PortSide, PortSide.E);
        assert.equal(t.Source!.PortName, undefined);
        assert.equal(t.Source!.PortIndex, undefined);
        assert.equal(t.Target!.Node, undefined);
        assert.equal(t.Target!.FreePoint!.X, 300);
        assert.equal(t.Target!.FreePoint!.Y, 200);
        assert.equal(t.RoutingMode, RoutingMode.Orthogonal);
    });

    test('different cardinal sides round-trip onto Source.PortSide', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);
        for (const side of [PortSide.N, PortSide.S, PortSide.E, PortSide.W])
        {
            behavior.BeginCreate(f, side, new Point(300, 200));
            assert.equal(behavior.TransientConnector!.Source!.PortSide, side);
        }
    });

    test('a second BeginCreate preempts an unreleased gesture', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const a = fig(100, 100);
        const b = fig(300, 100);
        behavior.BeginCreate(a, PortSide.E, new Point(200, 200));
        const firstTransient = behavior.TransientConnector!;

        behavior.BeginCreate(b, PortSide.W, new Point(400, 200));
        const secondTransient = behavior.TransientConnector!;
        assert.notEqual(firstTransient, secondTransient);
        assert.equal(secondTransient.Source!.Node, b);
        assert.equal(secondTransient.Source!.PortSide, PortSide.W);
    });
});

// ── UpdateCursor flows into Target.FreePoint ─────────────────────────

describe('ConnectorCreateBehavior — UpdateCursor', () => {
    test('cursor update writes through to the transient Target.FreePoint', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);
        behavior.BeginCreate(f, PortSide.E, new Point(300, 200));
        behavior.UpdateCursor(new Point(400, 250));
        const fp = behavior.TransientConnector!.Target!.FreePoint!;
        assert.equal(fp.X, 400);
        assert.equal(fp.Y, 250);
    });

    test('UpdateCursor while inactive is a silent no-op', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        behavior.UpdateCursor(new Point(0, 0));   // does not throw
        assert.equal(behavior.IsActive, false);
    });
});

// ── EndCreate fires Board.ConnectorCreated ─────────────────────────

describe('ConnectorCreateBehavior — EndCreate', () => {
    test('fires Board.ConnectorCreated with side-anchored Source / Target', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const src = fig(100, 100);
        const tgt = fig(400, 100);

        const captured: ConnectorCreatedArgs[] = [];
        d.AddConnectorCreatedListener(args => captured.push(args));

        behavior.BeginCreate(src, PortSide.E, new Point(200, 200));
        behavior.EndCreate(tgt, PortSide.W);

        assert.equal(captured.length, 1);
        assert.equal(captured[0]!.Source.Node, src);
        assert.equal(captured[0]!.Source.PortSide, PortSide.E);
        assert.equal(captured[0]!.Target.Node, tgt);
        assert.equal(captured[0]!.Target.PortSide, PortSide.W);
        assert.equal(behavior.IsActive, false);
        assert.equal(behavior.TransientConnector, undefined);
    });

    test('the event-bag Source/Target ARE freshly-constructed endpoints, not the transient', () => {
        // The transient connector's endpoints are dropped at EndCreate.
        // The event args carry independent ConnectorEndpoint instances
        // so the consumer's listener can hold references without
        // affecting the framework's gesture state.
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const src = fig(100, 100);
        const tgt = fig(400, 100);

        behavior.BeginCreate(src, PortSide.E, new Point(200, 200));
        const transientSource = behavior.TransientConnector!.Source;

        let captured: ConnectorCreatedArgs | undefined;
        d.AddConnectorCreatedListener(args => { captured = args; });
        behavior.EndCreate(tgt, PortSide.W);

        assert.ok(captured !== undefined);
        assert.notEqual(captured!.Source, transientSource);
        assert.ok(captured!.Source instanceof ConnectorEndpoint);
    });

    test('EndCreate without an active gesture is a silent no-op', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);

        let fired = false;
        d.AddConnectorCreatedListener(() => { fired = true; });
        behavior.EndCreate(f, PortSide.E);
        assert.equal(fired, false);
    });
});

// ── Abort ────────────────────────────────────────────────────────────

describe('ConnectorCreateBehavior — Abort', () => {
    test('drops the transient without firing ConnectorCreated', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);

        let fired = false;
        d.AddConnectorCreatedListener(() => { fired = true; });
        behavior.BeginCreate(f, PortSide.E, new Point(200, 200));
        behavior.Abort();
        assert.equal(behavior.IsActive, false);
        assert.equal(behavior.TransientConnector, undefined);
        assert.equal(fired, false);
    });

    test('Abort while inactive is a silent no-op', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        behavior.Abort();
        assert.equal(behavior.IsActive, false);
    });

    test('Abort unregisters the transient source endpoint from the figure side', () => {
        // The transient created in BeginCreate registers its Source on
        // the source figure's side list. Without explicit cleanup, the
        // transient's endpoint stays in the registry after Abort —
        // visible as a phantom port marker on the SideBarsAdorner with
        // no real connector behind it. _cleanup must clear t.Source so
        // the connector's _reregisterSourceSide path unregisters it.
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const f = fig(100, 100);

        assert.equal(f.GetSideEndpointCount(PortSide.E), 0);
        behavior.BeginCreate(f, PortSide.E, new Point(200, 200));
        assert.equal(f.GetSideEndpointCount(PortSide.E), 1);
        behavior.Abort();
        assert.equal(f.GetSideEndpointCount(PortSide.E), 0,
            'transient source endpoint must be unregistered on Abort');
    });
});

// ── Side-registry leak repro (the "2 markers, 1 connector" bug) ──────

describe('ConnectorCreateBehavior — side-registry hygiene across gestures', () => {
    test('EndCreate releases the transient source side-slot (post-gesture count stays at 1)', () => {
        const d = newBoard();
        const behavior = new ConnectorCreateBehavior(d);
        const src = fig(100, 100);
        const tgt = fig(400, 100);

        // Capture the ConnectorCreated event so we can materialize the
        // new connector exactly like the demo does — the new
        // connector's source endpoint will then claim its own slot,
        // and the transient's slot from BeginCreate must NOT linger.
        const created: ConnectorCreatedArgs[] = [];
        d.AddConnectorCreatedListener(args => created.push(args));

        behavior.BeginCreate(src, PortSide.E, new Point(200, 140));
        assert.equal(src.GetSideEndpointCount(PortSide.E), 1, 'transient claims a slot');

        behavior.EndCreate(tgt, PortSide.W);
        // Transient's slot released by _cleanup.
        assert.equal(src.GetSideEndpointCount(PortSide.E), 0,
            'transient slot must be released before the listener materializes the real connector');

        // Materialize the real connector through the listener-supplied
        // endpoints — same shape as the demo's CreateConnector path.
        assert.equal(created.length, 1);
        const c = new Connector();
        c.RoutingMode = RoutingMode.Orthogonal;
        c.Source = created[0]!.Source;
        c.Target = created[0]!.Target;

        // Now exactly ONE endpoint is on each side. Marker count = 1.
        assert.equal(src.GetSideEndpointCount(PortSide.E), 1);
        assert.equal(tgt.GetSideEndpointCount(PortSide.W), 1);
    });
});

// ── attachConnectorCreate convenience ────────────────────────────────

describe('attachConnectorCreate', () => {
    test('returns { behavior, detach } and detach aborts in-flight gestures', () => {
        const d = newBoard();
        const { behavior, detach } = attachConnectorCreate(d);
        const f = fig(100, 100);
        behavior.BeginCreate(f, PortSide.E, new Point(200, 200));
        assert.equal(behavior.IsActive, true);
        detach();
        assert.equal(behavior.IsActive, false);
    });
});
