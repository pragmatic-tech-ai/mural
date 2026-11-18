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
    alignLeft,
    alignRight,
    alignTop,
    alignMiddle,
    alignCenter,
    type AlignTarget,
} from '../board/commands/align.js';

// ── Pure-math tests — exercise the helpers directly ─────────────────

function mkTarget(left: number, top: number, w: number, h: number): AlignTarget
{
    return { Left: left, Top: top, Width: w, Height: h };
}

describe('commands/align.ts — pure helpers', () => {

    test('alignLeft pulls every shape to the leftmost Left', () => {
        const a = mkTarget(10, 0, 20, 20);
        const b = mkTarget(50, 0, 30, 20);
        const c = mkTarget( 5, 0, 15, 20);
        alignLeft([a, b, c]);
        assert.equal(a.Left, 5);
        assert.equal(b.Left, 5);
        assert.equal(c.Left, 5);
    });

    test('alignRight pulls every shape\'s right edge to the rightmost edge', () => {
        const a = mkTarget(0,  0, 10, 20);   // right=10
        const b = mkTarget(20, 0, 30, 20);   // right=50   ← max
        const c = mkTarget(5,  0, 15, 20);   // right=20
        alignRight([a, b, c]);
        // sharedRight=50; new Left = 50 - width
        assert.equal(a.Left, 40);
        assert.equal(b.Left, 20);
        assert.equal(c.Left, 35);
    });

    test('alignTop pulls every shape to the topmost Top', () => {
        const a = mkTarget(0, 30, 10, 10);
        const b = mkTarget(0,  5, 10, 10);
        const c = mkTarget(0, 50, 10, 10);
        alignTop([a, b, c]);
        assert.equal(a.Top, 5);
        assert.equal(b.Top, 5);
        assert.equal(c.Top, 5);
    });

    test('alignMiddle centres every shape vertically on the bbox midline', () => {
        // Bbox: top=0, bottom=60  →  midY=30. Each shape's new Top = 30 - H/2.
        const a = mkTarget(0,  0, 10, 10);   // bottom=10
        const b = mkTarget(0, 50, 10, 10);   // bottom=60
        const c = mkTarget(0, 20, 10, 20);   // bottom=40
        alignMiddle([a, b, c]);
        assert.equal(a.Top, 25);    // 30 - 10/2 = 25
        assert.equal(b.Top, 25);
        assert.equal(c.Top, 20);    // 30 - 20/2 = 20
    });

    test('alignCenter centres every shape horizontally on the bbox midline', () => {
        // Bbox: left=0, right=60  →  midX=30. Each shape's new Left = 30 - W/2.
        const a = mkTarget( 0, 0, 10, 10);   // right=10
        const b = mkTarget(50, 0, 10, 10);   // right=60
        const c = mkTarget(20, 0, 20, 10);   // right=40
        alignCenter([a, b, c]);
        assert.equal(a.Left, 25);
        assert.equal(b.Left, 25);
        assert.equal(c.Left, 20);
    });

    test('all align helpers are no-ops on < 2 items', () => {
        const a = mkTarget(42, 17, 10, 10);
        const snapshot = { ...a };
        alignLeft([a]);    assert.deepEqual(a, snapshot);
        alignRight([a]);   assert.deepEqual(a, snapshot);
        alignTop([a]);     assert.deepEqual(a, snapshot);
        alignMiddle([a]);  assert.deepEqual(a, snapshot);
        alignCenter([a]);  assert.deepEqual(a, snapshot);
        alignLeft([]);     // no throw on empty array
    });
});

// ── Board-level integration — BoardCommands collaborator ────────

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

describe('Board — BoardCommands.AlignXxx (defaults from collaborator)', () => {

    test('AlignLeftCommand is installed at construction', () => {
        const { board } = setup([new FigureVM(0, 0)]);
        assert.ok(board.AlignLeftCommand instanceof RelayCommand);
        assert.ok(board.AlignRightCommand  instanceof RelayCommand);
        assert.ok(board.AlignTopCommand    instanceof RelayCommand);
        assert.ok(board.AlignMiddleCommand instanceof RelayCommand);
        assert.ok(board.AlignCenterCommand instanceof RelayCommand);
    });

    test('CanExecute is false when < 2 items are selected', () => {
        const a = new FigureVM(0, 0);
        const { board } = setup([a]);
        assert.equal(board.AlignLeftCommand?.CanExecute(),  false, 'zero-selection → false');
        selectMany(board, [a]);
        assert.equal(board.AlignLeftCommand?.CanExecute(),  false, 'one-selection → false');
    });

    test('CanExecute flips true at 2+ selected', () => {
        const a = new FigureVM(0, 0);
        const b = new FigureVM(50, 50);
        const { board } = setup([a, b]);
        selectMany(board, [a, b]);
        assert.equal(board.AlignLeftCommand?.CanExecute(),  true);
        assert.equal(board.AlignRightCommand?.CanExecute(), true);
    });

    test('Execute mutates positions of selected IFigure-shaped items', () => {
        const a = new FigureVM(10, 0, 20, 20);
        const b = new FigureVM(40, 0, 30, 20);
        const { board } = setup([a, b]);
        selectMany(board, [a, b]);
        board.AlignLeftCommand?.Execute();
        assert.equal(a.Left, 10);
        assert.equal(b.Left, 10);
    });

    test('Execute is gated by CanExecute internally (no mutation on too-small selection)', () => {
        const a = new FigureVM(10, 0, 20, 20);
        const { board } = setup([a]);
        selectMany(board, [a]);
        board.AlignLeftCommand?.Execute();
        // alignLeft no-ops for length < 2 — a.Left stays 10
        assert.equal(a.Left, 10);
    });

    test('Consumer override wins over the default', () => {
        const a = new FigureVM(0, 0);
        const b = new FigureVM(50, 50);
        const { board } = setup([a, b]);
        // Overwrite the default with a custom command
        let overrideCalled = false;
        board.set_property_value(Board.AlignLeftCommandKey,
            new RelayCommand(() => { overrideCalled = true; }));
        selectMany(board, [a, b]);
        board.AlignLeftCommand?.Execute();
        assert.equal(overrideCalled, true);
        // Original positions unchanged — the custom command doesn't mutate.
        assert.equal(a.Left, 0);
        assert.equal(b.Left, 50);
    });

    test('SelectionChanged fans out RaiseCanExecuteChanged to every command', () => {
        const a = new FigureVM(0, 0);
        const b = new FigureVM(50, 50);
        const { board } = setup([a, b]);

        let canExecChanges = 0;
        board.AlignLeftCommand?.AddCanExecuteChangedListener(() => canExecChanges++);

        selectMany(board, [a]);     // selection goes from 0 → 1
        selectMany(board, [a, b]);  // 1 → 2 (via the helper's plain-then-ctrl pattern this fires at least twice)
        board.ClearSelection();     // → 0
        // We don't pin an exact count (HandleContainerClick may fire
        // SelectionChanged multiple times across the helper's clicks).
        // The load-bearing property is "more than zero fires happened."
        assert.ok(canExecChanges > 0, `expected CanExecuteChanged to fire at least once, got ${canExecChanges}`);
    });
});
