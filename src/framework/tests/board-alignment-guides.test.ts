import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    Rect,
    SetterFactory,
    Setter,
    Size,
    Style,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { PaginatedCanvas } from '../../basic/panels/paginated-canvas.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { Board } from '../board/board.js';
import { Figure } from '../board/figure.js';
import { SelectionMode } from '../list/list-box.js';

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
    public get Left():   number { return this.get_property_value(FigureVM.LeftKey); }
    public get Top():    number { return this.get_property_value(FigureVM.TopKey); }
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

describe('Board — alignment guides DP surface', () => {

    test('AlignmentGuidesEnabled defaults to false', () => {
        const { board } = setup([]);
        assert.equal(board.AlignmentGuidesEnabled, false);
    });

    test('AlignmentGuides defaults to an empty (frozen) array', () => {
        const { board } = setup([]);
        const guides = board.AlignmentGuides;
        assert.equal(Array.isArray(guides), true);
        assert.equal(guides.length, 0);
    });

    test('flipping AlignmentGuidesEnabled = true installs PositionSnap', () => {
        const { board } = setup([]);
        assert.equal(board.PositionSnap, undefined, 'precondition: no snap before enable');
        board.AlignmentGuidesEnabled = true;
        assert.notEqual(board.PositionSnap, undefined, 'PositionSnap installed by the behavior');
    });

    test('flipping AlignmentGuidesEnabled = false restores prior PositionSnap', () => {
        const { board } = setup([]);
        const customSnap = (r: Rect): Rect => r;
        board.PositionSnap = customSnap;

        board.AlignmentGuidesEnabled = true;
        assert.notEqual(board.PositionSnap, customSnap, 'behavior overrides snap while enabled');

        board.AlignmentGuidesEnabled = false;
        assert.equal(board.PositionSnap, customSnap, 'prior snap restored on disable');
    });

    test('re-enabling after disable installs a fresh PositionSnap', () => {
        const { board } = setup([]);
        board.AlignmentGuidesEnabled = true;
        const firstSnap = board.PositionSnap;
        board.AlignmentGuidesEnabled = false;
        board.AlignmentGuidesEnabled = true;
        assert.notEqual(board.PositionSnap, undefined);
        assert.notEqual(board.PositionSnap, firstSnap, 'fresh attach yields a fresh snap closure');
    });

    test('AlignmentGuides is read-only — direct set_property_value throws', () => {
        const { board } = setup([]);
        assert.throws(
            () => board.set_property_value(Board.AlignmentGuidesKey, [] as never),
            /read-only/i,
            'public set_property_value must reject the read-only key',
        );
    });

    test('AlignmentGuides can be written by the framework via the privileged path', () => {
        // _setAlignmentGuides exposes the privileged write so the
        // behavior can drive the DP. Same path AlignmentGuidesBehavior
        // uses on PointerMove.
        const { board } = setup([]);
        const synthetic = [
            { axis: 'x' as const, position: 100, movingEdge: 'min' as const, otherEdge: 'min' as const, otherRect: new Rect(0, 0, 10, 10) },
        ];
        board._setAlignmentGuides(synthetic);
        assert.equal(board.AlignmentGuides.length, 1);
        assert.equal(board.AlignmentGuides[0].position, 100);
    });
});

// Regression: guides never appeared during a real drag because the behavior
// listened on the Board's BUBBLE pointer events, which Figure.OnPointerDown/
// Move/Up swallow by setting args.Handled. The fix drives the behavior from the
// Board's TUNNEL (preview) pointer interceptor (bracketing the active figure)
// and computes guides inside the PositionSnap callback. These tests exercise
// that path with real Figure items (Items-are-Figures).
describe('Board — alignment guides drag integration', () => {
    function setupFigures(): { board: Board; a: Figure; b: Figure }
    {
        initTestApp();   // Board theme → item containers realize + arrange
        const a = new Figure(); a.Left = 100; a.Top = 100; a.Width = 80; a.Height = 60;
        const b = new Figure(); b.Left = 300; b.Top = 100; b.Width = 80; b.Height = 60;
        const coll = new ObservableCollection<Figure>();
        coll.Add(a); coll.Add(b);
        const board = new Board();
        board.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        board.ItemsSource = coll;
        board.AlignmentGuidesEnabled = true;
        const surface = new Border();
        surface.SetChild(board);
        const target = new FakeTarget();
        target.Content = surface;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return { board, a, b };
    }

    // Drive the Board's tunnel (preview) pointer virtual directly — the same
    // point real routing invokes before a descendant Figure consumes the event.
    function previewPointer(board: Board, kind: 'PointerDown' | 'PointerUp', source: Figure): void
    {
        const args = { Kind: kind, Source: source, Visual: source, Handled: false };
        const seam = board as unknown as {
            OnPreviewPointerDown(a: unknown): void;
            OnPreviewPointerUp(a: unknown): void;
        };
        if (kind === 'PointerDown') seam.OnPreviewPointerDown(args);
        else seam.OnPreviewPointerUp(args);
    }

    test('dragging a figure whose edge nears a peer publishes guides and snaps', () => {
        const { board, a, b } = setupFigures();
        previewPointer(board, 'PointerDown', a);
        // A dragged so its top edge (103) lands within tolerance of B's top (100).
        const snapped = board.PositionSnap!(new Rect(a.Left, b.Top + 3, a.Width, a.Height));
        assert.ok(board.AlignmentGuides.length > 0, 'guides published during drag');
        assert.equal(snapped.Y, b.Top, 'snapped the moving rect to the peer top edge');
    });

    test('pointer-up ends the drag: guides clear and snapping disengages', () => {
        const { board, a, b } = setupFigures();
        previewPointer(board, 'PointerDown', a);
        board.PositionSnap!(new Rect(a.Left, b.Top + 3, a.Width, a.Height));
        assert.ok(board.AlignmentGuides.length > 0, 'precondition: guides present mid-drag');

        previewPointer(board, 'PointerUp', a);
        assert.equal(board.AlignmentGuides.length, 0, 'guides cleared on pointer-up');
        const r = board.PositionSnap!(new Rect(a.Left, b.Top + 3, a.Width, a.Height));
        assert.equal(r.Y, b.Top + 3, 'no snap once the drag has ended');
    });
});
