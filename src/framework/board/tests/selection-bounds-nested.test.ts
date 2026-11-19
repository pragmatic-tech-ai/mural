// A nested node's Left/Top are container-local, but the selection adorner draws
// in board space. SelectionBoundsTracker must report a selected nested node's
// DIAGRAM-space rect, or the handles land in the wrong place on screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObservableCollection, Size, ModifierKeys, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';
import { boardSpaceRect } from '../coordinate-space.js';

test('selecting a nested node reports its board-space rect as the selection bbox', () => {
    initTestApp();
    const container = new ContainerFigure();
    container.Id = 'C'; container.Left = 100; container.Top = 100; container.Width = 220; container.Height = 160;
    // Parent-relative coords (content-space) → board-space (130,150) once restored.
    const child = Figure.fromKind('rectangle', 22, 18, { width: 30, height: 20 });
    child.Id = 'n1'; child.ParentId = 'C';

    const items = new ObservableCollection<Figure>();
    items.Add(container); items.Add(child);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource = items;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = board;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    board.ContainerPlacement.placeAll();
    assert.equal(child.ContainerParent, container, 'child nested');

    board.HandleContainerClick(child, ModifierKeys.None);

    const ds = boardSpaceRect(child);   // (130, 150, 30, 20)
    assert.equal(board.SelectionCount,  1);
    assert.equal(board.SelectionLeft,   ds.X);
    assert.equal(board.SelectionTop,    ds.Y);
    assert.equal(board.SelectionWidth,  ds.Width);
    assert.equal(board.SelectionHeight, ds.Height);
    assert.equal(board.SelectionLeft, 130);
    assert.equal(board.SelectionTop,  150);
});
