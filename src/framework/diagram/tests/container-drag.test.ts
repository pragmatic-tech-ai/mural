// Drag-in / drag-out: dropping a node whose centre lands inside a container
// nests it (re-parents into the container's ChildHost); dragging it back out
// un-nests it. The gesture runs in diagram space (the node is popped to root on
// pointer-down), so re-nesting is decided on drop from the node's centre.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ModifierKeys, ObservableCollection, Size, Visual, type MountableTarget } from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

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
    OnPointerUp(a: unknown): void;
}

function drag(fig: Figure, fromX: number, fromY: number, toX: number, toY: number): void
{
    const d = fig as unknown as Draggable;
    d.OnPointerDown(pointerArgs(fromX, fromY));
    d.OnPointerMove(pointerArgs(toX, toY));
    d.OnPointerUp(pointerArgs(toX, toY));
}

describe('container drag-in / drag-out', () => {
    beforeEach(() => { initTestApp(); });

    function build(): { diagram: Diagram; surface: Border; container: ContainerFigure }
    {
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        const container = new ContainerFigure();
        container.Id = 'C'; container.Left = 200; container.Top = 200; container.Width = 240; container.Height = 200;
        const fig = Figure.fromKind('rectangle', 40, 40, { width: 80, height: 80 });
        fig.Id = 'n1';
        const col = new ObservableCollection<Figure>();
        col.Add(container); col.Add(fig);
        diagram.ItemsSource = col;
        surface.Measure(new Size(900, 700));
        surface.Arrange({ X: 0, Y: 0, Width: 900, Height: 700 } as never);
        diagram.ContainerPlacement.placeAll();
        return { diagram, surface, container };
    }

    test('dropping a node inside a container nests it into the container ChildHost', () => {
        const { diagram, container } = build();
        const fig = (diagram.ItemsSource as ObservableCollection<Figure>).Get(1)!;
        assert.equal(fig.ContainerParent, undefined, 'starts at root');

        // Press on the node centre (80,80), drag so its centre lands at ~(320,300),
        // well inside the container's diagram region (200..440, 200..400).
        drag(fig, 80, 80, 320, 300);

        assert.equal(fig.ParentId, 'C', 'nested: ParentId set to the container');
        assert.equal(fig.ContainerParent, container, 'ContainerParent link set');
        assert.equal(fig.GetVisualParent(), container.ChildHost, 're-parented into ChildHost');
    });

    test('dragging a nested node out to empty canvas un-nests it', () => {
        const { diagram, container } = build();
        const fig = (diagram.ItemsSource as ObservableCollection<Figure>).Get(1)!;
        drag(fig, 80, 80, 320, 300);
        assert.equal(fig.ContainerParent, container, 'nested first');

        // Its diagram-space centre is now ~(320,300); drag it far outside the box.
        drag(fig, 320, 300, 700, 300);

        assert.equal(fig.ParentId, undefined, 'un-nested: ParentId cleared');
        assert.equal(fig.ContainerParent, undefined, 'ContainerParent cleared');
    });
});
