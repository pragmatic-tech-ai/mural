import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import {
    Application,
    ObservableCollection,
    Visual,
    type MountableTarget,
    Size,
} from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate, TextBlock } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

// Walk the visual subtree depth-first and return every node encountered.
function collectVisuals(root: Visual): Visual[]
{
    const result: Visual[] = [];
    const stack: Visual[] = [root];
    while (stack.length > 0)
    {
        const v = stack.pop()!;
        result.push(v);
        for (const child of v.visualChildren)
        {
            stack.push(child);
        }
    }
    return result;
}

describe('Board — shape Figure realization (m2)', () => {
    beforeEach(() => {
        initTestApp();
    });

    function build(): { board: Board; surface: Border }
    {
        const board = new Board();
        board.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(board);
        const target = new FakeTarget();
        target.Content = surface;
        return { board, surface };
    }

    function layout(surface: Border): void
    {
        surface.Measure(new Size(800, 600));
        surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    }

    test('a shape Figure is realized as its own container carrying the silhouette', () => {
        const { board, surface } = build();
        // A shape Figure IS the node — it self-paints, so there is no inner
        // Shape produced by a [DataType] DataTemplate. Adding it to the board
        // realizes it directly as its own container.
        const fig = Figure.fromKind('rectangle', 30, 20);
        const col = new ObservableCollection<Figure>();
        col.Add(fig);
        board.ItemsSource = col;
        layout(surface);

        const container = board.Generator.ContainerFromItem(fig);
        assert.ok(container !== undefined, 'ContainerFromItem should return a container');
        assert.ok(container instanceof Figure, 'container should be a Figure');
        assert.strictEqual(container, fig, 'a shape Figure is its own container');

        // The Figure self-paints its silhouette from a cached unit source.
        assert.ok(fig._getSource() !== undefined, 'the shape Figure carries its silhouette source');
        assert.ok(fig.Geometry !== undefined, 'the shape Figure exposes a scaled silhouette geometry');

        // The "can not resolve template" fallback TextBlock must not appear.
        const visuals = collectVisuals(container);
        const hasErrorBlock = visuals.some(
            v => v instanceof TextBlock
              && (v as TextBlock).Text.startsWith('can not resolve template'),
        );
        assert.ok(!hasErrorBlock, 'unresolved-template error TextBlock must not be present');
    });
});
