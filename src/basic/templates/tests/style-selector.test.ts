import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Style, type Visual } from '../../../runtime/index.js';
import { StyleSelector } from '../style-selector.js';

class Dummy {}
const S1 = new Style(Dummy);
const S2 = new Style(Dummy);
const CONTAINER = undefined as unknown as Visual;

class PickS extends StyleSelector
{
    public SelectStyle(item: unknown): Style | undefined { return item === 1 ? S1 : S2; }
}

test('StyleSelector.resolve routes object selectors through SelectStyle', () =>
{
    assert.equal(StyleSelector.resolve(new PickS(), 1, CONTAINER), S1);
    assert.equal(StyleSelector.resolve(new PickS(), 2, CONTAINER), S2);
});

test('StyleSelector.resolve routes function selectors by calling them', () =>
{
    assert.equal(StyleSelector.resolve((i) => (i === 1 ? S1 : S2), 1, CONTAINER), S1);
});

test('StyleSelector.resolve returns undefined for an undefined selector', () =>
{
    assert.equal(StyleSelector.resolve(undefined, 1, CONTAINER), undefined);
});

test('StyleSelector.fromFn wraps a function as a selector object', () =>
{
    const s = StyleSelector.fromFn((i) => (i === 1 ? S1 : S2));
    assert.ok(s instanceof StyleSelector);
    assert.equal(s.SelectStyle(1, CONTAINER), S1);
});
