import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, EmitError } from '../compile.js';

// Pure source-to-source tests. Each one asserts on substrings of the
// emitted JS — robust against trivial format changes but precise about
// the bits that matter (imports, key emit lines).

function emitted(src: string): string
{
    return compile(src).js;
}

describe('compile — application skeleton', () => {
    test('empty Application emits the IIFE shape', () => {
        const js = emitted(`Application{ resources: {} }`);
        // export const app, with eager IIFE body.
        assert.match(js, /export const app = \(\(\) => \{/);
        assert.match(js, /const _app0 = new Application\(\);/);
        assert.match(js, /return _app0;/);
    });

    test('imports header sorts modules and symbols deterministically', () => {
        const js = emitted(`
            Application{
                resources: {
                    @primary = #4caf50
                    Border x:root[Padding=(16)]{}
                }
            }
        `);
        // Modules sorted alphabetically; within each module the symbols
        // sorted too.
        assert.match(
            js,
            /import \{ Border \} from "@pragmatic-tech-ai\/mural\/basic";/,
        );
        // x:root materialises a NameScope on the root visual so x:name
        // descendants resolve there; the emitter pulls NameScope into
        // the runtime imports automatically.
        assert.match(
            js,
            /import \{ Application, Color, NameScope, Thickness \} from "@pragmatic-tech-ai\/mural\/runtime";/,
        );
        assert.match(
            js,
            /import \{ SolidColorBrush \} from "@pragmatic-tech-ai\/mural\/visual-engine";/,
        );
    });
});

describe('compile — resources slot', () => {
    test('KeyValueResource emits rd.Set(key, value)', () => {
        const js = emitted(`
            Application{
                resources: {
                    @primary = #4caf50
                }
            }
        `);
        assert.match(
            js,
            /_rd1\.Set\("primary", new SolidColorBrush\(Color\.FromHex\('#4caf50'\)\)\);/,
        );
    });

    test('namespaced primitive (@theme:primary) keys under the full string', () => {
        // The colon is a key-namespace separator, not a rename. The
        // dictionary key is the full `name:tail` so `@theme:primary`
        // resolves to the same entry it defined.
        const js = emitted(`
            Application{
                resources: {
                    @theme:primary = #000000
                }
            }
        `);
        assert.match(js, /\.Set\("theme:primary",/);
    });

    test('x:root assigns Resources.Root', () => {
        const js = emitted(`
            Application{
                resources: {
                    Border x:root{}
                }
            }
        `);
        assert.match(js, /_rd1\.Root = _border2;/);
    });

    test('x:root attaches a fresh NameScope to the root visual', () => {
        const js = emitted(`
            Application{
                resources: {
                    Border x:root{}
                }
            }
        `);
        assert.match(js, /_border2\.SetNameScope\(new NameScope\(\)\);/);
    });
});

describe('compile — x:name', () => {
    test('x:name on a descendant sets Visual.Name and registers in the root NameScope', () => {
        const js = emitted(`
            Application{
                resources: {
                    Canvas x:root{
                        Border x:name="bg"{}
                    }
                }
            }
        `);
        // Root creates the scope, descendant sets Name + registers.
        assert.match(js, /\.SetNameScope\(new NameScope\(\)\);/);
        assert.match(js, /\.Name = "bg";/);
        assert.match(js, /\.nameScope\.Register\("bg", _border\d+\);/);
    });

    test('x:name on the root itself registers the root in its own scope', () => {
        const js = emitted(`
            Application{
                resources: {
                    Canvas x:root x:name="root"{}
                }
            }
        `);
        // Same variable on both sides of the register call — the
        // x:root element registers itself in its own NameScope.
        assert.match(js, /(_canvas\d+)\.SetNameScope\(new NameScope\(\)\);/);
        assert.match(js, /(_canvas\d+)\.nameScope\.Register\("root", \1\);/);
    });

    test('x:name without an enclosing x:root throws', () => {
        // Non-Application markup with x:name on the root — no x:root,
        // no NameScope owner — should fail with a clear EmitError.
        assert.throws(
            () => emitted(`Border x:name="foo"{}`),
            (err: unknown) => err instanceof EmitError
                && /x:name requires an enclosing x:root/.test((err as Error).message),
        );
    });

    test('x:name with a non-string value throws', () => {
        assert.throws(
            () => emitted(`
                Application{
                    resources: {
                        Canvas x:root{
                            Border x:name=42{}
                        }
                    }
                }
            `),
            (err: unknown) => err instanceof EmitError
                && /x:name requires a string literal/.test((err as Error).message),
        );
    });
});

describe('compile — Style emission', () => {
    test('implicit style — keyed by TargetType', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{ Padding = (12, 6); }
                }
            }
        `);
        // new Style(Border, [setter], undefined, [triggers], [multiTriggers]); then rd.Set(Border, _style)
        assert.match(js, /new Style\(Border, \[_setter\d+\], undefined, \[\], \[\]\);/);
        assert.match(js, /_rd1\.Set\(Border, _style\d+\);/);
        // Setter wraps the tuple as a 4-way Thickness.
        assert.match(
            js,
            /new Setter\(Border, "Padding", new Thickness\(12, 6, 12, 6\)\);/,
        );
    });

    test('keyed style — keyed by x:key string', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style x:key="DangerButton"[TargetType=Border]{ Fill = #ff0000; }
                }
            }
        `);
        assert.match(js, /_rd1\.Set\("DangerButton", _style\d+\);/);
    });

    test('trigger group emits PropertyTrigger with its setters', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        Fill = #ffffff;
                        when( IsMouseOver ){
                            Fill = #eeeeee;
                        }
                    }
                }
            }
        `);
        // PropertyTrigger(Border, "IsMouseOver", true, _sArrN) — the
        // setter list lives in a local var so OR-flattened triggers
        // can share the SAME array reference.
        assert.match(
            js,
            /new PropertyTrigger\(Border, "IsMouseOver", true, _sArr\d+\);/,
        );
        // Style construction picks up the trigger; the empty fifth arg
        // is the (empty) multi-trigger list.
        assert.match(js, /new Style\(Border, \[.*\], undefined, \[_trigger\d+\], \[\]\);/);
    });

    test('when($Path) lowers to DataTrigger emission', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        Fill = #ffffff;
                        when( $IsSelected ){
                            Fill = #ffaa00;
                        }
                    }
                }
            }
        `);
        // DataTrigger("IsSelected", true, _sArrN) — note no targetType
        // argument; the trigger resolves the path against the styled
        // visual's DataContext, not against a DP on a specific class.
        assert.match(
            js,
            /new DataTrigger\("IsSelected", true, _sArr\d+\);/,
        );
        // Style constructor picks up the DataTrigger in its 7th
        // argument slot. The 6th slot (event triggers) is still empty.
        assert.match(
            js,
            /new Style\(Border, \[.*\], undefined, \[\], \[\], \[\], \[_dataTrig\d+\]\);/,
        );
        // DataTrigger import is wired alongside Style.
        assert.match(js, /\bDataTrigger\b/);
    });

    test('when($Path = value) lowers to DataTrigger with an explicit value', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        when( $Mode = "warn" ){ Fill = #ffff00; }
                    }
                }
            }
        `);
        assert.match(
            js,
            /new DataTrigger\("Mode", "warn", _sArr\d+\);/,
        );
    });

    test('when($A.B) lowers to a dotted-path DataTrigger', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        when( $User.IsAdmin ){ Fill = #00ff00; }
                    }
                }
            }
        `);
        assert.match(
            js,
            /new DataTrigger\("User\.IsAdmin", true, _sArr\d+\);/,
        );
    });

    test('not $Path lowers to DataTrigger with value=false (bare-boolean negation)', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        when( not $IsSelected ){ Fill = #000; }
                    }
                }
            }
        `);
        assert.match(
            js,
            /new DataTrigger\("IsSelected", false, _sArr\d+\);/,
        );
    });

    test('mixed DP + $path inside an AND-conjunct is rejected', () => {
        // Pure-DP and pure-$path conjuncts both lower fine (MultiTrigger
        // and MultiDataTrigger respectively). MIXING them inside the
        // same conjunct stays rejected — mural mirrors WPF's split
        // (MultiTrigger.Conditions are DP-only; MultiDataTrigger.
        // Conditions are binding-only).
        assert.throws(
            () => emitted(`
                Application{
                    resources: {
                        Style[TargetType=Border]{
                            when( IsMouseOver and $IsSelected ){
                                Fill = #000;
                            }
                        }
                    }
                }
            `),
            (e) => e instanceof EmitError && /mixing \$path terms and DP terms/.test(e.message),
        );
    });

    test('pure $path AND-conjunct lowers to MultiDataTrigger', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Border]{
                        when( $IsSelected and $IsHot ){ Fill = #000; }
                    }
                }
            }
        `);
        assert.match(js, /new MultiDataTrigger\(\[/);
    });
});

