import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, AlignmentAxis, EdgeKind, Key, ModifierKeys, Point, Rect, Size, Visual, ObservableCollection, snapRectToGuides } from '../../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../../basic/index.js';
import { PaginatedCanvas } from '../../../../basic/panels/paginated-canvas.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Board } from '../../board.js';
import { Figure } from '../../figure.js';
import { attachPersistentGuides } from '../persistent-guides-behavior.js';
import { FORMAT_PAINTER_CURSOR } from '../format-painter-behavior.js';

describe('persistent-guides behavior', () => {
    test('attach installs a composing PositionSnap and detach restores it', () => {
        Application.current = null; new Application();
        const d = new Board();
        const prior = (r: Rect): Rect => r;
        d.PositionSnap = prior;
        const detach = attachPersistentGuides(d);
        assert.notEqual(d.PositionSnap, prior, 'snap composed');
        detach();
        assert.equal(d.PositionSnap, prior, 'snap restored');
    });

    test('node drop within tolerance of a guide forms glue (pure kernel)', () => {
        Application.current = null; new Application();
        const d = new Board();
        d.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        const res = snapRectToGuides(new Rect(197, 50, 40, 40), d.Guides, 5);
        assert.deepEqual(res.x, { edge: EdgeKind.Min, guide: 0 });
        assert.equal(res.snapped.X, 200);
    });
});

