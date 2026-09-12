import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Parser } from '../parser.js';
import { DEFAULT_SLOT_INFO } from '../symbol-table.js';

const isStringBody = (n: string): boolean => DEFAULT_SLOT_INFO.get(n)?.kind === 'string';
const parse = (src: string) => new Parser(src, { isStringBody }).ParseDocument();

describe('parser — TemplateSelector resource form', () =>
{
    test('parses typed cases + a bare @key default into a template-selector-body', () =>
    {
        const doc = parse(`Application { resources: {
            DataTemplate x:key="Fallback" [DataType=Observable] { TextBlock [ Text = "f" ] }
            TemplateSelector x:key="Sel" {
                DataTemplate [ DataType = TextBlock ] { TextBlock [ Text = "t" ] }
                DataTemplate [ DataType = Border ]    { TextBlock [ Text = "b" ] }
                @Fallback
            }
        }}`);
        // Locate the TemplateSelector resource-form anywhere in the tree.
        const forms: any[] = [];
        const walk = (o: any) => {
            if (o && typeof o === 'object') {
                if (o.kind === 'resource-form' && o.keyword === 'TemplateSelector') forms.push(o);
                for (const k of Object.keys(o)) walk(o[k]);
            }
        };
        walk(doc);
        assert.equal(forms.length, 1);
        const sel = forms[0];
        assert.equal(sel.body.kind, 'template-selector-body');
        assert.equal(sel.body.entries.length, 3);
        assert.equal(sel.body.entries[0].kind, 'resource-form');
        assert.equal(sel.body.entries[0].keyword, 'DataTemplate');
        assert.equal(sel.body.entries[2].kind, 'static-resource');
        assert.equal(sel.body.entries[2].key, 'Fallback');
    });

    test('rejects a non-DataTemplate, non-@key child', () =>
    {
        assert.throws(() => parse(`Application { resources: {
            TemplateSelector x:key="S" { TextBlock [ Text = "x" ] }
        }}`));
    });
});
