import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate, EmitError } from '../compile.js';
import { Parser, ParseError } from '../parser.js';
import {
    lowerInlineExpr,
    lowerInlineExprWithPaths,
    InlineExprError,
} from '../inline-expr.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import {
    Application,
    MuralBase,
    MetaData,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Border, TextBlock } from '../../basic/index.js';

const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine };

// Lex + parse layer: `{{ … }}` round-trips through Parser + back into
// the AST as an InlineExprValue. The legacy `$( … )$` syntax now
// errors with a clear migration hint.

describe('parser — `{{ … }}` inline expressions', () => {
    test('value-position `{{ … }}` parses as inline-expr', () => {
        const doc = new Parser(
            'Application{ resources: { Border x:root[Width = {{ 1 + 2 }}]{} } }',
        ).ParseDocument();
        // forms[0] = Application; its body is a StructuredBody whose
        // first item is a SlotAssign for `resources:`; that slot's
        // value is another StructuredBody holding the Border element.
        const app          = doc.forms[0]! as any;
        const resourcesSA  = app.body.items[0];
        const border       = resourcesSA.value.items[0];
        const widthAttr    = border.attrs.find((a: any) =>
            a.kind === 'named-attr' && a.path.parts[0] === 'Width');
        assert.equal(widthAttr.value.kind, 'inline-expr');
        assert.equal(widthAttr.value.raw.trim(), '1 + 2');
    });

    test('text-mode body captures `{{ … }}` as inline-expr chunks', () => {
        const doc = new Parser(
            'Application{ resources: { TextBlock x:root{Hi {{ $name }}!} } }',
            { isStringBody: (n) => n === 'TextBlock' },
        ).ParseDocument();
        const app         = doc.forms[0]! as any;
        const resourcesSA = app.body.items[0];
        const tb          = resourcesSA.value.items[0];
        assert.equal(tb.body.kind, 'string-body');
        const kinds = tb.body.chunks.map((c: any) => c.kind);
        assert.deepEqual(kinds, ['text-chunk', 'inline-expr', 'text-chunk']);
    });

    test('retired `$( … )$` form errors with a migration hint', () => {
        assert.throws(
            () => new Parser(
                'Application{ resources: { Border x:root[Width = $( 1 )$]{} } }',
            ).ParseDocument(),
            (e) => e instanceof ParseError && /\{\{ … \}\}/.test(e.message),
        );
    });

    test('unterminated inline expression is a parser error', () => {
        assert.throws(
            () => new Parser('Application{ resources: { Border x:root[Width = {{ 1 + 2]{} } }').ParseDocument(),
            ParseError,
        );
    });
});

// Analyzer layer — the lowerInlineExpr* entry points classify and
// transform without touching the rest of the compiler.

describe('inline-expr — lowering', () => {
    test('pure arithmetic folds to a constant', () => {
        const r = lowerInlineExpr('50 * 2 + 16', anySpan());
        assert.equal(r.kind, 'constant');
        if (r.kind === 'constant') assert.equal(r.value, 116);
    });

    test('Math.* member call folds', () => {
        const r = lowerInlineExpr('Math.max(3, 7)', anySpan());
        if (r.kind === 'constant') assert.equal(r.value, 7);
        else assert.fail('expected constant');
    });

    test('reactive form returns paths + rewritten body', () => {
        const r = lowerInlineExpr('$a + $b.c * 2', anySpan());
        assert.equal(r.kind, 'reactive');
        if (r.kind === 'reactive')
        {
            assert.deepEqual(r.paths, ['a', 'b.c']);
            assert.match(r.body, /_p0 \+ _p1 \* 2/);
        }
    });

    test('repeated path dedupes to one parameter', () => {
        const r = lowerInlineExpr('$x + $x * 3', anySpan());
        if (r.kind !== 'reactive') return assert.fail('expected reactive');
        assert.deepEqual(r.paths, ['x']);
        assert.match(r.body, /_p0 \+ _p0 \* 3/);
    });

    test('shared path map merges across multiple bodies', () => {
        const shared = new Map<string, string>();
        const a = lowerInlineExprWithPaths('$x + 1', anySpan(), shared);
        const b = lowerInlineExprWithPaths('$y * $x', anySpan(), shared);
        // First body introduced `x` → _p0; second body adds `y` → _p1
        // and reuses _p0 for the repeated `x`.
        if (a.kind !== 'reactive' || b.kind !== 'reactive') return assert.fail();
        assert.deepEqual(a.paths, ['x']);
        assert.deepEqual(b.paths, ['y']);
        assert.deepEqual([...shared.keys()],   ['x', 'y']);
        assert.deepEqual([...shared.values()], ['_p0', '_p1']);
        assert.match(b.body, /_p1 \* _p0/);
    });

    test('free identifier outside whitelist is rejected', () => {
        assert.throws(() => lowerInlineExpr('window.x', anySpan()), InlineExprError);
    });

    test('@key inside the body is reserved — clear error', () => {
        assert.throws(
            () => lowerInlineExpr('@primary', anySpan()),
            (e) => e instanceof InlineExprError && /resource references/.test(e.message),
        );
    });
});

// Compile layer — the EmitError mapping + the emitted JS shape that
// downstream tests / consumers rely on.

