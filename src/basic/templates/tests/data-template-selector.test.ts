import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Visual } from '../../../runtime/index.js';
import { DataTemplate } from '../data-template.js';
import { DataTemplateSelector } from '../data-template-selector.js';

const A = new DataTemplate(() => ({} as unknown as Visual));
const B = new DataTemplate(() => ({} as unknown as Visual));
const CONTAINER = undefined as unknown as Visual;

class Pick extends DataTemplateSelector
{
    public SelectTemplate(item: unknown): DataTemplate | undefined { return item === 1 ? A : B; }
}

test('resolve routes object selectors through SelectTemplate', () =>
{
    assert.equal(DataTemplateSelector.resolve(new Pick(), 1, CONTAINER), A);
    assert.equal(DataTemplateSelector.resolve(new Pick(), 2, CONTAINER), B);
});

test('resolve routes function selectors by calling them', () =>
{
    assert.equal(DataTemplateSelector.resolve((i) => (i === 1 ? A : B), 1, CONTAINER), A);
    assert.equal(DataTemplateSelector.resolve((i) => (i === 1 ? A : B), 2, CONTAINER), B);
});

test('resolve returns undefined for an undefined selector', () =>
{
    assert.equal(DataTemplateSelector.resolve(undefined, 1, CONTAINER), undefined);
});

test('fromFn wraps a function as a selector object', () =>
{
    const s = DataTemplateSelector.fromFn((i) => (i === 1 ? A : B));
    assert.ok(s instanceof DataTemplateSelector);
    assert.equal(s.SelectTemplate(1, CONTAINER), A);
    assert.equal(s.SelectTemplate(2, CONTAINER), B);
});
