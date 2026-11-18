import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application, ObservableCollection, Visual, Size, type MountableTarget,
} from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Board } from '../board.js';
import { Connector } from '../connector.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void {}
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function mount(board: Board): void
{
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(600, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 600, Height: 600 } as never);
}

describe('Board connectors reset handling', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('a Batch on the connectors collection re-materializes to final contents', () => {
        const connectors = new ObservableCollection<Connector>();
        const board = new Board();
        board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
        board.Connectors = connectors;               // direct assignment (no binding pulse)
        mount(board);

        const mat = (board as unknown as {
            _connectorsMaterializer: { MaterializedVisuals: ReadonlyMap<unknown, unknown> };
        })._connectorsMaterializer;

        connectors.Batch(() => {
            for (let i = 0; i < 4; i++) connectors.Add(new Connector());
        });
        assert.equal(mat.MaterializedVisuals.size, 4, 'all four materialized after batch');

        connectors.Batch(() => {
            connectors.Clear();
            connectors.Add(new Connector());
        });
        assert.equal(mat.MaterializedVisuals.size, 1, 'reset rebuilt to a single connector');
    });
});
