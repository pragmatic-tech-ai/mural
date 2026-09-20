import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application, DataObject, Point, ServiceKey } from '../../../../runtime/index.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';
import { ContainerFigure } from '../../container-figure.js';
import { ContentContainerFigure } from '../../content-container-figure.js';
import { attachStandardDiagramMutations } from '../../behaviors/attach-standard-mutations.js';
import { TOOLBOX_ITEM_FORMAT } from '../../behaviors/canvas-drop-behavior.js';
import { ToolboxRepository } from '../toolbox-repository.js';
import { ToolboxItem } from '../toolbox-item.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { ShapeVisualResolverKey } from '../shape-visual-resolver.js';
import type { IToolboxDropFactory, ToolboxDropContext } from '../toolbox-drop-factory.js';

const mutator = { Group(){}, Ungroup(){}, WrapInContainer(){}, UnwrapContainer(){}, CombineSelection(){}, DeleteNodes(){}, CreateNode(){ return null; } };

// Register a spy factory that returns a real Figure so the router's generic-adopt
// path (node instanceof Figure) engages. Returns the diagram + the captured context
// + a getter for the last created node.
function setupDropWithFigureFactory(): { diagram: Diagram; detach: () => void; captured: () => ToolboxDropContext | undefined; node: () => Figure | undefined }
{
    const diagram = new Diagram();
    const repo = Application.current!.Services.getRequired(ToolboxRepository.Key);
    let ctx: ToolboxDropContext | undefined;
    let made: Figure | undefined;
    const spyKey = new ServiceKey<IToolboxDropFactory>('FigureSpyFactory');
    const factory: IToolboxDropFactory = {
        CreateDropped(c) { ctx = c; made = Figure.fromKind('rectangle', c.Position.X, c.Position.Y, { width: 30, height: 20 }); made.Id = 'dropped'; return made; },
    };
    Application.current!.Services.registerInstance(spyKey, factory);
    const item = new ToolboxItem('test:fig', 'Fig', new ToolboxVisualDescriptor(ShapeVisualResolverKey, 'rectangle'), spyKey);
    repo.EnsurePage('test', 'Test').Items.Add(item);
    const detach = attachStandardDiagramMutations(diagram, mutator as never);
    return { diagram, detach, captured: () => ctx, node: () => made };
}

test('the drop context carries TargetContainer, and a generic container adopts the dropped node', () => {
    initTestApp();
    const { diagram, detach, captured, node } = setupDropWithFigureFactory();
    try
    {
        const container = new ContainerFigure();
        container.Id = 'C';
        const data = new DataObject().Set(TOOLBOX_ITEM_FORMAT, 'test:fig');
        diagram._fireItemDropped({ Data: data, Position: new Point(120, 120), TargetContainer: container });
        // Task 3: the target container plumbs through the router to the factory.
        assert.equal(captured()?.TargetContainer, container);
        // Task 4: a plain ContainerFigure adopts the dropped node (visual-only).
        assert.equal(node()?.ParentId, 'C');
    }
    finally { detach(); }
});

test('a model-backed container (ContentContainerFigure) is NOT adopted by the router', () => {
    initTestApp();
    const { diagram, detach, node } = setupDropWithFigureFactory();
    try
    {
        const card = new ContentContainerFigure();
        card.Id = 'CC';
        const data = new DataObject().Set(TOOLBOX_ITEM_FORMAT, 'test:fig');
        diagram._fireItemDropped({ Data: data, Position: new Point(50, 50), TargetContainer: card });
        // The host factory owns validation + the model ref; the router leaves it alone.
        assert.equal(node()?.ParentId, undefined);
    }
    finally { detach(); }
});

test('no TargetContainer (drop over empty canvas) leaves the node at root', () => {
    initTestApp();
    const { diagram, detach, node } = setupDropWithFigureFactory();
    try
    {
        const data = new DataObject().Set(TOOLBOX_ITEM_FORMAT, 'test:fig');
        diagram._fireItemDropped({ Data: data, Position: new Point(10, 10) });
        assert.equal(node()?.ParentId, undefined);
    }
    finally { detach(); }
});

test('dropping an item id routes through the repo to its factory', () => {
    const prior = Application.current;
    Application.current = null;
    new Application();
    try
    {
        // The Diagram ctor first-inits the repo + shape services.
        const diagram = new Diagram();
        const repo = Application.current!.Services.getRequired(ToolboxRepository.Key);

        const dropped: ToolboxDropContext[] = [];
        const sentinel = {};
        const spyKey = new ServiceKey<IToolboxDropFactory>('SpyFactory');
        const factory: IToolboxDropFactory = { CreateDropped(ctx) { dropped.push(ctx); return sentinel; } };
        Application.current!.Services.registerInstance(spyKey, factory);

        const item = new ToolboxItem('test:item', 'Test',
            new ToolboxVisualDescriptor(ShapeVisualResolverKey, 'rectangle'), spyKey);
        repo.EnsurePage('test', 'Test').Items.Add(item);

        const detach = attachStandardDiagramMutations(diagram, mutator as never);
        const data = new DataObject().Set(TOOLBOX_ITEM_FORMAT, item.Id);
        diagram._fireItemDropped({ Data: data, Position: new Point(100, 100) });

        assert.equal(dropped.length, 1);
        assert.equal(dropped[0]!.Item, item);
        // NodeDropOffset (40,40) is applied by the router → top-left (60,60).
        assert.equal(dropped[0]!.Position.X, 60);
        assert.equal(dropped[0]!.Position.Y, 60);
        // (Selecting the returned node is a Selector concern — it only accepts
        // real diagram items — so it is asserted in the mutations tests, not here.)
        detach();
    }
    finally
    {
        Application.current = prior;
    }
});

test('dropping an unknown item id is a no-op (no throw, no selection)', () => {
    const prior = Application.current;
    Application.current = null;
    new Application();
    try
    {
        const diagram = new Diagram();
        const detach = attachStandardDiagramMutations(diagram, mutator as never);
        const data = new DataObject().Set(TOOLBOX_ITEM_FORMAT, 'shape:does-not-exist');
        assert.doesNotThrow(() => diagram._fireItemDropped({ Data: data, Position: new Point(10, 10) }));
        detach();
    }
    finally
    {
        Application.current = prior;
    }
});
