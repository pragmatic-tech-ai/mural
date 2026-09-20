import { ModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    NoModifiers,
    ObservableCollection,
    PointerButton,
    SetterFactory,
    Style,
    Setter,
    Size,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../runtime/index.js';
import type { PointerEventInit } from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import { Figure } from '../diagram/figure.js';
import { InputManager } from '../index.js';
import { SelectionMode } from '../list/list-box.js';

class NodeVM extends MuralBase
{
    public static readonly IdKey   = MuralBase.RegisterProperty<string>(NodeVM, 'Id',   '', MetaData.None);
    public static readonly LeftKey = MuralBase.RegisterProperty<number>(NodeVM, 'Left', 0,  MetaData.None);
    public static readonly TopKey  = MuralBase.RegisterProperty<number>(NodeVM, 'Top',  0,  MetaData.None);
    constructor(id: string, left: number, top: number)
    {
        super();
        this.set_property_value(NodeVM.IdKey,   id);
        this.set_property_value(NodeVM.LeftKey, left);
        this.set_property_value(NodeVM.TopKey,  top);
    }
    public get Id(): string   { return this.get_property_value(NodeVM.IdKey); }
    public get Left(): number { return this.get_property_value(NodeVM.LeftKey); }
    public set Left(v: number){ this.set_property_value(NodeVM.LeftKey, v); }
    public get Top():  number { return this.get_property_value(NodeVM.TopKey); }
    public set Top(v: number) { this.set_property_value(NodeVM.TopKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function pointerInit(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   NoModifiers,
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
        ...overrides,
    };
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

describe('Diagram — group drag', () => {
    beforeEach(() => {
        Application.current = null;
        new Application();
    });

    test('dragging a selected shape moves every other selected shape by the same delta', () => {
        const { diagram, items } = setup();
        const a = new NodeVM('a', 100, 100);
        const b = new NodeVM('b', 300, 200);
        const c = new NodeVM('c', 500, 350);
        items.Add(a); items.Add(b); items.Add(c);

        const cA = cont(diagram, a);
        const cB = cont(diagram, b);
        const cC = cont(diagram, c);

        // Extended selection: all three are part of the active selection.
        diagram.SelectedItem = a;
        diagram.HandleContainerClick(cB, ModifierKeys.Control);
        diagram.HandleContainerClick(cC, ModifierKeys.Control);
        assert.equal(diagram.SelectedItems.length, 3, 'three items selected');

        // Press on A at (150, 150) — inside A's hit area (A is at 100,100).
        const im = new InputManager();
        im.InjectPointerDown(cA, pointerInit({ HostX: 150, HostY: 150 }));

        // Move past the click threshold then to (250, 220). Cumulative
        // delta on A from (100,100) → (200,170).
        im.InjectPointerMove(cA, pointerInit({ HostX: 200, HostY: 200 }));
        im.InjectPointerMove(cA, pointerInit({ HostX: 250, HostY: 220 }));

        // A's container.Left = 250 - 50 (grabOffsetX = 150-100) = 200. Top similarly.
        assert.equal(cA.Left, 200, 'A.Left after drag');
        assert.equal(cA.Top,  170, 'A.Top after drag');
        // B / C shifted by the same vector: (+100, +70).
        assert.equal(cB.Left, 400, 'B.Left after group drag');
        assert.equal(cB.Top,  270, 'B.Top after group drag');
        assert.equal(cC.Left, 600, 'C.Left after group drag');
        assert.equal(cC.Top,  420, 'C.Top after group drag');

        // VMs mirror.
        assert.equal(a.Left, 200); assert.equal(a.Top, 170);
        assert.equal(b.Left, 400); assert.equal(b.Top, 270);
        assert.equal(c.Left, 600); assert.equal(c.Top, 420);

        im.InjectPointerUp(cA, pointerInit({ HostX: 250, HostY: 220 }));
    });

    test('dragging an unselected shape leaves the existing selection in place', () => {
        const { diagram, items } = setup();
        const a = new NodeVM('a', 100, 100);
        const b = new NodeVM('b', 300, 200);
        const c = new NodeVM('c', 500, 350);
        items.Add(a); items.Add(b); items.Add(c);

        const cA = cont(diagram, a);
        const cB = cont(diagram, b);
        const cC = cont(diagram, c);

        // Select only A + B. C is NOT in the selection.
        diagram.SelectedItem = a;
        diagram.HandleContainerClick(cB, ModifierKeys.Control);

        // Press on C — unselected — and drag.
        const im = new InputManager();
        im.InjectPointerDown(cC, pointerInit({ HostX: 550, HostY: 400 }));
        im.InjectPointerMove(cC, pointerInit({ HostX: 600, HostY: 450 }));
        im.InjectPointerMove(cC, pointerInit({ HostX: 700, HostY: 500 }));

        // C followed the cursor.
        assert.equal(cC.Left, 650, 'C.Left after solo drag (700 - 50 grab)');
        assert.equal(cC.Top,  450, 'C.Top after solo drag (500 - 50 grab)');
        // A and B untouched — selection's identity was different.
        assert.equal(cA.Left, 100); assert.equal(cA.Top, 100);
        assert.equal(cB.Left, 300); assert.equal(cB.Top, 200);

        im.InjectPointerUp(cC, pointerInit({ HostX: 700, HostY: 500 }));
    });

    test('partner snapshot is press-time stable — mid-drag selection mutations do not change the partner set', () => {
        const { diagram, items } = setup();
        const a = new NodeVM('a', 100, 100);
        const b = new NodeVM('b', 300, 200);
        const c = new NodeVM('c', 500, 350);
        items.Add(a); items.Add(b); items.Add(c);

        const cA = cont(diagram, a);
        const cB = cont(diagram, b);
        const cC = cont(diagram, c);

        // Select A + B (C not selected at press time).
        diagram.SelectedItem = a;
        diagram.HandleContainerClick(cB, ModifierKeys.Control);

        const im = new InputManager();
        im.InjectPointerDown(cA, pointerInit({ HostX: 150, HostY: 150 }));
        im.InjectPointerMove(cA, pointerInit({ HostX: 200, HostY: 200 }));

        // Mid-drag selection mutation — toggle C in. Partner set was
        // already snapshotted at press time, so C must NOT move with
        // the rest of the drag.
        diagram.HandleContainerClick(cC, ModifierKeys.Control);

        im.InjectPointerMove(cA, pointerInit({ HostX: 250, HostY: 220 }));

        assert.equal(cA.Left, 200, 'A.Left after drag');
        assert.equal(cB.Left, 400, 'B.Left after drag (partner from press time)');
        assert.equal(cC.Left, 500, 'C.Left unchanged — added to selection mid-drag, not a partner');

        im.InjectPointerUp(cA, pointerInit({ HostX: 250, HostY: 220 }));
    });
});
