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
import { Board } from '../board/board.js';
import {
    attachCanvasDropBehavior,
    TOOLBOX_ITEM_FORMAT,
    type ItemDroppedArgs,
} from '../board/behaviors/canvas-drop-behavior.js';
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

function setup(): { board: Board; surface: Border }
{
    Application.current = null;
    new Application();
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource   = new ObservableCollection<ItemVM>();
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { board, surface };
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

describe('Board — canvas drop behavior', () => {

    test('attachCanvasDropBehavior sets AllowDrop=true on receiver', () => {
        const { board, surface } = setup();
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, false);
        attachCanvasDropBehavior(surface, board);
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, true);
    });

    test('detach reverses AllowDrop + removes listeners', () => {
        const { board, surface } = setup();
        const detach = attachCanvasDropBehavior(surface, board);
        detach();
        assert.equal((surface as unknown as { AllowDrop: boolean }).AllowDrop, false);
    });

    test('DragOver with the right format sets Effect = Copy', () => {
        const { board, surface } = setup();
        attachCanvasDropBehavior(surface, board);
        const data = new DataObject();
        data.Set(TOOLBOX_ITEM_FORMAT, 'rectangle');
        const args = new DragEventArgs('DragOver', surface, dragInit({ Data: data }));
        dispatchDrag(args);
        assert.equal(args.Effect, DragDropEffects.Copy);
    });

    test('DragOver without the right format does not set Effect', () => {
        const { board, surface } = setup();
        attachCanvasDropBehavior(surface, board);
        const data = new DataObject();
        data.Set('some-other-format', 'whatever');
        const args = new DragEventArgs('DragOver', surface, dragInit({ Data: data }));
        dispatchDrag(args);
        assert.equal(args.Effect, DragDropEffects.None);
    });

    test('Drop fires Board.ItemDropped with canvas-local position + data', () => {
        const { board, surface } = setup();
        attachCanvasDropBehavior(surface, board);
        const data = new DataObject();
        data.Set(TOOLBOX_ITEM_FORMAT, 'ellipse');

        const events: ItemDroppedArgs[] = [];
        board.AddItemDroppedListener(e => events.push(e));

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
        const { board, surface } = setup();
        attachCanvasDropBehavior(surface, board);
        const data = new DataObject();
        data.Set('not-our-format', 'noise');

        const events: ItemDroppedArgs[] = [];
        board.AddItemDroppedListener(e => events.push(e));

        const args = new DragEventArgs('Drop', surface, dragInit({ HostX: 100, HostY: 50, Data: data }));
        dispatchDrag(args);

        assert.equal(events.length, 0);
    });
});
