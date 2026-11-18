// Step 4 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the Port class defaults + init-object construction + PortResolver
// behavior in bbox mode. Outline mode lands in step 5.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Rect } from '../../../visual-engine/index.js';
import {
    type IPortHost,
    Port,
    PortCoordSpace,
    PortResolver,
    PortSide,
} from '../port.js';

const HOST = (x: number, y: number, w: number, h: number): IPortHost =>
    ({ ArrangedRect: new Rect(x, y, w, h) });

describe('Port — defaults', () => {
    test('no-arg construction sets the documented DP defaults', () => {
        const p = new Port();
        assert.equal(p.Name,       '');
        assert.equal(p.CoordSpace, PortCoordSpace.Bbox);
        assert.equal(p.X,          0);
        assert.equal(p.Y,          0);
        assert.equal(p.OutlineT,   0);
        assert.equal(p.Side,       PortSide.Auto);
    });
});

describe('Port — typed init-object constructor', () => {
    test('partial init touches only the named fields', () => {
        const p = new Port({ Side: PortSide.S, X: 0.25 });
        assert.equal(p.Side, PortSide.S);
        assert.equal(p.X,    0.25);
        // Untouched DPs hold defaults.
        assert.equal(p.Name,       '');
        assert.equal(p.Y,          0);
        assert.equal(p.OutlineT,   0);
        assert.equal(p.CoordSpace, PortCoordSpace.Bbox);
    });

    test('full init populates every DP', () => {
        const p = new Port({
            Name:       'in',
            CoordSpace: PortCoordSpace.Outline,
            X:          0.1, Y: 0.2,
            OutlineT:   0.3,
            Side:       PortSide.W,
        });
        assert.equal(p.Name,       'in');
        assert.equal(p.CoordSpace, PortCoordSpace.Outline);
        assert.equal(p.X,          0.1);
        assert.equal(p.Y,          0.2);
        assert.equal(p.OutlineT,   0.3);
        assert.equal(p.Side,       PortSide.W);
    });
});

describe('PortResolver — bbox-mode coordinate transform', () => {
    test('scales by ArrangedRect dimensions', () => {
        // Port at (0.5, 0) means top-edge center in shape-local space.
        // Host at (0, 0) with width=100 → board-host X=50, Y=0.
        const p = new Port({ X: 0.5, Y: 0 });
        const a = PortResolver.resolve(p, HOST(0, 0, 100, 100));
        assert.equal(a.x, 50);
        assert.equal(a.y, 0);
    });

    test('translates by ArrangedRect origin', () => {
        // Same port, different host origin. Resolution must shift by
        // (host.X, host.Y) so port-local (0.5, 0.5) lands at the host's
        // centroid in board coords.
        const p = new Port({ X: 0.5, Y: 0.5 });
        const a = PortResolver.resolve(p, HOST(100, 200, 80, 40));
        assert.equal(a.x, 100 + 0.5 * 80);
        assert.equal(a.y, 200 + 0.5 * 40);
    });

    test('respects non-square ArrangedRect — X scales by Width, Y by Height', () => {
        const p = new Port({ X: 0.25, Y: 0.75 });
        const a = PortResolver.resolve(p, HOST(0, 0, 200, 80));
        assert.equal(a.x, 0.25 * 200);
        assert.equal(a.y, 0.75 * 80);
    });

    test('corner ports land at corners', () => {
        const host = HOST(10, 20, 100, 50);
        assert.deepEqual(
            { x: PortResolver.resolve(new Port({ X: 0, Y: 0 }), host).x,
              y: PortResolver.resolve(new Port({ X: 0, Y: 0 }), host).y },
            { x: 10, y: 20 });
        assert.deepEqual(
            { x: PortResolver.resolve(new Port({ X: 1, Y: 1 }), host).x,
              y: PortResolver.resolve(new Port({ X: 1, Y: 1 }), host).y },
            { x: 110, y: 70 });
    });
});

describe('PortResolver — bbox-mode Auto side derivation', () => {
    const host = HOST(0, 0, 100, 100);

    test('top-edge mid: N', () => {
        const a = PortResolver.resolve(new Port({ X: 0.5, Y: 0 }), host);
        assert.equal(a.side, PortSide.N);
    });

    test('bottom-edge mid: S', () => {
        const a = PortResolver.resolve(new Port({ X: 0.5, Y: 1 }), host);
        assert.equal(a.side, PortSide.S);
    });

    test('left-edge mid: W', () => {
        const a = PortResolver.resolve(new Port({ X: 0, Y: 0.5 }), host);
        assert.equal(a.side, PortSide.W);
    });

    test('right-edge mid: E', () => {
        const a = PortResolver.resolve(new Port({ X: 1, Y: 0.5 }), host);
        assert.equal(a.side, PortSide.E);
    });

    test('center (all distances tied): W per priority order W→E→N→S', () => {
        const a = PortResolver.resolve(new Port({ X: 0.5, Y: 0.5 }), host);
        assert.equal(a.side, PortSide.W);
    });

    test('top-left corner (W ties with N): W per priority order', () => {
        const a = PortResolver.resolve(new Port({ X: 0, Y: 0 }), host);
        assert.equal(a.side, PortSide.W);
    });

    test('top-right corner (E ties with N): E per priority order', () => {
        // dL=1, dR=0, dT=0, dB=1. dR and dT tied at 0. Priority sees
        // dR before dT, so E wins.
        const a = PortResolver.resolve(new Port({ X: 1, Y: 0 }), host);
        assert.equal(a.side, PortSide.E);
    });

    test('bottom-right corner: E per priority order', () => {
        const a = PortResolver.resolve(new Port({ X: 1, Y: 1 }), host);
        assert.equal(a.side, PortSide.E);
    });

    test('bottom-left corner (W ties with S): W per priority order', () => {
        const a = PortResolver.resolve(new Port({ X: 0, Y: 1 }), host);
        assert.equal(a.side, PortSide.W);
    });
});

describe('PortResolver — explicit Side overrides Auto derivation', () => {
    const host = HOST(0, 0, 100, 100);

    test('center port with Side=S returns S despite all-tied distances', () => {
        const a = PortResolver.resolve(
            new Port({ X: 0.5, Y: 0.5, Side: PortSide.S }), host);
        assert.equal(a.side, PortSide.S);
    });

    test('top-left port with explicit Side=E ignores the auto-derived W', () => {
        const a = PortResolver.resolve(
            new Port({ X: 0, Y: 0, Side: PortSide.E }), host);
        assert.equal(a.side, PortSide.E);
    });

    test('explicit side never collapses to Auto in the output anchor', () => {
        for (const side of [PortSide.N, PortSide.S, PortSide.E, PortSide.W])
        {
            const a = PortResolver.resolve(
                new Port({ X: 0.5, Y: 0.5, Side: side }), host);
            assert.equal(a.side, side);
        }
    });
});

describe('PortResolver — outline mode preconditions', () => {
    test('throws when host.Geometry is missing', () => {
        const p = new Port({ CoordSpace: PortCoordSpace.Outline, OutlineT: 0.5 });
        assert.throws(
            () => PortResolver.resolve(p, HOST(0, 0, 100, 100)),
            (err: Error) => {
                assert.match(err.message, /outline/i);
                assert.match(err.message, /Geometry/);
                return true;
            },
        );
    });
});
