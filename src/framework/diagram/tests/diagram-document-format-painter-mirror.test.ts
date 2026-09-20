// DiagramDocument.FormatPainterActive mirrors the live view two-way, so a
// toolbar ToggleButton can bind it as a single-segment two-way IsChecked (the
// same proven pattern the connector-mode indicator uses) instead of firing a
// canExecute-gated command. A shape must be selected for the mode to STAY armed
// (the behavior auto-resets an armed-with-nothing state), so the view is mounted
// and a figure selected before toggling.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { ObservableCollection, Size, ModifierKeys, type Visual, type MountableTarget } from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { DiagramDocument } from '../diagram-document.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

// A mounted Diagram with one figure already selected, so the format painter arms
// and stays armed.
function armedView(): Diagram
{
    const view = new Diagram();
    view.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
    const surface = new Border();
    surface.SetChild(view);
    const target = new FakeTarget();
    target.Content = surface;

    const fig = Figure.fromKind('rectangle', 20, 20);
    const col = new ObservableCollection<Figure>();
    col.Add(fig);
    view.ItemsSource = col;
    surface.Measure(new Size(800, 600));
    surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);

    const container = view.Generator.ContainerFromItem(fig);
    view.HandleContainerClick(container as unknown as Visual, ModifierKeys.None);
    return view;
}

describe('DiagramDocument — FormatPainterActive proxy', () => {
    beforeEach(() => { initTestApp(); });

    test('a toggle write on the document arms the live view (and stays armed)', () => {
        const doc = new DiagramDocument();
        const view = armedView();
        doc.ActiveView = view;

        doc.FormatPainterActive = true;
        assert.equal(view.FormatPainterActive, true, 'document → view: brush armed');
        assert.equal(doc.FormatPainterActive, true, 'stable — a shape is selected');
    });

    test('the view arming flows back to the document', () => {
        const doc = new DiagramDocument();
        const view = armedView();
        doc.ActiveView = view;

        view.FormatPainterActive = true;
        assert.equal(doc.FormatPainterActive, true, 'view → document');

        view.FormatPainterActive = false;
        assert.equal(doc.FormatPainterActive, false, 'disarm flows back too');
    });

    test('detaches when the active view clears', () => {
        const doc = new DiagramDocument();
        const view = armedView();
        doc.ActiveView = view;
        view.FormatPainterActive = true;
        assert.equal(doc.FormatPainterActive, true);

        doc.ActiveView = undefined;
        view.FormatPainterActive = false;   // no longer mirrored
        assert.equal(doc.FormatPainterActive, true, 'document holds its last value after detach');
    });
});
