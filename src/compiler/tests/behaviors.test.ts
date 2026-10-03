import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { compile, instantiate } from '../compile.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import {
    Application,
    Behavior,
    MuralBase,
    MetaData,
    type Visual,
} from '../../runtime/index.js';
import { Border } from '../../basic/index.js';

// Stub Behavior subclass exercised by the markup→runtime tests. Mirrors
// the contract real authors follow: subclass Behavior, register DPs for
// per-instance config, override OnAttached to wire whatever the
// behavior actually does.
class StubBehavior extends Behavior
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        StubBehavior, 'Label', '', MetaData.None);

    public attachedTo: Visual | undefined;

    public get Label(): string  { return this.get_property_value(StubBehavior.LabelKey); }
    public set Label(v: string) { this.set_property_value(StubBehavior.LabelKey, v); }

    public override OnAttached(visual: Visual): void
    {
        this.attachedTo = visual;
    }
}

const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine, StubBehavior };

// Top-of-source import declaration so the compiler resolves
// `StubBehavior` against a real (but stubbed) module path; instantiate()
// pulls the actual class off CTX at run time.
const STUB_IMPORT = `import StubBehavior from "./stub-behavior.mjs"\n`;

function emitted(src: string): string
{
    return compile(STUB_IMPORT + src).js;
}

function instantiateTest(src: string): unknown
{
    return instantiate(STUB_IMPORT + src, CTX);
}