describe('compile — Style BasedOn (BasedOn = @key)', () => {
    test('local base (same top-level dict) is passed eagerly as the JS var', () => {
        // A top-level `resources NAME { … }` block registers each keyed
        // resource as a local JS var, so a same-dict `@Base` reference
        // binds to the constructed Style directly (no runtime lookup).
        // This is the Plexus shared-dictionary scenario.
        const js = emitted(`
            resources SharedDict {
                Style x:key="Base"[TargetType=Border]{ Padding = (4); }
                Style x:key="Derived"[TargetType=Border, BasedOn=@Base]{ Fill = #fff; }
            }
        `);
        const m = js.match(/const (_style\d+) = new Style\(Border, \[_setter\d+\], undefined, \[\], \[\]\);/);
        assert.ok(m, 'expected the base Style to compile with basedOn undefined');
        const baseVar = m![1];
        assert.match(
            js,
            new RegExp(`new Style\\(Border, \\[_setter\\d+\\], ${baseVar}, \\[\\], \\[\\]\\);`),
        );
    });

    test('cross-dict base (theme token) emits a deferred resolver thunk', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style x:key="Title"[TargetType=Border, BasedOn=@TitleSmall]{ Fill = #fff; }
                }
            }
        `);
        assert.match(
            js,
            /new Style\(Border, \[_setter\d+\], \(\) => Application\.current\?\.Resources\.Resolve\("TitleSmall"\), \[\], \[\]\);/,
        );
        // The thunk references Application — it must be imported from runtime.
        assert.match(js, /import \{[^}]*\bApplication\b[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime"/);
    });

    test('no BasedOn keeps basedOn undefined (legacy shape unchanged)', () => {
        const js = emitted(`
            Application{
                resources: { Style[TargetType=Border]{ Padding = (4); } }
            }
        `);
        assert.match(js, /new Style\(Border, \[_setter\d+\], undefined, \[\], \[\]\);/);
    });

    test('BasedOn with a non-@resource value is rejected', () => {
        assert.throws(
            () => emitted(`
                Application{
                    resources: { Style[TargetType=Border, BasedOn=Border]{ Padding = (4); } }
                }
            `),
            /BasedOn must be a '@resource' reference/,
        );
    });
});

describe('compile — DataTemplate triggers', () => {
    test('trailing `when($Path)` inside DataTemplate emits TemplateDataTrigger', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root {
                        TextBlock x:name="label"
                    }
                    when( $IsSelected ) {
                        Border.Fill = #ffaa00;
                    }
                }
            }
        `);
        // The TargetedSetter wraps the Fill setter for the
        // template root (Owner=Border, no targetName).
        assert.match(js, /new TargetedSetter\(Border, "Fill",/);
        // TemplateDataTrigger consumes the setter array.
        assert.match(
            js,
            /new TemplateDataTrigger\("IsSelected", true, _tplSet\d+\)/,
        );
        // DataTemplate construction goes through an IIFE so trigger
        // const declarations precede the constructor while still being
        // able to reference x:names from inside the factory body. The
        // factory is hoisted into `_factory` so the constructor call
        // uses the bound identifier rather than an inline arrow.
        // DataType is the FooVM Function reference imported from
        // "./foo-vm.mjs" — not a string. WPF parity.
        assert.match(
            js,
            /new DataTemplate\(_factory, FooVM, \[\], \[_tplDataTrig\d+\]\)/,
        );
        assert.match(js, /import \{ FooVM \} from "\.\/foo-vm\.mjs";/);
    });

    test('trailing `when($Path)` inside HierarchicalDataTemplate emits + forwards a TemplateDataTrigger', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                HierarchicalDataTemplate x:key="T" [DataType=FooVM, itemsselector=Children] {
                    Border x:root {
                        TextBlock x:name="label"
                    }
                    when( $IsEditing ) {
                        Border.Fill = #ffaa00;
                    }
                }
            }
        `);
        // The data trigger is emitted (previously dropped for the
        // hierarchical form — the compiler passed no triggers).
        assert.match(js, /new TemplateDataTrigger\("IsEditing", true, _tplSet\d+\)/);
        // …and forwarded into HierarchicalDataTemplate's trailing trigger
        // slots (after factory, child-selector, itemTemplate,
        // itemContainerStyle, dataType), via the same IIFE + _factory shape.
        assert.match(
            js,
            /new HierarchicalDataTemplate\(_factory, \(data\) => data\?\.Children, undefined, undefined, FooVM, \[\], \[_tplDataTrig\d+\]/,
        );
    });

    test('trigger-free HierarchicalDataTemplate keeps the historical 5-arg shape', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                HierarchicalDataTemplate x:key="T" [DataType=FooVM, itemsselector=Children] {
                    Border x:root
                }
            }
        `);
        assert.match(
            js,
            /new HierarchicalDataTemplate\(\(_data\) => \{[\s\S]*\}, \(data\) => data\?\.Children, undefined, undefined, FooVM\);/,
        );
    });

    test('`$name.Property` resolves to ElementNameBinding when name is an x:name in scope', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root {
                        Border x:name="chrome" [Fill=#ffaa00]
                        TextBlock [Foreground=$chrome.Fill]
                    }
                }
            }
        `);
        // The TextBlock's Foreground binds to the chrome's Fill
        // via ElementNameBinding wrapping a thunk that captures the
        // chrome var, NOT via DataContextBinding. The thunk shape
        // supports forward x:name references in the same template body.
        assert.match(
            js,
            /ElementNameBinding\(\(\) => _border\d+, "Fill"\)/,
        );
        assert.doesNotMatch(
            js,
            /DataContextBinding\([^,]+, "chrome\.Fill"\)/,
        );
        // The import header pulls ElementNameBinding from the runtime.
        assert.match(
            js,
            /import \{[^}]*ElementNameBinding[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime";/,
        );
    });

    test('`$name` without a trailing path binds to the named element itself', () => {
        // Empty-path ElementNameBinding — the binding's value IS the
        // source Visual. Used by markup-driven Diagram.DropReceiver /
        // Mutator wiring (`DropReceiver = $surface`).
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root {
                        Border x:name="chrome"
                        TextBlock [Tag=$chrome]
                    }
                }
            }
        `);
        assert.match(js, /ElementNameBinding\(\(\) => _border\d+, ""\)/);
    });

    test('`Name.Property = value` resolves to a TargetedSetter when Name is an x:name', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root {
                        Border x:name="chrome" [Fill=#ffffff]
                    }
                    when( $IsSelected ) {
                        chrome.Fill = #ffaa00;
                    }
                }
            }
        `);
        // chrome → x:name → TargetedSetter with targetName="chrome",
        // owner inferred from the named element's declared class.
        assert.match(
            js,
            /new TargetedSetter\(Border, "Fill", [^,]+, "chrome"\)/,
        );
    });

    test('DataTemplate body without trailing triggers keeps the 2-arg shape', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root
                }
            }
        `);
        // No triggers → no 4-arg form; the historical
        // `new DataTemplate((_data) => { … }, FooVM);` shape is
        // preserved — DataType is now a Function identifier sourced
        // from the import clause, not a string literal.
        assert.match(js, /new DataTemplate\(\(_data\) => \{[\s\S]*\}, FooVM\);/);
        assert.doesNotMatch(js, /TemplateDataTrigger/);
    });

    test('event triggers inside DataTemplate body lower to EventTrigger constructors passed as the 5th DataTemplate arg', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="T" [DataType=FooVM] {
                    Border x:root
                    on Click {
                        BeginStoryboard {
                            DoubleAnimation[TargetProperty=Opacity, From=0, To=1, Duration=200]
                        }
                    }
                }
            }
        `);
        // The Style EventTrigger path is reused, so the same
        // `new EventTrigger("Click", [_act…])` shape lands here.
        assert.match(js, /new EventTrigger\("Click", \[_act\d+\]\);/);
        // The 5th argument carries the event-trigger array. Property
        // and data trigger arrays are empty (no when() block).
        assert.match(
            js,
            /new DataTemplate\(_factory, FooVM, \[\], \[\], \[_evt\d+\]\)/,
        );
    });

    test('bare `Property = value` inside a DataTemplate trigger is rejected', () => {
        assert.throws(
            () => emitted(`
                import FooVM from "./foo-vm.mjs"
                resources Test {
                    DataTemplate x:key="T" [DataType=FooVM] {
                        Border x:root
                        when( $IsSelected ) {
                            Fill = #ffaa00;
                        }
                    }
                }
            `),
            (e) => e instanceof EmitError && /Owner\.Property/.test(e.message),
        );
    });

    test('unkeyed DataTemplate registers by DataType class function', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate [DataType=FooVM] {
                    Border x:root
                }
            }
        `);
        // Function-keyed entry — the imported FooVM identifier is the
        // key. ContentPresenter / ItemsControl resolve via
        // TryFindResource(content.constructor) — identity match.
        assert.match(js, /\.Set\(FooVM, _tmpl\d+\);/);
        assert.match(js, /import \{ FooVM \} from "\.\/foo-vm\.mjs";/);
    });

    test('unkeyed DataTemplate inside Application resources slot works the same way', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            Application{
                resources: {
                    DataTemplate [DataType=FooVM] {
                        Border x:root
                    }
                }
            }
        `);
        assert.match(js, /_rd\d+\.Set\(FooVM, _tmpl\d+\);/);
    });

    // HierarchicalDataTemplate parses as `data-template-body` like
    // DataTemplate but `compileHierarchicalDataTemplateForm` only
    // accepts `kind === 'element'`. Pre-existing gap — the form is
    // broken in markup form even with an x:key today. The implicit
    // wiring is in place for the day the form is reconciled.

    test('explicit x:key still wins over implicit DataType', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            resources Test {
                DataTemplate x:key="Row" [DataType=FooVM] {
                    Border x:root
                }
            }
        `);
        // Keyed entry — registered under the user-supplied string, not
        // under the DataType identifier.
        assert.match(js, /\.Set\("Row", _tmpl\d+\);/);
        assert.doesNotMatch(js, /\.Set\(FooVM, _tmpl\d+\);/);
    });

    test('top-level `import Name from "path"` extends the symbol table', () => {
        const js = emitted(`
            import BarVM from "../bar-vm.mjs"
            resources Test {
                DataTemplate x:key="K" [DataType=BarVM] {
                    Border x:root
                }
            }
        `);
        // Single import line at the top of the emitted module, plus
        // the constructor uses BarVM by identifier.
        assert.match(js, /import \{ BarVM \} from "\.\.\/bar-vm\.mjs";/);
        assert.match(js, /new DataTemplate\(\(_data\) => \{[\s\S]*\}, BarVM\);/);
    });

    test('bare `import Name` (no `from`) is rejected', () => {
        assert.throws(
            () => emitted(`
                import Floating
                resources Test {}
            `),
            /requires `from "path"`/,
        );
    });

    test('referencing an un-imported type in `[DataType=...]` errors loudly', () => {
        assert.throws(
            () => emitted(`
                resources Test {
                    DataTemplate x:key="K" [DataType=UnknownVM] {
                        Border x:root
                    }
                }
            `),
            /unknown symbol 'UnknownVM'/,
        );
    });
});

