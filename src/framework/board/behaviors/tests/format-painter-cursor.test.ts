import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import { ObservableCollection, Size, ModifierKeys, type Visual, type MountableTarget } from '../../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../../basic/index.js';
import { PaginatedCanvas } from '../../../../basic/panels/paginated-canvas.js';
import { Board } from '../../board.js';
import { Figure } from '../../figure.js';
import { FORMAT_PAINTER_CURSOR } from '../format-painter-behavior.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

describe('format painter — armed cursor', () => {
    beforeEach(() => { initTestApp(); });

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

    test('arming sets the canvas cursor; disarming clears it', () => {
        const { board, surface } = build();
        const fig = Figure.fromKind('rectangle', 20, 20);
        const col = new ObservableCollection<Figure>();
        col.Add(fig);
        board.ItemsSource = col;
        layout(surface);

        const container = board.Generator.ContainerFromItem(fig);
        board.HandleContainerClick(container as unknown as Visual, ModifierKeys.None);
        assert.ok(board.SelectedItems.length > 0, 'the figure is selected');

        assert.equal(board.Cursor, undefined, 'no painter cursor before arming');

        board.FormatPainterActive = true;
        assert.equal(board.FormatPainterActive, true, 'stays armed — a shape is selected');
        assert.equal(board.Cursor, FORMAT_PAINTER_CURSOR, 'canvas shows the painter cursor while armed');

        board.FormatPainterActive = false;
        assert.equal(board.Cursor, undefined, 'cursor cleared on disarm');
    });
});
