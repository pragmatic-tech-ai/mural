import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { diagramSpaceRect } from '../coordinate-space.js';

function mount(items: ObservableCollection<Figure>): Diagram
{
    const diagram = new Diagram();
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

test('placeAll (restore) links a node with a saved parentId into its container, coords already parent-relative', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    // Saved (loaded) child: Left/Top are ALREADY parent-relative (content-space).
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';

    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    assert.equal(child.ContainerParent, undefined);

    diagram.ContainerPlacement.placeAll();

    // Linked + attached with its parent-relative coords kept as-is (no conversion).
    assert.equal(child.ContainerParent, container, 'ContainerParent link set');
    assert.equal(child.GetVisualParent(), container.ChildHost, 'child re-parented into ChildHost');
    assert.equal(child.Left, 22); assert.equal(child.Top, 18);
    const r = diagramSpaceRect(child);   // origin (100,100)+ContentOrigin(8,32)+local(22,18)
    assert.equal(r.X, 130); assert.equal(r.Y, 150);
});

test('reparent (move) nests a root node preserving its diagram-space position', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'Cm'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const child = Figure.fromKind('rectangle', 130, 150, { width: 30, height: 20 });   // root diagram-space
    child.Id = 'nm';
    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();   // registers the container

    diagram.ContainerPlacement.reparent(child, 'Cm');
    assert.equal(child.ContainerParent, container);
    assert.equal(child.Left, 22); assert.equal(child.Top, 18);        // converted to content-space
    const r = diagramSpaceRect(child);
    assert.equal(r.X, 130); assert.equal(r.Y, 150);                   // on-screen position preserved
});

test('un-nesting (reparent to undefined) returns the node to root, preserving diagram-space position', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C2'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    // Parent-relative (22,18) → diagram-space (130,150) once restored.
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n2'; child.ParentId = 'C2';
    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();
    assert.equal(child.ContainerParent, container);

    diagram.ContainerPlacement.reparent(child, undefined);
    assert.equal(child.ContainerParent, undefined, 'un-nested');
    assert.equal(child.Left, 130); assert.equal(child.Top, 150);   // now root diagram-space coords
    const r = diagramSpaceRect(child);
    assert.equal(r.X, 130); assert.equal(r.Y, 150);   // stayed put in diagram space
});

// Multi-level nesting (azure ⊃ m365 ⊃ power_platform ⊃ leaf): a container that is
// ITSELF a child. placeAll's two passes (register all, then restore all) must nest
// each level into its direct parent, and diagram-space must compose through the
// whole chain. ContentOrigin is (8,32) per level.
test('placeAll restores a 3-level container nest (container inside container inside container)', () => {
    initTestApp();
    const azure = new ContainerFigure();
    azure.Id = 'azure'; azure.Left = 100; azure.Top = 100; azure.Width = 500; azure.Height = 400;
    const m365 = new ContainerFigure();
    m365.Id = 'm365'; m365.ParentId = 'azure'; m365.Left = 20; m365.Top = 20; m365.Width = 300; m365.Height = 250;
    const pp = new ContainerFigure();
    pp.Id = 'pp'; pp.ParentId = 'm365'; pp.Left = 15; pp.Top = 15; pp.Width = 180; pp.Height = 150;
    const leaf = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    leaf.Id = 'leaf'; leaf.ParentId = 'pp';

    const items = new ObservableCollection<Figure>();
    items.Add(azure); items.Add(m365); items.Add(pp); items.Add(leaf);
    const diagram = mount(items);

    diagram.ContainerPlacement.placeAll();

    assert.equal(m365.ContainerParent, azure, 'm365 nests in azure');
    assert.equal(pp.ContainerParent, m365, 'power_platform nests in m365');
    assert.equal(leaf.ContainerParent, pp, 'leaf nests in power_platform');
    assert.equal(leaf.GetVisualParent(), pp.ChildHost, 'leaf attached into the innermost ChildHost');
    // Diagram-space composes through all three content origins:
    // azure(100,100)+CO(8,32) → m365 pos → +CO → pp pos → +CO → leaf pos.
    const r = diagramSpaceRect(leaf);
    assert.equal(r.X, 169); assert.equal(r.Y, 241);
});

test('reparent builds a 3-level nest order-independently (child-first), preserving on-screen positions', () => {
    initTestApp();
    const azure = new ContainerFigure();
    azure.Id = 'azure'; azure.Left = 100; azure.Top = 100; azure.Width = 500; azure.Height = 400;
    // Each starts at its intended DIAGRAM-SPACE position, at root.
    const m365 = new ContainerFigure();
    m365.Id = 'm365'; m365.Left = 128; m365.Top = 152; m365.Width = 300; m365.Height = 250;
    const pp = new ContainerFigure();
    pp.Id = 'pp'; pp.Left = 151; pp.Top = 199; pp.Width = 180; pp.Height = 150;
    const leaf = Figure.fromKind('rectangle', 169, 241, { width: 40, height: 30 });
    leaf.Id = 'leaf';

    const items = new ObservableCollection<Figure>();
    items.Add(azure); items.Add(m365); items.Add(pp); items.Add(leaf);
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();   // registers all four; none nested yet

    // Nest CHILD-FIRST — the deepest link before its container is itself nested.
    diagram.ContainerPlacement.reparent(leaf, 'pp');
    diagram.ContainerPlacement.reparent(pp, 'm365');
    diagram.ContainerPlacement.reparent(m365, 'azure');

    assert.equal(m365.ContainerParent, azure);
    assert.equal(pp.ContainerParent, m365);
    assert.equal(leaf.ContainerParent, pp);
    // On-screen positions preserved through every reparent, regardless of order.
    const rl = diagramSpaceRect(leaf);
    assert.equal(rl.X, 169); assert.equal(rl.Y, 241);
    const rp = diagramSpaceRect(pp);
    assert.equal(rp.X, 151); assert.equal(rp.Y, 199);
});

test('deferred attach: a child registered before its container still lands once placeAll sees the container', () => {
    initTestApp();
    // child added to the collection BEFORE the container — record order must not matter.
    const child = Figure.fromKind('rectangle', 130, 150, { width: 30, height: 20 });
    child.Id = 'n3'; child.ParentId = 'C3';
    const container = new ContainerFigure();
    container.Id = 'C3'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    const items = new ObservableCollection<Figure>();
    items.Add(child); items.Add(container);   // child first
    const diagram = mount(items);
    diagram.ContainerPlacement.placeAll();
    assert.equal(child.ContainerParent, container, 'child nested despite appearing before its container');
});
