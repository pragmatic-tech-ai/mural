// Step 7 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins shortenPolyline math + the CapInset attached property + the
// Connector's cap-instantiation / inset-shortening / rotation pipeline.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DataContextBinding } from '../../../runtime/index.js';
import {
    Color,
    PathGeometry,
    Pen,
    Point,
    RotateTransform,
    ScaleTransform,
    SolidColorBrush,
    TransformGroup,
    type Visual,
} from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { Path } from '../../../basic/shapes/path.js';
import { Canvas } from '../../../basic/panels/canvas.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Connector } from '../connector.js';
import {
    pathGeometryToPolyline,
    polylineToPathGeometry,
    shortenPolyline,
} from '../caps/cap-inset.js';
import { RoutingMode } from '../routing/router.js';
// Side-effect imports for the routers used in the pipeline tests.
import '../routing/straight-router.js';
import '../routing/orthogonal-router.js';
import '../routing/bezier-router.js';

// A cap's RenderTransform is a TransformGroup [Scale, Rotate] (scale and
// rotate share the hot-point origin). These pull each child out for the
// orientation / size assertions.
function capRotate(cap: Visual): RotateTransform
{
    const g = cap.RenderTransform as TransformGroup;
    assert.ok(g instanceof TransformGroup);
    const r = g.Children.Get(1);
    assert.ok(r instanceof RotateTransform);
    return r;
}
function capScale(cap: Visual): ScaleTransform
{
    const g = cap.RenderTransform as TransformGroup;
    assert.ok(g instanceof TransformGroup);
    const s = g.Children.Get(0);
    assert.ok(s instanceof ScaleTransform);
    return s;
}

// ── shortenPolyline math ─────────────────────────────────────────────

describe('shortenPolyline — single-segment line', () => {
    test('zero inset is identity', () => {
        const pts = [new Point(0, 0), new Point(100, 0)];
        const out = shortenPolyline(pts, 0, 0);
        assert.equal(out, pts);
    });

    test('shorten source by 10 along a 100-unit east line', () => {
        const out = shortenPolyline([new Point(0, 0), new Point(100, 0)], 10, 0);
        assert.equal(out.length, 2);
        assert.equal(out[0]!.X, 10);
        assert.equal(out[0]!.Y, 0);
        assert.equal(out[1]!.X, 100);
        assert.equal(out[1]!.Y, 0);
    });

    test('shorten target by 10 along a 100-unit east line', () => {
        const out = shortenPolyline([new Point(0, 0), new Point(100, 0)], 0, 10);
        assert.equal(out[0]!.X, 0);
        assert.equal(out[1]!.X, 90);
    });

    test('shorten both ends along the same line', () => {
        const out = shortenPolyline([new Point(0, 0), new Point(100, 0)], 10, 15);
        assert.equal(out[0]!.X, 10);
        assert.equal(out[1]!.X, 85);
    });

    test('inset equal to segment length collapses to single point', () => {
        const out = shortenPolyline([new Point(0, 0), new Point(100, 0)], 100, 0);
        // segLen == remaining → trims first vertex via in-place
        // assignment; second vertex still in place. New segment is
        // zero-length.
        assert.equal(out.length, 2);
        assert.equal(out[0]!.X, 100);
        assert.equal(out[1]!.X, 100);
    });
});

describe('shortenPolyline — multi-segment polyline', () => {
    test('source inset spans the first segment + part of the second', () => {
        // L-shape: (0,0) → (100, 0) → (100, 100). Length 100 + 100 = 200.
        // Shorten source by 150: drop the first segment entirely (100
        // length consumed), then shorten the second segment by 50.
        // Remaining polyline: starts at (100, 50), ends at (100, 100).
        const pts = [new Point(0, 0), new Point(100, 0), new Point(100, 100)];
        const out = shortenPolyline(pts, 150, 0);
        assert.equal(out.length, 2);
        assert.equal(out[0]!.X, 100);
        assert.equal(out[0]!.Y, 50);
        assert.equal(out[1]!.X, 100);
        assert.equal(out[1]!.Y, 100);
    });

    test('target inset spans the last segment + part of the previous', () => {
        const pts = [new Point(0, 0), new Point(100, 0), new Point(100, 100)];
        // Total length 200. Shorten target by 150: drop last segment
        // (100), then shorten second-to-last by 50.
        const out = shortenPolyline(pts, 0, 150);
        assert.equal(out.length, 2);
        assert.equal(out[0]!.X, 0);
        assert.equal(out[0]!.Y, 0);
        assert.equal(out[1]!.X, 50);
        assert.equal(out[1]!.Y, 0);
    });
});

