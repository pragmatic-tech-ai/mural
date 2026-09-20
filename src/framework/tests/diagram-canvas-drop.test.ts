import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    DataObject,
    DragDropEffects,
    MetaData,
    MuralBase,
    NoModifiers,
    ObservableCollection,
    Visual,
    Size,
    type DragEventInit,
    type MountableTarget,
} from '../../runtime/index.js';
import { DragEventArgs, dispatchDrag } from '../../visual-engine/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import {
    attachCanvasDropBehavior,
    TOOLBOX_ITEM_FORMAT,
    type ItemDroppedArgs,
} from '../diagram/behaviors/canvas-drop-behavior.js';
import { SelectionMode } from '../list/list-box.js';

class ItemVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(ItemVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(ItemVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(ItemVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(ItemVM, 'Height', 10, MetaData.None);
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(): { diagram: Diagram; surface: Border }
{
    Application.current = null;
    new Application();
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource   = new ObservableCollection<ItemVM>();
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { diagram, surface };
}

function dragInit(overrides: Partial<DragEventInit> = {}): DragEventInit
{
    return {
        HostX:          0,
        HostY:          0,
        Modifiers:      NoModifiers,
        Data:           new DataObject(),
        AllowedEffects: DragDropEffects.All,
        Session:        undefined,
        ...overrides,
    };
}

describe('Diagram — canvas drop behavior', () => {

    test('attachCanvasDropBehavior sets AllowDrop=true on receiver', () => {
        const { diagram, surface } = setup();
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, false);
        attachCanvasDropBehavior(surface, diagram);
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, true);
    });

    test('detach reverses AllowDrop + removes listeners', () => {
        const { diagram, surface } = setup();
        const detach = attachCanvasDropBehavior(surface, diagram);
        detach();
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, false);
    });

    test('DragOver with the right format sets Effect = Copy', () => {
        const { diagram, surface } = setup();
        attachCanvasDropBehavior(surface, diagram);
        const data = new DataObject();
        data.Set(TOOLBOX_ITEM_FORMAT, 'rectangle');
        const args = new DragEventArgs('DragOver', surface, dragInit({ Data: data }));
        dispatchDrag(args);
        assert.equal(args.Effect, DragDropEffects.Copy);
    });

    test('DragOver without the right format does not set Effect', () => {
        const { diagram, surface } = setup();
        attachCanvasDropBehavior(surface, diagram);
        const data = new DataObject();
        data.Set('some-other-format', 'whatever');
        const args = new DragEventArgs('DragOver', surface, dragInit({ Data: data }));
        dispatchDrag(args);
        assert.equal(args.Effect, DragDropEffects.None);
    });

    test('Drop fires Diagram.ItemDropped with canvas-local position + data', () => {
        const { diagram, surface } = setup();
        attachCanvasDropBehavior(surface, diagram);
        const data = new DataObject();
        data.Set(TOOLBOX_ITEM_FORMAT, 'ellipse');

        const events: ItemDroppedArgs[] = [];
        diagram.AddItemDroppedListener(e => events.push(e));

        const args = new DragEventArgs('Drop', surface, dragInit({
            HostX: 100, HostY: 50, Data: data,
        }));
        dispatchDrag(args);

        assert.equal(events.length, 1);
        assert.equal(events[0].Data, data);
        // Surface origin = (0,0); no ScrollViewer → canvas-local = host coords.
        assert.equal(events[0].Position.X, 100);
        assert.equal(events[0].Position.Y, 50);
    });

    test('Drop without the right format is ignored', () => {
        const { diagram, surface } = setup();
        attachCanvasDropBehavior(surface, diagram);
        const data = new DataObject();
        data.Set('not-our-format', 'noise');

        const events: ItemDroppedArgs[] = [];
        diagram.AddItemDroppedListener(e => events.push(e));

        const args = new DragEventArgs('Drop', surface, dragInit({ HostX: 100, HostY: 50, Data: data }));
        dispatchDrag(args);

        assert.equal(events.length, 0);
    });
});
