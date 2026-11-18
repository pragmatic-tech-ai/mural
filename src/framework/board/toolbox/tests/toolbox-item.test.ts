import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey } from '../../../../runtime/index.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { type IToolboxVisualResolver } from '../toolbox-visual-resolver.js';
import { type IToolboxDropFactory } from '../toolbox-drop-factory.js';
import { ToolboxItem } from '../toolbox-item.js';
import { TOOLBOX_ITEM_FORMAT } from '../../behaviors/canvas-drop-behavior.js';

function makeItem(): ToolboxItem
{
    const rk = new ServiceKey<IToolboxVisualResolver>('r');
    const fk = new ServiceKey<IToolboxDropFactory>('f');
    return new ToolboxItem('shape:box', 'Box', new ToolboxVisualDescriptor(rk, 'box'), fk);
}

test('item exposes id/label/descriptor/factory', () => {
    const item = makeItem();
    assert.equal(item.Id, 'shape:box');
    assert.equal(item.Label, 'Box');
    assert.equal(item.Descriptor?.Key, 'box');
    assert.equal(item.FactoryKey.description, 'f');
});

test('BeginDragData carries the item id under TOOLBOX_ITEM_FORMAT', () => {
    const item = makeItem();
    const payload = item.BeginDragData!();
    assert.equal(payload.data.Get(TOOLBOX_ITEM_FORMAT), 'shape:box');
});
