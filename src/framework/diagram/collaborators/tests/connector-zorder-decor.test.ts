import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, MuralBase, Size, Visual, Panel } from '../../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../../basic/index.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';
import { Connector } from '../../connector.js';
import { ConnectorEndpoint } from '../../connector-endpoint.js';
import { Point } from '../../../../visual-engine/index.js';
import { RoutingMode } from '../../routing/router.js';
import '../../routing/straight-router.js';

function makeConnector(): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    return c;
}

// Diagram on a plain Canvas with one figure and one connector, laid out.
function mount(): { diagram: Diagram; figure: Figure; conn: Connector }
{
    const figure = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(figure);
    const conn = makeConnector();
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    diagram.Connectors = new ObservableCollection<MuralBase>([conn]);
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { diagram, figure, conn };
}

test('a pristine connector paints behind figures (ZIndex -1 vs figure 0)', () => {
    initTestApp();
    const { figure, conn } = mount();
    assert.equal(Panel.GetZIndex(figure), 0, 'figure keeps the default ZIndex');
    assert.equal(Panel.GetZIndex(conn), Connector.DefaultZIndex, 'connector defaults behind');
    assert.equal(Connector.DefaultZIndex, -1);
});

test('caps and label track the connector ZIndex when it changes', () => {
    initTestApp();
    const { conn } = mount();
    Panel.SetZIndex(conn, 7);
    assert.equal(Panel.GetZIndex(conn.LabelInstance), 7, 'label follows connector z');
    if (conn.TargetCapInstance !== undefined)
        assert.equal(Panel.GetZIndex(conn.TargetCapInstance), 7, 'target cap follows connector z');
    if (conn.SourceCapInstance !== undefined)
        assert.equal(Panel.GetZIndex(conn.SourceCapInstance), 7, 'source cap follows connector z');
});
