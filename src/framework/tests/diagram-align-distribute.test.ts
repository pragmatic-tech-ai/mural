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
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import { Figure } from '../diagram/figure.js';
import { SelectionMode } from '../list/list-box.js';

// Stand-in for a shape node. Carries Left / Top / Width /
// Height / IsSelected — the surface the alignment math reads + writes.
class NodeVM extends MuralBase
{
    public static readonly IdKey         = MuralBase.RegisterProperty<string>(NodeVM, 'Id',         '',    MetaData.None);
    public static readonly LeftKey       = MuralBase.RegisterProperty<number>(NodeVM, 'Left',       0,     MetaData.None);
    public static readonly TopKey        = MuralBase.RegisterProperty<number>(NodeVM, 'Top',        0,     MetaData.None);
    public static readonly WidthKey      = MuralBase.RegisterProperty<number>(NodeVM, 'Width',      80,    MetaData.None);
    public static readonly HeightKey     = MuralBase.RegisterProperty<number>(NodeVM, 'Height',     80,    MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(NodeVM, 'IsSelected', false, MetaData.None);
    constructor(id: string, left: number, top: number, w: number = 80, h: number = 80)
    {
        super();
        this.set_property_value(NodeVM.IdKey,     id);
        this.set_property_value(NodeVM.LeftKey,   left);
        this.set_property_value(NodeVM.TopKey,    top);
        this.set_property_value(NodeVM.WidthKey,  w);
        this.set_property_value(NodeVM.HeightKey, h);
    }
    public get Id():         string  { return this.get_property_value(NodeVM.IdKey); }
    public get Left():       number  { return this.get_property_value(NodeVM.LeftKey); }
    public set Left(v: number)       { this.set_property_value(NodeVM.LeftKey, v); }
    public get Top():        number  { return this.get_property_value(NodeVM.TopKey); }
    public set Top(v: number)        { this.set_property_value(NodeVM.TopKey, v); }
    public get Width():      number  { return this.get_property_value(NodeVM.WidthKey); }
    public get Height():     number  { return this.get_property_value(NodeVM.HeightKey); }
    public get IsSelected(): boolean { return this.get_property_value(NodeVM.IsSelectedKey); }
    public set IsSelected(v: boolean){ this.set_property_value(NodeVM.IsSelectedKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup()
{
    Application.current = null;
    new Application();
    const items   = new ObservableCollection<NodeVM>();
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    diagram.ItemContainerStyle = style;
    diagram.ItemsSource = items;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as any);
    return { diagram, surface, items };
}

function cont(diagram: Diagram, item: unknown): Figure
{
    const gen = (diagram as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

// Mirror the alignment math from DiagramVM (kept in-test so the
// production .mjs surface — JavaScript without a typed contract from
// TypeScript — doesn't need a parallel .ts shim). Same algorithm.
function alignLeft(sel: NodeVM[]): void
{
    if (sel.length < 2) return;
    const minLeft = Math.min(...sel.map(n => n.Left));
    for (const n of sel) n.Left = minLeft;
}
function alignRight(sel: NodeVM[]): void
{
    if (sel.length < 2) return;
    const sharedRight = Math.max(...sel.map(n => n.Left + n.Width));
    for (const n of sel) n.Left = sharedRight - n.Width;
}
function alignTop(sel: NodeVM[]): void
{
    if (sel.length < 2) return;
    const minTop = Math.min(...sel.map(n => n.Top));
    for (const n of sel) n.Top = minTop;
}
function alignMiddle(sel: NodeVM[]): void
{
    if (sel.length < 2) return;
    const top    = Math.min(...sel.map(n => n.Top));
    const bottom = Math.max(...sel.map(n => n.Top + n.Height));
    const midY   = (top + bottom) / 2;
    for (const n of sel) n.Top = midY - n.Height / 2;
}
function distributeHorizontal(sel: NodeVM[]): void
{
    if (sel.length < 3) return;
    sel.sort((a, b) => a.Left - b.Left);
    const leftmost  = sel[0]!;
    const rightmost = sel[sel.length - 1]!;
    const totalSpan = (rightmost.Left + rightmost.Width) - leftmost.Left;
    const widthSum  = sel.reduce((acc, n) => acc + n.Width, 0);
    const gap       = (totalSpan - widthSum) / (sel.length - 1);
    let cursor = leftmost.Left + leftmost.Width + gap;
    for (let i = 1; i < sel.length - 1; i++)
    {
        sel[i]!.Left = cursor;
        cursor += sel[i]!.Width + gap;
    }
}
function distributeVertical(sel: NodeVM[]): void
{
    if (sel.length < 3) return;
    sel.sort((a, b) => a.Top - b.Top);
    const topmost    = sel[0]!;
    const bottommost = sel[sel.length - 1]!;
    const totalSpan = (bottommost.Top + bottommost.Height) - topmost.Top;
    const heightSum = sel.reduce((acc, n) => acc + n.Height, 0);
    const gap       = (totalSpan - heightSum) / (sel.length - 1);
    let cursor = topmost.Top + topmost.Height + gap;
    for (let i = 1; i < sel.length - 1; i++)
    {
        sel[i]!.Top = cursor;
        cursor += sel[i]!.Height + gap;
    }
}

describe('Diagram — Align / Distribute math', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('AlignLeft drops every shape\'s Left to the leftmost Left', () => {
        const a = new NodeVM('a', 100, 200);
        const b = new NodeVM('b', 250, 100);
        const c = new NodeVM('c',  60, 400);
        alignLeft([a, b, c]);
        assert.equal(a.Left, 60);
        assert.equal(b.Left, 60);
        assert.equal(c.Left, 60);
        // Top untouched.
        assert.equal(a.Top, 200);
        assert.equal(b.Top, 100);
        assert.equal(c.Top, 400);
    });

    test('AlignRight pins every shape\'s right edge to the rightmost', () => {
        // Distinct widths so the math isn't trivially the same Left.
        const a = new NodeVM('a',  10, 0, 80);   // right = 90
        const b = new NodeVM('b', 100, 0, 40);   // right = 140
        const c = new NodeVM('c',  50, 0, 60);   // right = 110
        alignRight([a, b, c]);
        // sharedRight = 140; each Left = 140 - width
        assert.equal(a.Left, 60);   // 140 - 80
        assert.equal(b.Left, 100);  // 140 - 40
        assert.equal(c.Left, 80);   // 140 - 60
    });

    test('AlignTop drops every shape\'s Top to the topmost Top', () => {
        const a = new NodeVM('a', 0, 200);
        const b = new NodeVM('b', 0, 150);
        const c = new NodeVM('c', 0, 300);
        alignTop([a, b, c]);
        assert.equal(a.Top, 150);
        assert.equal(b.Top, 150);
        assert.equal(c.Top, 150);
    });

    test('AlignMiddle centres every shape on the selection bbox horizontal midline', () => {
        const a = new NodeVM('a', 0, 100, 80, 80); // top in [100, 180]
        const b = new NodeVM('b', 0, 300, 80, 40); // top in [300, 340]
        // top=100, bottom=340, midY = 220
        alignMiddle([a, b]);
        assert.equal(a.Top, 180);   // 220 - 80/2
        assert.equal(b.Top, 200);   // 220 - 40/2
    });

    test('DistributeHorizontal spaces 3 equal-width shapes with equal gaps', () => {
        const a = new NodeVM('a',   0, 0, 80);   // right = 80
        const b = new NodeVM('b', 200, 0, 80);   // start anywhere
        const c = new NodeVM('c', 400, 0, 80);   // right = 480
        distributeHorizontal([a, b, c]);
        // totalSpan = 480, widthSum = 240, gap = (480 - 240) / 2 = 120
        // cursor starts at 0 + 80 + 120 = 200 → b.Left = 200
        assert.equal(a.Left, 0);
        assert.equal(b.Left, 200);
        assert.equal(c.Left, 400);
    });

    test('DistributeHorizontal spaces 4 unequal-width shapes with equal gaps', () => {
        const a = new NodeVM('a',   0, 0,  40);  // right = 40
        const b = new NodeVM('b', 100, 0, 100);
        const c = new NodeVM('c', 250, 0,  20);
        const d = new NodeVM('d', 400, 0,  60);  // right = 460
        distributeHorizontal([a, b, c, d]);
        // totalSpan = 460, widthSum = 40+100+20+60 = 220
        // gap = (460 - 220) / 3 = 80
        // cursor: 0 + 40 + 80 = 120 → b.Left = 120
        // next:  120 + 100 + 80 = 300 → c.Left = 300
        // rightmost unchanged.
        assert.equal(a.Left,   0);
        assert.equal(b.Left, 120);
        assert.equal(c.Left, 300);
        assert.equal(d.Left, 400);
    });

    test('Distribute on 2 shapes is a no-op (PowerPoint parity)', () => {
        const a = new NodeVM('a',   0, 0);
        const b = new NodeVM('b', 400, 0);
        distributeHorizontal([a, b]);
        assert.equal(a.Left,   0);
        assert.equal(b.Left, 400);
    });
});

describe('Diagram — alignment moves dragged containers (architectural fix)', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('VM.Left write reaches a previously-dragged container (no Local shadowing)', () => {
        const { diagram, items } = setup();
        const a = new NodeVM('a', 100, 100);
        items.Add(a);

        // Simulate a user drag — the same path Figure.OnPointerMove
        // exercises: write Local, then ClearValue (which is what the
        // architectural fix added).
        const cA = cont(diagram, a);
        cA.Left = 250; cA.Top = 175;
        cA.ClearValue(Figure.LeftKey);
        cA.ClearValue(Figure.TopKey);

        // Writeback should have made it to the VM, AND with Local
        // cleared the Style tier becomes effective.
        assert.equal(a.Left, 250, 'VM.Left after drag round-trip');
        assert.equal(a.Top,  175, 'VM.Top after drag round-trip');
        assert.equal(cA.Left, 250, 'container.Left after drag round-trip');
        assert.equal(cA.Top,  175, 'container.Top after drag round-trip');

        // Now simulate an alignment command writing VM.Left directly.
        a.Left = 50;
        a.Top  = 20;
        // Container must follow.
        assert.equal(cA.Left, 50, 'container.Left after VM-side write (alignment)');
        assert.equal(cA.Top,  20, 'container.Top after VM-side write (alignment)');
    });

    test('multi-shape alignment moves every container after each was dragged', () => {
        const { diagram, items } = setup();
        const a = new NodeVM('a', 100, 100);
        const b = new NodeVM('b', 250, 150);
        const c = new NodeVM('c',  60, 400);
        items.Add(a); items.Add(b); items.Add(c);

        // Drag every shape to a new position.
        for (const vm of [a, b, c])
        {
            const ctr = cont(diagram, vm);
            ctr.Left = vm.Left + 10;
            ctr.Top  = vm.Top  + 5;
            ctr.ClearValue(Figure.LeftKey);
            ctr.ClearValue(Figure.TopKey);
        }
        assert.equal(a.Left, 110); assert.equal(b.Left, 260); assert.equal(c.Left, 70);

        // Run AlignLeft — every VM.Left drops to min.
        alignLeft([a, b, c]);
        // VM is the source of truth.
        assert.equal(a.Left, 70);
        assert.equal(b.Left, 70);
        assert.equal(c.Left, 70);
        // Containers follow the source via the Style binding.
        assert.equal(cont(diagram, a).Left, 70, 'a container.Left');
        assert.equal(cont(diagram, b).Left, 70, 'b container.Left');
        assert.equal(cont(diagram, c).Left, 70, 'c container.Left');
    });
});
