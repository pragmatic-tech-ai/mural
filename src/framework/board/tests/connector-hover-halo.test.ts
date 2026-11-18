// Regression for the connector hover-halo coordinate bug.
//
// HoverHaloAdorner paints the hovered connector's route by handing the
// connector's own Geometry to a Shape. The connector renders its route in
// ABSOLUTE canvas coordinates, so the halo must paint that geometry 1:1 —
// no fit-to-slot scaling.
//
// The original halo was a PLAIN Shape arranged at the full adorner-layer
// extent. The base Shape uniform-scales a 2-D geometry to fill a non-
// degenerate slot, so for a route with real 2-D bounds (a connector WITH
// waypoints) it blew the halo up to fill the whole layer (correct shape,
// wrong size/place). Axis-aligned routes have zero-area bounds and dodged
// the fit, which is why only waypoint connectors showed the bug.
//
// A first fix arranged the plain Shape at Size.Zero (relying on Shape's
// degenerate-slot short-circuit). That paints verbatim in isolation but
// regressed live: the SVG renderer re-emits a visual's own primitives on a
// SIZE change, and a halo that stays 0×0 across the hidden→shown
// transition never repaints — so the halo stopped appearing entirely.
//
// The shipped fix is HaloShape: a Shape subclass that paints its Geometry
// verbatim regardless of slot. The adorner arranges it at the full layer
// extent (non-degenerate, so size-change repaint tracking fires) and the
// route is NEVER scaled. These tests pin both: HaloShape paints 1:1 at a
// full-layer slot, while a plain Shape at the same slot fit-scales (the
// old bug).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Point,
    Rect,
    Size,
    type DrawingContext,
} from '../../../runtime/index.js';
import type { Brush, Pen } from '../../../visual-engine/index.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import type { Transform } from '../../../visual-engine/drawing/transform.js';
import { waypoint } from '../route-waypoint.js';
import { Shape } from '../../../basic/shapes/shape.js';
import { HaloShape } from '../behaviors/connector-interactions-behavior.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';

class CapturingContext implements DrawingContext
{
    public transforms: Transform[]              = [];
    public geoms:      unknown[]                 = [];
    public pens:       (Pen | undefined)[]       = [];
    DrawGeometry(_b: Brush | undefined, p: Pen | undefined, g: unknown): void { this.geoms.push(g); this.pens.push(p); }
    DrawRectangle(): void { throw new Error('not used'); }
    DrawText():      void { throw new Error('not used'); }
    PushTransform(t: Transform): void { this.transforms.push(t); }
    PushClip():      void { /* no-op */ }
    Pop():           void { /* no-op */ }
}

function newApplication(): void
{
    Application.current = null;
    new Application();
}

// A connector whose route bends through a waypoint, so its geometry has
// real width AND height (unlike a straight axis-aligned route).
function waypointConnector(): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(200, 0) });
    c.Waypoints = [waypoint(new Point(100, 120))];
    return c;
}

// Render `ShapeCtor` painting the connector's Geometry, measured
// unbounded, arranged at the given slot.
function renderHalo(
    ShapeCtor: new () => Shape,
    c:         Connector,
    slot:      Rect,
): CapturingContext
{
    const halo = new ShapeCtor();
    halo.Geometry = c.Geometry;
    halo.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));
    halo.Arrange(slot);
    const dc = new CapturingContext();
    halo.Render(dc);
    return dc;
}

describe('connector hover halo — paints route verbatim, never fit-scaled', () => {

    test('a waypoint route has 2-D bounds', () => {
        newApplication();
        const g = waypointConnector().Geometry;
        assert.ok(g !== undefined, 'route geometry computed synchronously');
        const b = g.GetBounds();
        assert.ok(b.Width > 0 && b.Height > 0, 'bounds span both axes');
    });

    test('HaloShape paints the route 1:1 at a full-layer slot — no fit transform', () => {
        newApplication();
        const c = waypointConnector();
        const dc = renderHalo(HaloShape, c, new Rect(0, 0, 800, 600));
        assert.equal(dc.transforms.length, 0, 'HaloShape never fit-scales, regardless of slot');
        assert.equal(dc.geoms.length, 1);
        assert.equal(dc.geoms[0], c.Geometry, 'same geometry instance, painted as-authored');
    });

    test('a plain Shape at the same full-layer slot WOULD fit-scale the route (the old bug)', () => {
        newApplication();
        const c = waypointConnector();
        const dc = renderHalo(Shape, c, new Rect(0, 0, 800, 600));
        assert.equal(dc.transforms.length, 1, 'base Shape scales 2-D geometry to fill a non-degenerate slot');
    });
});

describe('connector hit band — forgiving pointer target', () => {

    test('a Connector ships a non-zero HitTestStrokeWidth by default', () => {
        newApplication();
        assert.ok(waypointConnector().HitTestStrokeWidth > 0, 'connectors are hard to hit on a 1px line — band is on by default');
    });

    test('rendering a connector emits an invisible wide hit band under the visible route', () => {
        newApplication();
        const c = waypointConnector();
        const dc = new CapturingContext();
        c.Render(dc);
        // Two passes: the transparent hit band first, then the visible route.
        assert.equal(dc.geoms.length, 2, 'hit band + visible route');
        const bandPen = dc.pens[0];
        assert.ok(bandPen !== undefined, 'band carries a pen');
        assert.equal(bandPen.Thickness, c.HitTestStrokeWidth, 'band width = HitTestStrokeWidth');
        const brush = bandPen.Brush;
        assert.ok(brush instanceof SolidColorBrush, 'band stroke is a solid colour');
        assert.equal(brush.Color.A, 0, 'band is fully transparent — invisible but still hittable');
        assert.equal(dc.geoms[0], c.Geometry, 'band paints the route geometry');
        assert.equal(dc.geoms[1], c.Geometry, 'visible pass paints the same route geometry');
    });

    test('HitTestStrokeWidth = 0 paints only the visible route (no band)', () => {
        newApplication();
        const c = waypointConnector();
        c.HitTestStrokeWidth = 0;
        const dc = new CapturingContext();
        c.Render(dc);
        assert.equal(dc.geoms.length, 1, 'no band when the width is zero');
    });
});
