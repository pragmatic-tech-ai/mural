import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PointerButton, NoModifiers, DataObject, DragDropEffects,
    type PointerEventArgs, type PointerEventInit,
} from '../../runtime/index.js';
import { InputManager } from '../../framework/index.js';
import { HeadlessTarget } from '../index.js';
import { Border } from '../../basic/border.js';
import { initTestApp } from '../../basic/tests/test-app.js';

// Regression: the declarative IsDraggable latch must NOT capture the pointer on
// PointerDown. Capturing on every press redirects the matching PointerUp to the
// captor (InputManager.InjectPointerUp dispatches to `captured ?? hit`), which
// steals the release from a DESCENDANT click handler. A TreeViewItem is
// draggable (HierarchyDragBehavior) while its selectable ClickableRow is a
// descendant — capture-on-down made every row's click (and thus selection /
// activation) silently dead. Capture is deferred to the drag-start in
// _onDragLatchPointerMove, so a plain press-release never captures.

const dc = new Proxy({}, { get: () => () => {} }) as never;

function pointer(o: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse', ...o,
    };
}

class ClickChild extends Border
{
    public ups = 0;
    protected override OnPointerUp(args: PointerEventArgs): void
    {
        this.ups++;
        super.OnPointerUp(args);
    }
}

test('a draggable container does not steal PointerUp from a descendant on a plain click', () =>
{
    initTestApp();
    const parent = new Border();
    parent.Width = 100; parent.Height = 40;
    parent.IsDraggable = true;
    parent.OnDragStart = () => ({ data: new DataObject(), effects: DragDropEffects.Move });

    const child = new ClickChild();
    child.Width = 100; child.Height = 40;
    parent.SetChild(child);

    new HeadlessTarget(200, 100, parent).Render(dc); // flush layout

    const im = new InputManager();
    // Plain press + release at the same point — NO move past the drag threshold.
    im.InjectPointerDown(child, pointer());
    assert.equal(im.GetCapturedVisual(0), undefined, 'a plain press must not capture the pointer');
    im.InjectPointerUp(child, pointer());

    assert.ok(child.ups > 0, `descendant OnPointerUp must fire on a plain click (ups=${child.ups})`);
});
