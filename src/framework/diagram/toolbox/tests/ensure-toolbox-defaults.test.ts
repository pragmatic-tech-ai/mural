import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '../../../../runtime/index.js';
import { ToolboxRepository } from '../toolbox-repository.js';
import { ShapeVisualResolverKey } from '../shape-visual-resolver.js';
import { ShapeDropFactoryKey } from '../shape-drop-factory.js';
import { FigureKindDropFactoryKey } from '../figure-kind-drop-factory.js';
import { SHAPE_CATALOG } from '../../shape-catalog.js';
import { ensureToolboxDefaults } from '../ensure-toolbox-defaults.js';

test('ensureToolboxDefaults registers repo + shape services + Shapes page', () => {
    const services = new ServiceProvider();
    ensureToolboxDefaults(services);
    const repo = services.getRequired(ToolboxRepository.Key);
    assert.ok(services.has(ShapeVisualResolverKey));
    assert.ok(services.has(ShapeDropFactoryKey));
    const shapes = repo.Pages.Get(0);
    assert.equal(shapes?.Id, 'shapes');
    assert.equal(shapes?.Items.Count, SHAPE_CATALOG.length);
});

test('ensureToolboxDefaults adds the annotate page (container, text, callout)', () => {
    const services = new ServiceProvider();
    ensureToolboxDefaults(services);
    const repo = services.getRequired(ToolboxRepository.Key);
    assert.ok(services.has(FigureKindDropFactoryKey));
    const page = [...Array(repo.Pages.Count).keys()].map((i) => repo.Pages.Get(i)!).find((p) => p.Id === 'annotate');
    assert.ok(page, 'annotate page exists');
    assert.equal(page!.Title, 'Callouts, Text & Containers');
    assert.deepEqual(page!.Items.ToArray().map((it) => it.Id), ['kind:container', 'kind:text', 'kind:callout']);
    for (const it of page!.Items.ToArray())
    {
        assert.equal(it.FactoryKey, FigureKindDropFactoryKey, 'each annotate item drops via FigureKindDropFactory');
    }
});

test('ensureToolboxDefaults is idempotent', () => {
    const services = new ServiceProvider();
    ensureToolboxDefaults(services);
    const repo = services.getRequired(ToolboxRepository.Key);
    ensureToolboxDefaults(services);
    assert.equal(services.getRequired(ToolboxRepository.Key), repo);   // same instance
    assert.equal(repo.Pages.Count, 2);                                  // Shapes + annotate
    assert.equal(repo.Pages.Get(0)!.Items.Count, SHAPE_CATALOG.length); // not doubled
    assert.equal(repo.Pages.Get(1)!.Items.Count, 3);                    // annotate not doubled
});

test('ensureToolboxDefaults tolerates undefined services (headless Diagram)', () => {
    assert.doesNotThrow(() => ensureToolboxDefaults(undefined));
});
