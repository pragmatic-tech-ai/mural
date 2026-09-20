import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Point } from '../../../../runtime/index.js';
import { Figure } from '../../figure.js';
import { ContainerFigure } from '../../container-figure.js';
import { TextNode } from '../../text-node.js';
import { Callout } from '../../callout.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { ShapeVisualResolverKey } from '../shape-visual-resolver.js';
import { FigureKindDropFactory } from '../figure-kind-drop-factory.js';

// A stand-in for the diagram document the factory scans + mutates: it exposes
// Nodes.ToArray() (for the id counter) and AddNode() (the drop sink).
function fakeDoc()
{
    const nodes: Array<{ Id?: string }> = [];
    return {
        Nodes: { ToArray: () => nodes },
        AddNode: (n: { Id?: string }) => { nodes.push(n); },
        nodes,
    };
}

function drop(factory: FigureKindDropFactory, doc: ReturnType<typeof fakeDoc>, kind: string): Figure
{
    return factory.CreateDropped({
        Item: undefined as never,
        Descriptor: new ToolboxVisualDescriptor(ShapeVisualResolverKey, kind),
        Position: new Point(30, 40),
        Diagram: undefined as never,
        Mutator: doc as never,
    }) as Figure;
}

test('drops the figure for the descriptor kind and adds it to the document', () => {
    initTestApp();
    const factory = new FigureKindDropFactory();
    const doc = fakeDoc();

    const container = drop(factory, doc, 'container');
    assert.ok(container instanceof ContainerFigure);
    assert.equal(container.Left, 30); assert.equal(container.Top, 40);

    const text = drop(factory, doc, 'text');
    assert.ok(text instanceof TextNode);

    const callout = drop(factory, doc, 'callout');
    assert.ok(callout instanceof Callout);

    assert.equal(doc.nodes.length, 3, 'each drop is added to the document');
});

test('assigns a collision-safe per-kind `<kind>:<n>` id, incrementing per kind', () => {
    initTestApp();
    const factory = new FigureKindDropFactory();
    const doc = fakeDoc();

    assert.equal(drop(factory, doc, 'text').Id, 'text:1');
    assert.equal(drop(factory, doc, 'text').Id, 'text:2');
    assert.equal(drop(factory, doc, 'container').Id, 'container:1');   // separate counter
    assert.equal(drop(factory, doc, 'callout').Id, 'callout:1');
    assert.equal(drop(factory, doc, 'text').Id, 'text:3');
});
