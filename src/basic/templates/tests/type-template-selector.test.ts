import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Visual } from '../../../runtime/index.js';
import { DataTemplate } from '../data-template.js';
import { TypeTemplateSelector } from '../type-template-selector.js';

class Base {}
class Derived extends Base {}
const baseT = new DataTemplate(() => ({} as unknown as Visual));
const fallbackT = new DataTemplate(() => ({} as unknown as Visual));
const CONTAINER = undefined as unknown as Visual;

test('exact type hit', () =>
{
    const s = new TypeTemplateSelector(new Map([[Base, baseT]]));
    assert.equal(s.SelectTemplate(new Base(), CONTAINER), baseT);
});

test('derived instance falls back to a base-type entry (most-derived-first walk)', () =>
{
    const s = new TypeTemplateSelector(new Map<Function, DataTemplate>([[Base, baseT]]));
    assert.equal(s.SelectTemplate(new Derived(), CONTAINER), baseT);
});

test('most-derived entry wins over a base entry', () =>
{
    const derivedT = new DataTemplate(() => ({} as unknown as Visual));
    const s = new TypeTemplateSelector(new Map<Function, DataTemplate>([[Base, baseT], [Derived, derivedT]]));
    assert.equal(s.SelectTemplate(new Derived(), CONTAINER), derivedT);
});

test('no match → fallback', () =>
{
    const s = new TypeTemplateSelector(new Map(), fallbackT);
    assert.equal(s.SelectTemplate(new Base(), CONTAINER), fallbackT);
});

test('no match, no fallback → undefined', () =>
{
    const s = new TypeTemplateSelector(new Map());
    assert.equal(s.SelectTemplate(new Base(), CONTAINER), undefined);
});

test('null/undefined item → fallback', () =>
{
    const s = new TypeTemplateSelector(new Map(), fallbackT);
    assert.equal(s.SelectTemplate(undefined, CONTAINER), fallbackT);
    assert.equal(s.SelectTemplate(null, CONTAINER), fallbackT);
});