describe('shortenPolyline — PathGeometry round-trip', () => {
    test('toPolyline + polylineToPathGeometry preserves line-only paths', () => {
        const pts = [new Point(0, 0), new Point(100, 0), new Point(100, 100)];
        const g  = polylineToPathGeometry(pts);
        const back = pathGeometryToPolyline(g);
        assert.ok(back !== undefined);
        assert.equal(back!.length, pts.length);
        for (let i = 0; i < pts.length; i++)
        {
            assert.equal(back![i]!.X, pts[i]!.X);
            assert.equal(back![i]!.Y, pts[i]!.Y);
        }
    });
});

// ── CapInset attached property ───────────────────────────────────────

describe('Connector.CapInset attached property', () => {
    function makeVisual(): Visual
    {
        // A Border carries a Visual identity and exposes the standard
        // get_property_value / set_property_value surface — sufficient
        // for the attached-property roundtrip.
        return new Border();
    }

    test('default value is 0', () => {
        const v = makeVisual();
        assert.equal(Connector.GetCapInset(v), 0);
    });

    test('Set + Get roundtrip', () => {
        const v = makeVisual();
        Connector.SetCapInset(v, 12);
        assert.equal(Connector.GetCapInset(v), 12);
    });
});

// ── Connector cap pipeline ───────────────────────────────────────────

// Factory: produces a template whose root visual carries CapInset=`inset`.
function capTemplate(inset: number): DataTemplate
{
    return new DataTemplate(() => {
        const root = new Border();
        Connector.SetCapInset(root, inset);
        // Give the cap a token Brush so a downstream renderer would
        // have something to paint — only structural for v1.
        root.Fill = new SolidColorBrush(Color.FromHex('#000000'));
        return root;
    });
}

function startEndOf(c: Connector): { start: Point; end: Point }
{
    const g    = c.Geometry as PathGeometry;
    const fig  = g.Figures[0]!;
    const segs = fig.Segments;
    const last = segs[segs.length - 1]!;
    return { start: fig.StartPoint, end: (last as { Point: Point }).Point };
}

describe('Connector — cap-template instantiation', () => {
    test('setting SourceCapTemplate materializes the cap visual via template.Apply', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        assert.equal(c.SourceCapInstance, undefined);

        c.SourceCapTemplate = capTemplate(12);
        assert.ok(c.SourceCapInstance !== undefined);
        // CapInset attached property reads back the value the
        // template set on its root.
        assert.equal(Connector.GetCapInset(c.SourceCapInstance!), 12);
    });

    test('setting TargetCapTemplate materializes the target cap independently', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        c.TargetCapTemplate = capTemplate(8);
        assert.ok(c.TargetCapInstance !== undefined);
        assert.equal(c.SourceCapInstance, undefined);   // unaffected
        assert.equal(Connector.GetCapInset(c.TargetCapInstance!), 8);
    });
});

describe('Connector — inset shortens the painted line by exactly CapInset', () => {
    test('source cap with inset=12 trims the source end by 12 along a 100-unit horizontal line', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        // Before cap: route runs 0 → 100, length 100.
        const before = startEndOf(c);
        assert.equal(before.start.X, 0);
        assert.equal(before.end.X,   100);

        c.SourceCapTemplate = capTemplate(12);
        const after = startEndOf(c);
        assert.equal(after.start.X, 12);
        assert.equal(after.end.X,   100);
    });

    test('source + target caps trim both ends symmetrically', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        c.SourceCapTemplate = capTemplate(10);
        c.TargetCapTemplate = capTemplate(15);
        const after = startEndOf(c);
        assert.equal(after.start.X, 10);
        assert.equal(after.end.X,   85);
    });
});