// Drive the tunnel (preview) pointer virtuals + OnKeyDown directly with real
// Figure items, like the alignment-guides drag-integration test.
describe('persistent-guides behavior — live interactions', () => {
    function setup(): { board: Board; a: Figure }
    {
        initTestApp();
        const a = new Figure(); a.Id = 'na'; a.Left = 197; a.Top = 100; a.Width = 80; a.Height = 60;
        const b = new Figure(); b.Id = 'nb'; b.Left = 400; b.Top = 300; b.Width = 80; b.Height = 60;
        const coll = new ObservableCollection<Figure>();
        coll.Add(a); coll.Add(b);
        const board = new Board();
        board.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        board.ItemsSource = coll;
        attachPersistentGuides(board);
        const surface = new Border();
        surface.SetChild(board);
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return { board, a };
    }

    // HostToContent is ~identity here (no ruler offset, zoom 1), so host coords
    // double as content coords for driving gestures.
    function down(board: Board, hx: number, hy: number, source: unknown): void
    {
        (board as unknown as { OnPreviewPointerDown(a: unknown): void })
            .OnPreviewPointerDown({ Kind: 'PointerDown', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function move(board: Board, hx: number, hy: number, source: unknown): void
    {
        (board as unknown as { OnPreviewPointerMove(a: unknown): void })
            .OnPreviewPointerMove({ Kind: 'PointerMove', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function up(board: Board, hx: number, hy: number, source: unknown): void
    {
        (board as unknown as { OnPreviewPointerUp(a: unknown): void })
            .OnPreviewPointerUp({ Kind: 'PointerUp', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function key(board: Board, k: Key): boolean
    {
        const args = { Key: k, Modifiers: 0, Handled: false };
        (board as unknown as { OnKeyDown(a: unknown): void }).OnKeyDown(args);
        return args.Handled;
    }

    test('dragging a node whose edge lands on a guide glues it on drop', () => {
        const { board, a } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        down(board, 237, 130, a);      // on the node body, away from the guide + edges
        up(board, 237, 130, a);
        const glued = board.Guides[0]!.glued;
        assert.equal(glued.length, 1);
        assert.equal(glued[0]!.nodeId, 'na');
        assert.equal(glued[0]!.edge, EdgeKind.Min);
    });

    test('dropping the node far from the guide leaves it un-glued', () => {
        const { board, a } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        down(board, 237, 130, a);
        a.Left = 50;
        up(board, 237, 130, a);
        assert.equal(board.Guides[0]!.glued.length, 0);
    });

    test('clicking near a guide selects it', () => {
        const { board } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        down(board, 300, 200, board);   // on the guide line, clear of edges
        up(board, 300, 200, board);
        assert.equal(board.SelectedGuide, 0);
    });

    test('Delete removes the selected guide and clears the selection', () => {
        const { board } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        board.SelectedGuide = 0;
        const handled = key(board, Key.Delete);
        assert.equal(handled, true, 'guide delete consumes the key');
        assert.equal(board.Guides.length, 0);
        assert.equal(board.SelectedGuide, -1);
    });

    test('Delete is a no-op (unhandled) when no guide is selected', () => {
        const { board } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        board.SelectedGuide = -1;
        const handled = key(board, Key.Delete);
        assert.equal(handled, false, 'lets the node-delete path run');
        assert.equal(board.Guides.length, 1);
    });

    test('dragging out of the top margin creates a horizontal guide', () => {
        const { board } = setup();
        assert.equal(board.Guides.length, 0);
        down(board, 400, 4, board);     // top margin band (content y=4 <= 14)
        move(board, 400, 130, board);   // drag down into the canvas
        up(board, 400, 130, board);
        assert.equal(board.Guides.length, 1);
        assert.equal(board.Guides[0]!.axis, AlignmentAxis.Y);   // horizontal line
        assert.ok(Math.abs(board.Guides[0]!.position - 130) < 6);
        assert.equal(board.SelectedGuide, 0, 'new guide is selected');
    });

    test('a click in the margin without dragging does not create a guide', () => {
        const { board } = setup();
        down(board, 400, 4, board);
        up(board, 400, 4, board);       // no move
        assert.equal(board.Guides.length, 0);
    });

    test('hovering the top create band shows a resize cursor + Y preview line', () => {
        const { board } = setup();
        move(board, 400, 4, board);      // idle move into the top band (content y=4 <= 14)
        assert.equal(board.Cursor, 'ns-resize');
        assert.ok(board.GuidePreview !== undefined, 'preview published');
        assert.equal(board.GuidePreview!.axis, AlignmentAxis.Y);
        assert.ok(Math.abs(board.GuidePreview!.position - 4) < 1);
    });

    test('hovering an existing guide shows the grab cursor and no preview', () => {
        const { board } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        move(board, 300, 200, board);    // on the guide line, clear of the bands
        assert.equal(board.Cursor, 'grab');
        assert.equal(board.GuidePreview, undefined);
    });

    test('moving off any zone clears the hover cursor + preview', () => {
        const { board } = setup();
        move(board, 400, 4, board);      // arm hover in the band
        assert.equal(board.Cursor, 'ns-resize');
        move(board, 400, 300, board);    // empty canvas, away from bands + guides
        assert.equal(board.Cursor, undefined);
        assert.equal(board.GuidePreview, undefined);
    });

    test('while the format painter is armed, guides yield — its cursor survives an idle move', () => {
        const { board, a } = setup();
        // Select a shape so the format painter arms (and stays armed), which
        // sets the board-wide copy cursor.
        const container = board.Generator.ContainerFromItem(a);
        board.HandleContainerClick(container as unknown as Visual, ModifierKeys.None);
        board.FormatPainterActive = true;
        assert.equal(board.Cursor, FORMAT_PAINTER_CURSOR, 'painter armed → copy cursor');
        // An idle move over empty canvas — the guides hover would normally
        // clearHover() here, stomping the painter's cursor. It must yield instead.
        move(board, 400, 300, board);
        assert.equal(board.Cursor, FORMAT_PAINTER_CURSOR, 'guides must not clobber the armed paint cursor');
    });

    test('the create band tracks the EFFECTIVE visible edge, not raw ScrollX/Y', () => {
        const { board } = setup();
        // Pretend the content pane's visible origin sits at content (50, 0) — e.g.
        // horizontally panned — regardless of what a stale ScrollX would say.
        (board as unknown as { VisibleContentOrigin(): Point }).VisibleContentOrigin = () => new Point(50, 0);

        // A drag starting just inside the shifted left edge (content x in [50,64])
        // pulls out a vertical guide.
        down(board, 52, 300, board);
        move(board, 61, 300, board);     // move >3 px along x so it "counts"
        up(board, 61, 300, board);
        assert.equal(board.Guides.length, 1);
        assert.equal(board.Guides[0]!.axis, AlignmentAxis.X);

        // A press left of the shifted edge (content x=10) is NOT in the band.
        board.Guides = [];
        down(board, 10, 300, board);
        up(board, 10, 300, board);
        assert.equal(board.Guides.length, 0);
    });

    test('grabbing and dragging a guide moves it', () => {
        const { board } = setup();
        board.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        down(board, 300, 200, board);
        move(board, 355, 200, board);   // no node edge near 355 -> no snap
        up(board, 355, 200, board);
        assert.ok(Math.abs(board.Guides[0]!.position - 355) < 6, `moved to ~355, got ${board.Guides[0]!.position}`);
    });
});
