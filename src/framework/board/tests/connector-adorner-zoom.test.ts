// BUGFIX #3 (SP4 follow-up): the connector-interaction adorners — side bars,
// endpoint/waypoint/segment handles, port markers — arranged their chrome at
// raw CONTENT-space coordinates. Under the LayoutTransform camera the
// AdornerLayer sits OUTSIDE PART_Camera (host space), so raw content coords
// drift by the zoom scale: at 142% the handles landed short of the connectors
// they decorate (see the live-smoke screenshot). Every other adorner
// (SelectionBoundsAdorner) already projects content -> layer via the
// AdornedToLayerMatrix the AdornerLayer hands it; these must too.
//
// Setup mirrors selection-bounds-adorner.test.ts: AdornerDecorator > camera
// [LayoutTransform Scale] > adorned. The bars/handles must project through
// that scale so they hug the zoomed figures/connectors, while their own
// thickness/size stays a constant on-screen chrome size.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import {
    AdornerDecorator,
    Rect,
    Size,
    Visual,
    Element,
    type DrawingContext,
} from '../../../runtime/index.js';
import { Border } from '../../../basic/index.js';
import { ScaleTransform } from '../../../visual-engine/drawing/transform.js';
import {
    SideBarsAdorner,
    EditHandlesAdorner,
} from '../behaviors/connector-interactions-behavior.js';
import { Figure } from '../figure.js';
import { PortSide } from '../port.js';
import { BoardSettings } from '../board-settings.js';

// Any Visual can stand in for the items panel: the adorners read figure /
// connector coords from shared state / the board, not from this element's
// children. Sized so the layer has a non-degenerate extent.
class PanelStub extends Element
{
    constructor() { super(); this.Width = 800; this.Height = 600; }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void {}
}

// Build AdornerDecorator > camera[Scale(zoom)] > panel and return the layer +
// panel. zoom = 1 yields an identity projection (backward-compatible baseline).
function zoomedLayer(zoom: number)
{
    const decorator = new AdornerDecorator();
    const camera = new Border();
    if (zoom !== 1) camera.LayoutTransform = new ScaleTransform(zoom, zoom);
    const panel = new PanelStub();
    camera.SetChild(panel);
    decorator.Child = camera;
    const host = new Border();
    host.SetChild(decorator);
    host.Measure(new Size(2000, 2000));
    host.Arrange(new Rect(0, 0, 2000, 2000));
    return { layer: decorator.AdornerLayer, panel };
}

function arrangeLayer(layer: { Measure(s: Size): void; Arrange(r: Rect): void }): void
{
    layer.Measure(new Size(2000, 2000));
    layer.Arrange(new Rect(0, 0, 2000, 2000));
}

// SharedState / HandleDownCallback are module-private; borrow their exact
// shapes off the ctor signature so the test needs no `as never`.
type StateArg = ConstructorParameters<typeof SideBarsAdorner>[1];
type DownArg  = ConstructorParameters<typeof SideBarsAdorner>[2];
const noopDown = (() => {}) as DownArg;

function makeState(over: Partial<Record<string, unknown>>): StateArg
{
    return {
        hoveredFigure:    undefined,
        hoverSide:        undefined,
        hoveredConnector: undefined,
        activeGesture:    undefined,
        activePointerId:  undefined,
        editKind:         undefined,
        ...over,
    } as StateArg;
}

