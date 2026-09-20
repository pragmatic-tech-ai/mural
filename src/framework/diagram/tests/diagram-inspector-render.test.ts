import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Size } from '../../../runtime/index.js';
import { Border } from '../../../basic/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { DiagramInspector } from '../diagram-inspector.js';
import { ShapeStylePage, SizePositionPage } from '../inspector-pages.js';
import { findDataTemplateForType } from '../../../basic/templates/data-template.js';

describe('DiagramInspector render', () => {
    test('each page type resolves a DataTemplate and builds', () => {
        initTestApp();
        const ctx = new Border();
        for (const page of [new ShapeStylePage(), new SizePositionPage()])
        {
            const tpl = findDataTemplateForType(page.constructor, ctx);
            assert.ok(tpl, `${page.constructor.name} has a DataTemplate`);
            const v = tpl!.Apply(page);
            assert.ok(v, 'template builds a visual');
        }
    });
    test('the paged inspector template builds + arranges', () => {
        initTestApp();
        const insp = new DiagramInspector();
        const ctx = new Border();
        const tpl = findDataTemplateForType(insp.constructor, ctx);
        assert.ok(tpl, 'DiagramInspector has a DataTemplate');
        const v = tpl!.Apply(insp);
        const host = new Border(); host.SetChild(v);
        host.Measure(new Size(320, 600));
        host.Arrange({ X: 0, Y: 0, Width: 320, Height: 600 } as never);
        assert.ok(v, 'inspector builds + arranges');
    });
});
