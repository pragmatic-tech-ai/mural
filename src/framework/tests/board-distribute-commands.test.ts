import { ModifierKeys } from '../../runtime/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
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
import {
    distributeHorizontal,
    distributeVertical,
    type DistributeTarget,
} from '../board/commands/distribute.js';

// ── Pure-math tests ─────────────────────────────────────────────────

function mkTarget(left: number, top: number, w: number, h: number): DistributeTarget
{
    return { Left: left, Top: top, Width: w, Height: h };
}

describe('commands/distribute.ts — pure helpers', () => {

    test('distributeHorizontal — 3 same-width shapes get equal gaps', () => {
        // Bbox: leftmost Left=0 width=10, rightmost Left=80 width=10 → totalSpan=90,
        // widthSum=30, gap = (90 - 30) / 2 = 30.
        // Middle shape lands at 0+10+30=40.
        const a = mkTarget( 0, 0, 10, 10);
        const b = mkTarget(20, 0, 10, 10);  // any starting Left — gets repositioned
        const c = mkTarget(80, 0, 10, 10);
        distributeHorizontal([a, b, c]);
        assert.equal(a.Left,  0);
        assert.equal(b.Left, 40);
        assert.equal(c.Left, 80);
    });

    test('distributeHorizontal — variable widths produce equal edge-gaps', () => {
        // a: 10 wide, c: 20 wide. Bbox: Left=0..100. totalSpan=100. widthSum =
        // 10 + b.Width + 20. With b.Width=20: widthSum=50, gap=(100-50)/2 = 25.
        // Middle (b) lands at 0+10+25=35.
        const a = mkTarget(  0, 0, 10, 10);
        const b = mkTarget( 50, 0, 20, 10);
        const c = mkTarget( 80, 0, 20, 10);
        distributeHorizontal([a, b, c]);
        assert.equal(a.Left,  0);
        assert.equal(b.Left, 35);
        assert.equal(c.Left, 80);
    });

    test('distributeHorizontal — input order does not affect result', () => {
        // Same 3 shapes, scrambled. Sort-by-Left internally → identical result.
        const a = mkTarget( 0, 0, 10, 10);
        const b = mkTarget(80, 0, 10, 10);
        const c = mkTarget(20, 0, 10, 10);
        distributeHorizontal([b, c, a]);   // scrambled order
        assert.equal(a.Left,  0);
        assert.equal(c.Left, 40);   // c is the middle by sort (Left=20→40)
        assert.equal(b.Left, 80);
    });

    test('distributeVertical — 3 same-height shapes get equal gaps', () => {
        const a = mkTarget(0,  0, 10, 10);
        const b = mkTarget(0, 30, 10, 10);
        const c = mkTarget(0, 80, 10, 10);
        distributeVertical([a, b, c]);
        assert.equal(a.Top,  0);
        assert.equal(b.Top, 40);
        assert.equal(c.Top, 80);
    });

    test('distribute helpers no-op on < 3 items', () => {
        const a = mkTarget(0, 0, 10, 10);
        const b = mkTarget(50, 0, 10, 10);
        const snapshotA = { ...a };
        const snapshotB = { ...b };
        distributeHorizontal([a, b]);
        assert.deepEqual(a, snapshotA);
        assert.deepEqual(b, snapshotB);
        distributeHorizontal([a]);  // 1-item: no throw
        distributeHorizontal([]);   // 0-item: no throw
    });
});

// ── Board integration ─────────────────────────────────────────────

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
    public get Height(): number  { return this.get_property_value(FigureVM.HeightKey); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: FigureVM[]): { board: Board }
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
    return { board };
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
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(board, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        board.HandleContainerClick(c, mods);
    }
}

describe('Board — BoardCommands.DistributeXxx', () => {

    test('default commands installed at construction', () => {
        const { board } = setup([]);
        assert.ok(board.DistributeHorizontalCommand instanceof RelayCommand);
        assert.ok(board.DistributeVerticalCommand   instanceof RelayCommand);
    });

    test('CanExecute is false with < 3 selected', () => {
        const a = new FigureVM(0, 0);
        const b = new FigureVM(50, 0);
        const { board } = setup([a, b]);
        selectMany(board, [a, b]);
        assert.equal(board.DistributeHorizontalCommand?.CanExecute(), false);
    });

    test('CanExecute flips true at 3 selected', () => {
        const a = new FigureVM( 0, 0);
        const b = new FigureVM(50, 0);
        const c = new FigureVM(80, 0);
        const { board } = setup([a, b, c]);
        selectMany(board, [a, b, c]);
        assert.equal(board.DistributeHorizontalCommand?.CanExecute(), true);
        assert.equal(board.DistributeVerticalCommand?.CanExecute(),   true);
    });

    test('Execute spaces inner shapes horizontally', () => {
        const a = new FigureVM( 0, 0);
        const b = new FigureVM(50, 0);
        const c = new FigureVM(80, 0);
        const { board } = setup([a, b, c]);
        selectMany(board, [a, b, c]);
        board.DistributeHorizontalCommand?.Execute();
        // gap = (90 - 30) / 2 = 30 → b lands at 0+10+30 = 40
        assert.equal(a.Left,  0);
        assert.equal(b.Left, 40);
        assert.equal(c.Left, 80);
    });
});
