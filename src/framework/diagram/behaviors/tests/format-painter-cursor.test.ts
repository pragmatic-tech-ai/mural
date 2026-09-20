import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import { ObservableCollection, Size, ModifierKeys, type Visual, type MountableTarget } from '../../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../../basic/index.js';
import { PaginatedCanvas } from '../../../../basic/panels/paginated-canvas.js';
import { Diagram } from '../../diagram.js';
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

    function build(): { diagram: Diagram; surface: Border }
    {
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        return { diagram, surface };
    }

    function layout(surface: Border): void
    {
        surface.Measure(new Size(800, 600));
        surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    }

    test('arming sets the canvas cursor; disarming clears it', () => {
        const { diagram, surface } = build();
        const fig = Figure.fromKind('rectangle', 20, 20);
        const col = new ObservableCollection<Figure>();
        col.Add(fig);
        diagram.ItemsSource = col;
        layout(surface);

        const container = diagram.Generator.ContainerFromItem(fig);
        diagram.HandleContainerClick(container as unknown as Visual, ModifierKeys.None);
        assert.ok(diagram.SelectedItems.length > 0, 'the figure is selected');

        assert.equal(diagram.Cursor, undefined, 'no painter cursor before arming');

        diagram.FormatPainterActive = true;
        assert.equal(diagram.FormatPainterActive, true, 'stays armed — a shape is selected');
        assert.equal(diagram.Cursor, FORMAT_PAINTER_CURSOR, 'canvas shows the painter cursor while armed');

        diagram.FormatPainterActive = false;
        assert.equal(diagram.Cursor, undefined, 'cursor cleared on disarm');
    });
});
