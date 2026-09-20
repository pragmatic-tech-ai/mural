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

class TestNodeVM extends MuralBase
{
    public static readonly IdKey         = MuralBase.RegisterProperty<string>(TestNodeVM, 'Id',         '',    MetaData.None);
    public static readonly LeftKey       = MuralBase.RegisterProperty<number>(TestNodeVM, 'Left',       0,     MetaData.None);
    public static readonly TopKey        = MuralBase.RegisterProperty<number>(TestNodeVM, 'Top',        0,     MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(TestNodeVM, 'IsSelected', false, MetaData.None);
    constructor(id: string, left: number, top: number)
    {
        super();
        this.set_property_value(TestNodeVM.IdKey, id);
        this.set_property_value(TestNodeVM.LeftKey, left);
        this.set_property_value(TestNodeVM.TopKey,  top);
    }
    public get Id(): string           { return this.get_property_value(TestNodeVM.IdKey); }
    public get Left():  number        { return this.get_property_value(TestNodeVM.LeftKey); }
    public set Left(v: number)        { this.set_property_value(TestNodeVM.LeftKey, v); }
    public get Top():   number        { return this.get_property_value(TestNodeVM.TopKey); }
    public set Top(v: number)         { this.set_property_value(TestNodeVM.TopKey, v); }
    public get IsSelected(): boolean  { return this.get_property_value(TestNodeVM.IsSelectedKey); }
    public set IsSelected(v: boolean) { this.set_property_value(TestNodeVM.IsSelectedKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

interface InternalGen
{
    ContainerFromItem(item: unknown): Visual | undefined;
}

function makeDiagram(): { diagram: Diagram; surface: Border; items: ObservableCollection<TestNodeVM> }
{
    const items   = new ObservableCollection<TestNodeVM>();
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

function relayout(surface: Border): void
{
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as any);
}

function container(diagram: Diagram, item: unknown): Figure
{
    const gen = (diagram as unknown as { _generator: InternalGen })._generator;
    const c   = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

describe('Diagram — multi-drag + multi-insert position persistence', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('5 sequential drags + 5 sequential inserts: every move persists', () => {
        const { diagram, surface, items } = makeDiagram();

        // Seed five items at known positions.
        const seeded: TestNodeVM[] = [
            new TestNodeVM('a', 100, 100),
            new TestNodeVM('b', 100, 100),
            new TestNodeVM('c', 100, 100),
            new TestNodeVM('d', 100, 100),
            new TestNodeVM('e', 100, 100),
        ];
        for (const n of seeded) items.Add(n);
        relayout(surface);

        // Drag each one to a unique position.
        const targets = [
            { left: 200, top: 250 },
            { left: 320, top: 110 },
            { left:  80, top: 380 },
            { left: 500, top: 200 },
            { left: 410, top: 340 },
        ];
        for (let i = 0; i < seeded.length; i++)
        {
            const c = container(diagram, seeded[i]);
            c.Left = targets[i].left;
            c.Top  = targets[i].top;
        }

        // Now simulate the toolbox drop: select a fresh inserted item.
        const fresh: TestNodeVM[] = [];
        for (let i = 0; i < 5; i++)
        {
            const fi = new TestNodeVM('f' + i, 50 + i * 20, 50 + i * 20);
            items.Add(fi);
            // Mirror the canvas-drop-behavior pattern: select the just-dropped node.
            diagram.SelectedItem = fi;
            fresh.push(fi);
            relayout(surface);
        }

        // Every previously-moved container must still be at its target.
        for (let i = 0; i < seeded.length; i++)
        {
            const c = container(diagram, seeded[i]);
            assert.equal(c.Left, targets[i].left, `seeded[${i}].container.Left should still be ${targets[i].left} but was ${c.Left}`);
            assert.equal(c.Top,  targets[i].top,  `seeded[${i}].container.Top should still be ${targets[i].top} but was ${c.Top}`);
            assert.equal(seeded[i].Left, targets[i].left, `seeded[${i}].VM.Left should still be ${targets[i].left} but was ${seeded[i].Left}`);
            assert.equal(seeded[i].Top,  targets[i].top,  `seeded[${i}].VM.Top should still be ${targets[i].top} but was ${seeded[i].Top}`);
        }
    });

    test('interleaved drag-then-insert-then-drag cycles', () => {
        const { diagram, surface, items } = makeDiagram();

        const a = new TestNodeVM('a', 100, 100);
        items.Add(a);
        relayout(surface);

        // Drag a to (200, 200).
        const cA = container(diagram, a);
        cA.Left = 200; cA.Top = 200;
        assert.equal(a.Left, 200);
        assert.equal(a.Top,  200);

        // Insert b.
        const b = new TestNodeVM('b', 50, 50);
        items.Add(b);
        diagram.SelectedItem = b;
        relayout(surface);
        // a must not snap back.
        assert.equal(container(diagram, a).Left, 200, 'a.Left after b insert');
        assert.equal(container(diagram, a).Top,  200, 'a.Top after b insert');

        // Drag b to (300, 300).
        const cB = container(diagram, b);
        cB.Left = 300; cB.Top = 300;
        assert.equal(b.Left, 300);
        assert.equal(b.Top,  300);

        // Insert c.
        const c = new TestNodeVM('c', 60, 60);
        items.Add(c);
        diagram.SelectedItem = c;
        relayout(surface);
        // a and b must persist.
        assert.equal(container(diagram, a).Left, 200, 'a.Left after c insert');
        assert.equal(container(diagram, b).Left, 300, 'b.Left after c insert');

        // Drag c to (400, 400).
        const cC = container(diagram, c);
        cC.Left = 400; cC.Top = 400;
        assert.equal(c.Left, 400);
        assert.equal(c.Top,  400);

        // Drag a again to (250, 250). Re-fetch container — Refresh
        // discards the prior Figure instance.
        const cA2 = container(diagram, a);
        cA2.Left = 250; cA2.Top = 250;
        assert.equal(a.Left, 250);
        assert.equal(a.Top,  250);

        // Insert d.
        const d = new TestNodeVM('d', 70, 70);
        items.Add(d);
        diagram.SelectedItem = d;
        relayout(surface);
        assert.equal(container(diagram, a).Left, 250, 'a.Left after d insert');
        assert.equal(container(diagram, b).Left, 300, 'b.Left after d insert');
        assert.equal(container(diagram, c).Left, 400, 'c.Left after d insert');
    });

    test('drag → selection-replace mid-cycle does not snap previously-moved nodes', () => {
        const { diagram, surface, items } = makeDiagram();

        const a = new TestNodeVM('a', 100, 100);
        const b = new TestNodeVM('b', 100, 100);
        const c = new TestNodeVM('c', 100, 100);
        items.Add(a); items.Add(b); items.Add(c);
        relayout(surface);

        const cA = container(diagram, a);
        const cB = container(diagram, b);
        const cC = container(diagram, c);
        cA.Left = 200; cA.Top = 200;
        cB.Left = 300; cB.Top = 300;
        cC.Left = 400; cC.Top = 400;

        // Mimic the drop's selector mutation that the canvas-drop-behavior performs.
        diagram.SelectedItem = a;
        diagram.SelectedItem = b;
        diagram.SelectedItem = c;
        diagram.SelectedItem = undefined;

        assert.equal(cA.Left, 200, 'a.Left after selection churn');
        assert.equal(cB.Left, 300, 'b.Left after selection churn');
        assert.equal(cC.Left, 400, 'c.Left after selection churn');
    });
});
