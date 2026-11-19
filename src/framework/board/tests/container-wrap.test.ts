import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { BoardDocument } from '../board-document.js';
import { ContainerFigure } from '../container-figure.js';

function doc(): BoardDocument { Application.current = null; new Application(); return new BoardDocument(); }

function* containerNodes(d: BoardDocument): Iterable<ContainerFigure>
{
    for (let i = 0; i < d.Nodes.Count; i++) { const n = d.Nodes.Get(i); if (n instanceof ContainerFigure) yield n; }
}

test('WrapInContainer inserts a container and claims the selection as parent-relative children', () => {
    const d = doc();
    const a = d.CreateNode('rectangle', 10, 10)!;
    const b = d.CreateNode('rectangle', 100, 20)!;
    const beforeA = { x: a.Left, y: a.Top };
    const beforeB = { x: b.Left, y: b.Top };
    d.WrapInContainer([a, b]);

    // A container node was inserted.
    const container = [...containerNodes(d)][0];
    assert.ok(container instanceof ContainerFigure, 'a ContainerFigure was created');
    assert.ok(container.Id !== undefined, 'container got an id');

    // Both nodes now name the container as parent.
    assert.equal(a.ParentId, container.Id);
    assert.equal(b.ParentId, container.Id);

    // Their Left/Top are now container-local; board-space position is preserved:
    // localLeft + (container.Left + ContentOrigin.X) === original board Left.
    assert.equal(a.Left + container.Left + container.ContentOrigin.X, beforeA.x);
    assert.equal(a.Top  + container.Top  + container.ContentOrigin.Y, beforeA.y);
    assert.equal(b.Left + container.Left + container.ContentOrigin.X, beforeB.x);
    assert.equal(b.Top  + container.Top  + container.ContentOrigin.Y, beforeB.y);
});

test('WrapInContainer is a no-op for an empty selection', () => {
    const d = doc();
    const before = d.Nodes.Count;
    d.WrapInContainer([]);
    assert.equal(d.Nodes.Count, before);
});
