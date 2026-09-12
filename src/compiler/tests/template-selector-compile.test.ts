import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { instantiate } from '../compile.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import { Application, Observable } from '../../runtime/index.js';
import { Border, TextBlock, TypeTemplateSelector } from '../../basic/index.js';

const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine };

const SRC = `
    Application { resources: {
        DataTemplate x:key="Fallback" [DataType=Border] { TextBlock [ Text = "fallback" ] }
        TemplateSelector x:key="Sel" {
            DataTemplate [ DataType = TextBlock ] { TextBlock [ Text = "tb" ] }
            @Fallback
        }
    }}`;

describe('compiler — TemplateSelector → TypeTemplateSelector (Shape C)', () =>
{
    beforeEach(() => { Application.current = null; });

    test('compiles to a TypeTemplateSelector resolvable by @key', () =>
    {
        const app = instantiate(SRC, CTX) as Application;
        assert.ok(app.Resources.Resolve('Sel') instanceof TypeTemplateSelector);
    });

    test('SelectTemplate returns the type-keyed case, else the default', () =>
    {
        const app = instantiate(SRC, CTX) as Application;
        const sel = app.Resources.Resolve('Sel') as TypeTemplateSelector;
        const hit = sel.SelectTemplate(new TextBlock('x'), undefined as any);
        const fb  = sel.SelectTemplate(new Observable(), undefined as any);
        assert.equal(hit?.DataType, TextBlock, 'TextBlock item → the TextBlock case');
        assert.equal(fb?.DataType, Border, 'unmatched item → the @Fallback default');
    });

    test('a case DataTemplate missing DataType throws at compile', () =>
    {
        assert.throws(() => instantiate(`Application { resources: {
            TemplateSelector x:key="S" { DataTemplate { TextBlock [ Text = "x" ] } }
        }}`, CTX));
    });

    test('a default @key not declared earlier in the block throws', () =>
    {
        assert.throws(() => instantiate(`Application { resources: {
            TemplateSelector x:key="S" {
                DataTemplate [ DataType = TextBlock ] { TextBlock [ Text = "x" ] }
                @Missing
            }
        }}`, CTX));
    });

    test('a TemplateSelector without x:key throws', () =>
    {
        assert.throws(() => instantiate(`Application { resources: {
            TemplateSelector { DataTemplate [ DataType = TextBlock ] { TextBlock [ Text = "x" ] } }
        }}`, CTX));
    });
});
