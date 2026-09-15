import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { SolidColorBrush, Color } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { ConnectorRoutingScheduler } from '../connector-routing-scheduler.js';
import { ConnectorEnd } from '../routing/router.js';
import { ApplicationSettings } from '../../shell/services/application-settings-service.js';
import { DiagramSettings, DiagramSettingKey } from '../diagram-settings.js';

function fig(id: string, x: number, y: number): Figure {
    const f = Figure.fromKind('rectangle', x, y, { width: 120, height: 48 });
    f.Id = id;
    f.Fill = new SolidColorBrush(Color.FromHex('#eee'));
    return f;
}

describe('SideEndpointRegistry.optimizeIntersections — barycenter ordering', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('orders a hub side by far-endpoint position regardless of wiring order', () => {
        // Hub to the right; K spokes to its left at increasing Y. Wire them in
        // REVERSE Y order so insertion order != far-endpoint order — the
        // barycenter pass must sort the hub-side slots by far (spoke) Y.
        const K = 6;
        const hub = fig('hub', 1000, 0);
        const spokes = Array.from({ length: K }, (_, i) => fig(`s${i}`, 0, i * 140));
        const cons: Connector[] = [];
        ConnectorRoutingScheduler.Batch(() => {
            for (let i = K - 1; i >= 0; i--) {   // reverse insertion order
                const c = new Connector();
                c.Source = new ConnectorEndpoint({ Node: spokes[i] });
                c.Target = new ConnectorEndpoint({ Node: hub });
                cons[i] = c;   // index by spoke, not insertion
            }
        });

        // Each spoke connector's slot on the hub side must be its Y rank (0..K-1),
        // i.e. slot index increases with spoke Y — a clean, crossing-free fan.
        const slots = cons.map(c => c.GetPortSlotIndex(ConnectorEnd.Target));
        for (const s of slots) assert.ok(s !== undefined, 'connector must be side-anchored on the hub');
        assert.deepEqual(slots, [0, 1, 2, 3, 4, 5], `expected far-endpoint order, got ${JSON.stringify(slots)}`);
    });

    test('with "Optimize connector routing" OFF, slots stay in insertion order', () => {
        // Same reverse-wired hub as the barycenter test, but the master switch is
        // off — optimizeIntersections must early-return, leaving each connector on
        // the slot it was inserted at (the old way, no crossing reduction).
        const app = new Application();
        app.Services.register(ApplicationSettings.Key, p => new ApplicationSettings(p));
        const settings = app.Services.getRequired(ApplicationSettings.Key);
        DiagramSettings.OptimizeConnectorRouting();          // bind + contribute
        settings.Set(DiagramSettingKey.ConnectorOptimizeRouting, false);

        const K = 6;
        const hub = fig('hub', 1000, 0);
        const spokes = Array.from({ length: K }, (_, i) => fig(`s${i}`, 0, i * 140));
        const cons: Connector[] = [];
        ConnectorRoutingScheduler.Batch(() => {
            for (let i = K - 1; i >= 0; i--) {   // reverse insertion order
                const c = new Connector();
                c.Source = new ConnectorEndpoint({ Node: spokes[i] });
                c.Target = new ConnectorEndpoint({ Node: hub });
                cons[i] = c;
            }
        });

        // Spoke i was inserted at position (K-1-i); with no optimizer that IS its
        // slot. So slots run reversed vs. the far-endpoint order — proof the
        // optimizer never reordered.
        const slots = cons.map(c => c.GetPortSlotIndex(ConnectorEnd.Target));
        for (const s of slots) assert.ok(s !== undefined, 'connector must be side-anchored on the hub');
        assert.deepEqual(slots, [5, 4, 3, 2, 1, 0], `expected insertion order (unoptimized), got ${JSON.stringify(slots)}`);
    });

    test('a dense side (k=120) settles quickly — no O(k^4) hill-climb blowup', () => {
        // The pathology from the real 157-connector hub: one optimize pass must
        // stay cheap. The hill-climb is size-gated, so this runs barycenter only.
        const K = 120;
        const hub = fig('hub', 4000, 0);
        const t0 = performance.now();
        ConnectorRoutingScheduler.Batch(() => {
            for (let i = 0; i < K; i++) {
                const s = fig(`s${i}`, 0, i * 70);
                const c = new Connector();
                c.Source = new ConnectorEndpoint({ Node: s });
                c.Target = new ConnectorEndpoint({ Node: hub });
            }
        });
        const ms = performance.now() - t0;
        // Generous bound: barycenter is O(k log k); the old hill-climb was minutes
        // at this size. 3s leaves ample headroom while still catching a regression.
        assert.ok(ms < 3000, `dense side took ${ms.toFixed(0)}ms — O(k^4) hill-climb likely back`);
    });
});
