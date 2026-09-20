// Wrap / Unwrap event-commands: Execute fires the Diagram event with the right
// payload; CanExecute gates on selection shape. Mirrors diagram-group-commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModifierKeys, ObservableCollection, RelayCommand, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { SelectionMode } from '../../list/list-box.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ContainerFigure } from '../container-figure.js';

function mount(items: ObservableCollection<Figure>): Diagram
{
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

// Figures are their own containers here, so click them directly to select.
function selectMany(diagram: Diagram, figs: Figure[]): void
{
    for (let i = 0; i < figs.length; i++)
        diagram.HandleContainerClick(figs[i]!, i === 0 ? ModifierKeys.None : ModifierKeys.Control);
}

test('default Wrap/Unwrap commands are installed', () => {
    initTestApp();
    const diagram = mount(new ObservableCollection<Figure>());
    assert.ok(diagram.WrapInContainerCommand instanceof RelayCommand);
    assert.ok(diagram.UnwrapContainerCommand instanceof RelayCommand);
});

test('WrapInContainerCommand fires WrapRequested with the top-level selection', () => {
    initTestApp();
    const a = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const b = Figure.fromKind('rectangle', 100, 10, { width: 40, height: 30 });
    const items = new ObservableCollection<Figure>(); items.Add(a); items.Add(b);
    const diagram = mount(items);

    const requests: Array<readonly unknown[]> = [];
    diagram.AddWrapRequestedListener(args => requests.push(args.Items));

    assert.equal(diagram.WrapInContainerCommand?.CanExecute(), false, 'empty selection → disabled');
    selectMany(diagram, [a, b]);
    assert.equal(diagram.WrapInContainerCommand?.CanExecute(), true, 'two root figures → enabled');
    diagram.WrapInContainerCommand?.Execute();

    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.length, 2);
    assert.ok(requests[0]!.includes(a) && requests[0]!.includes(b));
});

test('UnwrapContainerCommand gates on a selected container', () => {
    initTestApp();
    const fig = Figure.fromKind('rectangle', 10, 10, { width: 40, height: 30 });
    const container = Figure.fromKind('container', 200, 10) as ContainerFigure;
    container.Id = 'C';
    const items = new ObservableCollection<Figure>(); items.Add(fig); items.Add(container);
    const diagram = mount(items);

    const requests: Array<readonly unknown[]> = [];
    diagram.AddUnwrapRequestedListener(args => requests.push(args.Containers));

    selectMany(diagram, [fig]);
    assert.equal(diagram.UnwrapContainerCommand?.CanExecute(), false, 'plain figure → disabled');
    selectMany(diagram, [container]);
    assert.equal(diagram.UnwrapContainerCommand?.CanExecute(), true, 'container → enabled');
    diagram.UnwrapContainerCommand?.Execute();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]![0], container);
});
