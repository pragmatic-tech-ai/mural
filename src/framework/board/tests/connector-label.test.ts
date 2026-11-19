import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Point, PathGeometry } from '../../../visual-engine/index.js';
import { Key, KeyEventArgs, ModifierKeys, Rect } from '../../../runtime/index.js';
import { Canvas } from '../../../basic/panels/canvas.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { ShapeText } from '../shape-text.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { pointAlongPolyline, nearestTOnPolyline, splitPolylineAroundRect } from '../connector-route.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';

// § board-text Slice 5 — connector labels. A Connector owns a first-class
// ShapeText that rides its route at an arc-length fraction (LabelPosition,
// 0.5 = midpoint), is draggable along the path, and persists.

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

describe('connector-route — polyline geometry (pure)', () => {
    const P = (x: number, y: number): Point => new Point(x, y);

    test('pointAlongPolyline finds the arc-length midpoint of one segment', () => {
        const r = pointAlongPolyline([P(0, 0), P(100, 0)], 0.5);
        assert.deepEqual([r.point.X, r.point.Y], [50, 0]);
        assert.equal(r.tangent, 0);
    });

    test('pointAlongPolyline measures by arc length across bends', () => {
        // Two 100-unit legs → total 200; t=0.5 lands exactly on the corner.
        const pts = [P(0, 0), P(100, 0), P(100, 100)];
        assert.deepEqual(pointAlongPolyline(pts, 0.5).point, P(100, 0));
        // t=0.75 → 150 units → halfway down the second (vertical) leg.
        assert.deepEqual(pointAlongPolyline(pts, 0.75).point, P(100, 50));
    });

    test('pointAlongPolyline clamps t and tolerates degenerate input', () => {
        const pts = [P(0, 0), P(10, 0)];
        assert.deepEqual(pointAlongPolyline(pts, -1).point, P(0, 0));
        assert.deepEqual(pointAlongPolyline(pts, 2).point, P(10, 0));
        assert.deepEqual(pointAlongPolyline([], 0.5).point, Point.Zero);
    });

    test('nearestTOnPolyline projects a cursor onto the route', () => {
        const pts = [P(0, 0), P(100, 0)];
        assert.equal(nearestTOnPolyline(pts, P(50, 10)), 0.5);
        assert.equal(nearestTOnPolyline(pts, P(30, -5)), 0.3);
        // Off the ends clamps to the segment (t stays in [0,1]).
        assert.equal(nearestTOnPolyline(pts, P(-40, 0)), 0);
        assert.equal(nearestTOnPolyline(pts, P(140, 0)), 1);
    });

    // splitPolylineAroundRect breaks a route where a label sits: the drawn
    // line stops at the label rect's near edge and resumes at its far edge.
    test('splitPolylineAroundRect breaks a straight line into two around a mid rect', () => {
        const pts = [P(0, 0), P(100, 0)];
        // Label rect covers x 40..60 (y -10..10 straddles the line).
        const parts = splitPolylineAroundRect(pts, new Rect(40, -10, 20, 20));
        assert.equal(parts.length, 2, 'one polyline each side of the label');
        assert.deepEqual(parts[0], [P(0, 0), P(40, 0)], 'leading run stops at the near edge');
        assert.deepEqual(parts[1], [P(60, 0), P(100, 0)], 'trailing run resumes at the far edge');
    });

    test('splitPolylineAroundRect returns the whole line when the rect misses it', () => {
        const pts = [P(0, 0), P(100, 0)];
        // Rect sits well off the line (label dragged away from the route).
        const parts = splitPolylineAroundRect(pts, new Rect(40, 50, 20, 20));
        assert.equal(parts.length, 1, 'no gap');
        assert.deepEqual(parts[0], pts, 'the original polyline, unbroken');
    });

    test('splitPolylineAroundRect drops the leading run when the rect covers the start', () => {
        const pts = [P(0, 0), P(100, 0)];
        // Rect x -10..40 swallows the start vertex → only a trailing run remains.
        const parts = splitPolylineAroundRect(pts, new Rect(-10, -10, 50, 20));
        assert.equal(parts.length, 1, 'only the trailing run survives');
        assert.deepEqual(parts[0], [P(40, 0), P(100, 0)]);
    });

    test('splitPolylineAroundRect spans a bend when the label sits on a corner', () => {
        const pts = [P(0, 0), P(100, 0), P(100, 100)];
        // Rect x 90..110 y -10..10 covers the (100,0) corner.
        const parts = splitPolylineAroundRect(pts, new Rect(90, -10, 20, 20));
        assert.equal(parts.length, 2, 'gap spans the corner');
        assert.deepEqual(parts[0], [P(0, 0), P(90, 0)], 'leading run into the corner');
        assert.deepEqual(parts[1], [P(100, 10), P(100, 100)], 'trailing run out of the corner');
    });
});

