import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual, Panel, MuralBase } from '../../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../../basic/index.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { SelectionMode } from '../../../list/list-box.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';
import { Connector } from '../../connector.js';
import { ConnectorEndpoint } from '../../connector-endpoint.js';
import { Point } from '../../../../visual-engine/index.js';
import { RoutingMode } from '../../routing/router.js';
import '../../routing/straight-router.js';

function mount(items: ObservableCollection<Figure>): Diagram {
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function select(diagram: Diagram, figs: Figure[]): void {
    for (let i = 0; i < figs.length; i++)
        diagram.HandleContainerClick(figs[i]!, i === 0 ? ModifierKeys.None : ModifierKeys.Control);
}

function rect(x: number, y: number): Figure {
    return Figure.fromKind('rectangle', x, y, { width: 40, height: 30 });
}

test('z-order commands are installed and gate on selection', () => {
    initTestApp();
    const diagram = mount(new ObservableCollection<Figure>());
    assert.ok(diagram.BringToFrontCommand instanceof RelayCommand);
    assert.equal(diagram.BringToFrontCommand!.CanExecute(), false);
});

test('BringToFront gives the selected figure the top ZIndex', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20); const c = rect(30, 30);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b); items.Add(c);
    const diagram = mount(items);

    select(diagram, [a]);
    assert.equal(diagram.BringToFrontCommand!.CanExecute(), true);
    diagram.BringToFrontCommand!.Execute();

    const za = Panel.GetZIndex(a), zb = Panel.GetZIndex(b), zc = Panel.GetZIndex(c);
    assert.ok(za > zb && za > zc, `a(${za}) should be above b(${zb}) and c(${zc})`);
});

test('SendToBack gives the selected figure the bottom ZIndex', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const diagram = mount(items);
    select(diagram, [b]);
    diagram.SendToBackCommand!.Execute();
    assert.ok(Panel.GetZIndex(b) < Panel.GetZIndex(a));
});

function makeConnector(): Connector {
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    return c;
}

// Push a connector through the Connectors DP so the materializer mounts it
// onto the same canvas as the figures.
function addConnector(diagram: Diagram, c: Connector): void {
    let col = diagram.Connectors;
    if (col === undefined) { col = new ObservableCollection<MuralBase>([]); diagram.Connectors = col; }
    col.Add(c);
}

test('z-order commands are enabled when only a connector is selected', () => {
    initTestApp();
    const diagram = mount(new ObservableCollection<Figure>());
    const c = makeConnector(); addConnector(diagram, c);
    diagram.SelectConnector(c);
    assert.equal(diagram.BringToFrontCommand!.CanExecute(), true);
});

test('BringToFront on a connector raises it above every figure', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const diagram = mount(items);
    const c = makeConnector(); addConnector(diagram, c);

    diagram.SelectConnector(c);
    diagram.BringToFrontCommand!.Execute();

    const zc = Panel.GetZIndex(c);
    assert.ok(zc > Panel.GetZIndex(a) && zc > Panel.GetZIndex(b),
        `connector(${zc}) should be above a(${Panel.GetZIndex(a)}) and b(${Panel.GetZIndex(b)})`);
});

test('SendToBack on a connector drops it below every figure', () => {
    initTestApp();
    const a = rect(10, 10);
    const items = new ObservableCollection<Figure>(); items.Add(a);
    const diagram = mount(items);
    const c = makeConnector(); addConnector(diagram, c);

    diagram.SelectConnector(c);
    diagram.BringToFrontCommand!.Execute();       // move it up first
    diagram.SendToBackCommand!.Execute();          // then all the way back
    assert.ok(Panel.GetZIndex(c) < Panel.GetZIndex(a));
});

test('mixed figure + connector BringToFront raises both above the rest', () => {
    initTestApp();
    const a = rect(10, 10); const b = rect(20, 20);
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const diagram = mount(items);
    const c = makeConnector(); addConnector(diagram, c);

    select(diagram, [a]);
    diagram.SelectConnector(c);
    diagram.BringToFrontCommand!.Execute();

    assert.ok(Panel.GetZIndex(a) > Panel.GetZIndex(b), 'selected figure rose above the unselected one');
    assert.ok(Panel.GetZIndex(c) > Panel.GetZIndex(b), 'selected connector rose above the unselected figure');
});

test('a connector brought to front pulls its label to the same z', () => {
    initTestApp();
    const a = rect(10, 10);
    const items = new ObservableCollection<Figure>(); items.Add(a);
    const diagram = mount(items);
    const c = makeConnector(); addConnector(diagram, c);

    diagram.SelectConnector(c);
    diagram.BringToFrontCommand!.Execute();
    assert.equal(Panel.GetZIndex(c.LabelInstance), Panel.GetZIndex(c), 'label rides with the connector');
});
