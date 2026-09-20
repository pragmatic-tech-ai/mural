import { ModifierKeys } from '../../runtime/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    SetterFactory,
    Setter,
    Size,
    Style,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import { Figure } from '../diagram/figure.js';
import { SelectionMode } from '../list/list-box.js';

// IFigure-shaped synthetic data class — MuralBase with Left/Top/Width/Height
// DPs. SelectionBoundsTracker duck-types on these via findDescriptor; any
// MuralBase with these four DPs registered satisfies the contract.
class FigureVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(FigureVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(FigureVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(FigureVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(FigureVM, 'Height', 10, MetaData.None);

    constructor(left: number, top: number, w: number = 10, h: number = 10)
    {
        super();
        this.set_property_value(FigureVM.LeftKey,   left);
        this.set_property_value(FigureVM.TopKey,    top);
        this.set_property_value(FigureVM.WidthKey,  w);
        this.set_property_value(FigureVM.HeightKey, h);
    }

    public get Left():   number  { return this.get_property_value(FigureVM.LeftKey); }
    public set Left(v: number)   { this.set_property_value(FigureVM.LeftKey, v); }
    public get Top():    number  { return this.get_property_value(FigureVM.TopKey); }
    public set Top(v: number)    { this.set_property_value(FigureVM.TopKey, v); }
    public get Width():  number  { return this.get_property_value(FigureVM.WidthKey); }
    public set Width(v: number)  { this.set_property_value(FigureVM.WidthKey, v); }
    public get Height(): number  { return this.get_property_value(FigureVM.HeightKey); }
    public set Height(v: number) { this.set_property_value(FigureVM.HeightKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: FigureVM[]): { diagram: Diagram; coll: ObservableCollection<FigureVM> }
{
    Application.current = null;
    new Application();
    const coll = new ObservableCollection<FigureVM>();
    for (const i of items) coll.Add(i);
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    diagram.ItemContainerStyle = style;
    diagram.ItemsSource = coll;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { diagram, coll };
}

function cont(diagram: Diagram, item: unknown): Figure
{
    const gen = (diagram as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

function selectMany(diagram: Diagram, items: unknown[]): void
{
    // First click: replace selection. Subsequent: Ctrl-add.
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(diagram, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        diagram.HandleContainerClick(c, mods);
    }
}

describe('Diagram — selection bounds tracker', () => {

    test('empty selection yields (0, 0, 0, 0) bounds and Count = 0', () => {
        const { diagram } = setup([new FigureVM(10, 10), new FigureVM(50, 50)]);
        assert.equal(diagram.SelectionLeft,   0);
        assert.equal(diagram.SelectionTop,    0);
        assert.equal(diagram.SelectionWidth,  0);
        assert.equal(diagram.SelectionHeight, 0);
        assert.equal(diagram.SelectionCount,  0);
    });

    test('three-item selection: union bbox + count', () => {
        const a = new FigureVM(10, 20, 20, 30);   // right=30, bottom=50
        const b = new FigureVM(40, 15, 15, 10);   // right=55, bottom=25
        const c = new FigureVM( 5, 50, 12,  8);   // right=17, bottom=58
        const { diagram } = setup([a, b, c]);

        selectMany(diagram, [a, b, c]);

        assert.equal(diagram.SelectionLeft,    5);
        assert.equal(diagram.SelectionTop,    15);
        assert.equal(diagram.SelectionWidth,  50);
        assert.equal(diagram.SelectionHeight, 43);
        assert.equal(diagram.SelectionCount,   3);
    });

    test('changing selection re-derives bbox + detaches old listeners', () => {
        const a = new FigureVM(0,  0,  10, 10);
        const b = new FigureVM(50, 0,  10, 10);
        const c = new FigureVM(0,  50, 10, 10);
        const { diagram } = setup([a, b, c]);

        selectMany(diagram, [a, b]);
        assert.equal(diagram.SelectionWidth, 60);

        // Switch to a different selection (plain click on `c` replaces).
        selectMany(diagram, [c]);
        assert.equal(diagram.SelectionLeft,   0);
        assert.equal(diagram.SelectionTop,   50);
        assert.equal(diagram.SelectionWidth, 10);
        assert.equal(diagram.SelectionCount,  1);

        a.Left = 999;
        assert.equal(diagram.SelectionLeft, 0, 'unselected `a` move must not affect bounds');
    });

    test('moving a selected item recomputes bounds live', () => {
        const a = new FigureVM(0,  0,  10, 10);
        const b = new FigureVM(20, 0,  10, 10);
        const { diagram } = setup([a, b]);
        selectMany(diagram, [a, b]);
        assert.equal(diagram.SelectionWidth, 30);

        a.Left = -10;
        assert.equal(diagram.SelectionLeft,  -10);
        assert.equal(diagram.SelectionWidth,  40);
    });

    test('resizing a selected item recomputes bounds live', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);
        assert.equal(diagram.SelectionWidth,  10);
        assert.equal(diagram.SelectionHeight, 10);

        a.Width  = 50;
        a.Height = 25;
        assert.equal(diagram.SelectionWidth,  50);
        assert.equal(diagram.SelectionHeight, 25);
    });

    test('clearing selection resets bounds to (0,0,0,0)', () => {
        const a = new FigureVM(10, 10, 20, 20);
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);
        assert.equal(diagram.SelectionCount, 1);

        diagram.ClearSelection();
        assert.equal(diagram.SelectionLeft,   0);
        assert.equal(diagram.SelectionTop,    0);
        assert.equal(diagram.SelectionWidth,  0);
        assert.equal(diagram.SelectionHeight, 0);
        assert.equal(diagram.SelectionCount,  0);
    });
});