describe('compile — Behaviors block', () => {
    test('Behaviors { … } block lowers to AddBehavior calls on the parent', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root [Padding=(8)] {
                    Behaviors {
                        StubBehavior [Label="hello"]
                    }
                }
            } }
        `);
        assert.match(js, /new StubBehavior\(\)/);
        assert.match(
            js,
            /\.set_property_value\(\w+\.LabelKey, "hello"\);/,
        );
        // The behavior var is attached to the parent Border via
        // AddBehavior — emitted right after the behavior's setters.
        assert.match(js, /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
    });

    test('a Behaviors block on an element that already has children keeps both', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root {
                    Behaviors {
                        StubBehavior [Label="b"]
                    }
                    TextBlock x:name="inside" [Text="Hello"]
                }
            } }
        `);
        // Border still receives its child via the default slot.
        assert.match(js, /\.SetChild\(_textBlock\d+\)/);
        // AND the behavior is attached.
        assert.match(js, /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
    });

    test('Behaviors block with attributes on the block element itself is rejected', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Border x:root {
                        Behaviors [Foo="bar"] {
                            StubBehavior
                        }
                    }
                } }
            `),
            /Behaviors.*attributes/i,
        );
    });

    test('Empty Behaviors block compiles to a no-op', () => {
        // Doesn't throw; doesn't emit any AddBehavior calls.
        const js = emitted(`
            Application{ resources: {
                Border x:root {
                    Behaviors {}
                }
            } }
        `);
        assert.doesNotMatch(js, /AddBehavior/);
    });
});

describe('compile — .Behaviors: colon-section form', () => {
    test('.Behaviors: lowers to AddBehavior, same as the braces form', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root [Padding=(8)] {
                    .Behaviors: {
                        StubBehavior [Label="hello"]
                    }
                }
            } }
        `);
        assert.match(js, /new StubBehavior\(\)/);
        assert.match(js, /\.set_property_value\(\w+\.LabelKey, "hello"\);/);
        assert.match(js, /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
    });

    test('.Behaviors: emits the same AddBehavior as the braces form', () => {
        const colon = emitted(`
            Application{ resources: {
                Border x:root { .Behaviors: { StubBehavior [Label="x"] } }
            } }
        `);
        const braces = emitted(`
            Application{ resources: {
                Border x:root { Behaviors { StubBehavior [Label="x"] } }
            } }
        `);
        assert.match(colon,  /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
        assert.match(braces, /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
    });

    test('.Behaviors: coexists with the default-slot child', () => {
        const js = emitted(`
            Application{ resources: {
                Border x:root {
                    .Behaviors: { StubBehavior [Label="b"] }
                    TextBlock x:name="inside" [Text="Hello"]
                }
            } }
        `);
        assert.match(js, /\.SetChild\(_textBlock\d+\)/);
        assert.match(js, /_border\d+\.AddBehavior\(_stubBehavior\d+\);/);
    });

    test('a non-element entry in .Behaviors: is rejected', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Border x:root { .Behaviors: { @Nope = #fff } }
                } }
            `),
            /only accepts Behavior element entries/,
        );
    });
});

describe('instantiate — Behaviors end-to-end', () => {
    beforeEach(() => { Application.current = null; });

    test('OnAttached fires with the parent Visual; DP setters apply before attach', () => {
        const app = instantiateTest(`
            Application{ resources: {
                Border x:root {
                    Behaviors {
                        StubBehavior [Label="alpha"]
                    }
                }
            } }
        `) as Application;
        const border = app.Resources.Root as Border;
        assert.ok(border instanceof Border);
        assert.equal(border.Behaviors.length, 1);
        const b = border.Behaviors[0] as StubBehavior;
        assert.ok(b instanceof StubBehavior);
        assert.equal(b.attachedTo, border);
        // DP setter ran BEFORE OnAttached (so the behavior's
        // configuration is populated by the time it wires anything up).
        assert.equal(b.Label, 'alpha');
    });

    test('Multiple behaviors attach in source order', () => {
        const app = instantiateTest(`
            Application{ resources: {
                Border x:root {
                    Behaviors {
                        StubBehavior [Label="first"]
                        StubBehavior [Label="second"]
                    }
                }
            } }
        `) as Application;
        const border = app.Resources.Root as Border;
        assert.equal(border.Behaviors.length, 2);
        assert.equal((border.Behaviors[0] as StubBehavior).Label, 'first');
        assert.equal((border.Behaviors[1] as StubBehavior).Label, 'second');
    });
});

// Pins backlog 9.2: Behaviors { … } inside a when() trigger body
// lowers to paired AttachBehaviorAction / DetachBehaviorAction in the
// trigger's enterActions / exitActions arrays.
describe('compile — triggered Behaviors block', () => {
    test('Behaviors block inside when() emits Attach + Detach action pair', () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( IsMouseOver ){
                        Behaviors { StubBehavior [Label="hover"] }
                    }
                }
            }}
        `);
        // Imports — both action types pulled in.
        assert.match(js, /AttachBehaviorAction/);
        assert.match(js, /DetachBehaviorAction/);
        // Attach action with factory closure that constructs the
        // behavior fresh and returns it. The closure takes the firing
        // Visual as `_target` so the Behavior's own attribute bindings
        // can resolve against the host (see behaviorHostVar).
        assert.match(
            js,
            /new AttachBehaviorAction\(\(_target\) => \{[\s\S]*new StubBehavior\(\)[\s\S]*return [^;]+;[\s\S]*\}\)/,
        );
        // Detach action wraps the attach action handle.
        assert.match(js, /new DetachBehaviorAction\(_attBeh\d+\)/);
        // PropertyTrigger gets the 6-arg form with both action arrays
        // populated.
        assert.match(
            js,
            /new PropertyTrigger\(Border, "IsMouseOver", true, _sArr\d+, _enter\d+, _exit\d+\)/,
        );
    });

    test('Behaviors block at Style body level (outside when()) is a compile error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Style[TargetType=Border]{
                        Behaviors { StubBehavior }
                    }
                }}
            `),
            /Behaviors \{ … \} block is only allowed inside a when\(…\) trigger body/,
        );
    });

    test('Multiple behaviors in one trigger body emit multiple Attach/Detach pairs', () => {
        const js = emitted(`
            Application{ resources: {
                Style[TargetType=Border]{
                    when( IsMouseOver ){
                        Behaviors {
                            StubBehavior [Label="a"]
                            StubBehavior [Label="b"]
                        }
                    }
                }
            }}
        `);
        const attaches = js.match(/new AttachBehaviorAction\(/g) ?? [];
        const detaches = js.match(/new DetachBehaviorAction\(/g) ?? [];
        assert.equal(attaches.length, 2);
        assert.equal(detaches.length, 2);
    });
});