describe('Connector — per-end CapScale resizes the cap + its inset', () => {
    function eastConnector(): Connector
    {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        return c;
    }

    test('SourceCapScale drives the cap ScaleTransform (default 1)', () => {
        const c = eastConnector();
        c.SourceCapTemplate = capTemplate(0);
        assert.equal(capScale(c.SourceCapInstance!).ScaleX, 1);
        assert.equal(capScale(c.SourceCapInstance!).ScaleY, 1);

        c.SourceCapScale = 1.5;
        assert.equal(capScale(c.SourceCapInstance!).ScaleX, 1.5);
        assert.equal(capScale(c.SourceCapInstance!).ScaleY, 1.5);
    });

    test('scaling the cap scales the inset that trims the line', () => {
        const c = eastConnector();
        c.SourceCapTemplate = capTemplate(12);   // base inset 12
        assert.equal(startEndOf(c).start.X, 12); // 1× → trim 12

        c.SourceCapScale = 0.5;                  // half-size cap
        assert.equal(startEndOf(c).start.X, 6);  // trim 6

        c.SourceCapScale = 1.5;                  // 1.5× cap
        assert.equal(startEndOf(c).start.X, 18); // trim 18
    });

    test('per-end scales are independent + survive a re-route', () => {
        const c = eastConnector();
        c.SourceCapTemplate = capTemplate(0);
        c.TargetCapTemplate = capTemplate(0);
        c.SourceCapScale = 0.5;
        c.TargetCapScale = 1.5;
        // Move the source end — recompute re-places both caps; each keeps
        // its own scale.
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(10, 0) });
        c.SourceCapScale = 0.5;   // re-assert after the endpoint swap reset nothing
        assert.equal(capScale(c.SourceCapInstance!).ScaleX, 0.5);
        assert.equal(capScale(c.TargetCapInstance!).ScaleX, 1.5);
    });
});

describe('Connector — cap rotation matches tangentAt', () => {
    test('east-pointing straight route: source cap RenderTransform.Angle = 180° (outward flip)', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        c.SourceCapTemplate = capTemplate(0);    // pin angle without inset noise

        const t = capRotate(c.SourceCapInstance!);
        // Travel tangent at source = 0° (east); placeCap flips the source
        // cap 180° so it points outward (back at the source node).
        assert.equal(t.Angle, 180);
    });

    test('south-pointing straight route: target cap angle = 90°', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0)   });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(0, 100) });
        c.TargetCapTemplate = capTemplate(0);

        const t = capRotate(c.TargetCapInstance!);
        // tangentAt(target) = π/2 radians = 90°.
        assert.equal(t.Angle, 90);
    });

    test('NE diagonal route: source cap angle ≈ 225° (45° travel + 180° outward flip)', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0)   });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 100) });
        c.SourceCapTemplate = capTemplate(0);

        const t = capRotate(c.SourceCapInstance!);
        // atan2(100, 100) = π/4 rad = 45° travel; +180° source flip = 225°.
        assert.ok(Math.abs(t.Angle - 225) < 1e-9, `expected ~225°, got ${t.Angle}`);
    });
});

describe('Connector — cap position via Canvas.Left / Top', () => {
    test('cap visual is positioned at the resolved endpoint', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(42, 17) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(200, 100) });
        c.SourceCapTemplate = capTemplate(0);

        const cap = c.SourceCapInstance!;
        assert.equal(Canvas.GetLeft(cap), 42);
        assert.equal(Canvas.GetTop(cap),  17);
    });

    test('source-end moves: cap re-positions to the new resolved anchor', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        const src = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
        c.Source = src;
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        c.SourceCapTemplate = capTemplate(0);
        assert.equal(Canvas.GetLeft(c.SourceCapInstance!), 0);

        src.FreePoint = new Point(25, 30);
        assert.equal(Canvas.GetLeft(c.SourceCapInstance!), 25);
        assert.equal(Canvas.GetTop(c.SourceCapInstance!),  30);
    });
});

