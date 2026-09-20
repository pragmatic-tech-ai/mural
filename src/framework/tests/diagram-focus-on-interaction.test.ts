import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application, DataObject, DragDropEffects, NoModifiers, ObservableCollection,
    Visual, Size, type DragEventInit,
} from '../../runtime/index.js';
import { DragEventArgs, dispatchDrag } from '../../visual-engine/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import { attachCanvasDropBehavior, TOOLBOX_ITEM_FORMAT } from '../diagram/behaviors/canvas-drop-behavior.js';

function setup(): { diagram: Diagram; surface: Border; focusCount: () => number }
{
    Application.current = null;
    new Application();
    const diagram = new Diagram();
    diagram.Focusable = true;
    diagram.ItemsPanel  = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = new ObservableCollection<Visual>();
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    // Spy Focus() — the FakeTarget path never wires a real InputManager, so assert
    // the intent (Focus was requested) rather than the resulting IsFocused.
    let n = 0;
    (diagram as unknown as { Focus(): void }).Focus = () => { n++; };
    return { diagram, surface, focusCount: () => n };
}

describe('Diagram — focuses on any interaction', () => {
    test('a preview pointer-down focuses the diagram (fires before a Figure consumes it)', () => {
        const { diagram, focusCount } = setup();
        // The tunnel handler runs on the Diagram before any descendant node /
        // connector can set Handled — so a click on a node or connector focuses too.
        (diagram as unknown as { OnPreviewPointerDown(a: unknown): void })
            .OnPreviewPointerDown({ Kind: 'PointerDown', Source: diagram, Visual: diagram, Handled: false });
        assert.equal(focusCount(), 1, 'preview pointer-down took focus');
    });

    test('dropping a toolbox item focuses the diagram', () => {
        const { diagram, surface, focusCount } = setup();
        attachCanvasDropBehavior(surface, diagram);
        const data = new DataObject();
        data.Set(TOOLBOX_ITEM_FORMAT, 'rectangle');
        const init: DragEventInit = {
            HostX: 100, HostY: 50, Modifiers: NoModifiers, Data: data,
            AllowedEffects: DragDropEffects.All, Session: undefined,
        };
        dispatchDrag(new DragEventArgs('Drop', surface, init));
        assert.equal(focusCount(), 1, 'the drop took focus');
    });
});
