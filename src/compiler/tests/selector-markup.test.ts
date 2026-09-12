import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { instantiate } from '../compile.js';
import { DEFAULT_SYMBOLS } from '../symbol-table.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import { Application } from '../../runtime/index.js';
import { ContentControl } from '../../framework/base/content-control.js';
import { ItemsControl } from '../../framework/base/items-control.js';
import { DataTemplateSelector, type DataTemplate } from '../../basic/index.js';

const CTX_BASE: Record<string, unknown> = { ...runtime, ...controls, ...engine, ContentControl, ItemsControl };

// A consumer-authored selector — the realistic Shape B: a subclass registered
// in the caller's symbols + ctx (exactly how Plexus registers its converters /
// selectors), constructed and assigned to the DP from markup.
class KindSelector extends DataTemplateSelector
{
    public SelectTemplate(): DataTemplate | undefined { return undefined; }
}

describe('selector markup — Shape B (object assigned in markup)', () =>
{
    beforeEach(() => { Application.current = null; });

    test('ContentTemplateSelector = KindSelector [] lands a selector object on the DP', () =>
    {
        const symbols = new Map([...DEFAULT_SYMBOLS, ['KindSelector', 'test-local']]);
        const ctx = { ...CTX_BASE, KindSelector };
        // A bare-element root compiles to a zero-arg factory — invoke it.
        const factory = instantiate('ContentControl [ ContentTemplateSelector = KindSelector [] ]', ctx, { symbols }) as () => ContentControl;
        const cc = factory();
        assert.ok(cc instanceof ContentControl);
        assert.ok(cc.ContentTemplateSelector instanceof KindSelector);
    });

    test('ItemTemplateSelector accepts a selector object in markup too', () =>
    {
        const symbols = new Map([...DEFAULT_SYMBOLS, ['KindSelector', 'test-local']]);
        const ctx = { ...CTX_BASE, KindSelector };
        const factory = instantiate('ItemsControl [ ItemTemplateSelector = KindSelector [] ]', ctx, { symbols }) as () => ItemsControl;
        const ic = factory();
        assert.ok(ic.ItemTemplateSelector instanceof KindSelector);
    });
});

describe('selector markup — Shape A (data-trigger sets a template DP)', () =>
{
    beforeEach(() => { Application.current = null; });

    // A template DP is an ordinary DP: a data-trigger (when($path)) can set it,
    // so value-based template selection needs no selector object. This guards
    // that the markup path compiles + applies without special-casing.
    test('a Style data-trigger setting ItemTemplate compiles and applies', () =>
    {
        const src = `
            Application{ resources: {
                DataTemplate x:key="A" [DataType=TextBlock] { TextBlock [ Text = "A" ] }
                DataTemplate x:key="B" [DataType=TextBlock] { TextBlock [ Text = "B" ] }
                Style x:key="S" [ TargetType = ItemsControl ] {
                    ItemTemplate = @A;
                    when ( $Flag ) { ItemTemplate = @B; }
                }
            }}`;
        // Must not throw — proves ItemTemplate is a trigger-targetable DP.
        const app = instantiate(src, CTX_BASE) as Application;
        assert.ok(app instanceof Application);
        assert.ok(app.Resources.Resolve('S') !== undefined, 'style S compiled into resources');
    });
});
