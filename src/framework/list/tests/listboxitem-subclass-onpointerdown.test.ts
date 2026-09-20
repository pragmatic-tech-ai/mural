import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application, PointerButton, NoModifiers,
    type PointerEventArgs, type PointerEventInit,
} from '../../../runtime/index.js';
import { InputManager } from '../../index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ListBoxItem } from '../list-box.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

class ListBoxItemEx extends ListBoxItem
{
    public hits = 0;
    protected override OnPointerDown(args: PointerEventArgs): void
    {
        this.hits++;
        super.OnPointerDown(args);
    }
}

const dc = new Proxy({}, { get: () => () => {} }) as never;
function pointer(o: Partial<PointerEventInit> = {}): PointerEventInit
{
    return { HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse', ...o };
}

test('click on a template/content descendant bubbles to ListBoxItem subclass OnPointerDown', () => {
    initTestApp();
    const item = new ListBoxItemEx();
    const content = new Border(); content.Width = 80; content.Height = 20;
    item.Content = content;
    new HeadlessTarget(200, 100, item).Render(dc); // flush layout → template + content materialize

    // Is `content` actually a visual descendant of the item?
    let v: unknown = content;
    let reachesItem = false;
    for (let i = 0; i < 50 && v !== undefined; i++)
    {
        if (v === item) { reachesItem = true; break; }
        v = (v as { GetVisualParent(): unknown }).GetVisualParent();
    }
    console.log('PROBE content reaches item via visual parents:', reachesItem);

    const im = new InputManager();
    im.InjectPointerDown(content, pointer());
    console.log('PROBE item.hits after clicking deep content:', item.hits);
    assert.ok(item.hits > 0, `OnPointerDown should fire on the container (hits=${item.hits})`);
});
