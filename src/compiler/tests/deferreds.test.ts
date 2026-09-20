import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from '../compile.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import {
    Application,
    MuralBase,
    MetaData,
    MultiTrigger,
    Style,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Border, TextBlock, Run, ControlTemplate, DataTemplate } from '../../basic/index.js';

const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine };

function emitted(src: string): string
{
    return compile(src).js;
}

describe('compile — compound triggers', () => {
    test("'not P' on a bare boolean emits PropertyTrigger with value=false", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    Fill = #ffffff;
                    when( not IsEnabled ){ Fill = #cccccc; }
                }
            } }
        `);
        assert.match(
            js,
            /new PropertyTrigger\(Border, "IsEnabled", false, _sArr\d+\);/,
        );
    });

    test("'A or B' splits into two PropertyTriggers sharing the setter list", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    Fill = #ffffff;
                    when( IsMouseOver or IsFocused ){ Fill = #eeeeee; }
                }
            } }
        `);
        // Two PropertyTriggers.
        const matches = js.match(/new PropertyTrigger\(Border, /g) ?? [];
        assert.equal(matches.length, 2);
        // Both reference the SAME setter-array local — by-name equality
        // here implies by-instance equality at runtime since the array
        // literal is built once in the local declaration.
        const arrayRefs = js.match(/, (_sArr\d+)\);/g) ?? [];
        assert.equal(arrayRefs.length, 2);
        assert.equal(arrayRefs[0], arrayRefs[1]);
    });

    test("'A and B' emits a MultiTrigger sharing the setter list", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( IsMouseOver and IsFocused ){ Fill = #eee; }
                }
            } }
        `);
        // MultiTrigger with two conditions, both PropertyName-keyed.
        assert.match(
            js,
            /new MultiTrigger\(\[\{ propertyOwner: Border, propertyName: "IsMouseOver", value: true \}, \{ propertyOwner: Border, propertyName: "IsFocused", value: true \}\], _sArr\d+\);/,
        );
    });

    test("'(A or B) and C' distributes into two MultiTriggers via DNF", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( (IsMouseOver or IsFocused) and IsEnabled ){
                        Fill = #eee;
                    }
                }
            } }
        `);
        // Two MultiTriggers — one for (IsMouseOver and IsEnabled), one for
        // (IsFocused and IsEnabled). Both share the same setter array.
        const matches = js.match(/new MultiTrigger\(/g) ?? [];
        assert.equal(matches.length, 2);
    });

    test("'not P = value' is rejected with a clear error", () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Style[TargetType=Border]{
                        when( not Status = "active" ){ Fill = #eee; }
                    }
                } }
            `),
            /bare boolean properties/,
        );
    });

    test("'not \\$Path' emits a DataTrigger with value=false (bare-boolean negation)", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( not $IsActive ){ Fill = #cccccc; }
                }
            } }
        `);
        assert.match(
            js,
            /new DataTrigger\("IsActive", false, _sArr\d+\);/,
        );
    });

    test("'\\$A and \\$B' emits a MultiDataTrigger sharing the setter list", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( $IsSelected and $IsHot ){ Fill = #eee; }
                }
            } }
        `);
        assert.match(
            js,
            /new MultiDataTrigger\(\[\{ path: "IsSelected", value: true \}, \{ path: "IsHot", value: true \}\], _sArr\d+\);/,
        );
    });

    test("'(\\$A or \\$B) and \\$C' distributes into two MultiDataTriggers via DNF", () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( ($A or $B) and $C ){ Fill = #eee; }
                }
            } }
        `);
        const matches = js.match(/new MultiDataTrigger\(/g) ?? [];
        assert.equal(matches.length, 2);
    });

    test("mixing DP and \\$path inside the same conjunct is rejected", () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Style[TargetType=Border]{
                        when( IsMouseOver and $IsHot ){ Fill = #eee; }
                    }
                } }
            `),
            /mixing \$path terms and DP terms/,
        );
    });
});

describe('compile — text-mode bodies', () => {
    test('TextBox{Hello mural} lexes as a single TextRun and sets Text', () => {
        // Text-mode (string) bodies now belong to string-body controls
        // like TextBox — TextBlock became an inline flow-content host
        // (quoted text → Run). TextBox keeps the unquoted text-body form.
        const js = emitted(`
            Application{ resources: {
                TextBox x:root{Hello mural}
            } }
        `);
        assert.match(js, /\.set_property_value\(\w+\.TextKey, "Hello mural"\);/);
    });

    test('Non-string-bodied control still parses {…} structurally', () => {
        // Border body is element-typed; the parser stays in structural
        // mode. Empty body works fine.
        assert.doesNotThrow(() => emitted(`
            Application{ resources: { Border x:root{} }}
        `));
    });

    test('Escapes inside text bodies pass through', () => {
        const js = emitted(`
            Application{ resources: {
                TextBox x:root{Hello \\{brace\\} world}
            } }
        `);
        assert.match(js, /\.set_property_value\(\w+\.TextKey, "Hello \{brace\} world"\)/);
    });
});

describe('compile — control templates', () => {
    test('template x:key=…[TargetType=…]{…} emits new ControlTemplate(factory)', () => {
        const js = emitted(`
            Application{ resources: {
                Template x:key="FancyBorder"[TargetType=Border]{
                    Border[Padding=(8)]{}
                }
            } }
        `);
        assert.match(js, /new ControlTemplate\(\(_templatedParent\) => \{/);
        // Factory body indented + returns the inner root.
        assert.match(js, /return _border\d+;/);
        // Registered in the dictionary under the x:key.
        assert.match(js, /\.Set\("FancyBorder", _tmpl\d+\);/);
    });

    test('template without x:key auto-wraps in a Style with a Template setter', () => {
        const js = emitted(`
            Application{ resources: {
                Template[TargetType=Border]{ Border{} }
            } }
        `);
        // The implicit Template path is how the controls library ships
        // its bundled chrome (see src/Controls/controls.template.mu).
        // To keep Function keys in the resource chain single-typed
        // (Style only — same key space as user-side [TargetType=X]
        // implicit Styles), the Template is wrapped in a Style whose
        // single Template setter holds it.
        assert.match(js, /new Setter\(Border, "Template", _tmpl\d+\);/);
        assert.match(js, /new Style\(Border, \[_setter\d+\], undefined, \[\], \[\]\);/);
        assert.match(js, /\.Set\(Border, _style\d+\);/);
    });
});

describe('compile — data templates', () => {
    test('DataTemplate x:key=…[DataType=…]{…} emits new DataTemplate(factory)', () => {
        const js = emitted(`
            import PersonVM from "./person-vm.mjs"
            Application{ resources: {
                DataTemplate x:key="PersonRow"[DataType=PersonVM]{
                    TextBlock [Text="row"]
                }
            } }
        `);
        assert.match(js, /new DataTemplate\(\(_data\) => \{/);
        assert.match(js, /\.Set\("PersonRow", _tmpl\d+\);/);
    });
});

describe('compile — macros', () => {
    test('macro is expanded with positional args bound to named params', () => {
        const js = emitted(`
            def panel[#bg, #pad]{
                Border[Fill=#bg, Padding=#pad]{}
            }

            Application{ resources: {
                Border x:root{
                    panel[#4caf50, (8)]
                }
            } }
        `);
        // The macro should have expanded into a Border with the bound
        // bg and pad — the macro identifier `panel` doesn't appear in
        // the emit.
        assert.match(
            js,
            /\.set_property_value\(\w+\.FillKey, new SolidColorBrush\(Color\.FromHex\('#4caf50'\)\)\);/,
        );
        assert.match(
            js,
            /\.set_property_value\(\w+\.PaddingKey, new Thickness\(8\)\);/,
        );
        // The macro itself isn't a control — `panel` should not appear
        // in the imports nor `new panel()` anywhere.
        assert.doesNotMatch(js, /new panel\(/);
    });

    test('content slot — #1 splices invocation body into the macro tree', () => {
        const js = emitted(`
            def labeled[#bg, #1]{
                Border[Fill=#bg, Padding=(4)]{
                    #1
                }
            }

            Application{ resources: {
                Border x:root{
                    labeled[#0000ff]{
                        Border[Padding=(2)]{}
                    }
                }
            } }
        `);
        assert.match(js, /\.set_property_value\(\w+\.FillKey, new SolidColorBrush\(Color\.FromHex\('#0000ff'\)\)/);
        assert.match(js, /\.set_property_value\(\w+\.PaddingKey, new Thickness\(4\)\)/);
        assert.match(js, /\.set_property_value\(\w+\.PaddingKey, new Thickness\(2\)\)/);
    });

    test('default parameter values fill missing args', () => {
        const js = emitted(`
            def card[#bg = #ffffff]{ Border[Fill=#bg]{} }
            Application{ resources: {
                Border x:root{ card[] }
            } }
        `);
        assert.match(
            js,
            /\.set_property_value\(\w+\.FillKey, new SolidColorBrush\(Color\.FromHex\('#ffffff'\)\)\);/,
        );
    });

    test('too many positional args is rejected', () => {
        assert.throws(
            () => emitted(`
                def card[#bg]{ Border[Fill=#bg]{} }
                Application{ resources: {
                    Border x:root{ card[#0000ff, "stray"] }
                } }
            `),
            /too many positional/,
        );
    });

    test('named-argument invocation is rejected in v0', () => {
        assert.throws(
            () => emitted(`
                def card[#bg]{ Border[Fill=#bg]{} }
                Application{ resources: {
                    Border x:root{ card[bg=#0000ff] }
                } }
            `),
            /named-argument/,
        );
    });

    test('duplicate macro name errors', () => {
        assert.throws(
            () => emitted(`
                def card[#bg]{ Border{} }
                def card[#bg]{ Border{} }
                Application{ resources: {} }
            `),
            /duplicate macro/,
        );
    });
});

describe('instantiate — deferreds end-to-end', () => {
    beforeEach(() => { Application.current = null; });

    test('TextBlock { "…" } quoted body → a single Run in Inlines', () => {
        // TextBlock is now an inline flow-content host: a quoted body
        // string lowers to a Run appended to Inlines (not the Text DP).
        const app = instantiate(`
            Application{ resources: {
                TextBlock x:root{ "Hello mural" }
            } }
        `, CTX) as Application;
        const tb = app.Resources.Root as TextBlock;
        assert.ok(tb instanceof TextBlock);
        assert.equal(tb.Inlines.Count, 1);
        assert.equal((tb.Inlines.Get(0) as Run).Text, 'Hello mural');
    });

    test('Style with OR-trigger registers two PropertyTriggers sharing setters', () => {
        const app = instantiate(`
            Application{ resources: {
                Style[TargetType=Border]{
                    Fill = #ffffff;
                    when( IsMouseOver or IsFocused ){ Fill = #eeeeee; }
                }
            } }
        `, CTX) as Application;
        const s = app.Resources.Resolve(Border) as Style;
        assert.equal(s.Triggers.length, 2);
        // Setter arrays are the SAME instance — shared, per emit.
        assert.equal(s.Triggers[0]!.setters, s.Triggers[1]!.setters);
    });

    test('Control template — apply produces fresh subtree', () => {
        const app = instantiate(`
            Application{ resources: {
                Template x:key="FancyBorder"[TargetType=Border]{
                    Border[Padding=(8)]{}
                }
            } }
        `, CTX) as Application;
        const tmpl = app.Resources.Resolve('FancyBorder') as ControlTemplate;
        assert.ok(tmpl instanceof ControlTemplate);
        const inst = tmpl.Apply(new Border());
        assert.ok(inst.root instanceof Border);
    });

    test('Data template — apply with data returns a Visual', () => {
        // Uses Border as a stand-in dataType — the test passes a Border
        // instance as the data so the type-identity match through
        // findDataTemplateForType lines up. Real consumers use a VM
        // class imported via a top-level `import` directive.
        const app = instantiate(`
            Application{ resources: {
                DataTemplate x:key="Row"[DataType=Border]{
                    TextBlock [Text="row"]
                }
            } }
        `, CTX) as Application;
        const tmpl = app.Resources.Resolve('Row') as DataTemplate;
        assert.ok(tmpl instanceof DataTemplate);
        const v = tmpl.Apply({ Name: 'sample' });
        assert.ok(v instanceof TextBlock);
        assert.equal((v as TextBlock).Text, 'row');
    });

    test('$Path binding — emits DataContextBinding watching the DataContext path', () => {
        const app = instantiate(`
            Application{ resources: {
                Border x:root{
                    TextBlock[Text=$Name]
                }
            } }
        `, CTX) as Application;
        const border = app.Resources.Root as Border;
        const tb = border.child as TextBlock;
        assert.ok(tb instanceof TextBlock);
        // No DataContext set → binding resolves to undefined; the
        // EVD will return the default Text value.
        assert.equal(tb.Text, undefined);

        // Set DataContext on an ancestor — inheritance flows down.
        class Person extends MuralBase
        {
            static { MuralBase.RegisterProperty(Person, 'Name', '', MetaData.None); }
            public get Name(): string { return this.get_property_value(resolveKey(this, undefined, 'Name')) as string; }
            public set Name(v: string) { this.set_property_value(resolveKey(this, undefined, 'Name'), v); }
        }
        const p = new Person(); p.Name = 'Eugene';
        border.DataContext = p;
        assert.equal(tb.Text, 'Eugene');

        // Reactive update — change a property on the source.
        p.Name = 'Mural';
        assert.equal(tb.Text, 'Mural');
    });

    test('$$Property — inside a ControlTemplate, binds to templated parent', () => {
        const app = instantiate(`
            Application{ resources: {
                Template x:key="MyTmpl"[TargetType=Border]{
                    Border[Fill=$$Fill]{}
                }
            } }
        `, CTX) as Application;
        const tmpl = app.Resources.Resolve('MyTmpl') as ControlTemplate;
        assert.ok(tmpl instanceof ControlTemplate);

        // Apply with a templated parent that has a Fill set.
        const parent = new Border();
        const brush = new engine.SolidColorBrush(runtime.Color.Red);
        parent.Fill = brush;
        const inst = tmpl.Apply(parent);
        assert.equal((inst.root as Border).Fill, brush);
    });

    test('MultiTrigger — AND condition activates only when both watched props match', () => {
        const app = instantiate(`
            Application{ resources: {
                Style[TargetType=Border]{
                    Fill = #ffffff;
                    when( IsMouseOver and IsFocused ){ Fill = #eeeeee; }
                }
            } }
        `, CTX) as Application;
        const s = app.Resources.Resolve(Border) as Style;
        assert.equal(s.MultiTriggers.length, 1);
        const mt = s.MultiTriggers[0]!;
        assert.ok(mt instanceof MultiTrigger);
        assert.equal(mt.conditions.length, 2);
        assert.equal(mt.conditions[0]!.propertyName, 'IsMouseOver');
        assert.equal(mt.conditions[1]!.propertyName, 'IsFocused');
        assert.equal(mt.setters.length, 1);
    });

    test('Macro inside a rooted Border — expansion becomes its Child', () => {
        const app = instantiate(`
            def labeled[#bg]{ Border[Fill=#bg, Padding=(8)]{} }
            Application{ resources: {
                Border x:root{
                    labeled[#0000ff]
                }
            } }
        `, CTX) as Application;
        const outer = app.Resources.Root as Border;
        const inner = outer.child as Border;
        assert.ok(inner instanceof Border);
        // Inner Border has the macro-provided Fill.
        assert.notEqual(inner.Fill, undefined);
    });
});