describe('connector adorners track figures/connectors under a camera zoom', () => {
    beforeEach(() => { initTestApp(); });

    test('SideBarsAdorner E bar hugs the SCALED figure edge, thickness stays constant', () => {
        const zoom = 2;
        const { layer, panel } = zoomedLayer(zoom);
        // Figure at content (100, 50), 40 x 30. E edge sits at x = 140.
        const fig = Figure.fromKind('rectangle', 100, 50, { width: 40, height: 30 });
        const state = makeState({ hoveredFigure: fig, hoverSide: PortSide.E });

        const adorner = new SideBarsAdorner(panel as unknown as Visual, state, noopDown);
        layer.Add(adorner);
        arrangeLayer(layer);

        const t    = BoardSettings.SideBarThickness();
        const inY  = 30 * 0.05;             // SIDE_BAR_INSET_RATIO
        const barH = 30 - 2 * inY;
        // visualChildren = [N, S, E, W bars, ...port markers]; E is index 2.
        const eBar = adorner.visualChildren[2]!.ArrangedRect;
        // Edge x scaled (140 -> 280); the bar is centered on it (minus half t).
        assert.equal(eBar.X + eBar.Width / 2, 140 * zoom, 'E bar centered on scaled edge');
        assert.equal(eBar.Y, (50 + inY) * zoom, 'bar top scaled');
        assert.equal(eBar.Height, barH * zoom, 'bar length scales with the figure');
        assert.equal(eBar.Width, t, 'bar thickness stays a constant on-screen size');
    });

    test('SideBarsAdorner E bar is unchanged at zoom 1 (identity baseline)', () => {
        const { layer, panel } = zoomedLayer(1);
        const fig = Figure.fromKind('rectangle', 100, 50, { width: 40, height: 30 });
        const state = makeState({ hoveredFigure: fig, hoverSide: PortSide.E });
        const adorner = new SideBarsAdorner(panel as unknown as Visual, state, noopDown);
        layer.Add(adorner);
        arrangeLayer(layer);

        const t    = BoardSettings.SideBarThickness();
        const inY  = 30 * 0.05;
        const barH = 30 - 2 * inY;
        const eBar = adorner.visualChildren[2]!.ArrangedRect;
        assert.equal(eBar.X, 100 + 40 - t / 2);
        assert.equal(eBar.Y, 50 + inY);
        assert.equal(eBar.Height, barH);
        assert.equal(eBar.Width, t);
    });

    test('EditHandlesAdorner endpoint dots center on the SCALED anchors, size constant', () => {
        const zoom = 2;
        const { layer, panel } = zoomedLayer(zoom);
        // Minimal fake connector + board: one selected connector with anchors.
        const conn = {
            CurrentSourceAnchor: { x: 100, y: 50 },
            CurrentTargetAnchor: { x: 200, y: 80 },
            Waypoints:           [],
            CurrentRoutePoints:  [],
        };
        // SelectedConnectors is iterated (for..of); Connectors is probed by
        // Count/Get (collectionContains) — one object satisfies both.
        const coll = {
            Count: 1,
            Get: (_i: number) => conn,
            [Symbol.iterator]() { return [conn][Symbol.iterator](); },
        };
        const board = {
            SelectedConnectors: coll,
            Connectors:         coll,
            IsConnectorSelected: () => true,
        };
        const state = makeState({});

        const adorner = new EditHandlesAdorner(
            panel as unknown as Visual,
            board as never,
            state,
            noopDown,
        );
        layer.Add(adorner);
        arrangeLayer(layer);

        const sz = BoardSettings.EndpointHandleSize();
        // visualChildren = [...epPool(8), ...wpPool, ...segPool]; ep[0]=source, ep[1]=target.
        const src = adorner.visualChildren[0]!.ArrangedRect;
        const tgt = adorner.visualChildren[1]!.ArrangedRect;
        assert.equal(src.X + src.Width / 2, 100 * zoom, 'source dot centered on scaled anchor x');
        assert.equal(src.Y + src.Height / 2, 50 * zoom, 'source dot centered on scaled anchor y');
        assert.equal(src.Width, sz, 'dot stays a constant on-screen size');
        assert.equal(tgt.X + tgt.Width / 2, 200 * zoom, 'target dot centered on scaled anchor x');
        assert.equal(tgt.Y + tgt.Height / 2, 80 * zoom, 'target dot centered on scaled anchor y');
    });
});
