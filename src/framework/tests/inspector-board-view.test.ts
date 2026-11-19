import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Color, Rect, Size, Visibility, type Visual } from '../../runtime/index.js';
import { SolidColorBrush } from '../../visual-engine/index.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { EditorShell } from '../shell/editor-shell.js';
import { PanelDockService } from '../shell/services/panel-dock-service.js';
import { Board } from '../board/board.js';
import { BoardInspector } from '../board/board-inspector.js';
import { ShapeFormatControl } from '../formatting/shape-format-control.js';

function collect<T>(root: Visual, ctor: new (...a: never[]) => T, out: T[] = []): T[]
{
    if (root instanceof ctor) out.push(root);
    for (const c of root.visualChildren) collect(c, ctor, out);
    return out;
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const red = new SolidColorBrush(Color.FromHex('#ff0000'));

// Reproduces the Plexus Format Shape pane end-to-end: a BoardInspector whose
// View points at a live Board carrying a selection-format fill, hosted by the
// shell's InspectorService and rendered through DataTemplate[BoardInspector]
// (DataContext = $View → ShapeFormatControl Fill = $SelectionFormatFill).
// Asserts the ShapeFormatControl actually receives the fill through the $View
// hop — the reported failure is the pane showing "Select a shape…" despite a
// selection.
describe('BoardInspector — Format Shape pane tracks the View selection format', () =>
{
    beforeEach(() => { initTestApp(); });

    async function mount(): Promise<{ root: Visual; svc: PanelDockService }>
    {
        const shell = new EditorShell();
        const root  = shell.visualChildren[0]!;
        const svc   = shell.Services.get(PanelDockService.Key) as PanelDockService;
        await settle();
        root.Measure(new Size(1200, 800));
        root.Arrange(new Rect(0, 0, 1200, 800));
        return { root, svc };
    }

    function pump(root: Visual): void
    {
        root.Measure(new Size(1200, 800));
        root.Arrange(new Rect(0, 0, 1200, 800));
    }

    test('View set BEFORE Add (select-then-open): fill flows to ShapeFormatControl', async () =>
    {
        const { root, svc } = await mount();

        const board = new Board();
        board.set_property_value(Board.SelectionFormatFillKey, red);

        const inspector = new BoardInspector();
        inspector.View = board;

        svc.Add(inspector);
        await settle();
        pump(root);

        const sfc = collect(root, ShapeFormatControl);
        assert.equal(sfc.length, 1, 'ShapeFormatControl materialized in the pane');
        assert.equal(sfc[0]!.Fill, red, 'Fill resolved through $View → $SelectionFormatFill');
    });

    test('View set, selection AFTER Add (open-then-select): reactive update', async () =>
    {
        const { root, svc } = await mount();

        const board = new Board();          // no selection format yet
        const inspector = new BoardInspector();
        inspector.View = board;

        svc.Add(inspector);
        await settle();
        pump(root);

        const sfc = collect(root, ShapeFormatControl)[0]!;
        assert.equal(sfc.Fill, undefined, 'no fill before selection');

        // Simulate selecting a shape after the pane is open.
        board.set_property_value(Board.SelectionFormatFillKey, red);
        await settle();
        pump(root);

        assert.equal(sfc.Fill, red, 'Fill updates reactively when the selection format changes');
    });

    test('View assigned AFTER Add (inspector created before the control publishes)', async () =>
    {
        const { root, svc } = await mount();

        const board = new Board();
        board.set_property_value(Board.SelectionFormatFillKey, red);

        const inspector = new BoardInspector();  // View still undefined
        svc.Add(inspector);
        await settle();
        pump(root);

        const sfc = collect(root, ShapeFormatControl)[0]!;
        assert.equal(sfc.Fill, undefined, 'no View yet → no fill');

        // The document publishes its ActiveView late → Inspector.View = board.
        inspector.View = board;
        await settle();
        pump(root);

        assert.equal(sfc.Fill, red, 'Fill flows once View is assigned (reactive $View)');
    });
});