describe('compile — element construction and slots', () => {
    test('Border child via the single-element slot', () => {
        const js = emitted(`
            Application{
                resources: {
                    Border x:root{
                        Border[Padding=(4)]{}
                    }
                }
            }
        `);
        // Outer Border calls SetChild with inner Border (Single.Child
        // is read-only; mutation goes through SetChild).
        assert.match(js, /_border\d+\.SetChild\(_border\d+\);/);
    });

    test('Canvas children via the list slot', () => {
        const js = emitted(`
            Application{
                resources: {
                    Canvas x:root{
                        Border[Canvas.Left=10]{}
                        Border[Canvas.Left=20]{}
                    }
                }
            }
        `);
        // Panel.AddChild for each child (Children is read-only —
        // mutation goes through AddChild; see compiler.ts comment).
        const matches = js.match(/\.AddChild\(_border\d+\)/g) ?? [];
        assert.equal(matches.length, 2);
    });

    test('attached property emits the explicit-owner overload', () => {
        const js = emitted(`
            Application{
                resources: {
                    Canvas x:root{
                        Border[Canvas.Left=10, Canvas.Top=20]{}
                    }
                }
            }
        `);
        assert.match(
            js,
            /\.set_property_value\(Canvas\.LeftKey, 10\);/,
        );
        assert.match(
            js,
            /\.set_property_value\(Canvas\.TopKey, 20\);/,
        );
    });
});

