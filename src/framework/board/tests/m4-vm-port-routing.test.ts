// M4-B2 tests: shape Figures must honour named/side ports through the
// duck-typed side-slot host path (endpointSideSlot broadened from
// instanceof Figure to ISideEndpointHost). A shape Figure IS the node,
// so it is used directly as a connector endpoint's Node.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';

// ── helpers ─────────────────────────────────────────────────────────────

function initApp(): void
{
    Application.current = null;
    new Application();
}

// Resolve a connector's source anchor after one compute tick.
// Connector._scheduleRecompute runs synchronously in tests (no real
// scheduler); the resolved anchor is written to CurrentSourceAnchor.
function sourceAnchor(c: Connector): { x: number; y: number }
{
    const a = c.CurrentSourceAnchor;
    assert.ok(a !== undefined, 'CurrentSourceAnchor must be resolved after endpoint assignment');
    return { x: a.x, y: a.y };
}

function targetAnchor(c: Connector): { x: number; y: number }
{
    const a = c.CurrentTargetAnchor;
    assert.ok(a !== undefined, 'CurrentTargetAnchor must be resolved after endpoint assignment');
    return { x: a.x, y: a.y };
}

// ── Test 1: explicit PortSide on a VM endpoint anchors at the side edge ──

describe('M4-B2 — VM side-port routing', () => {
    test('VM-shape endpoint with explicit PortSide anchors at the side edge, not a clipped bbox point', () => {
        initApp();

        // a: 0,0 100×80   b: 300,0 100×80
        const vmA = Figure.fromKind('rectangle',   0, 0, { width: 100, height: 80 });
        const vmB = Figure.fromKind('rectangle', 300, 0, { width: 100, height: 80 });

        // Endpoint: vmA East side, vmB West side — explicit PortSide, no PortIndex/PortName.
        const src = new ConnectorEndpoint({ Node: vmA, PortSide: PortSide.E });
        const tgt = new ConnectorEndpoint({ Node: vmB, PortSide: PortSide.W });

        const connector = new Connector();
        connector.Source = src;
        connector.Target = tgt;

        const sa = sourceAnchor(connector);
        const ta = targetAnchor(connector);

        // Source must lie on vmA's East edge (x === vmA.Left + vmA.Width = 100).
        // Before B2 the VM falls through to geometric clip, which can land at
        // the same x but is computed differently (and won't register a slot).
        // The key assertion: x is exactly 100 (right edge of vmA).
        assert.equal(sa.x, 100,
            `source anchor x must be on vmA's East edge (100); got ${sa.x}`);

        // y should be centred on the East side (single slot → t=0.5 → y = 0 + 0.5*80 = 40).
        // This is the SIDE-SLOT resolution, not the geometric-clip mid-point.
        assert.equal(sa.y, 40,
            `source anchor y must be the mid-point of the East side (40); got ${sa.y}`);

        // Target on vmB West edge: x = 300, y = 40 (mid height).
        assert.equal(ta.x, 300,
            `target anchor x must be on vmB's West edge (300); got ${ta.x}`);
        assert.equal(ta.y, 40,
            `target anchor y must be the mid-point of the West side (40); got ${ta.y}`);
    });

    // ── Test 2: two connectors on the same VM side distribute across slots ──

    test('two connectors sharing a VM side distribute across slots (anchors differ)', () => {
        initApp();

        // vmA: 0,0 100×80.  Two connectors leave its East side.
        const vmA = Figure.fromKind('rectangle',   0, 0, { width: 100, height: 80 });
        const vmB = Figure.fromKind('rectangle', 300, 0, { width: 100, height: 80 });
        const vmC = Figure.fromKind('rectangle', 300, 200, { width: 100, height: 80 });

        const c1 = new Connector();
        c1.Source = new ConnectorEndpoint({ Node: vmA, PortSide: PortSide.E });
        c1.Target = new ConnectorEndpoint({ Node: vmB, PortSide: PortSide.W });

        const c2 = new Connector();
        c2.Source = new ConnectorEndpoint({ Node: vmA, PortSide: PortSide.E });
        c2.Target = new ConnectorEndpoint({ Node: vmC, PortSide: PortSide.W });

        const sa1 = sourceAnchor(c1);
        const sa2 = sourceAnchor(c2);

        // Both must be on vmA's East edge.
        assert.equal(sa1.x, 100, `c1 source x must be 100; got ${sa1.x}`);
        assert.equal(sa2.x, 100, `c2 source x must be 100; got ${sa2.x}`);

        // With 2 connectors: t(0)=1/3, t(1)=2/3 → y0=80/3≈26.67, y1=160/3≈53.33
        // They must DIFFER (distribution is working).
        assert.notEqual(sa1.y, sa2.y,
            `two connectors on the same VM side must distribute to different y slots; ` +
            `both are ${sa1.y}`);

        // Together they must straddle the midpoint of the East side.
        const midY = vmA.Top + vmA.Height / 2;   // 40
        const yMin = Math.min(sa1.y, sa2.y);
        const yMax = Math.max(sa1.y, sa2.y);
        assert.ok(yMin < midY && yMax > midY,
            `slot positions (${yMin}, ${yMax}) must straddle the mid-point ${midY}`);
    });
});
