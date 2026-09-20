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
import { DiagramSelectionSource } from '../diagram/behaviors/diagram-selection-source.js';

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
    public get Top():    number  { return this.get_property_value(FigureVM.TopKey); }
    public get Width():  number  { return this.get_property_value(FigureVM.WidthKey); }
    public get Height(): number  { return this.get_property_value(FigureVM.HeightKey); }
}

// A figure-shaped item that also carries the LockAspectRatio DP (real Figures
// do; the plain FigureVM above does not). DiagramSelectionSource reads the flag
// duck-typed off the geometry host, so this exercises the aspect-lock path.
class LockFigureVM extends FigureVM
{
    public static readonly LockAspectRatioKey = MuralBase.RegisterProperty<boolean>(LockFigureVM, 'LockAspectRatio', false, MetaData.None);
    public get LockAspectRatio(): boolean { return this.get_property_value(LockFigureVM.LockAspectRatioKey); }
    public set LockAspectRatio(v: boolean) { this.set_property_value(LockFigureVM.LockAspectRatioKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: FigureVM[]): { diagram: Diagram }
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
    return { diagram };
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
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(diagram, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        diagram.HandleContainerClick(c, mods);
    }
}

describe('Diagram — selection-resize DP surface', () => {

    test('SelectionResizeEnabled defaults to false', () => {
        const { diagram } = setup([]);
        assert.equal(diagram.SelectionResizeEnabled, false);
    });

    test('flipping SelectionResizeEnabled = true is idempotent', () => {
        const { diagram } = setup([]);
        diagram.SelectionResizeEnabled = true;
        diagram.SelectionResizeEnabled = true;   // re-flip should not throw or double-attach
        assert.equal(diagram.SelectionResizeEnabled, true);
    });

    test('flipping back to false detaches cleanly', () => {
        const { diagram } = setup([]);
        diagram.SelectionResizeEnabled = true;
        diagram.SelectionResizeEnabled = false;
        assert.equal(diagram.SelectionResizeEnabled, false);
    });
});

describe('DiagramSelectionSource — direct resize semantics', () => {

    test('Bounds + Count proxy through Diagram', () => {
        const a = new FigureVM(10, 20, 30, 40);
        const b = new FigureVM(60, 70, 20, 10);
        const { diagram } = setup([a, b]);
        const src = new DiagramSelectionSource(diagram);

        selectMany(diagram, [a, b]);
        assert.equal(src.Count, 2);
        const b1 = src.Bounds;
        assert.equal(b1.X,      10);
        assert.equal(b1.Y,      20);
        assert.equal(b1.Width,  70);  // (60+20) − 10
        assert.equal(b1.Height, 60);  // (70+10) − 20
    });

    test('subscribe fires on bounds changes', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const { diagram } = setup([a]);
        const src = new DiagramSelectionSource(diagram);

        let fires = 0;
        const unsubscribe = src.subscribe(() => fires++);
        selectMany(diagram, [a]);    // SelectionCount: 0 → 1
        assert.ok(fires > 0, `expected ≥ 1 fire, got ${fires}`);

        const before = fires;
        unsubscribe();
        diagram.ClearSelection();
        assert.equal(fires, before, 'unsubscribed listener must not fire');
    });

    test('beginResize + applyResize(E handle: +dw, 0 dh, left, none) grows widths', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const b = new FigureVM(0, 0, 10, 10);
        const { diagram } = setup([a, b]);
        selectMany(diagram, [a, b]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(5, 0, 'left', 'none');
        src.endResize();

        // Each item gets a uniform +5 width delta; Left anchored (left → Left unchanged).
        assert.equal(a.Left, 0);
        assert.equal(a.Width, 15);
        assert.equal(b.Left, 0);
        assert.equal(b.Width, 15);
    });

    test('applyResize honors right anchor by sliding Left with width', () => {
        const a = new FigureVM(20, 0, 10, 10);   // right edge = 30
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(5, 0, 'right', 'none');
        src.endResize();

        // newW = 15. xAnchor=right → newLeft = snap.left + snap.w − newW = 20 + 10 − 15 = 15.
        assert.equal(a.Left,  15);
        assert.equal(a.Width, 15);
    });

    test('applyResize clamps dimensions to MIN (8)', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(-50, -50, 'left', 'top');   // would drive W/H negative
        src.endResize();

        assert.equal(a.Width,  8);
        assert.equal(a.Height, 8);
    });

    test('aspect lock: corner drag scales uniformly (80×80 +1 → 81×81, not 81×82)', () => {
        const a = new LockFigureVM(0, 0, 80, 80);
        a.LockAspectRatio = true;
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(1, 1, 'left', 'top');   // SE-ish corner, +1 each axis
        src.endResize();

        assert.equal(a.Width,  81);
        assert.equal(a.Height, 81);
    });

    test('aspect lock: single-axis (edge) drag scales BOTH dims proportionally', () => {
        const a = new LockFigureVM(0, 0, 100, 50);   // ratio 2:1
        a.LockAspectRatio = true;
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(50, 0, 'left', 'none');   // E handle: +50 width, no height delta
        src.endResize();

        // scaleW = 150/100 = 1.5 dominant → newW = 150, newH = 50 * 1.5 = 75.
        assert.equal(a.Width,  150);
        assert.equal(a.Height, 75);
    });

    test('aspect lock: shrink past MIN clamps uniformly (ratio preserved)', () => {
        const a = new LockFigureVM(0, 0, 40, 20);   // ratio 2:1, MIN = 8
        a.LockAspectRatio = true;
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(-100, -100, 'left', 'top');   // would drive both negative
        src.endResize();

        // minScale = max(8/40, 8/20) = 0.4 → newW = 16, newH = 8. Ratio still 2:1.
        assert.equal(a.Width,  16);
        assert.equal(a.Height, 8);
    });

    test('aspect lock OFF: axes remain independent (regression guard)', () => {
        const a = new LockFigureVM(0, 0, 80, 80);   // lock defaults false
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.beginResize();
        src.applyResize(1, 0, 'left', 'top');
        src.endResize();

        assert.equal(a.Width,  81);
        assert.equal(a.Height, 80);   // untouched — no aspect coupling
    });

    test('applyResize without prior beginResize is a no-op', () => {
        const a = new FigureVM(0, 0, 10, 10);
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);

        const src = new DiagramSelectionSource(diagram);
        src.applyResize(5, 0, 'left', 'none');   // no beginResize
        assert.equal(a.Width, 10, 'no snapshot → no writes');
    });
});