describe('compile — value emission', () => {
    test('Thickness shape — 1, 2, 4 values', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root[Padding=(8), Margin=(4, 6), CornerRadius=(1, 2, 3, 4)]{}
            } }
        `);
        assert.match(js, /new Thickness\(8\)/);
        assert.match(js, /new Thickness\(4, 6, 4, 6\)/);
        assert.match(js, /new CornerRadius\(1, 2, 3, 4\)/);
    });

    test('Size literal emits new Size(w, h)', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root[Width=100]{}
                Style[TargetType=Border]{
                    MinSize = <120, 40>;
                }
            } }
        `);
        assert.match(js, /new Size\(120, 40\)/);
    });

    test('hex colour vs named colour', () => {
        const js = emitted(`
            Application{ resources: {
                @h = #0d47a1
                @n = #blue
            } }
        `);
        assert.match(js, /new SolidColorBrush\(Color\.FromHex\('#0d47a1'\)\)/);
        assert.match(js, /new SolidColorBrush\(Color\.Blue\)/);
    });

    test('@@key emits DynamicResource(targetVar, key) in direct-attribute context', () => {
        const js = emitted(`
            Application{ resources: {
                @theme = #4caf50
                Border x:root[Fill=@@theme]{}
            } }
        `);
        assert.match(
            js,
            /\.set_property_value\(\w+\.FillKey, DynamicResource\(_border\d+, "theme"\)\);/,
        );
    });

    test('@@key inside a Style setter wraps in a SetterFactory', () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{ Fill = @@theme; }
            } }
        `);
        assert.match(
            js,
            /new SetterFactory\(\(_t\) => DynamicResource\(_t, "theme"\)\)/,
        );
    });

    test('@key emits a DynamicResource binding for non-local lookups', () => {
        // `@key` falls through to dynamic semantics when the key isn't in
        // the local ResourceDictionary being built. The local fast path
        // still applies inside a single RD (Style { Template = @key; } where
        // @key is declared in the same RD) — that case is exercised by
        // the basic.resources.mu round-trip.
        const js = emitted(`
            Application{ resources: {
                @primary = #4caf50
                Border x:root[Fill=@primary]{}
            } }
        `);
        assert.match(
            js,
            /\.set_property_value\(\w+\.FillKey, DynamicResource\(_border\d+, "primary"\)\);/,
        );
    });

    test('@key inside an element VALUE binds to the constructed _e, not a bare SetterFactory', () => {
        // `Type [ Prop = @key ]` in value position constructs the object in
        // an IIFE with `_e`. That `_e` is a concrete target, so `@key`
        // installs a real DynamicResource(_e, …) — NOT an un-applied
        // SetterFactory that nothing ever resolves (which would leave the
        // property holding a factory object instead of the resolved value).
        const js = emitted(`
            import Tool from "./tool.mjs"
            resources R {
                @myTool = Tool [ Icon = @alignLeft, Command = $picked ]
            }
        `);
        assert.match(js, /_e\.Icon = DynamicResource\(_e, "alignLeft"\);/);
        // A plain $binding likewise binds against _e (DataContext), not a
        // deferred SetterFactory.
        assert.match(js, /_e\.Command = DataContextBinding\(_e, "picked"\);/);
        assert.doesNotMatch(js, /_e\.\w+ = new SetterFactory/);
    });

    test('PascalIdent in enum context — HorizontalAlignment=Center', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root[HorizontalAlignment=Center]{}
            } }
        `);
        assert.match(
            js,
            /\.set_property_value\(\w+\.HorizontalAlignmentKey, HorizontalAlignment\.Center\);/,
        );
        // The enum class also lands in the import header.
        assert.match(
            js,
            /import \{[^}]*HorizontalAlignment[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime";/,
        );
    });

    test('Unknown enum member is a compile error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Border x:root[HorizontalAlignment=center]{}
                } }
            `),
            (err: Error) =>
                err.message.includes('center') &&
                err.message.includes('HorizontalAlignment') &&
                err.message.includes('Center'),
        );
    });

    test('Unknown enum member errors when the property name differs from the enum (Variant: DrawerVariant)', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Drawer x:root[Variant=Bogus]{}
                } }
            `),
            (err: Error) =>
                err.message.includes('Bogus') &&
                err.message.includes('DrawerVariant') &&
                err.message.includes('Persistent'),
        );
    });

    test('Unresolved bareword in value position is a compile error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    TextBlock x:root[Text=SomeUnknownIdent]{}
                } }
            `),
            (err: Error) =>
                err.message.includes('unresolved identifier') &&
                err.message.includes('SomeUnknownIdent'),
        );
    });

    test('Dotted Type.Member ref emits ClassName.Member and adds the import', () => {
        // Token-resource RHS — the canonical site exercised by light.mu /
        // dark.mu's `@ShapeFull = CornerRadius.Full`. The emitter
        // validates the head against the symbol table and the tail
        // against STATIC_MEMBERS, then emits a real type-member ref.
        const js = emitted(`
            Application{ resources: {
                @ShapeFull = CornerRadius.Full
                Border x:root[CornerRadius=@ShapeFull]{}
            } }
        `);
        assert.match(js, /\.Set\("ShapeFull", CornerRadius\.Full\)/);
        assert.match(
            js,
            /import \{[^}]*CornerRadius[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime";/,
        );
    });

    test('Dotted ref with unknown head is a compile error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    @x = Nonsense.Full
                    Border x:root[Fill=@x]{}
                } }
            `),
            (err: Error) =>
                err.message.includes("'Nonsense'") &&
                err.message.includes('STATIC_MEMBERS'),
        );
    });

    test('Dotted ref with unknown tail is a compile error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    @x = CornerRadius.Bogus
                    Border x:root[CornerRadius=@x]{}
                } }
            `),
            (err: Error) =>
                err.message.includes("'Bogus'") &&
                err.message.includes('static member') &&
                err.message.includes('Full'),
        );
    });
});

describe('compile — deferred & errored features', () => {
    test('$Path binding emits DataContextBinding bound to the target var', () => {
        const js = emitted(`
            Application{ resources: { Border x:root[Fill=$Name]{} } }
        `);
        assert.match(
            js,
            /\.set_property_value\(\w+\.FillKey, DataContextBinding\(_border\d+, "Name"\)\);/,
        );
    });

    test('macros are deferred', () => {
        assert.throws(
            () => emitted(`def card[#x]{ Border{} }`),
            /no top-level element/,    // ignored as a top form; doc has no element
        );
    });

    test('positional attrs outside macros are an error', () => {
        assert.throws(
            () => emitted(`Application{ resources: { Border x:root["stray"]{} } }`),
            /positional/,
        );
    });

    test('Application body slot other than resources / services / modules is rejected', () => {
        assert.throws(
            () => emitted(`Application{ Border x:root{} }`),
            /only the 'resources:', '\.services:' and '\.modules:' blocks are supported/,
        );
    });

    test('resource without x:key or x:root errors loudly', () => {
        assert.throws(
            () => emitted(`Application{ resources: { Border{} } }`),
            /x:key or x:root/,
        );
    });

    test('unknown symbol surfaces a typed error', () => {
        assert.throws(
            () => emitted(`Application{ resources: { NonexistentControl x:root{} } }`),
            EmitError,
        );
    });
});

