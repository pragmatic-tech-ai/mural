// M4 B1: Figure ports — Ports getter + SideEndpointRegistry delegation.
// Tests must FAIL before implementation and PASS after.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';

function app(): void { Application.current = null; new Application(); }

describe('M4 Figure ports', () => {
    test('Ports resolves per-kind defaults (non-empty)', () => {
        app();
        const vm = Figure.fromKind('rectangle', 0, 0, { width: 80, height: 60 });
        assert.ok(vm.Ports.length > 0, 'a rectangle VM exposes default ports');
    });

    test('side-endpoint registration reports slot index + count', () => {
        app();
        const vm = Figure.fromKind('rectangle', 0, 0, { width: 80, height: 60 });
        // Cast to ISideEndpointHost for duck-typed access (matches the spec pattern)
        const host = vm as unknown as import('../side-endpoint-host.js').ISideEndpointHost;
        // PortSide.E is a ResolvedPortSide (Exclude<PortSide, PortSide.Auto>)
        const side = PortSide.E;
        const ep1 = {} as never, ep2 = {} as never;   // opaque endpoints; identity only
        // Calling convention: (side, ep, onRebalance, owner?) — same as connector.ts calls Figure
        host._registerSideEndpoint(side, ep1, () => {}, vm);
        host._registerSideEndpoint(side, ep2, () => {}, vm);
        assert.deepEqual(host.GetSideSlot(ep1, side), { index: 0, count: 2 });
        assert.deepEqual(host.GetSideSlot(ep2, side), { index: 1, count: 2 });
        assert.equal(host.GetSideEndpointCount(side), 2);
    });

    test('GetSideEndpointCount returns 0 for a side with no registrations', () => {
        app();
        const vm = Figure.fromKind('rectangle', 0, 0, { width: 80, height: 60 });
        const host = vm as unknown as import('../side-endpoint-host.js').ISideEndpointHost;
        assert.equal(host.GetSideEndpointCount(PortSide.N), 0);
    });
});
