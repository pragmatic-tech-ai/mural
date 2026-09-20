// SP4: figure body-drag must move the node by the CONTENT-space delta, i.e. the
// screen delta divided by the zoom (PART_Camera's LayoutTransform scale). Before
// the HostToContent rework a 100px screen drag moved Left by 100 at any zoom;
// now it moves by 100/zoom.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import {
    ModifierKeys,
    ObservableCollection,
    Size,
    Visual,
    type MountableTarget,
} from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

// Mutable duck-typed PointerEventArgs covering the fields the drag handlers read.
function pointerArgs(hostX: number, hostY: number): Record<string, unknown>
{
    return {
        HostX: hostX, HostY: hostY,
        Handled: false, IsDoubleClick: false,
        Modifiers: ModifierKeys.None, Button: 0,
        CapturePointer(_v: unknown): void { /* noop */ },
        ReleasePointerCapture(): void { /* noop */ },
    };
}

interface Draggable
{
    OnPointerDown(a: unknown): void;
    OnPointerMove(a: unknown): void;
}

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

function placeFigure(diagram: Diagram, surface: Border, left: number, top: number): Figure
{
    const fig = Figure.fromKind('rectangle', left, top);
    const col = new ObservableCollection<Figure>();
    col.Add(fig);
    diagram.ItemsSource = col;
    layout(surface);
    return fig;
}

describe('Figure drag under zoom', () => {
    beforeEach(() => { initTestApp(); });

    test('a 100px screen drag at zoom 2 moves Left by 50 (content delta)', () => {
        const { diagram, surface } = build();
        const fig = placeFigure(diagram, surface, 100, 80);
        diagram.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });

        const d = fig as unknown as Draggable;
        d.OnPointerDown(pointerArgs(400, 300));
        d.OnPointerMove(pointerArgs(500, 300));   // +100px screen in X

        assert.ok(Math.abs(fig.Left - 150) < 1e-6, `expected Left 150, got ${fig.Left}`);
        assert.ok(Math.abs(fig.Top - 80) < 1e-6, `expected Top 80, got ${fig.Top}`);
    });

    test('a sub-threshold screen wiggle does not move the node', () => {
        const { diagram, surface } = build();
        const fig = placeFigure(diagram, surface, 100, 80);
        diagram.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });

        const d = fig as unknown as Draggable;
        d.OnPointerDown(pointerArgs(400, 300));
        d.OnPointerMove(pointerArgs(402, 300));   // 2px < CLICK_THRESHOLD_PX (4)

        assert.equal(fig.Left, 100);
        assert.equal(fig.Top, 80);
    });
});
