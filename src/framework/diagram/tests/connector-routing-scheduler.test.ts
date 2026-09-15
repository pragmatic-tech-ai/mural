import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { SolidColorBrush, Color } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { ConnectorRoutingScheduler } from '../connector-routing-scheduler.js';
import { SideEndpointRegistry } from '../side-endpoint-host.js';

function fig(id: string, x: number, y: number): Figure {
    const f = Figure.fromKind('rectangle', x, y, { width: 120, height: 48 });
    f.Id = id;
    f.Fill = new SolidColorBrush(Color.FromHex('#eee'));
    return f;
}

describe('Connector._flushRecompute', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('resolves route Geometry from data geometry', () => {
        const a = fig('a', 0, 0), b = fig('b', 400, 0);
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ Node: a });
        c.Target = new ConnectorEndpoint({ Node: b });
        c._flushRecompute();
        assert.ok(c.Geometry !== undefined, 'expected resolved Geometry');
    });
});

describe('ConnectorRoutingScheduler scope mechanics', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('IsSuspended true inside, false outside; nesting defers flush', () => {
        assert.equal(ConnectorRoutingScheduler.IsSuspended, false);
        let innerSeen = false;
        ConnectorRoutingScheduler.Batch(() => {
            assert.equal(ConnectorRoutingScheduler.IsSuspended, true);
            ConnectorRoutingScheduler.Batch(() => {
                assert.equal(ConnectorRoutingScheduler.IsSuspended, true);
                innerSeen = true;
            });
            // inner close must NOT lift suspension (depth still 1)
            assert.equal(ConnectorRoutingScheduler.IsSuspended, true);
        });
        assert.equal(innerSeen, true);
        assert.equal(ConnectorRoutingScheduler.IsSuspended, false);
    });

    test('throw inside mutate still lifts suspension', () => {
        assert.throws(() => ConnectorRoutingScheduler.Batch(() => { throw new Error('x'); }));
        assert.equal(ConnectorRoutingScheduler.IsSuspended, false);
    });

    test('empty scope is a no-op', () => {
        ConnectorRoutingScheduler.Batch(() => { /* nothing dirty */ });
        assert.equal(ConnectorRoutingScheduler.IsSuspended, false);
    });
});

describe('ConnectorRoutingScheduler deferral', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('endpoint wiring inside Batch defers routing until close', () => {
        const a = fig('a', 0, 0), b = fig('b', 400, 0);
        let c!: Connector;
        ConnectorRoutingScheduler.Batch(() => {
            c = new Connector();
            c.Source = new ConnectorEndpoint({ Node: a });
            c.Target = new ConnectorEndpoint({ Node: b });
            assert.equal(c.Geometry, undefined, 'route must be deferred inside Batch');
        });
        assert.ok(c.Geometry !== undefined, 'route must resolve after Batch closes');
    });

    test('shared-side wiring defers both routes and settles on close', () => {
        const hub = fig('hub', 400, 0);
        const s1 = fig('s1', 0, 0), s2 = fig('s2', 0, 200);
        let c1!: Connector, c2!: Connector;
        ConnectorRoutingScheduler.Batch(() => {
            c1 = new Connector();
            c1.Source = new ConnectorEndpoint({ Node: s1 });
            c1.Target = new ConnectorEndpoint({ Node: hub });
            c2 = new Connector();
            c2.Source = new ConnectorEndpoint({ Node: s2 });
            c2.Target = new ConnectorEndpoint({ Node: hub });
            assert.equal(c1.Geometry, undefined);
            assert.equal(c2.Geometry, undefined);
        });
        assert.ok(c1.Geometry !== undefined);
        assert.ok(c2.Geometry !== undefined);
    });
});

// A hub with N spokes all landing on its W side — the case the crossing
// optimizer reorders. Wiring order is fixed so eager vs batched are comparable
// index-by-index.
function buildHubGraph(batched: boolean): Connector[] {
    const hub = fig('hub', 500, 200);
    const spokes = [fig('a', 0, 0), fig('b', 0, 120), fig('c', 0, 240), fig('d', 0, 360)];
    const cons: Connector[] = [];
    const wire = (): void => {
        for (const s of spokes) {
            const c = new Connector();
            c.Source = new ConnectorEndpoint({ Node: s });
            c.Target = new ConnectorEndpoint({ Node: hub });
            cons.push(c);
        }
    };
    if (batched) ConnectorRoutingScheduler.Batch(wire); else wire();
    return cons;
}

// Serialize the outcome the optimizer decides: each connector's resolved source
// + target anchors (x, y, side). Slot reordering shows up as different anchor
// positions, so identical serializations ⇒ identical routing outcome.
function anchorsOf(cons: readonly Connector[]): string {
    return JSON.stringify(cons.map(c => [c.CurrentSourceAnchor, c.CurrentTargetAnchor]));
}