describe('Connector label — model + sugar', () => {
    beforeEach(() => { initTestApp(); });

    test('a Connector seeds a first-class ShapeText label', () => {
        const c = new Connector();
        assert.ok(c.Text instanceof ShapeText, 'Connector.Text is a ShapeText');
    });

    // F2 on a selected connector begins editing its label — the keyboard
    // equivalent of double-clicking it (Connector.OnPointerDown). Previously F2
    // only handled selected figures, so a selected connector did nothing.
    test('F2 on a selected connector begins editing its label', () => {
        const board = new Board();
        const c = new Connector();
        board.SelectConnector(c);
        const keyArgs = new KeyEventArgs('KeyDown', board, {
            Key: Key.F2, KeyText: 'F2', Code: 'F2', Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        (board as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(keyArgs);
        assert.equal(keyArgs.Handled, true, 'F2 is consumed');
        assert.equal(c.Text.IsEditing, true, 'F2 puts the connector label into edit mode');
    });

    test('LabelText is sugar over Text.Content; LabelPosition defaults to the midpoint', () => {
        const c = new Connector();
        assert.equal(c.LabelPosition, 0.5, 'default rides the midpoint');
        c.LabelText = 'yes';
        assert.equal(c.Text.Content, 'yes');
        c.Text.Content = 'no';
        assert.equal(c.LabelText, 'no');
    });

    test('an empty label is non-hit-testable (clicks fall through to the route)', () => {
        const c = new Connector();
        assert.equal(c.Text.IsHitTestVisible, false, 'empty label ignores the pointer');
        c.LabelText = 'edge';
        assert.equal(c.Text.IsHitTestVisible, true, 'a captioned label catches the pointer');
    });
});

describe('Connector label — route positioning', () => {
    beforeEach(() => { initTestApp(); });

    function wired(): Connector
    {
        const a = new Figure(); a.Left = 0;   a.Top = 0;
        const b = new Figure(); b.Left = 240; b.Top = 0;
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ Node: a });
        c.Target = new ConnectorEndpoint({ Node: b });
        return c;
    }

    test('a wired connector computes a route the label can ride', () => {
        const c = wired();
        assert.ok(c.CurrentRoutePoints !== undefined && c.CurrentRoutePoints.length >= 2,
            'CurrentRoutePoints is a polyline');
    });

    test('moving LabelPosition slides the label along the route', () => {
        const c = wired();
        c.LabelText = 'x';
        c.LabelPosition = 0.2;
        const left1 = Canvas.GetLeft(c.Text);
        c.LabelPosition = 0.8;
        const left2 = Canvas.GetLeft(c.Text);
        assert.notEqual(left1, left2, 'the label re-places at the new arc fraction');
    });

    test('a double-click on the connector begins editing its label', () => {
        const c = wired();
        // Duck-typed PointerEventArgs — OnPointerDown's double-click path only
        // reads IsDoubleClick + Handled.
        const args = { IsDoubleClick: true, Handled: false };
        (c as unknown as { OnPointerDown(a: unknown): void }).OnPointerDown(args);
        assert.equal(args.Handled, true, 'the gesture is consumed');
        assert.equal(c.Text.IsEditing, true, 'the midpoint label enters edit mode');
    });
});

describe('Connector label — line gap', () => {
    beforeEach(() => { initTestApp(); });

    // The route runs horizontally at y≈40 from x≈80 to x≈240 (see the route
    // positioning suite above).
    function wired(): Connector
    {
        const a = new Figure(); a.Left = 0;   a.Top = 0;
        const b = new Figure(); b.Left = 240; b.Top = 0;
        const c = new Connector();
        c.Source = new ConnectorEndpoint({ Node: a });
        c.Target = new ConnectorEndpoint({ Node: b });
        return c;
    }

    // The drawn polyline the connector cached for its route (post cap-inset) —
    // what _applyLabelGap breaks around a label. Set by the recompute.
    function drawnPolyline(c: Connector): readonly Point[] | undefined
    {
        return (c as unknown as { _drawnPolyline: readonly Point[] | undefined })._drawnPolyline;
    }

    function gapped(c: Connector, gap: Rect | undefined): PathGeometry
    {
        const poly = drawnPolyline(c)!;
        return (c as unknown as { _gappedGeometry(p: readonly Point[], g: Rect | undefined): PathGeometry })
            ._gappedGeometry(poly, gap);
    }

    // Note: a detached connector label cannot MEASURE in this headless harness
    // (its template only materializes once mounted, so DesiredSize is 0 and
    // _labelGapRect always bails). We therefore exercise the connector's
    // geometry assembly directly with an explicit gap rect — the measured
    // placement path is verified live in Plexus. splitPolylineAroundRect's own
    // math is covered by the pure suite above.

    test('an empty connector draws one unbroken figure', () => {
        const c = wired();
        // End-to-end: an empty label yields no gap rect, so the recompute wrote
        // a single continuous figure.
        assert.equal((c.Geometry as unknown as PathGeometry).Figures.length, 1);
    });

    test('the route assembles as two figures when a label rect sits on it', () => {
        const c = wired();
        // A label box straddling the mid of the route (y≈40, x 80..240).
        const geom = gapped(c, new Rect(140, 30, 60, 20));
        assert.equal(geom.Figures.length, 2, 'the line gaps around the label');
    });

    test('the route assembles as one figure when there is no gap rect', () => {
        const c = wired();
        assert.equal(gapped(c, undefined).Figures.length, 1, 'no label → one continuous figure');
    });

    test('the route assembles as one figure when the rect misses the line', () => {
        const c = wired();
        // Rect well below the y≈40 route — a label dragged off the path.
        assert.equal(gapped(c, new Rect(140, 200, 60, 20)).Figures.length, 1);
    });
});

describe('Connector label — persistence', () => {
    beforeEach(() => { initTestApp(); });

    test('label text + position round-trip through Save/Load', () => {
        const doc = new BoardDocument(new MemoryStorage());
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 240, 0)!;
        const c = doc.CreateConnector(
            new ConnectorEndpoint({ Node: a }),
            new ConnectorEndpoint({ Node: b }))!;
        c.LabelText     = 'depends on';
        c.LabelPosition = 0.3;
        doc.Save();
        doc.Load();
        const reloaded = doc.Connectors.Get(0)!;
        assert.equal(reloaded.LabelText, 'depends on', 'label content restored');
        assert.equal(reloaded.LabelPosition, 0.3, 'label position restored');
    });

    test('a label-less connector persists no label fields', () => {
        const doc = new BoardDocument(new MemoryStorage());
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 240, 0)!;
        doc.CreateConnector(
            new ConnectorEndpoint({ Node: a }),
            new ConnectorEndpoint({ Node: b }));
        doc.Save();
        doc.Load();
        const reloaded = doc.Connectors.Get(0)!;
        assert.equal(reloaded.LabelText, '', 'stays uncaptioned');
        assert.equal(reloaded.LabelPosition, 0.5, 'stays at the midpoint default');
    });
});
