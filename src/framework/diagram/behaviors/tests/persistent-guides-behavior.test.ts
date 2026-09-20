import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, AlignmentAxis, EdgeKind, Key, ModifierKeys, Point, Rect, Size, Visual, ObservableCollection, snapRectToGuides } from '../../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../../basic/index.js';
import { PaginatedCanvas } from '../../../../basic/panels/paginated-canvas.js';
import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Diagram } from '../../diagram.js';
import { Figure } from '../../figure.js';
import { attachPersistentGuides } from '../persistent-guides-behavior.js';
import { FORMAT_PAINTER_CURSOR } from '../format-painter-behavior.js';

describe('persistent-guides behavior', () => {
    test('attach installs a composing PositionSnap and detach restores it', () => {
        Application.current = null; new Application();
        const d = new Diagram();
        const prior = (r: Rect): Rect => r;
        d.PositionSnap = prior;
        const detach = attachPersistentGuides(d);
        assert.notEqual(d.PositionSnap, prior, 'snap composed');
        detach();
        assert.equal(d.PositionSnap, prior, 'snap restored');
    });

    test('node drop within tolerance of a guide forms glue (pure kernel)', () => {
        Application.current = null; new Application();
        const d = new Diagram();
        d.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        const res = snapRectToGuides(new Rect(197, 50, 40, 40), d.Guides, 5);
        assert.deepEqual(res.x, { edge: EdgeKind.Min, guide: 0 });
        assert.equal(res.snapped.X, 200);
    });
});

