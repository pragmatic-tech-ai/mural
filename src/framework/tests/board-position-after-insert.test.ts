import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    SetterFactory,
    Style,
    Setter,
    Size,
    Visual,
    DataContextBinding,
    type DrawingContext,
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Board } from '../board/board.js';
import { Figure } from '../board/figure.js';
import { SelectionMode } from '../list/list-box.js';

// Minimal node VM — mirrors a shape node's shape with
// Left / Top / IsSelected DPs.
class TestNodeVM extends MuralBase
{
    public static readonly IdKey   = MuralBase.RegisterProperty<string>(TestNodeVM, 'Id',   '',    MetaData.None);
    public static readonly LeftKey = MuralBase.RegisterProperty<number>(TestNodeVM, 'Left', 0,     MetaData.None);
    public static readonly TopKey  = MuralBase.RegisterProperty<number>(TestNodeVM, 'Top',  0,     MetaData.None);
    public static readonly SizeKey = MuralBase.RegisterProperty<number>(TestNodeVM, 'Size', 80,    MetaData.None);
    constructor(id: string, left: number, top: number)
    {
        super();
        this.set_property_value(TestNodeVM.IdKey, id);
        this.set_property_value(TestNodeVM.LeftKey, left);
        this.set_property_value(TestNodeVM.TopKey,  top);
    }
    public get Left(): number   { return this.get_property_value(TestNodeVM.LeftKey); }
    public set Left(v: number)  { this.set_property_value(TestNodeVM.LeftKey, v); }
    public get Top():  number   { return this.get_property_value(TestNodeVM.TopKey); }
    public set Top(v: number)   { this.set_property_value(TestNodeVM.TopKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

describe('Board — existing container Left/Top persistence after a new item is inserted', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('moving Figure.Left (TwoWay binding) survives a subsequent ObservableCollection.Add', () => {
        const items = new ObservableCollection<TestNodeVM>();
        const a = new TestNodeVM('a', 100, 100);
        items.Add(a);

        const board = new Board();
        board.SelectionMode = SelectionMode.Extended;
        board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());

        // ItemContainerStyle wires the Left / Top bindings the same way the
        // demo's FigureStyle does.
        const style = new Style(Figure, [
            new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
            new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
        ], undefined, [], []);
        board.ItemContainerStyle = style;

        board.ItemsSource = items;

        // Mount in a Border so layout has somewhere to flow into.
        const surface = new Border();
        (surface as unknown as { Child: Visual }).Child = board;
        const target = new FakeTarget();
        target.Content = surface;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as any);

        // Find the realized Figure for `a`.
        const containerA = (board as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })
            ._generator.ContainerFromItem(a) as Figure | undefined;
        assert.ok(containerA instanceof Figure, 'A container should have realized for item a');

        // Simulate a drag: write a new Left / Top onto the container.
        containerA.Left = 300;
        containerA.Top  = 220;

        // TwoWay binding should have pushed the values to the VM.
        assert.equal(a.Left, 300, 'container.Left push should have updated VM.Left via TwoWay binding');
        assert.equal(a.Top,  220, 'container.Top push should have updated VM.Top via TwoWay binding');

        // Now insert a new item — same as a toolbox drop.
        const b = new TestNodeVM('b', 50, 50);
        items.Add(b);

        // The previously-moved container MUST stay at (300, 220).
        assert.equal(containerA.Left, 300, 'container A.Left must not snap back after a sibling is inserted');
        assert.equal(containerA.Top,  220, 'container A.Top must not snap back after a sibling is inserted');
        assert.equal(a.Left, 300, 'VM A.Left must not be reset by the insert');
        assert.equal(a.Top,  220, 'VM A.Top must not be reset by the insert');
    });
});