describe('compile — inline expressions', () => {
    test('constant fold lands as a literal in `set_property_value`', () => {
        const js = compile(
            'Application{ resources: { Border x:root[Width = {{ 50 * 2 + 16 }}]{} } }',
        ).js;
        assert.match(js, /\.set_property_value\(\w+\.WidthKey, 116\)/);
        // No MultiBinding import — purely a constant.
        assert.doesNotMatch(js, /MultiBinding/);
    });

    test('reactive form emits MultiBinding with the matching path list', () => {
        const js = compile(
            'Application{ resources: { Border x:root[Width = {{ $a + $b * 2 }}]{} } }',
        ).js;
        assert.match(js, /import \{[^}]*MultiBinding[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime";/);
        assert.match(
            js,
            /MultiBinding\(_border\d+, \["a","b"\], \(_p0, _p1\) => \( ?_p0 \+ _p1 \* 2 ?\)\)/,
        );
    });

    test('text body with `{{ $path }}` becomes a MultiBinding-backed Text', () => {
        const js = compile(
            'Application{ resources: { TextBox x:root{Hi {{ $name }}!} } }',
        ).js;
        assert.match(
            js,
            /\.set_property_value\(\w+\.TextKey, MultiBinding\(_textBox\d+, \["name"\], \(_p0\) => \("Hi " \+ String\( ?_p0 ?\) \+ "!"\)\)\)/,
        );
    });

    test('text body where every `{{ … }}` folds yields a plain string literal', () => {
        const js = compile(
            'Application{ resources: { TextBox x:root{The answer is {{ 6 * 7 }}} } }',
        ).js;
        assert.match(js, /\.set_property_value\(\w+\.TextKey, "The answer is 42"\)/);
        assert.doesNotMatch(js, /MultiBinding/);
    });

    test('disallowed identifier surfaces as EmitError on the inline-expr span', () => {
        assert.throws(
            () => compile(
                'Application{ resources: { Border x:root[Width = {{ window.x }}]{} } }',
            ),
            EmitError,
        );
    });

    test('Style setter wraps reactive MultiBinding in a SetterFactory', () => {
        const js = compile(`
            Application{ resources: {
                Style[TargetType=Border]{ Width = {{ $base * 2 }}; }
            } }
        `).js;
        assert.match(
            js,
            /new SetterFactory\(\(_t\) => MultiBinding\(_t, \["base"\], \(_p0\) => \( ?_p0 \* 2 ?\)\)\)/,
        );
    });
});

// End-to-end through the runtime: a reactive inline expression really
// binds to the host's DataContext and refreshes on property changes.

describe('inline expressions — end-to-end', () => {
    beforeEach(() => { (Application as any).current = null; });

    test('reactive `{{ $a + $b }}` watches both paths and recomputes', () => {
        class M extends MuralBase
        {
            static
            {
                MuralBase.RegisterProperty(M, 'A', 0, MetaData.None);
                MuralBase.RegisterProperty(M, 'B', 0, MetaData.None);
            }
            public get A(): number { return this.get_property_value(resolveKey(this, undefined, 'A')) as number; }
            public set A(v: number) { this.set_property_value(resolveKey(this, undefined, 'A'), v); }
            public get B(): number { return this.get_property_value(resolveKey(this, undefined, 'B')) as number; }
            public set B(v: number) { this.set_property_value(resolveKey(this, undefined, 'B'), v); }
        }

        const app = instantiate(`
            Application{ resources: {
                Border x:root[Width = {{ $A + $B * 2 }}]{}
            } }
        `, CTX) as Application;
        const border = app.Resources.Root as Border;
        const model  = new M();
        model.A = 10;
        model.B = 5;
        border.DataContext = model;

        // 10 + 5*2 = 20
        assert.equal(border.Width, 20);

        // Mutate A — converter re-runs.
        model.A = 30;
        assert.equal(border.Width, 40);

        // Mutate B — converter re-runs again.
        model.B = 0;
        assert.equal(border.Width, 30);
    });

    test('reactive text body interpolation refreshes on data change', () => {
        class M extends MuralBase
        {
            static
            {
                MuralBase.RegisterProperty(M, 'Name',  '', MetaData.None);
                MuralBase.RegisterProperty(M, 'Count', 0,  MetaData.None);
            }
            public get Name():  string { return this.get_property_value(resolveKey(this, undefined, 'Name'))  as string; }
            public set Name(v:  string){ this.set_property_value(resolveKey(this, undefined, 'Name'),  v); }
            public get Count(): number { return this.get_property_value(resolveKey(this, undefined, 'Count')) as number; }
            public set Count(v: number){ this.set_property_value(resolveKey(this, undefined, 'Count'), v); }
        }

        // Reactive interpolation is exercised through the real-world
        // attribute form (`Text = {{ … }}`) on a lightweight TextBlock —
        // the string-BODY form now belongs to TextBox (which needs a theme
        // to instantiate). Same MultiBinding machinery either way.
        const app = instantiate(`
            Application{ resources: {
                TextBlock x:root [ Text = {{ "Hi " + String($Name) + ", you have " + String($Count) + " messages" }} ]
            } }
        `, CTX) as Application;
        const tb = app.Resources.Root as TextBlock;
        const m  = new M();
        m.Name  = 'Alice';
        m.Count = 3;
        tb.DataContext = m;

        assert.equal(tb.Text, 'Hi Alice, you have 3 messages');
        m.Count = 7;
        assert.equal(tb.Text, 'Hi Alice, you have 7 messages');
        m.Name = 'Bob';
        assert.equal(tb.Text, 'Hi Bob, you have 7 messages');
    });
});

function anySpan(): import('../tokens.js').SourceSpan
{
    return {
        start: { line: 1, column: 1, offset: 0 },
        end:   { line: 1, column: 1, offset: 0 },
    };
}
