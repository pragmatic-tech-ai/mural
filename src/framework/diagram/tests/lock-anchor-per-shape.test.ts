import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, ModifierKeys, Size, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SelectionMode } from '../../list/list-box.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { PositionAnchor } from '../position-anchor.js';

function mount(): { diagram: Diagram; a: Figure; b: Figure }
{
    Application.current = null; new Application();
    const a = Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); a.Id = 'a';
    const b = Figure.fromKind('rectangle', 200, 60, { width: 80, height: 40 }); b.Id = 'b';
    const coll = new ObservableCollection<Figure>(); coll.Add(a); coll.Add(b);
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { diagram, a, b };
}

function select(diagram: Diagram, item: unknown): void
{
    const container = diagram.Generator.ContainerFromItem(item);
    if (container === undefined) throw new Error('no container');
    diagram.HandleContainerClick(container, ModifierKeys.None);
}

describe('lock aspect + position anchor are per-shape', () => {
    test('inspector edits write back to the figure and do not leak across selections', () => {
        const { diagram, a, b } = mount();
        select(diagram, a);

        // Toggle lock + Center anchor through the inspector-facing DPs; the
        // mirror must write them onto figure A.
        diagram.SelectedShapeLockAspect = true;
        diagram.SelectedShapeAnchor = PositionAnchor.Center;
        assert.equal(a.LockAspectRatio, true);
        assert.equal(a.PositionFrom, PositionAnchor.Center);

        // Selecting B seeds the inspector from B's OWN (default) state — the
        // lock/anchor must not leak from A.
        select(diagram, b);
        assert.equal(diagram.SelectedShapeLockAspect, false, 'lock leaked to B');
        assert.equal(diagram.SelectedShapeAnchor, PositionAnchor.TopLeftCorner, 'anchor leaked to B');
        assert.equal(b.LockAspectRatio, false);

        // Reselecting A restores A's remembered state (it lives on the figure).
        select(diagram, a);
        assert.equal(diagram.SelectedShapeLockAspect, true, 'A forgot its lock');
        assert.equal(diagram.SelectedShapeAnchor, PositionAnchor.Center, 'A forgot its anchor');
    });
});