describe('compile — ShellModule (module declaration)', () => {
    // A module file is a top-level ShellModule (a MuralBase, not a Visual) — it
    // exports the fragment `create()`. Its Capabilities are declarative
    // children (list slot → AddChild → Capabilities.Add); each Capability is
    // attribute-only (Name / Icon / ServiceKey — its content is a SERVICE named
    // by ServiceKey, not a mounted child).
    const src = `
        ShellModule[Name="Diagram"]{
            Capability[Name="Shapes"]
            Capability[Name="Layers"]
        }
    `;

    test('a top-level ShellModule exports create() and builds the module', () => {
        const js = emitted(src);
        assert.match(js, /export function create\(\)/);
        assert.match(js, /const _shellModule\d+ = new ShellModule\(\);/);
        assert.match(js, /_shellModule\d+\.set_property_value\(ShellModule\.NameKey, "Diagram"\);/);
    });

    test('Capabilities route through AddChild (the list slot)', () => {
        const js = emitted(src);
        // Two capabilities constructed and funneled via the list slot.
        assert.match(js, /const _capability\d+ = new Capability\(\);/);
        assert.match(js, /_shellModule\d+\.AddChild\(_capability\d+\);/);
    });

    test('ShellModule / Capability resolve to the shell module module', () => {
        const js = emitted(src);
        assert.match(
            js,
            /import \{ Capability, ShellModule \} from "@pragmatic-tech-ai\/mural\/framework\/shell\/module\.js";/,
        );
    });
});

