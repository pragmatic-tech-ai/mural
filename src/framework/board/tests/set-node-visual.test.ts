// Slice #3b T1: BoardDocument.SetNodeVisual writes a node's geometry into the
// visual store by id. Two paths: BEFORE the container realizes (the drop path —
// ContainerBound seeds the container on realize) and AFTER (apply to the live
// container immediately). GetNodeVisual reads it back.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';
import { BoardDocument } from '../board-document.js';

function mountView(doc: BoardDocument): Board
{
    const board = new Board();
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.DataContext = doc;          // publishes board as doc.ActiveView
    board.ItemsSource = doc.Nodes;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return board;
}

describe('BoardDocument.SetNodeVisual', () => {
    test('set BEFORE realize → container seeded on bind (drop path)', () => {
        Application.current = null; new Application();
        const doc = new BoardDocument();
        const vm = new NodeViewModel(); vm.Id = 'v';
        doc.Nodes.Add(vm);
        // Geometry written before any view/container exists.
        doc.SetNodeVisual('v', { left: 15, top: 25, w: 120, h: 60 });
        assert.deepEqual(doc.GetNodeVisual('v'), { left: 15, top: 25, w: 120, h: 60 });

        const board = mountView(doc);
        const container = board.Generator.ContainerFromItem(vm) as Figure;
        assert.ok(container instanceof Figure);
        assert.equal(container.Left, 15, 'container seeded from the store on realize');
        assert.equal(container.Width, 120);
    });

    test('set AFTER realize → applied to the live container immediately', () => {
        Application.current = null; new Application();
        const doc = new BoardDocument();
        const vm = new NodeViewModel(); vm.Id = 'v';
        doc.Nodes.Add(vm);
        const board = mountView(doc);
        const container = board.Generator.ContainerFromItem(vm) as Figure;

        doc.SetNodeVisual('v', { left: 99, top: 88, w: 40, h: 30 });
        assert.equal(container.Left,  99, 'live container updated immediately');
        assert.equal(container.Top,   88);
        assert.equal(container.Width, 40);
    });

    test('GetNodeVisual returns undefined for an unknown id', () => {
        Application.current = null; new Application();
        const doc = new BoardDocument();
        assert.equal(doc.GetNodeVisual('nope'), undefined);
    });
});
