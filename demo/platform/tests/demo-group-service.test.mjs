import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlock } from '@pragmatic-tech-ai/mural/basic';
import { DemoGroupService } from '../demo-group-service.mjs';
// A provider that resolves nothing — DemoGroupService only optionally reaches
// for ContentHostService, so undefined is the correct stub here.
const nullProvider = { get: () => undefined, getRequired: () => { throw new Error('none'); } };
let built = 0;
const desc = (id, title) => ({ id, title, factory: () => { built++; return new TextBlock(); } });
class TestGroup extends DemoGroupService {
    constructor(provider, d) { super(provider, d); }
}
test('seeds demos sorted by title and auto-selects the first', () => {
    const g = new TestGroup(nullProvider, [desc('b', 'Beta'), desc('a', 'Alpha')]);
    assert.equal(g.Demos.Count, 2);
    assert.equal(g.Demos.Get(0).Title, 'Alpha');
    assert.equal(g.SelectedDemo?.Title, 'Alpha'); // first auto-selected
    assert.ok(g.Content instanceof TextBlock); // selection built its Visual
});
test('caches the instantiated Visual per demo id across re-selection', () => {
    built = 0;
    const g = new TestGroup(nullProvider, [desc('a', 'Alpha'), desc('b', 'Beta')]);
    const first = g.Content; // Alpha built (built === 1)
    g.SelectedItem = g.Demos.Get(1); // Beta built (built === 2)
    g.SelectedItem = g.Demos.Get(0); // Alpha from cache (no rebuild)
    assert.equal(built, 2);
    assert.equal(g.Content, first); // same cached instance
});
test('has no dependency on the registry', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../demo-group-service.mts', import.meta.url), 'utf8');
    assert.ok(!/from\s+['"][^'"]*registry/.test(src), 'demo-group-service.mts must not import the registry');
});