describe('compile — module NAME form', () => {
    const src = `module DiagramModule[Name="Diagram"]{ Capability[Name="Shapes"] }`;

    test('exports `const NAME` as an IIFE building the ShellModule', () => {
        const js = emitted(src);
        assert.match(js, /export const DiagramModule = \(\(\) => \{/);
        assert.match(js, /const _shellModule\d+ = new ShellModule\(\);/);
        assert.match(js, /_shellModule\d+\.set_property_value\(ShellModule\.NameKey, "Diagram"\);/);
        assert.match(js, /_shellModule\d+\.AddChild\(_capability\d+\);/);
        assert.match(js, /return _shellModule\d+;/);
    });

    test('a module file cannot also contain another top-level form', () => {
        assert.throws(() => emitted(`module M{} Border{}`), /cannot also contain/);
    });

    test('`merge Alias` in the app resources folds an imported dictionary in', () => {
        // Closes the §27 gap: a standalone `resources NAME { … }` dict merges
        // into Application.Resources via a `merge` directive + top-level import.
        const js = emitted(
            `import PlexusIcons from "./plexus-icons.mu.js"\n` +
            `Application { resources: { merge PlexusIcons  Border x:root {} } }`);
        assert.match(js, /import \{ PlexusIcons \} from "\.\/plexus-icons\.mu\.js";/);
        assert.match(js, /for \(const \[_k, _v\] of PlexusIcons\.Clone\(\)\.Entries\(\)\) _rd\d+\.Set\(_k, _v\);/);
    });

    test('a `resources:` block in the module body fills ShellModule.Resources', () => {
        // The module contributes its own dictionary — the ordinary
        // element-resources slot lowers onto `<shellModule>.Resources`, which
        // the Application merges app-global when the module is added.
        const js = emitted(
            `module DiagramModule { resources: { @ModIcon = #ff0000 } Capability[Name="Shapes"]{} }`);
        assert.match(js, /const _rd\d+ = _shellModule\d+\.Resources;/);
        assert.match(js, /_rd\d+\.Set\("ModIcon",/);
    });

    test('a `services:` block in the module body records registrations via AddRegistration', () => {
        // The module has no live provider at declaration — each `.services:`
        // entry is RECORDED (AddRegistration) with the same token / lazy-factory
        // shape a live `.services:` block uses, replayed into the app root when
        // the module is composed. A Capability's ServiceKey then references one
        // of these tokens.
        const js = emitted(
            `module DiagramModule {
                .services: { StatusService  scoped NavigationService }
                Capability[Name="Shapes", ServiceKey=StatusService]
             }`);
        assert.match(js, /_shellModule\d+\.AddRegistration\(ServiceProvider\.tokenFor\(StatusService\), \(p\) => new StatusService\(p\), 'singleton'\);/);
        assert.match(js, /_shellModule\d+\.AddRegistration\(ServiceProvider\.tokenFor\(NavigationService\), \(p\) => new NavigationService\(p\), 'scoped'\);/);
    });

    test('a `.settings:` block appends each SettingDefinition to ShellModule.Settings', () => {
        // `.settings:` is a generic member-block: each entry constructs a
        // SettingDefinition (DPs set) and is appended to the module's `Settings`
        // collection. The lowercase `settings` spelling (paralleling `.services:`
        // / `.modules:`) remaps to the PascalCase `Settings` property. `Kind =
        // Boolean` resolves to the SettingKind enum member.
        const js = emitted(
            `module DiagramModule {
                .settings: {
                    SettingDefinition[Key="diagram.grid.snap", Label="Snap to grid", Kind=Boolean, Default=true]
                }
                Capability[Name="Shapes"]
             }`);
        assert.match(js, /import \{ SettingDefinition, SettingKind \} from "@pragmatic-tech-ai\/mural\/framework\/shell\/settings\/setting-definition\.js";/);
        assert.match(js, /const _settingDefinition\d+ = new SettingDefinition\(\);/);
        assert.match(js, /_settingDefinition\d+\.set_property_value\(SettingDefinition\.KeyKey, "diagram\.grid\.snap"\);/);
        assert.match(js, /_settingDefinition\d+\.set_property_value\(SettingDefinition\.KindKey, SettingKind\.Boolean\);/);
        assert.match(js, /_settingDefinition\d+\.set_property_value\(SettingDefinition\.DefaultKey, true\);/);
        assert.match(js, /_shellModule\d+\.Settings\.Add\(_settingDefinition\d+\);/);
    });
});

describe('compile — .modules: block on Application', () => {
    test('adds each imported module const to Application.Modules, in order', () => {
        const js = emitted(`
            import DiagramModule from "./diagram.module.mu.js"
            import LayersModule from "./layers.module.mu.js"
            Application { .modules: { DiagramModule LayersModule } resources: {} }
        `);
        assert.match(js, /import \{ DiagramModule \} from "\.\/diagram\.module\.mu\.js";/);
        assert.match(js, /_app\d+\.AddModule\(DiagramModule\);/);
        assert.match(js, /_app\d+\.AddModule\(LayersModule\);/);
        assert.doesNotMatch(js, /_app\d+\.Modules\.Add\(/);
    });
});

describe('compile — .targets: block in a module body', () => {
    test('lowers each entry to module.AddTarget(...)', () => {
        const js = emitted(`
            import Desktop from "./host-kinds.js"
            import Web from "./host-kinds.js"
            module DiagramModule { .targets: { Desktop Web } }
        `);
        assert.match(js, /_shellModule\d+\.AddTarget\(Desktop\);/);
        assert.match(js, /_shellModule\d+\.AddTarget\(Web\);/);
    });
});

describe('compile — result metadata', () => {
    beforeEach(() => { /* nothing — kept for symmetry with other suites */ });

    test('isApplication=true and exportName="app" for Application root', () => {
        const r = compile(`Application{ resources: {} }`);
        assert.equal(r.isApplication, true);
        assert.equal(r.exportName,    'app');
    });

    test('imports map exposes the modules and symbols', () => {
        const r = compile(`Application{ resources: { Border x:root{} } }`);
        assert.ok(r.imports.has('@pragmatic-tech-ai/mural/runtime'));
        assert.ok(r.imports.has('@pragmatic-tech-ai/mural/basic'));
        assert.equal(r.imports.get('@pragmatic-tech-ai/mural/basic')!.has('Border'), true);
    });
});

describe('compile — resources block (typed dictionary class)', () => {
    test('emits an export class extending ResourceDictionary with a static Clone', () => {
        const r = compile(`
            resources MyTheme {
                Style x:key="Foo" [TargetType=TextBlock] { FontSize = 14; }
            }
        `);
        assert.equal(r.kind,           'resources');
        assert.equal(r.isApplication,  false);
        assert.equal(r.exportName,     '');
        assert.match(r.js, /export class MyTheme extends ResourceDictionary/);
        assert.match(r.js, /static Clone\(\)/);
        assert.match(r.js, /const _gate_MyTheme = Symbol\("MyTheme\.ctor"\)/);
        assert.match(r.js, /MyTheme is private — use MyTheme\.Clone\(\)/);
    });

    test('private constructor throws when called without the gate symbol', () => {
        const r = compile(`
            resources Gated {
                Style x:key="A" [TargetType=TextBlock] { FontSize = 14; }
            }
        `);
        // The throw is gated on `_g !== _gate_Gated` so any
        // direct `new Gated()` from outside the module fails fast.
        assert.match(r.js, /if \(_g !== _gate_Gated\)/);
        assert.match(r.js, /throw new Error\(.*Gated is private/);
    });

    test('typed accessors emit for every x:key on a root resource', () => {
        const r = compile(`
            resources A {
                Style x:key="One"   [TargetType=TextBlock] { FontSize = 14; }
                Style x:key="Two"   [TargetType=TextBlock] { FontSize = 16; }
                Style x:key="Three" [TargetType=TextBlock] { FontSize = 18; }
            }
        `);
        // get / set pairs on the class.
        assert.match(r.js, /get One\(\) \{ return this\.Resolve\("One"\); \}/);
        assert.match(r.js, /set One\(v\) \{ this\.Set\("One", v\); \}/);
        assert.match(r.js, /get Two\(\) \{ return this\.Resolve\("Two"\); \}/);
        assert.match(r.js, /get Three\(\) \{ return this\.Resolve\("Three"\); \}/);
        // Metadata surfaces them too so the .d.ts emitter knows what
        // to declare.
        const meta = r.resourcesBlocks?.[0];
        assert.equal(meta?.name, 'A');
        assert.equal(meta?.accessors.length, 3);
        assert.deepEqual(meta?.accessors.map(a => a.name), ['One', 'Two', 'Three']);
        // ResourceForm accessor type is the runtime class — Style here.
        assert.equal(meta?.accessors[0]!.type, 'Style');
    });

    test('implicit-by-type Styles (no x:key) get no class accessor', () => {
        const r = compile(`
            resources B {
                Style [TargetType=TextBlock] { FontSize = 14; }
            }
        `);
        const meta = r.resourcesBlocks?.[0];
        assert.equal(meta?.accessors.length, 0);
        // The Style still lands in the dict — keyed by the TextBlock class.
        assert.match(r.js, /t\.Set\(TextBlock,/);
    });

    test('Template with x:key emits ControlTemplate-typed accessor', () => {
        const r = compile(`
            resources C {
                Template x:key="MyTmpl" [TargetType=Border] {
                    Border x:root {}
                }
            }
        `);
        const meta = r.resourcesBlocks?.[0];
        assert.equal(meta?.accessors[0]!.name, 'MyTmpl');
        assert.equal(meta?.accessors[0]!.type, 'ControlTemplate');
    });

    test('imports inside a block merge with last-write-wins, locals override', () => {
        const r = compile(`
            resources Child {
                import Parent from "./parent.mu.js"

                Style x:key="Override" [TargetType=TextBlock] { FontSize = 24; }
            }
        `);
        // ES import for Parent surfaces at the top of the module.
        assert.match(r.js, /import \{ Parent \} from "\.\/parent\.mu\.js";/);
        // Merge loop runs FIRST so locals override.
        assert.match(
            r.js,
            /for \(const \[k, v\] of Parent\.Clone\(\)\.Entries\(\)\) t\.Set\(k, v\);[\s\S]*t\.Set\("Override",/,
        );
    });

    test('multiple resources blocks per file emit one class each', () => {
        const r = compile(`
            resources First {
                Style x:key="X" [TargetType=TextBlock] { FontSize = 14; }
            }
            resources Second {
                Style x:key="Y" [TargetType=TextBlock] { FontSize = 16; }
            }
        `);
        assert.equal(r.resourcesBlocks?.length, 2);
        assert.match(r.js, /export class First extends ResourceDictionary/);
        assert.match(r.js, /export class Second extends ResourceDictionary/);
    });

    test('duplicate class names within a file raise an EmitError', () => {
        assert.throws(
            () => compile(`
                resources Dup { Style x:key="A" [TargetType=TextBlock] { FontSize = 14; } }
                resources Dup { Style x:key="B" [TargetType=TextBlock] { FontSize = 16; } }
            `),
            (err) => err instanceof EmitError && /duplicate `resources Dup`/.test(err.message),
        );
    });

    test('legacy `ResourceDictionary { … }` root form is rejected with migration hint', () => {
        assert.throws(
            () => compile(`
                ResourceDictionary {
                    Style x:key="A" [TargetType=TextBlock] { FontSize = 14; }
                }
            `),
            (err) => err instanceof EmitError && /resources NAME/.test(err.message),
        );
    });

    test('non-identifier x:key (e.g. with spaces) keeps the dict entry but skips the accessor', () => {
        // `dict.Resolve("Some Key")` still works; the class just can't
        // expose `dict["Some Key"]` as a typed property — the runtime
        // accessor names are bare identifiers.
        const r = compile(`
            resources Mixed {
                Style x:key="Some Key" [TargetType=TextBlock] { FontSize = 14; }
                Style x:key="Valid"    [TargetType=TextBlock] { FontSize = 16; }
            }
        `);
        const meta = r.resourcesBlocks?.[0];
        assert.equal(meta?.accessors.length, 1);
        assert.equal(meta?.accessors[0]!.name, 'Valid');
        // But the dict still carries both — `Set("Some Key", …)` is
        // emitted in Clone.
        assert.match(r.js, /t\.Set\("Some Key",/);
    });
});

describe('compile — `theme NAME { schemes: [...] defaultScheme: ... tokens { ... } ... }` block', () => {
    test('emits a class extending Theme + sibling NAMECatalog Map + NAMEResources dict + auto-register', () => {
        const js = emitted(`
            theme Material {
                import MaterialLight from "./light.mu.js"
                import MaterialDark  from "./dark.mu.js"

                schemes:       [MaterialLight, MaterialDark]
                defaultScheme: MaterialLight

                tokens {
                    @Primary   : Brush  "Primary brand color"
                    @ShapeFull : CornerRadius
                    @Space1..@Space3 : number "M3 spacing scale"
                }
                Style x:key="DemoStyle" [TargetType=TextBlock] { FontSize = 14; }
            }
        `);
        // Resources dictionary sibling — same shape as a resources block.
        assert.match(js, /export class MaterialResources extends ResourceDictionary/);
        // Sibling catalog Map with each token entry.
        assert.match(js, /export const MaterialCatalog = new Map\(\[/);
        assert.match(js, /\["Primary",\s*\{\s*type:\s*"Brush",\s*description:\s*"Primary brand color"\s*\}\]/);
        // Description-less entry omits the field.
        assert.match(js, /\["ShapeFull",\s*\{\s*type:\s*"CornerRadius"\s*\}\]/);
        // Range form expands to N entries.
        assert.match(js, /\["Space1",\s*\{\s*type:\s*"number"/);
        assert.match(js, /\["Space2",\s*\{\s*type:\s*"number"/);
        assert.match(js, /\["Space3",\s*\{\s*type:\s*"number"/);
        // Theme class with statics + ctor + Activate.
        assert.match(js, /export class Material extends Theme/);
        assert.match(js, /static Catalog = MaterialCatalog/);
        assert.match(js, /static DefaultScheme = MaterialLight/);
        assert.match(js, /static instance = new Material\(\)/);
        assert.match(js, /schemes:\s*\[MaterialLight\.instance,\s*MaterialDark\.instance\]/);
        assert.match(js, /defaultScheme:\s*"MaterialLight"/);
        assert.match(js, /static Activate\(scheme\)/);
        // Auto-register side effects.
        assert.match(js, /ThemeManager\.RegisterTheme\(Material\.instance\)/);
        assert.match(js, /Application\.RegisterDefaultTheme\(Material\)/);
        // Theme + Application imported from runtime.
        assert.match(js, /import \{[^}]*Theme[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime"/);
    });

    test('theme block without tokens is rejected', () => {
        assert.throws(
            () => compile(`
                theme T {
                    schemes:       [S]
                    defaultScheme: S
                }
            `),
            (err) => err instanceof EmitError && /tokens \{ … \} block is required/.test(err.message));
    });

    test('theme block without schemes header is rejected', () => {
        assert.throws(
            () => compile(`
                theme T {
                    defaultScheme: S
                    tokens { @X : Brush }
                }
            `),
            (err) => err instanceof EmitError && /schemes: \[\.\.\.\] header is required/.test(err.message));
    });

    test('defaultScheme must appear in schemes list', () => {
        assert.throws(
            () => compile(`
                theme T {
                    schemes:       [A, B]
                    defaultScheme: C
                    tokens { @X : Brush }
                }
            `),
            (err) => err instanceof EmitError && /defaultScheme 'C' must be one of/.test(err.message));
    });
});

describe('compile — `scheme NAME against THEME { … }` block', () => {
    test('emits a class extending Scheme with a static singleton instance', () => {
        const js = emitted(`
            scheme MaterialLight against Material {
                @Primary   = #6750A4
                @OnPrimary = #FFFFFF
                @ShapeFull = 999
            }
        `);
        assert.match(js, /export class MaterialLight extends Scheme/);
        assert.match(js, /static instance = new MaterialLight\(\)/);
        assert.match(js, /name:\s*"MaterialLight"/);
        assert.match(js, /theme:\s*"Material"/);
        assert.match(js, /tokens:\s*new Map\(\[/);
        assert.match(js, /\["Primary",/);
        // Scheme imported from the runtime.
        assert.match(js, /import \{[^}]*Scheme[^}]*\} from "@pragmatic-tech-ai\/mural\/runtime"/);
    });

    test('`basedOn theme.scheme` emits as a string field', () => {
        const js = emitted(`
            scheme FluentLight against Fluent basedOn Material.light {
                @Primary = #0078D4
            }
        `);
        assert.match(js, /basedOn:\s*"Material\.light"/);
    });

    test('non-value items in a scheme body are rejected', () => {
        assert.throws(
            () => compile(`
                scheme Bad against Demo {
                    @Primary = #6750A4
                    Style x:key="X" [TargetType=TextBlock] { FontSize = 14; }
                }
            `),
            (err) => err instanceof EmitError && /body must contain only/.test(err.message));
    });
});

describe('compile — element-node value form `Ident [Prop = val]`', () => {
    test('emits an IIFE that constructs the class and applies named-attr setters', () => {
        const js = emitted(`
            scheme S against T {
                @Elev = MaterialElevationEffect [Level = 1]
            }
        `);
        assert.match(js, /\["Elev",\s*\(\(_e\) => \{\s*_e\.Level = 1;\s*return _e;\s*\}\)\(new MaterialElevationEffect\(\)\)\]/);
        // The class name is registered as an import.
        assert.match(js, /import \{[^}]*MaterialElevationEffect[^}]*\} from "@pragmatic-tech-ai\/mural\/visual-engine"/);
    });

    test('element value with no attrs emits a bare `new Ident()`', () => {
        const js = emitted(`
            scheme S against T {
                @Empty = MaterialElevationEffect
            }
        `);
        // No attrs → plain construction (the parser stops at the bare
        // ident because there's no '[' following). Verifies the ident
        // fallthrough still works when '[' isn't present.
        assert.match(js, /\["Empty",\s*MaterialElevationEffect\]/);
    });
});