// A hub already wired (routes settled) plus its N spokes, ready to be moved —
// the drag scenario. Returns the hub so the test can rewrite its Left/Top.
function buildSettledHub(spokeCount: number): { hub: Figure; cons: Connector[] } {
    const hub = fig('hub', 500, 200);
    const cons: Connector[] = [];
    for (let i = 0; i < spokeCount; i++) {
        const s = fig(`s${i}`, 0, i * 80);
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ Node: s });
        c.Target = new ConnectorEndpoint({ Node: hub });
        cons.push(c);
    }
    return { hub, cons };
}

describe('ConnectorRoutingScheduler outcome identity', () => {
    test('batched wiring produces identical routes to eager', () => {
        Application.current = null; new Application();
        const eager = anchorsOf(buildHubGraph(false));
        Application.current = null; new Application();
        const batched = anchorsOf(buildHubGraph(true));
        assert.equal(batched, eager);
    });
});

describe('ConnectorRoutingScheduler node-move (drag tick)', () => {
    // Regression: dragging a hub node freezes because each Left/Top write
    // re-routes every attached connector AND re-runs the crossing optimizer —
    // O(k²) per tick. Wrapping the tick's position writes in a Batch (as
    // Figure.OnPointerMove now does) must collapse that to one optimize per
    // multi-connector side, independent of k.
    test('moving a hub inside Batch optimizes per-side, not per-connector', () => {
        const proto = SideEndpointRegistry.prototype as unknown as {
            optimizeIntersections: (s: unknown) => void;
        };
        const orig = proto.optimizeIntersections;
        let calls = 0;
        proto.optimizeIntersections = function (this: unknown, s: unknown): void {
            calls++;
            return orig.call(this, s);
        };
        try {
            Application.current = null; new Application();
            const eager = buildSettledHub(8);
            calls = 0;
            eager.hub.Left = eager.hub.Left + 40;
            eager.hub.Top  = eager.hub.Top + 40;
            const eagerCalls = calls;

            Application.current = null; new Application();
            const batched = buildSettledHub(8);
            calls = 0;
            ConnectorRoutingScheduler.Batch(() => {
                batched.hub.Left = batched.hub.Left + 40;
                batched.hub.Top  = batched.hub.Top + 40;
            });
            const batchedCalls = calls;

            assert.ok(batchedCalls < eagerCalls, `batched(${batchedCalls}) must be < eager(${eagerCalls})`);
            assert.ok(batchedCalls <= 2, `expected per-side optimize, got ${batchedCalls}`);
        } finally {
            proto.optimizeIntersections = orig;
        }
    });

    test('batched move yields the same routes as an eager move', () => {
        Application.current = null; new Application();
        const eager = buildSettledHub(8);
        eager.hub.Left = eager.hub.Left + 40;
        eager.hub.Top  = eager.hub.Top + 40;
        const eagerAnchors = anchorsOf(eager.cons);

        Application.current = null; new Application();
        const batched = buildSettledHub(8);
        ConnectorRoutingScheduler.Batch(() => {
            batched.hub.Left = batched.hub.Left + 40;
            batched.hub.Top  = batched.hub.Top + 40;
        });
        assert.equal(anchorsOf(batched.cons), eagerAnchors);
    });
});

describe('ConnectorRoutingScheduler optimize-count', () => {
    test('batched path optimizes each side once, not per-connector', () => {
        const proto = SideEndpointRegistry.prototype as unknown as {
            optimizeIntersections: (s: unknown) => void;
        };
        const orig = proto.optimizeIntersections;
        let calls = 0;
        proto.optimizeIntersections = function (this: unknown, s: unknown): void {
            calls++;
            return orig.call(this, s);
        };
        try {
            Application.current = null; new Application();
            calls = 0;
            buildHubGraph(false);
            const eagerCalls = calls;

            Application.current = null; new Application();
            calls = 0;
            buildHubGraph(true);
            const batchedCalls = calls;

            // The win: batched invokes the optimizer a small constant number of
            // times (one per multi-connector dirty side — here only the hub's W
            // side, the 4 spoke sides being single-connector), independent of the
            // per-connector × hill-climb-iteration cascade the eager path pays.
            assert.ok(batchedCalls < eagerCalls, `batched(${batchedCalls}) must be < eager(${eagerCalls})`);
            assert.ok(batchedCalls <= 2, `expected optimizer invoked per multi-connector side, got ${batchedCalls}`);
        } finally {
            proto.optimizeIntersections = orig;
        }
    });
});