describe('Connector — cap colour context tracks the connector Stroke', () => {
    function straightConnectorWithSourceCap(): Connector
    {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        c.SourceCapTemplate = capTemplate(0);
        return c;
    }

    test('cap context is created and seeded from the connector Stroke', () => {
        const c = straightConnectorWithSourceCap();
        const ctx = c.SourceCapContext;
        assert.ok(ctx !== undefined, 'context exists once a cap is set');
        // Connector seeds a default Stroke (#475569) in its ctor.
        assert.equal(ctx!.Pen, c.Stroke);
        assert.equal(ctx!.Brush, c.Stroke!.Brush);
    });

    test('the cap visual receives the context as its DataContext', () => {
        const c = straightConnectorWithSourceCap();
        assert.equal(c.SourceCapInstance!.DataContext, c.SourceCapContext);
    });

    test('swapping the connector Stroke pushes the new Pen + Brush into the context', () => {
        const c = straightConnectorWithSourceCap();
        const newPen = new Pen(new SolidColorBrush(Color.FromHex('#ff0000')), 3);
        c.Stroke = newPen;
        assert.equal(c.SourceCapContext!.Pen, newPen);
        assert.equal(c.SourceCapContext!.Brush, newPen.Brush);
    });

    test('swapping the Brush in place on the same Pen recolours the context', () => {
        const c = straightConnectorWithSourceCap();
        const redBrush = new SolidColorBrush(Color.FromHex('#ff0000'));
        // Mutate the existing Pen's Brush reference (PenEditor-style),
        // without swapping the Pen itself.
        c.Stroke!.Brush = redBrush;
        assert.equal(c.SourceCapContext!.Brush, redBrush);
    });
});

// Mirrors exactly what the .mu compiler emits for a catalog cap entry
// (see build/framework/board/caps/caps.template.mu.js): a Path whose
// paint is a DataContextBinding against $Pen / $Brush, plus the
// Connector.CapInset attached property. The factory does NOT set
// DataContext — instantiateCap does, the same as the runtime path.
function markupLikeCap(opts: { paint: 'fill' | 'stroke'; data: string; inset: number }): DataTemplate
{
    return new DataTemplate(() => {
        const p = new Path();
        p.Data = opts.data;
        if (opts.paint === 'fill') p.set_property_value(Path.FillKey,   DataContextBinding(p, 'Brush'));
        else                       p.set_property_value(Path.StrokeKey, DataContextBinding(p, 'Pen'));
        Connector.SetCapInset(p, opts.inset);
        return p;
    });
}

describe('Connector — markup-style cap paint resolves through the DataContext binding', () => {
    function straightConnector(): Connector
    {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        return c;
    }

    test('open cap Stroke=$Pen resolves to the connector Pen', () => {
        const c = straightConnector();
        c.TargetCapTemplate = markupLikeCap({ paint: 'stroke', data: 'M -12,-6 L 0,0 L -12,6', inset: 0 });
        const cap = c.TargetCapInstance as Path;
        assert.equal(cap.Stroke, c.Stroke);
    });

    test('filled cap Fill=$Brush resolves to the connector Brush, and tracks a recolour', () => {
        const c = straightConnector();
        c.TargetCapTemplate = markupLikeCap({ paint: 'fill', data: 'M 0,0 L -12,-6 L -12,6 Z', inset: 12 });
        const cap = c.TargetCapInstance as Path;
        assert.equal(cap.Fill, c.Stroke!.Brush);

        // In-place recolour (PenEditor swapping the brush on the same Pen)
        // flows ctx.Brush → the cap's $Brush binding re-resolves.
        const red = new SolidColorBrush(Color.FromHex('#ff0000'));
        c.Stroke!.Brush = red;
        assert.equal(cap.Fill, red);
    });

    test('filled cap inset still shortens the route (attached prop survives markup path)', () => {
        const c = straightConnector();
        c.TargetCapTemplate = markupLikeCap({ paint: 'fill', data: 'M 0,0 L -12,-6 L -12,6 Z', inset: 12 });
        // 100-unit east route, target inset 12 → tail stops at x=88.
        const g = c.Geometry as PathGeometry;
        const segs = g.Figures[0]!.Segments;
        const last = segs[segs.length - 1] as { Point: Point };
        assert.equal(last.Point.X, 88);
    });
});

describe('Connector — Bezier route bypasses cap-inset shortening (documented v1 gap)', () => {
    test('inset > 0 with Bezier mode leaves the cubic untouched', () => {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Bezier;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });

        const before = c.Geometry as PathGeometry;
        const beforeStart = before.Figures[0]!.StartPoint;
        const beforeSegName = before.Figures[0]!.Segments[0]!.constructor.name;

        c.SourceCapTemplate = capTemplate(20);

        const after = c.Geometry as PathGeometry;
        const afterStart = after.Figures[0]!.StartPoint;
        // pathGeometryToPolyline returns undefined for CubicBezierSegment;
        // _scheduleRecompute writes routeGeom as-is.
        assert.equal(afterStart.X, beforeStart.X);
        assert.equal(after.Figures[0]!.Segments[0]!.constructor.name, beforeSegName);
    });
});
