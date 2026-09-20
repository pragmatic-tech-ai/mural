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

// Demo-shaped VM with Left/Top/IsSelected. Mirrors the shape a shape node
// publishes in the diagram demo so the test exercises the real
// container/style binding chain.
class TestNodeVM extends MuralBase
{
    public static readonly IdKey         = MuralBase.RegisterProperty<string>(TestNodeVM, 'Id',         '',    MetaData.None);
    public static readonly LeftKey       = MuralBase.RegisterProperty<number>(TestNodeVM, 'Left',       0,     MetaData.None);
    public static readonly TopKey        = MuralBase.RegisterProperty<number>(TestNodeVM, 'Top',        0,     MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(TestNodeVM, 'IsSelected', false, MetaData.None);
    constructor(id: string, left: number, top: number)
    {
        super();
        this.set_property_value(TestNodeVM.IdKey,   id);
        this.set_property_value(TestNodeVM.LeftKey, left);
        this.set_property_value(TestNodeVM.TopKey,  top);
    }
    public get Id(): string         { return this.get_property_value(TestNodeVM.IdKey); }
    public get Left(): number       { return this.get_property_value(TestNodeVM.LeftKey); }
    public set Left(v: number)      { this.set_property_value(TestNodeVM.LeftKey, v); }
    public get Top():  number       { return this.get_property_value(TestNodeVM.TopKey); }
    public set Top(v: number)       { this.set_property_value(TestNodeVM.TopKey, v); }
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

function cont(diagram: Diagram, item: unknown): Figure
{
    const gen = (diagram as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

describe('CollectionView incremental forwarding (no Filter/Sort/Group)', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('Add preserves existing containers — same identity across N adds', () => {
        const { diagram, items } = setup();
        const a = new TestNodeVM('a', 100, 100);
        items.Add(a);
        const cA0 = cont(diagram, a);

        for (let i = 0; i < 10; i++)
        {
            items.Add(new TestNodeVM('x' + i, 0, 0));
            const cAi = cont(diagram, a);
            assert.strictEqual(cAi, cA0, `existing container should be preserved after Add #${i}`);
        }
    });

    test('Add preserves user-written Left/Top on existing containers across N adds', () => {
        const { diagram, items } = setup();
        const seeded: TestNodeVM[] = [];
        const targets: { left: number; top: number }[] = [];
        for (let i = 0; i < 5; i++)
        {
            const vm = new TestNodeVM('s' + i, 100, 100);
            seeded.push(vm);
            items.Add(vm);
            const t = { left: 200 + i * 50, top: 100 + i * 30 };
            targets.push(t);
            const c = cont(diagram, vm);
            c.Left = t.left; c.Top = t.top;
        }
        for (let i = 0; i < 5; i++)
        {
            items.Add(new TestNodeVM('f' + i, 0, 0));
            for (let j = 0; j < seeded.length; j++)
            {
                const c = cont(diagram, seeded[j]);
                assert.equal(c.Left, targets[j].left, `seeded[${j}].Left after Add f${i}`);
                assert.equal(c.Top,  targets[j].top,  `seeded[${j}].Top after Add f${i}`);
                assert.equal(seeded[j].Left, targets[j].left, `seeded[${j}].VM.Left after Add f${i}`);
                assert.equal(seeded[j].Top,  targets[j].top,  `seeded[${j}].VM.Top after Add f${i}`);
            }
        }
    });

    test('Remove preserves untouched containers', () => {
        const { diagram, items } = setup();
        const a = new TestNodeVM('a', 100, 100);
        const b = new TestNodeVM('b', 100, 100);
        const c = new TestNodeVM('c', 100, 100);
        items.Add(a); items.Add(b); items.Add(c);
        const cA = cont(diagram, a);
        const cC = cont(diagram, c);
        items.Remove(b);
        assert.strictEqual(cont(diagram, a), cA, 'a container identity preserved after Remove(b)');
        assert.strictEqual(cont(diagram, c), cC, 'c container identity preserved after Remove(b)');
    });

    test('Insert at index preserves existing containers', () => {
        const { diagram, items } = setup();
        const a = new TestNodeVM('a', 100, 100);
        const c = new TestNodeVM('c', 100, 100);
        items.Add(a); items.Add(c);
        const cA = cont(diagram, a);
        const cC = cont(diagram, c);
        const b = new TestNodeVM('b', 100, 100);
        items.Insert(1, b);
        assert.strictEqual(cont(diagram, a), cA, 'a container preserved after Insert(b)');
        assert.strictEqual(cont(diagram, c), cC, 'c container preserved after Insert(b)');
    });
});
