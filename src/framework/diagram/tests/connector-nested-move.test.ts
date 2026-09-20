// Stage 3: a connector anchored to a NESTED node re-routes when an ANCESTOR
// container moves (the nested node's own Left/Top don't tick on a container move).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { PathGeometry, Point } from '../../../visual-engine/index.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { RoutingMode } from '../routing/router.js';
// Side-effect: register the routers under their RoutingMode names.
import '../routing/straight-router.js';

function app(): void { Application.current = null; new Application(); }
function startPt(c: Connector): Point { return (c.Geometry as PathGeometry).Figures[0]!.StartPoint; }
function endPt(c: Connector): Point
{
    const seg = (c.Geometry as PathGeometry).Figures[0]!.Segments[0]! as unknown as { Point: Point };
    return seg.Point;
}

test('moving an ancestor container re-routes a connector anchored to its nested child (source)', () => {
    app();
    const container = new ContainerFigure();
    container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 20, 20, { width: 30, height: 20 });
    child.ContainerParent = container;   // nested BEFORE the endpoint attaches
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ Node: child });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(800, 200) });   // far right → east anchor
    const beforeX = startPt(c).X;

    container.Left = container.Left + 150;   // move the ANCESTOR (child's own Left/Top unchanged)

    assert.equal(startPt(c).X - beforeX, 150, 'source anchor tracked the container move');
});

test('moving an ancestor container re-routes a connector anchored to its nested child (target)', () => {
    app();
    const container = new ContainerFigure();
    container.Left = 400; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 20, 20, { width: 30, height: 20 });
    child.ContainerParent = container;
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 200) });
    c.Target = new ConnectorEndpoint({ Node: child });
    const beforeY = endPt(c).Y;

    container.Top = container.Top + 60;   // move the ancestor vertically

    assert.equal(endPt(c).Y - beforeY, 60, 'target anchor tracked the container move');
});

test('nesting an already-connected node then moving the container re-routes it', () => {
    app();
    const container = new ContainerFigure();
    container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 300, 120, { width: 30, height: 20 }); // starts at ROOT
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ Node: child });   // attached while child is root → no ancestors yet
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(800, 200) });

    // Simulate ContainerPlacement.reparent: link the parent, then write parent-
    // relative Left/Top (the write is what fires the node-moved handler → refresh).
    child.ContainerParent = container;
    child.Left = 20; child.Top = 20;

    const beforeX = startPt(c).X;
    container.Left = container.Left + 150;   // move the ancestor
    assert.equal(startPt(c).X - beforeX, 150, 'ancestor subscription was refreshed on reparent');
});
