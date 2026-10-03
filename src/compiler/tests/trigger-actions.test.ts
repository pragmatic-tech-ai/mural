import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compile } from '../compile.js';

function emitted(src: string): string
{
    return compile(src).js;
}

describe('compile — declarative EventTrigger + BeginStoryboard', () => {
    test('Style with `on Click { BeginStoryboard { DoubleAnimation[...] } }` emits EventTrigger + Storyboard factory', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Button]{
                        on Click {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Width, From=80, To=240, Duration=400]
                            }
                        }
                    }
                }
            }
        `);

        // EventTrigger registered with the routed-event name "Click".
        assert.match(js, /new EventTrigger\("Click", \[_act\d+\]\);/);

        // The action is a BeginStoryboardAction whose factory builds a
        // Storyboard with sb.Add(_target, "Width", new DoubleAnimation(…)).
        assert.match(js, /new BeginStoryboardAction\(\(_target\) => \{/);
        assert.match(js, /const _sb\d+ = new Storyboard\(\);/);
        assert.match(
            js,
            /_sb\d+\.Add\(_target, "Width", new DoubleAnimation\(\{ From: 80, To: 240, Duration: 400 \}\)\);/,
        );

        // Style constructor picks up the new 6th positional arg for
        // event triggers when at least one is present.
        assert.match(
            js,
            /new Style\(Button, \[\], undefined, \[\], \[\], \[_evt\d+\]\);/,
        );
    });

    test('Style WITHOUT event triggers keeps the legacy 5-arg Style constructor shape', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Button]{
                        Fill = #ff0000;
                    }
                }
            }
        `);
        // No 6th arg — preserves existing snapshot-test compatibility.
        assert.match(
            js,
            /new Style\(Button, \[_setter\d+\], undefined, \[\], \[\]\);/,
        );
        assert.doesNotMatch(js, /EventTrigger|BeginStoryboardAction|Storyboard/);
    });

    test('Multiple animations in one BeginStoryboard bundle into a single Storyboard', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Button]{
                        on Click {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Width, To=240, Duration=400]
                                DoubleAnimation[TargetProperty=Height, To=80, Duration=400, BeginTime=100]
                            }
                        }
                    }
                }
            }
        `);
        // Both animations added to the SAME Storyboard variable.
        const adds = js.match(/_sb(\d+)\.Add\(/g) ?? [];
        assert.equal(adds.length, 2);
        const sbVars = new Set(adds.map(s => s.split('.')[0]));
        assert.equal(sbVars.size, 1, 'both animations bind to the same Storyboard');
    });

    test('Multiple `on Click { ... }` blocks emit multiple EventTriggers', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Button]{
                        on Click {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Width, To=200, Duration=300]
                            }
                        }
                        on Click {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Height, To=40, Duration=300]
                            }
                        }
                    }
                }
            }
        `);
        const evts = js.match(/new EventTrigger\("Click"/g) ?? [];
        assert.equal(evts.length, 2);
    });

    test('TargetProperty accepts a bare identifier OR a quoted string', () => {
        const jsIdent = emitted(`
            Application{ resources: {
                Style[TargetType=Button]{
                    on Click { BeginStoryboard { DoubleAnimation[TargetProperty=Width, To=100, Duration=200] } }
                }
            }}
        `);
        assert.match(jsIdent, /\.Add\(_target, "Width", /);

        const jsString = emitted(`
            Application{ resources: {
                Style[TargetType=Button]{
                    on Click { BeginStoryboard { DoubleAnimation[TargetProperty="Width", To=100, Duration=200] } }
                }
            }}
        `);
        assert.match(jsString, /\.Add\(_target, "Width", /);
    });

    test('Animation declaration without TargetProperty is rejected with a clear error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Style[TargetType=Button]{
                        on Click { BeginStoryboard { DoubleAnimation[To=100, Duration=200] } }
                    }
                }}
            `),
            /TargetProperty/,
        );
    });

    test('Empty BeginStoryboard body (no animations) is a clear error', () => {
        assert.throws(
            () => emitted(`
                Application{ resources: {
                    Style[TargetType=Button]{
                        on Click { BeginStoryboard { } }
                    }
                }}
            `),
            /at least one animation/,
        );
    });

    test('Setters and event triggers can coexist in one style', () => {
        const js = emitted(`
            Application{
                resources: {
                    Style[TargetType=Button]{
                        Fill = #1976d2;
                        on Click {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Width, To=240, Duration=400]
                            }
                        }
                    }
                }
            }
        `);
        assert.match(js, /new Setter\(Button, "Fill", /);
        assert.match(js, /new EventTrigger\("Click"/);
        // Setters arg is non-empty AND event-triggers arg is non-empty.
        assert.match(
            js,
            /new Style\(Button, \[_setter\d+\], undefined, \[\], \[\], \[_evt\d+\]\);/,
        );
    });
});

describe('compile — ControlTemplate event triggers', () => {
    test('ControlTemplate with `on Click { … }` passes the EventTrigger to the ControlTemplate ctor', () => {
        const js = emitted(`
            Application{
                resources: {
                    Template x:key="FancyBorder"[TargetType=Border]{
                        Border[Padding=(8)]{}
                        on Loaded {
                            BeginStoryboard {
                                DoubleAnimation[TargetProperty=Width, To=200, Duration=100]
                            }
                        }
                    }
                }
            }
        `);
        // EventTrigger is constructed inside the ControlTemplate IIFE.
        assert.match(js, /new EventTrigger\("Loaded", \[_act\d+\]\);/);
        // ControlTemplate ctor receives both the triggers list (empty
        // here) and the eventTriggers list.
        assert.match(js, /new ControlTemplate\(_factory, \[\], \[_evt\d+\]\);/);
    });
});

describe('compile — DataTemplate MultiDataTrigger', () => {
    test('DataTemplate with `when ( $A and $B )` emits a TemplateMultiDataTrigger', () => {
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            Application{
                resources: {
                    DataTemplate x:key="T" [DataType=FooVM] {
                        TextBlock [Text="row"]
                        when ( $IsSelected and $IsHot ) {
                            TextBlock.Foreground = #ff0000;
                        }
                    }
                }
            }
        `);
        assert.match(
            js,
            /new TemplateMultiDataTrigger\(\[\{ path: "IsSelected", value: true \}, \{ path: "IsHot", value: true \}\], _tplSet\d+\);/,
        );
        // DataTemplate ctor receives the multi-data-trigger array as
        // the 6th positional arg.
        assert.match(
            js,
            /new DataTemplate\(_factory, FooVM, \[\], \[\], \[\], \[_tplMultiDataTrig\d+\]\);/,
        );
    });

    test('DataTemplate trigger body with `Behaviors { … }` lowers Attach/Detach into enter/exit', () => {
        // The `partitionTriggerBody` helper routes behaviors-block items
        // through `compileTriggeredBehavior`, producing paired
        // AttachBehaviorAction / DetachBehaviorAction trigger actions.
        // The template trigger then carries them as enterActions /
        // exitActions, firing on activation / deactivation edges.
        const js = emitted(`
            import FooVM from "./foo-vm.mjs"
            import StubBehavior from "./stub.mjs"
            Application{
                resources: {
                    DataTemplate x:key="T" [DataType=FooVM] {
                        TextBlock [Text="row"]
                        when ( $IsActive ) {
                            TextBlock.Foreground = #ff0000;
                            Behaviors {
                                StubBehavior
                            }
                        }
                    }
                }
            }
        `);
        // Behavior lowered to paired Attach/Detach actions. The factory
        // closure takes the firing Visual as `_target` so the Behavior's
        // own attribute bindings can resolve against the host.
        assert.match(js, /new AttachBehaviorAction\(\(_target\) => \{/);
        assert.match(js, /new DetachBehaviorAction\(_attBeh\d+\);/);
        // Template trigger ctor receives enter/exit action arrays.
        assert.match(
            js,
            /new TemplateDataTrigger\("IsActive", true, _tplSet\d+, undefined, _tplEnter\d+, _tplExit\d+\);/,
        );
    });
});