// Drive the tunnel (preview) pointer virtuals + OnKeyDown directly with real
// Figure items, like the alignment-guides drag-integration test.
describe('persistent-guides behavior — live interactions', () => {
    function setup(): { diagram: Diagram; a: Figure }
    {
        initTestApp();
        const a = new Figure(); a.Id = 'na'; a.Left = 197; a.Top = 100; a.Width = 80; a.Height = 60;
        const b = new Figure(); b.Id = 'nb'; b.Left = 400; b.Top = 300; b.Width = 80; b.Height = 60;
        const coll = new ObservableCollection<Figure>();
        coll.Add(a); coll.Add(b);
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        diagram.ItemsSource = coll;
        attachPersistentGuides(diagram);
        const surface = new Border();
        surface.SetChild(diagram);
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return { diagram, a };
    }

    // HostToContent is ~identity here (no ruler offset, zoom 1), so host coords
    // double as content coords for driving gestures.
    function down(diagram: Diagram, hx: number, hy: number, source: unknown): void
    {
        (diagram as unknown as { OnPreviewPointerDown(a: unknown): void })
            .OnPreviewPointerDown({ Kind: 'PointerDown', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function move(diagram: Diagram, hx: number, hy: number, source: unknown): void
    {
        (diagram as unknown as { OnPreviewPointerMove(a: unknown): void })
            .OnPreviewPointerMove({ Kind: 'PointerMove', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function up(diagram: Diagram, hx: number, hy: number, source: unknown): void
    {
        (diagram as unknown as { OnPreviewPointerUp(a: unknown): void })
            .OnPreviewPointerUp({ Kind: 'PointerUp', Source: source, Visual: source, Handled: false, HostX: hx, HostY: hy });
    }
    function key(diagram: Diagram, k: Key): boolean
    {
        const args = { Key: k, Modifiers: 0, Handled: false };
        (diagram as unknown as { OnKeyDown(a: unknown): void }).OnKeyDown(args);
        return args.Handled;
    }

    test('dragging a node whose edge lands on a guide glues it on drop', () => {
        const { diagram, a } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        down(diagram, 237, 130, a);      // on the node body, away from the guide + edges
        up(diagram, 237, 130, a);
        const glued = diagram.Guides[0]!.glued;
        assert.equal(glued.length, 1);
        assert.equal(glued[0]!.nodeId, 'na');
        assert.equal(glued[0]!.edge, EdgeKind.Min);
    });

    test('dropping the node far from the guide leaves it un-glued', () => {
        const { diagram, a } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 200, glued: [] }];
        down(diagram, 237, 130, a);
        a.Left = 50;
        up(diagram, 237, 130, a);
        assert.equal(diagram.Guides[0]!.glued.length, 0);
    });

    test('clicking near a guide selects it', () => {
        const { diagram } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        down(diagram, 300, 200, diagram);   // on the guide line, clear of edges
        up(diagram, 300, 200, diagram);
        assert.equal(diagram.SelectedGuide, 0);
    });

    test('Delete removes the selected guide and clears the selection', () => {
        const { diagram } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        diagram.SelectedGuide = 0;
        const handled = key(diagram, Key.Delete);
        assert.equal(handled, true, 'guide delete consumes the key');
        assert.equal(diagram.Guides.length, 0);
        assert.equal(diagram.SelectedGuide, -1);
    });

    test('Delete is a no-op (unhandled) when no guide is selected', () => {
        const { diagram } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        diagram.SelectedGuide = -1;
        const handled = key(diagram, Key.Delete);
        assert.equal(handled, false, 'lets the node-delete path run');
        assert.equal(diagram.Guides.length, 1);
    });

    test('dragging out of the top margin creates a horizontal guide', () => {
        const { diagram } = setup();
        assert.equal(diagram.Guides.length, 0);
        down(diagram, 400, 4, diagram);     // top margin band (content y=4 <= 14)
        move(diagram, 400, 130, diagram);   // drag down into the canvas
        up(diagram, 400, 130, diagram);
        assert.equal(diagram.Guides.length, 1);
        assert.equal(diagram.Guides[0]!.axis, AlignmentAxis.Y);   // horizontal line
        assert.ok(Math.abs(diagram.Guides[0]!.position - 130) < 6);
        assert.equal(diagram.SelectedGuide, 0, 'new guide is selected');
    });

    test('a click in the margin without dragging does not create a guide', () => {
        const { diagram } = setup();
        down(diagram, 400, 4, diagram);
        up(diagram, 400, 4, diagram);       // no move
        assert.equal(diagram.Guides.length, 0);
    });

    test('hovering the top create band shows a resize cursor + Y preview line', () => {
        const { diagram } = setup();
        move(diagram, 400, 4, diagram);      // idle move into the top band (content y=4 <= 14)
        assert.equal(diagram.Cursor, 'ns-resize');
        assert.ok(diagram.GuidePreview !== undefined, 'preview published');
        assert.equal(diagram.GuidePreview!.axis, AlignmentAxis.Y);
        assert.ok(Math.abs(diagram.GuidePreview!.position - 4) < 1);
    });

    test('hovering an existing guide shows the grab cursor and no preview', () => {
        const { diagram } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        move(diagram, 300, 200, diagram);    // on the guide line, clear of the bands
        assert.equal(diagram.Cursor, 'grab');
        assert.equal(diagram.GuidePreview, undefined);
    });

    test('moving off any zone clears the hover cursor + preview', () => {
        const { diagram } = setup();
        move(diagram, 400, 4, diagram);      // arm hover in the band
        assert.equal(diagram.Cursor, 'ns-resize');
        move(diagram, 400, 300, diagram);    // empty canvas, away from bands + guides
        assert.equal(diagram.Cursor, undefined);
        assert.equal(diagram.GuidePreview, undefined);
    });

    test('while the format painter is armed, guides yield — its cursor survives an idle move', () => {
        const { diagram, a } = setup();
        // Select a shape so the format painter arms (and stays armed), which
        // sets the diagram-wide copy cursor.
        const container = diagram.Generator.ContainerFromItem(a);
        diagram.HandleContainerClick(container as unknown as Visual, ModifierKeys.None);
        diagram.FormatPainterActive = true;
        assert.equal(diagram.Cursor, FORMAT_PAINTER_CURSOR, 'painter armed → copy cursor');
        // An idle move over empty canvas — the guides hover would normally
        // clearHover() here, stomping the painter's cursor. It must yield instead.
        move(diagram, 400, 300, diagram);
        assert.equal(diagram.Cursor, FORMAT_PAINTER_CURSOR, 'guides must not clobber the armed paint cursor');
    });

    test('the create band tracks the EFFECTIVE visible edge, not raw ScrollX/Y', () => {
        const { diagram } = setup();
        // Pretend the content pane's visible origin sits at content (50, 0) — e.g.
        // horizontally panned — regardless of what a stale ScrollX would say.
        (diagram as unknown as { VisibleContentOrigin(): Point }).VisibleContentOrigin = () => new Point(50, 0);

        // A drag starting just inside the shifted left edge (content x in [50,64])
        // pulls out a vertical guide.
        down(diagram, 52, 300, diagram);
        move(diagram, 61, 300, diagram);     // move >3 px along x so it "counts"
        up(diagram, 61, 300, diagram);
        assert.equal(diagram.Guides.length, 1);
        assert.equal(diagram.Guides[0]!.axis, AlignmentAxis.X);

        // A press left of the shifted edge (content x=10) is NOT in the band.
        diagram.Guides = [];
        down(diagram, 10, 300, diagram);
        up(diagram, 10, 300, diagram);
        assert.equal(diagram.Guides.length, 0);
    });

    test('grabbing and dragging a guide moves it', () => {
        const { diagram } = setup();
        diagram.Guides = [{ axis: AlignmentAxis.X, position: 300, glued: [] }];
        down(diagram, 300, 200, diagram);
        move(diagram, 355, 200, diagram);   // no node edge near 355 -> no snap
        up(diagram, 355, 200, diagram);
        assert.ok(Math.abs(diagram.Guides[0]!.position - 355) < 6, `moved to ~355, got ${diagram.Guides[0]!.position}`);
    });
});
