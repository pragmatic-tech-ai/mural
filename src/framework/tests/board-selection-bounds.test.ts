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
import { Board } from '../board/board.js';
import { Figure } from '../board/figure.js';
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

function setup(items: FigureVM[]): { board: Board; coll: ObservableCollection<FigureVM> }
{
    Application.current = null;
    new Application();
    const coll = new ObservableCollection<FigureVM>();
    for (const i of items) coll.Add(i);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    board.ItemContainerStyle = style;
    board.ItemsSource = coll;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { board, coll };
}

function cont(board: Board, item: unknown): Figure
{
    const gen = (board as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

function selectMany(board: Board, items: unknown[]): void
{
    // First click: replace selection. Subsequent: Ctrl-add.
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(board, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        board.HandleContainerClick(c, mods);
    }
}

describe('Board — selection bounds tracker', () => {

    test('empty selection yields (0, 0, 0, 0) bounds and Count = 0', () => {
        const { board } = setup([new FigureVM(10, 10), new FigureVM(50, 50)]);
        assert.equal(board.SelectionLeft,   0);
        assert.equal(board.SelectionTop,    0);
        assert.equal(board.SelectionWidth,  0);
        assert.equal(board.SelectionHeight, 0);
        assert.equal(board.SelectionCount,  0);
    });

    test('three-item selection: union bbox + count', () => {
        const a = new FigureVM(10, 20, 20, 30);   // right=30, bottom=50
        const b = new FigureVM(40, 15, 15, 10);   // right=55, bottom=25
        const c = new FigureVM( 5, 50, 12,  8);   // right=17, bottom=58
        const { board } = setup([a, b, c]);

        selectMany(board, [a, b, c]);

        assert.equal(board.SelectionLeft,    5);
        assert.equal(board.SelectionTop,    15);
        assert.equal(board.SelectionWidth,  50);
        assert.equal(board.SelectionHeight, 43);
        assert.equal(board.SelectionCount,   3);
    });

    test('changing selection re-derives bbox + detaches old listeners', () => {
        const a = new FigureVM(0,  0,  10, 10);
        const b = new FigureVM(50, 0,  10, 10);
        const c = new FigureVM(0,  50, 10, 10);
        const { board } = setup([a, b, c]);

        selectMany(board, [a, b]);
        assert.equal(board.SelectionWidth, 60);

        // Switch to a different selection (plain click on `c` replaces).
        selectMany(board, [c]);
        assert.equal(board.SelectionLeft,   0);
        assert.equal(board.SelectionTop,   50);
        assert.equal(board.SelectionWidth, 10);
        assert.equal(board.SelectionCount,  1);

        a.Left = 999;
        assert.equal(board.SelectionLeft, 0, 'unselected `a` move must not affect bounds');
    });

    test('moving a selected item recomputes bounds live', () => {
        const a = new FigureVM(0,  0,  10, 10);
        const b = new FigureVM(20, 0,  10, 10);
        const { board } = setup([a, b]);
        selectMany(board, [a, b]);
        assert.equal(board.SelectionWidth, 30);

        a.Left = -10;
        assert.equal(board.SelectionLeft,  -10);
        assert.equal(board.SelectionWidth,  40);
    });

    test('resizing a selected item recomputes bounds live', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const { board } = setup([a]);
        selectMany(board, [a]);
        assert.equal(board.SelectionWidth,  10);
        assert.equal(board.SelectionHeight, 10);

        a.Width  = 50;
        a.Height = 25;
        assert.equal(board.SelectionWidth,  50);
        assert.equal(board.SelectionHeight, 25);
    });

    test('clearing selection resets bounds to (0,0,0,0)', () => {
        const a = new FigureVM(10, 10, 20, 20);
        const { board } = setup([a]);
        selectMany(board, [a]);
        assert.equal(board.SelectionCount, 1);

        board.ClearSelection();
        assert.equal(board.SelectionLeft,   0);
        assert.equal(board.SelectionTop,    0);
        assert.equal(board.SelectionWidth,  0);
        assert.equal(board.SelectionHeight, 0);
        assert.equal(board.SelectionCount,  0);
    });
});
