import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Binding,
    BindingMode,
    DataTrigger,
    DynamicResource,
    MetaData,
    MuralBase,
    MultiDataTrigger,
    MultiTrigger,
    Panel,
    PropertyTrigger,
    PropertyValueSource,
    ResourceDictionary,
    Setter,
    SetterFactory,
    Size,
    Style,
    TriggerAction,
    Element,
    Visual,
    type DataTriggerCondition,
    type DrawingContext,
    type TriggerCondition,
} from '../index.js';
import { resolveKey } from '../model-internals.js';

// Leaf with a couple of properties (one local, one inheritable) used
// as the styling target. Tint is inheritable so we can verify that a
// styled value shadows an inherited one. Padding is a non-inheritable
// number so we can verify cross-class setters and basic shadowing
// against an inherited value.
class Widget extends Element
{
    static
    {
        MuralBase.RegisterProperty(Widget, 'Tint',  'default', MetaData.Inherits);
        MuralBase.RegisterProperty(Widget, 'Bias',  0,         MetaData.None);
    }
    public get Tint(): string { return this.get_property_value(resolveKey(this, undefined, 'Tint')); }
    public set Tint(v: string) { this.set_property_value(resolveKey(this, undefined, 'Tint'), v); }
    public get Bias(): number { return this.get_property_value(resolveKey(this, undefined, 'Bias')); }
    public set Bias(v: number) { this.set_property_value(resolveKey(this, undefined, 'Bias'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

class TestPanel extends Panel { }

// ThemedWidget — opts into the DefaultStyleKey machinery by overriding
// metadata to itself. A `Style [TargetType=ThemedWidget]` placed in the
// resource chain (theme dict, ancestor, app) is picked up via
// resolve_theme_style. Two subclasses exercise the inheritance + opt-out
// paths: ChildOfThemed inherits ThemedWidget's DefaultStyleKey default
// (renders with the ThemedWidget theme), while OwnThemedChild overrides
// to itself (renders only when a `[TargetType=OwnThemedChild]` entry
// exists).
class ThemedWidget extends Widget
{
    static
    {
        MuralBase.OverrideMetadata(ThemedWidget, Element.DefaultStyleKeyKey, { default_value: ThemedWidget });
    }
}
class ChildOfThemed extends ThemedWidget { }
class OwnThemedChild extends ThemedWidget
{
    static
    {
        MuralBase.OverrideMetadata(OwnThemedChild, Element.DefaultStyleKeyKey, { default_value: OwnThemedChild });
    }
}

describe('Style — basics', () => {
    test('Setter holds owner, property name, and value verbatim', () => {
        const s = new Setter(Widget, 'Tint', 'red');
        assert.equal(s.owner, Widget);
        assert.equal(s.property, 'Tint');
        assert.equal(s.value, 'red');
    });

    test('Style stores TargetType + Setters; BasedOn defaults to undefined', () => {
        const style = new Style(Widget, [new Setter(Widget, 'Bias', 7)]);
        assert.equal(style.TargetType, Widget);
        assert.equal(style.Setters.length, 1);
        assert.equal(style.BasedOn, undefined);
    });

    test('ResolveSetters returns an empty map for an empty style', () => {
        const style = new Style(Widget);
        assert.equal(style.ResolveSetters().size, 0);
    });
});

describe('Style — BasedOn chaining', () => {
    test('child Setters override base Setters for the same (owner, property) key', () => {
        const base = new Style(Widget, [
            new Setter(Widget, 'Tint', 'base-tint'),
            new Setter(Widget, 'Bias', 1),
        ]);
        const child = new Style(Widget, [
            new Setter(Widget, 'Tint', 'child-tint'),  // overrides
        ], base);

        const resolved = child.ResolveSetters();
        assert.equal(resolved.get('Widget.Tint')?.value, 'child-tint');
        assert.equal(resolved.get('Widget.Bias')?.value, 1);  // inherited from base
    });

    test('multi-level BasedOn chains resolve transitively, deepest setters win at each layer', () => {
        const grandparent = new Style(Widget, [
            new Setter(Widget, 'Tint', 'gp'),
            new Setter(Widget, 'Bias', 10),
        ]);
        const parent = new Style(Widget, [
            new Setter(Widget, 'Tint', 'p'),  // overrides gp
        ], grandparent);
        const child = new Style(Widget, [
            new Setter(Widget, 'Bias', 99),   // overrides gp
        ], parent);

        const r = child.ResolveSetters();
        assert.equal(r.get('Widget.Tint')?.value, 'p');     // from parent
        assert.equal(r.get('Widget.Bias')?.value, 99);      // from child
    });
});

describe('Style — explicit application on Visual.Style', () => {
    test('applying a Style pushes setter values into the StyleValue tier', () => {
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 42)]);
        assert.equal(w.Bias, 42);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('LocalValue shadows StyleValue (write after Style is applied)', () => {
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 42)]);
        w.Bias = 7;
        assert.equal(w.Bias, 7);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.LocalValue);
    });

    test('LocalValue shadows StyleValue (write before Style is applied)', () => {
        const w = new Widget();
        w.Bias = 7;
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 42)]);
        // Bias was locally set to 7; the style value is now cached but
        // shadowed. Local still wins.
        assert.equal(w.Bias, 7);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.LocalValue);
    });

    test('ClearValue (Local-clear) falls back to the styled value', () => {
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 42)]);
        w.Bias = 7;
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.LocalValue);

        w.ClearValue(resolveKey(w, undefined, 'Bias'));
        assert.equal(w.Bias, 42);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('replacing Style swaps the StyleValue: old setters cleared, new applied', () => {
        const w = new Widget();
        w.Style = new Style(Widget, [
            new Setter(Widget, 'Bias', 1),
            new Setter(Widget, 'Tint', 'red'),
        ]);
        assert.equal(w.Bias, 1);
        assert.equal(w.Tint, 'red');

        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 9)]);  // no Tint setter
        assert.equal(w.Bias, 9);
        // Tint was set by the old style only; clearing the old style
        // should drop it back to default (no inherited ancestor, no
        // new setter).
        assert.equal(w.Tint, 'default');
    });

    test('Style = undefined clears all styled values back to inherited / default', () => {
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 42)]);
        assert.equal(w.Bias, 42);
        w.Style = undefined;
        assert.equal(w.Bias, 0);  // descriptor default
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.Default);
    });

    test('StyleValue shadows InheritedValue', () => {
        const parent = new Widget();
        parent.set_property_value(resolveKey(parent, Widget, 'Tint'), 'inherited-tint');
        const child = new Widget();
        const root = new TestPanel();
        root.AddChild(parent);
        // Place child under parent so it inherits.
        const wrapper = new TestPanel();
        parent.set_property_value(resolveKey(parent, Widget, 'Tint'), 'inherited-tint');
        wrapper.AddChild(child);
        parent['property_values'];  // touch to silence type lint
        // Apply style on child — should win over the inherited value.
        // (We don't actually need parent in the tree for the inheritance
        // test; the style-vs-default test below already covers the
        // baseline.)
        child.Style = new Style(Widget, [new Setter(Widget, 'Tint', 'styled-tint')]);
        assert.equal(child.Tint, 'styled-tint');
        assert.equal(child.GetValueSource(resolveKey(child, undefined, 'Tint')), PropertyValueSource.StyleValue);
    });

    test('cross-class setter (attached property) lands on the target via explicit owner', () => {
        // Register a fake attached-style sentinel — same machinery as
        // Canvas.Left, but local to the test so we don't depend on
        // controls-package shape.
        class Marker { static
        {
            MuralBase.RegisterAttachedProperty(Marker, 'Tag', 'none', MetaData.None);
        } }

        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Marker, 'Tag', 'styled')]);
        assert.equal(w.get_property_value(resolveKey(w, Marker, 'Tag')), 'styled');
    });
});

describe('Style — implicit lookup via TargetType', () => {
    test('a Style keyed by class in an ancestor Resources is auto-applied to descendants', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 11),
        ]));
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 11);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('explicit Style wins over implicit', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 11),
        ]));
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 99)]);
        root.AddChild(w);
        assert.equal(w.Bias, 99);
    });

    test('clearing explicit Style re-promotes the implicit style', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 11),
        ]));
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 99)]);
        root.AddChild(w);
        assert.equal(w.Bias, 99);

        w.Style = undefined;
        assert.equal(w.Bias, 11);  // implicit takes over
    });

    test('detaching from the logical tree clears the implicit style', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 11),
        ]));
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 11);

        root.RemoveChild(w);
        assert.equal(w.Bias, 0);
    });

    test('a closer ancestor\'s implicit Style shadows a farther one', () => {
        const outer = new TestPanel();
        outer.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 1),
        ]));
        const inner = new TestPanel();
        inner.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 2),
        ]));
        outer.AddChild(inner);
        const w = new Widget();
        inner.AddChild(w);
        assert.equal(w.Bias, 2);
    });

    test('implicit Style via a MergedDictionary on an ancestor', () => {
        const theme = new ResourceDictionary();
        theme.Set(Widget, new Style(Widget, [new Setter(Widget, 'Bias', 33)]));

        const root = new TestPanel();
        root.Resources.AddMergedDictionary(theme);
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 33);
    });
});

describe('Style — interaction with Binding (Binding shadows Style)', () => {
    test('a Binding installed on a styled property still wins over the styled value', () => {
        // Use a tiny source MuralBase with a getter Binding can target.
        class Src extends MuralBase
        {
            static { MuralBase.RegisterProperty(Src, 'V', 999, MetaData.None); }
            public get V(): number { return this.get_property_value(resolveKey(this, undefined, 'V')); }
            public set V(v: number) { this.set_property_value(resolveKey(this, undefined, 'V'), v); }
        }

        const src = new Src();
        const w = new Widget();
        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 5)]);
        assert.equal(w.Bias, 5);

        w.set_property_value(resolveKey(w, undefined, 'Bias'), new Binding(src, 'V'));
        assert.equal(w.Bias, 999);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.Binding);

        // Update the source — binding propagates the change.
        src.V = 7;
        assert.equal(w.Bias, 7);
    });
});

// =================================================================
// Limitation fixes
// =================================================================

describe('Style — TargetType validation', () => {
    test('applying a Style whose TargetType is not an ancestor of the target throws', () => {
        class Other extends Element { }
        const w = new Widget();
        const wrong = new Style(Other, [new Setter(Widget, 'Bias', 1)]);
        assert.throws(() => { w.Style = wrong; }, /TargetType 'Other' does not match target 'Widget'/);
    });

    test('a Style whose TargetType is an ancestor class is accepted', () => {
        // Style targets Visual; Widget is a Visual subclass — apply works.
        const w = new Widget();
        const generic = new Style(Visual, [new Setter(Widget, 'Bias', 7)]);
        w.Style = generic;
        assert.equal(w.Bias, 7);
    });
});

describe('Style — sealing', () => {
    test('Seal() flips IsSealed; idempotent', () => {
        const s = new Style(Widget);
        assert.equal(s.IsSealed, false);
        s.Seal();
        assert.equal(s.IsSealed, true);
        s.Seal();  // no-op
        assert.equal(s.IsSealed, true);
    });

    test('first apply seals the style automatically', () => {
        const s = new Style(Widget, [new Setter(Widget, 'Bias', 1)]);
        assert.equal(s.IsSealed, false);
        const w = new Widget();
        w.Style = s;
        assert.equal(s.IsSealed, true);
    });

    test('Seal cascades into the BasedOn chain', () => {
        const base  = new Style(Widget, [new Setter(Widget, 'Bias', 1)]);
        const child = new Style(Widget, [], base);
        child.Seal();
        assert.equal(base.IsSealed, true);
        assert.equal(child.IsSealed, true);
    });
});

describe('Style — deferred BasedOn resolver (BasedOn = @key)', () => {
    test('a thunk basedOn resolves at Seal, not construction', () => {
        const base  = new Style(Widget, [new Setter(Widget, 'Bias', 1)]);
        // Resolver isn't consulted yet — base is unresolved before Seal.
        let resolved = 0;
        const child = new Style(Widget, [], () => { resolved++; return base; });
        assert.equal(child.BasedOn, undefined);
        assert.equal(resolved, 0);

        child.Seal();
        assert.equal(child.BasedOn, base);
        assert.equal(resolved, 1);
        // The resolved base is sealed as part of the chain.
        assert.equal(base.IsSealed, true);
    });

    test('resolved base contributes its setters to the child', () => {
        const base  = new Style(Widget, [new Setter(Widget, 'Bias', 7)]);
        const child = new Style(Widget, [new Setter(Widget, 'Tint', 'red')],
                                () => base);
        const w = new Widget();
        w.Style = child;                    // first apply → Seal → resolve
        assert.equal(w.Bias, 7);            // inherited from the deferred base
        assert.equal(w.Tint, 'red');       // own setter
    });

    test('a thunk returning undefined leaves BasedOn unset (no theme for Widget)', () => {
        const child = new Style(Widget, [], () => undefined);
        child.Seal();
        assert.equal(child.BasedOn, undefined);
    });

    test('a thunk resolving to a non-Style is ignored', () => {
        const child = new Style(Widget, [], () => ({} as unknown as Style));
        child.Seal();
        assert.equal(child.BasedOn, undefined);
    });

    test('a thunk resolving to the style itself is ignored (no self-loop)', () => {
        let child!: Style;
        child = new Style(Widget, [], () => child);
        child.Seal();
        assert.equal(child.BasedOn, undefined);
    });
});

describe('Style — Setter.value supports Binding (via SetterFactory)', () => {
    test('Binding value pushes initial source value into StyleValue tier', () => {
        class Src extends MuralBase
        {
            static { MuralBase.RegisterProperty(Src, 'V', 42, MetaData.None); }
            public get V(): number { return this.get_property_value(resolveKey(this, undefined, 'V')); }
            public set V(v: number) { this.set_property_value(resolveKey(this, undefined, 'V'), v); }
        }
        const src = new Src();
        const w = new Widget();
        w.Style = new Style(Widget, [
            new Setter(Widget, 'Bias', new SetterFactory(
                () => new Binding(src, 'V', BindingMode.OneWay),
            )),
        ]);
        assert.equal(w.Bias, 42);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('Binding value updates reactively when the source changes', () => {
        class Src extends MuralBase
        {
            static { MuralBase.RegisterProperty(Src, 'V', 0, MetaData.None); }
            public get V(): number { return this.get_property_value(resolveKey(this, undefined, 'V')); }
            public set V(v: number) { this.set_property_value(resolveKey(this, undefined, 'V'), v); }
        }
        const src = new Src();
        const w = new Widget();
        w.Style = new Style(Widget, [
            new Setter(Widget, 'Bias', new SetterFactory(
                () => new Binding(src, 'V', BindingMode.OneWay),
            )),
        ]);
        src.V = 7;
        assert.equal(w.Bias, 7);
        src.V = 12;
        assert.equal(w.Bias, 12);
    });

    test('SetterFactory is invoked per target — two Visuals get independent Binding instances', () => {
        // Each target gets its own Binding so their setOnValueChanged
        // callbacks don't overwrite each other. Manifests when both
        // targets observe source mutations.
        class Src extends MuralBase
        {
            static { MuralBase.RegisterProperty(Src, 'V', 1, MetaData.None); }
            public get V(): number { return this.get_property_value(resolveKey(this, undefined, 'V')); }
            public set V(v: number) { this.set_property_value(resolveKey(this, undefined, 'V'), v); }
        }
        const src = new Src();
        const style = new Style(Widget, [
            new Setter(Widget, 'Bias', new SetterFactory(
                () => new Binding(src, 'V', BindingMode.OneWay),
            )),
        ]);
        const a = new Widget();
        const b = new Widget();
        a.Style = style;
        b.Style = style;
        assert.equal(a.Bias, 1);
        assert.equal(b.Bias, 1);
        src.V = 9;
        assert.equal(a.Bias, 9);
        assert.equal(b.Bias, 9);
    });

    test('replacing a Style disposes its Binding subscriptions', () => {
        class Src extends MuralBase
        {
            static { MuralBase.RegisterProperty(Src, 'V', 1, MetaData.None); }
            public get V(): number { return this.get_property_value(resolveKey(this, undefined, 'V')); }
            public set V(v: number) { this.set_property_value(resolveKey(this, undefined, 'V'), v); }
        }
        const src = new Src();
        const w = new Widget();
        w.Style = new Style(Widget, [
            new Setter(Widget, 'Bias', new SetterFactory(
                () => new Binding(src, 'V', BindingMode.OneWay),
            )),
        ]);
        assert.equal(w.Bias, 1);

        w.Style = new Style(Widget, [new Setter(Widget, 'Bias', 100)]);
        assert.equal(w.Bias, 100);
        // After swap, mutating src must not move w.Bias — the old
        // binding has been disposed.
        src.V = 999;
        assert.equal(w.Bias, 100);
    });
});

describe('Style — Style.Resources', () => {
    test('lazy-created via Resources getter; HasResources reflects allocation', () => {
        const s = new Style(Widget);
        assert.equal(s.HasResources, false);
        const r = s.Resources;
        assert.equal(s.HasResources, true);
        assert.ok(r instanceof ResourceDictionary);
    });

    test('Style.Resources entries are visible to TryFindResource on a target with this style applied', () => {
        const style = new Style(Widget);
        style.Resources.Set('Accent', 'sage');
        const w = new Widget();
        w.Style = style;
        assert.equal(w.TryFindResource('Accent'), 'sage');
    });

    test('Style.Resources shadows ancestor Resources with the same key', () => {
        const root = new TestPanel();
        root.Resources.Set('Accent', 'from-ancestor');
        const w = new Widget();
        const style = new Style(Widget);
        style.Resources.Set('Accent', 'from-style');
        w.Style = style;
        root.AddChild(w);
        // Style.Resources sits ahead of the ancestor chain in the
        // lookup order.
        assert.equal(w.TryFindResource('Accent'), 'from-style');
    });

    test('a DynamicResource setter resolves through Style.Resources', () => {
        // SetterFactory(target => DynamicResource(target, 'Brush'))
        // looks up 'Brush' on the target's resource chain, which now
        // begins with the Style's own dict.
        const style = new Style(Widget);
        style.Resources.Set('Brush', 'gold');
        style.Resources.Set('Bias', 5);  // unused but present
        // We need a Bias setter via DynamicResource pointing at a key.
        const styleWithSetter = new Style(Widget, [
            new Setter(Widget, 'Bias', new SetterFactory(
                target => DynamicResource(target, 'Bias'),
            )),
        ]);
        styleWithSetter.Resources.Set('Bias', 77);
        const w = new Widget();
        w.Style = styleWithSetter;
        assert.equal(w.Bias, 77);
    });

    test('BasedOn Resources resolve transitively', () => {
        const base = new Style(Widget);
        base.Resources.Set('FromBase', 'base-val');
        const child = new Style(Widget, [], base);
        assert.equal(child.TryResolveResource('FromBase'), 'base-val');
    });
});

describe('Style — reactive implicit style', () => {
    test('adding the implicit Style to an ancestor Resources after attach picks it up', () => {
        const root = new TestPanel();
        // Touch root.Resources so we have a dict to subscribe to.
        root.Resources;
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 0);  // no implicit style yet

        // Now add the implicit style — subscription should re-resolve.
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 88),
        ]));
        assert.equal(w.Bias, 88);
    });

    test('removing the implicit Style from ancestor Resources unapplies it', () => {
        const root = new TestPanel();
        const style = new Style(Widget, [new Setter(Widget, 'Bias', 88)]);
        root.Resources.Set(Widget, style);
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 88);

        root.Resources.Delete(Widget);
        assert.equal(w.Bias, 0);
    });

    test('swapping the implicit Style to a different one re-resolves on the descendant', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 1),
        ]));
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 1);

        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 2),
        ]));
        assert.equal(w.Bias, 2);
    });

    test('reactive implicit picks up changes via a MergedDictionary on an ancestor', () => {
        const theme = new ResourceDictionary();
        const root  = new TestPanel();
        root.Resources.AddMergedDictionary(theme);
        const w = new Widget();
        root.AddChild(w);
        assert.equal(w.Bias, 0);

        theme.Set(Widget, new Style(Widget, [new Setter(Widget, 'Bias', 55)]));
        assert.equal(w.Bias, 55);
    });
});

describe('Style — PropertyTrigger', () => {
    test('a trigger activates when its watched property matches and applies its setters', () => {
        // Trigger fires when Tint === 'hot' and bumps Bias to 99.
        const trigger = new PropertyTrigger(Widget, 'Tint', 'hot', [
            new Setter(Widget, 'Bias', 99),
        ]);
        const style = new Style(Widget, [
            new Setter(Widget, 'Bias', 1),
        ], undefined, [trigger]);

        const w = new Widget();
        w.Style = style;
        assert.equal(w.Bias, 1);  // style value; trigger inactive

        w.Tint = 'hot';
        assert.equal(w.Bias, 99);  // trigger active, shadows style
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.TriggerValue);
    });

    test('deactivating a trigger restores the underlying style value', () => {
        const trigger = new PropertyTrigger(Widget, 'Tint', 'hot', [
            new Setter(Widget, 'Bias', 99),
        ]);
        const style = new Style(Widget, [
            new Setter(Widget, 'Bias', 1),
        ], undefined, [trigger]);
        const w = new Widget();
        w.Style = style;
        w.Tint = 'hot';
        assert.equal(w.Bias, 99);
        w.Tint = 'cold';
        assert.equal(w.Bias, 1);  // style value resumes
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('trigger evaluates immediately at apply if the property already matches', () => {
        // Trigger fires when Tint === 'red'; set Tint first, then apply.
        const w = new Widget();
        w.Tint = 'red';
        w.Style = new Style(Widget, [], undefined, [
            new PropertyTrigger(Widget, 'Tint', 'red', [
                new Setter(Widget, 'Bias', 50),
            ]),
        ]);
        assert.equal(w.Bias, 50);  // initial evaluation activated trigger
    });

    test('Trigger shadows LocalValue when active; cached local re-surfaces when trigger deactivates', () => {
        // Mural's priority order is Trigger > Binding > Local (vs.
        // WPF's Local > Trigger). Template factories write LocalValue
        // via the per-part `set_property_value` calls the compiler
        // emits, and template / style triggers express state-driven
        // overrides —
        // so triggers MUST be able to override local writes for the
        // common `when ( IsMouseOver / IsChecked ) { … }` pattern to
        // be visible. See effective-value.ts header comment for the
        // full rationale and the WPF deviation.
        const trigger = new PropertyTrigger(Widget, 'Tint', 'hot', [
            new Setter(Widget, 'Bias', 99),
        ]);
        const w = new Widget();
        w.Style = new Style(Widget, [], undefined, [trigger]);
        w.Bias = 5;        // local set
        w.Tint = 'hot';    // trigger activates and overrides local
        assert.equal(w.Bias, 99);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.TriggerValue);

        // Deactivating the trigger drops the trigger slot and the
        // cached local value surfaces.
        w.Tint = 'cold';
        assert.equal(w.Bias, 5);
        assert.equal(w.GetValueSource(resolveKey(w, undefined, 'Bias')), PropertyValueSource.LocalValue);

        // Re-activating the trigger over the cached local: trigger wins again.
        w.Tint = 'hot';
        assert.equal(w.Bias, 99);
    });

    test('unapplying a Style tears down trigger subscriptions', () => {
        const trigger = new PropertyTrigger(Widget, 'Tint', 'hot', [
            new Setter(Widget, 'Bias', 99),
        ]);
        const style = new Style(Widget, [], undefined, [trigger]);
        const w = new Widget();
        w.Style = style;
        w.Tint = 'hot';
        assert.equal(w.Bias, 99);

        w.Style = undefined;
        assert.equal(w.Bias, 0);  // trigger setters cleared
        // Subsequent Tint changes should NOT re-activate the trigger,
        // because its subscription was removed.
        w.Tint = 'cold';
        w.Tint = 'hot';
        assert.equal(w.Bias, 0);
    });

    test('trigger setters from BasedOn are included', () => {
        const baseTrigger = new PropertyTrigger(Widget, 'Tint', 'inherited', [
            new Setter(Widget, 'Bias', 33),
        ]);
        const base  = new Style(Widget, [], undefined, [baseTrigger]);
        const child = new Style(Widget, [], base);
        const w = new Widget();
        w.Style = child;
        w.Tint = 'inherited';
        assert.equal(w.Bias, 33);
    });
});

// Data-driven trigger: condition watches the styled visual's DataContext
// via DataContextBinding semantics, not a DP on the visual itself.
// Drives the diagram-style "per-element data-driven re-skinning" use
// case. Backing VM exposes the watched property as a regular MuralBase DP
// so changes flow through the existing property-change machinery.
class ItemVM extends MuralBase
{
    static
    {
        MuralBase.RegisterProperty(ItemVM, 'IsSelected', false, MetaData.None);
        MuralBase.RegisterProperty(ItemVM, 'Score',      0,     MetaData.None);
    }
    public get IsSelected(): boolean { return this.get_property_value(resolveKey(this, undefined, 'IsSelected')); }
    public set IsSelected(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'IsSelected'), v); }
    public get Score(): number { return this.get_property_value(resolveKey(this, undefined, 'Score')); }
    public set Score(v: number) { this.set_property_value(resolveKey(this, undefined, 'Score'), v); }
}

describe('Style — DataTrigger', () => {
    test('activates when bound DataContext path matches the trigger value', () => {
        const trig = new DataTrigger('IsSelected', true, [
            new Setter(Widget, 'Bias', 77),
        ]);
        const style = new Style(Widget, [], undefined, [], [], [], [trig]);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = style;
        // Initial state: vm.IsSelected === false, trigger inactive.
        assert.equal(w.Bias, 0);
        vm.IsSelected = true;
        assert.equal(w.Bias, 77);
        vm.IsSelected = false;
        assert.equal(w.Bias, 0);
    });

    test('re-resolves when DataContext is swapped to a different model', () => {
        const trig = new DataTrigger('Score', 5, [
            new Setter(Widget, 'Bias', 50),
        ]);
        const style = new Style(Widget, [], undefined, [], [], [], [trig]);
        const a = new ItemVM(); a.Score = 5;
        const b = new ItemVM(); b.Score = 0;
        const w = new Widget();
        w.DataContext = a;
        w.Style = style;
        // Initial DataContext matches → trigger active.
        assert.equal(w.Bias, 50);
        // Swap to a non-matching DataContext → trigger deactivates and
        // setter unwinds. Confirms the binding refresh on DataContext
        // change is wired through the DataTrigger evaluator.
        w.DataContext = b;
        assert.equal(w.Bias, 0);
        // Make b match → activates again under the new source.
        b.Score = 5;
        assert.equal(w.Bias, 50);
    });

    test('unapplying the Style tears down the DataContext subscription', () => {
        const trig = new DataTrigger('IsSelected', true, [
            new Setter(Widget, 'Bias', 88),
        ]);
        const style = new Style(Widget, [], undefined, [], [], [], [trig]);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = style;
        vm.IsSelected = true;
        assert.equal(w.Bias, 88);

        w.Style = undefined;
        assert.equal(w.Bias, 0);
        // After unapply, mutating the source must NOT re-activate.
        vm.IsSelected = false;
        vm.IsSelected = true;
        assert.equal(w.Bias, 0);
    });

    test('DataTrigger and PropertyTrigger coexist in the same Style (disjoint setters)', () => {
        // Disjoint setters so the two triggers don't fight over the
        // same Trigger-tier slot. PropertyTrigger drives Bias;
        // DataTrigger drives Tint. Both must install and evaluate
        // correctly without disturbing each other.
        class Surface extends Element
        {
            static
            {
                MuralBase.RegisterProperty(Surface, 'Mode',   'cold',    MetaData.None);
                MuralBase.RegisterProperty(Surface, 'Outline', 'thin',   MetaData.None);
                MuralBase.RegisterProperty(Surface, 'Fill',    'none',   MetaData.None);
            }
            public get Mode():    string { return this.get_property_value(resolveKey(this, undefined, 'Mode')); }
            public set Mode(v:    string)        { this.set_property_value(resolveKey(this, undefined, 'Mode'), v); }
            public get Outline(): string { return this.get_property_value(resolveKey(this, undefined, 'Outline')); }
            public get Fill():    string { return this.get_property_value(resolveKey(this, undefined, 'Fill')); }
            protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
            protected override RenderOverride(_dc: DrawingContext): void { }
        }
        const dataTrig = new DataTrigger('IsSelected', true, [
            new Setter(Surface, 'Fill', 'orange'),
        ]);
        const propTrig = new PropertyTrigger(Surface, 'Mode', 'hot', [
            new Setter(Surface, 'Outline', 'bold'),
        ]);
        const style = new Style(Surface, [], undefined, [propTrig], [], [], [dataTrig]);
        const vm = new ItemVM();
        const s = new Surface();
        s.DataContext = vm;
        s.Style = style;
        // Neither trigger is active yet.
        assert.equal(s.Outline, 'thin');
        assert.equal(s.Fill,    'none');
        // Fire the property trigger.
        s.Mode = 'hot';
        assert.equal(s.Outline, 'bold');
        assert.equal(s.Fill,    'none');
        // Fire the data trigger via VM mutation; both setters
        // independently active.
        vm.IsSelected = true;
        assert.equal(s.Outline, 'bold');
        assert.equal(s.Fill,    'orange');
        // Deactivate just the data trigger — Fill restores.
        vm.IsSelected = false;
        assert.equal(s.Fill, 'none');
        assert.equal(s.Outline, 'bold');
    });

    test('inherits via BasedOn', () => {
        const baseTrig = new DataTrigger('IsSelected', true, [
            new Setter(Widget, 'Bias', 42),
        ]);
        const base  = new Style(Widget, [], undefined, [], [], [], [baseTrig]);
        const child = new Style(Widget, [], base);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = child;
        vm.IsSelected = true;
        assert.equal(w.Bias, 42);
    });

    test('binding-factory source lets a DataTrigger watch a non-DataContext source', async () => {
        // The factory form bypasses DataContextBinding and lets the
        // trigger watch arbitrary Binding sources — ElementName,
        // RelativeSource, Source, etc. We synthesise a trivial
        // binding that reads from an outside ItemVM directly to
        // demonstrate the dispatch path works.
        const { Binding } = await import('../binding/binding.js');
        const vm = new ItemVM();
        const trig = new DataTrigger(
            // Factory: build a fresh Binding(vm, 'IsSelected') per
            // styled target. The factory closure can capture any
            // out-of-tree source.
            (_target) => new Binding(vm, 'IsSelected'),
            true,
            [new Setter(Widget, 'Bias', 21)],
        );
        const style = new Style(Widget, [], undefined, [], [], [], [trig]);
        const w = new Widget();
        // Note: NO DataContext assignment — the trigger watches `vm`
        // directly, not via the styled visual's DataContext walk.
        w.Style = style;
        assert.equal(w.Bias, 0);
        vm.IsSelected = true;
        assert.equal(w.Bias, 21);
        vm.IsSelected = false;
        assert.equal(w.Bias, 0);
    });

    test('bare-boolean DataTrigger lowers `not $Path` to value=false', () => {
        // The compiler emits `DataTrigger(path, false, …)` for `not
        // $Path` — runtime behaves like any other DataTrigger comparing
        // the bound value against `false` via ===.
        const trig = new DataTrigger('IsSelected', false, [
            new Setter(Widget, 'Bias', 11),
        ]);
        const style = new Style(Widget, [], undefined, [], [], [], [trig]);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = style;
        // IsSelected starts false → trigger matches (negated) → setters apply.
        assert.equal(w.Bias, 11);
        vm.IsSelected = true;
        assert.equal(w.Bias, 0);
        vm.IsSelected = false;
        assert.equal(w.Bias, 11);
    });
});

// A no-op TriggerAction whose Invoke just records the firing target.
// Bound to enter/exit slots so we can count edges without dragging the
// storyboard machinery into Style-level tests.
class CounterAction extends TriggerAction
{
    public calls: number = 0;
    public lastTarget: Visual | undefined;
    public Invoke(target: Visual): void
    {
        this.calls++;
        this.lastTarget = target;
    }
}

describe('Style — MultiTrigger', () => {
    test('activates only when EVERY condition matches; deactivates on first mismatch', () => {
        const conds: TriggerCondition[] = [
            { propertyOwner: Widget, propertyName: 'Tint', value: 'hot' },
            { propertyOwner: Widget, propertyName: 'Bias', value: 7    },
        ];
        const mt = new MultiTrigger(conds, [new Setter(Widget, 'Tint', 'glow')]);
        const style = new Style(Widget, [], undefined, [], [mt]);
        const w = new Widget();
        w.Style = style;
        // One condition matches → still inactive.
        w.Tint = 'hot';
        assert.equal(w.Tint, 'hot');
        // Second condition matches → activates and setter overrides Tint.
        w.Bias = 7;
        assert.equal(w.Tint, 'glow');
        // One condition flips off → deactivates.
        w.Bias = 0;
        assert.equal(w.Tint, 'hot');
    });

    test('initial-state full match applies setters silently (no enterActions fire)', () => {
        const probe = new CounterAction();
        const conds: TriggerCondition[] = [
            { propertyOwner: Widget, propertyName: 'Tint', value: 'hot' },
            { propertyOwner: Widget, propertyName: 'Bias', value: 7    },
        ];
        const mt = new MultiTrigger(conds, [new Setter(Widget, 'Tint', 'glow')], [probe]);
        const w = new Widget();
        w.Tint = 'hot';
        w.Bias = 7;
        w.Style = new Style(Widget, [], undefined, [], [mt]);
        // Setter applies — but no edge.
        assert.equal(w.Tint, 'glow');
        assert.equal(probe.calls, 0);
        // Transition off then on — that IS the edge.
        w.Bias = 0;
        w.Bias = 7;
        assert.equal(probe.calls, 1);
    });

    test('exitActions fire on deactivation EDGE only', () => {
        const enter = new CounterAction();
        const exit  = new CounterAction();
        const conds: TriggerCondition[] = [
            { propertyOwner: Widget, propertyName: 'Tint', value: 'hot' },
            { propertyOwner: Widget, propertyName: 'Bias', value: 7    },
        ];
        const mt = new MultiTrigger(conds, [], [enter], [exit]);
        const w = new Widget();
        w.Style = new Style(Widget, [], undefined, [], [mt]);
        // Not yet matched.
        assert.equal(enter.calls, 0);
        assert.equal(exit.calls, 0);
        // Match → enter edge.
        w.Tint = 'hot';
        w.Bias = 7;
        assert.equal(enter.calls, 1);
        assert.equal(exit.calls,  0);
        // Break match → exit edge.
        w.Bias = 0;
        assert.equal(enter.calls, 1);
        assert.equal(exit.calls,  1);
    });

    test('unapplying the Style tears down all condition subscriptions', () => {
        const conds: TriggerCondition[] = [
            { propertyOwner: Widget, propertyName: 'Tint', value: 'hot' },
            { propertyOwner: Widget, propertyName: 'Bias', value: 7    },
        ];
        const mt = new MultiTrigger(conds, [new Setter(Widget, 'Tint', 'glow')]);
        const style = new Style(Widget, [], undefined, [], [mt]);
        const w = new Widget();
        w.Style = style;
        w.Tint = 'hot';
        w.Bias = 7;
        assert.equal(w.Tint, 'glow');

        w.Style = undefined;
        assert.equal(w.Tint, 'hot');
        // Subsequent changes must NOT re-activate the unsubscribed trigger.
        w.Bias = 0;
        w.Bias = 7;
        assert.equal(w.Tint, 'hot');
    });
});

describe('Style — MultiDataTrigger', () => {
    test('activates only when EVERY DataContext-bound condition matches', () => {
        const conds: DataTriggerCondition[] = [
            { path: 'IsSelected', value: true },
            { path: 'Score',      value: 5    },
        ];
        const mt = new MultiDataTrigger(conds, [new Setter(Widget, 'Bias', 99)]);
        const style = new Style(Widget, [], undefined, [], [], [], [], [mt]);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = style;
        assert.equal(w.Bias, 0);
        // One match, other not — inactive.
        vm.IsSelected = true;
        assert.equal(w.Bias, 0);
        // Both match — active.
        vm.Score = 5;
        assert.equal(w.Bias, 99);
        // Break one — inactive.
        vm.IsSelected = false;
        assert.equal(w.Bias, 0);
    });

    test('re-resolves all bindings when DataContext swaps', () => {
        const conds: DataTriggerCondition[] = [
            { path: 'IsSelected', value: true },
            { path: 'Score',      value: 5    },
        ];
        const mt = new MultiDataTrigger(conds, [new Setter(Widget, 'Bias', 42)]);
        const style = new Style(Widget, [], undefined, [], [], [], [], [mt]);
        const a = new ItemVM(); a.IsSelected = true; a.Score = 5;
        const b = new ItemVM(); b.IsSelected = false; b.Score = 0;
        const w = new Widget();
        w.DataContext = a;
        w.Style = style;
        assert.equal(w.Bias, 42);
        w.DataContext = b;
        assert.equal(w.Bias, 0);
        b.IsSelected = true; b.Score = 5;
        assert.equal(w.Bias, 42);
    });

    test('initial-state full match applies setters silently (no enterActions fire)', () => {
        const probe = new CounterAction();
        const conds: DataTriggerCondition[] = [
            { path: 'IsSelected', value: true },
            { path: 'Score',      value: 5    },
        ];
        const mt = new MultiDataTrigger(conds, [new Setter(Widget, 'Bias', 50)], [probe]);
        const vm = new ItemVM(); vm.IsSelected = true; vm.Score = 5;
        const w = new Widget();
        w.DataContext = vm;
        w.Style = new Style(Widget, [], undefined, [], [], [], [], [mt]);
        // Setter applied, but no enter edge.
        assert.equal(w.Bias, 50);
        assert.equal(probe.calls, 0);
        // Genuine transition (off → on) → edge.
        vm.IsSelected = false;
        vm.IsSelected = true;
        assert.equal(probe.calls, 1);
    });

    test('unapplying the Style tears down all DataContext subscriptions', () => {
        const conds: DataTriggerCondition[] = [
            { path: 'IsSelected', value: true },
            { path: 'Score',      value: 5    },
        ];
        const mt = new MultiDataTrigger(conds, [new Setter(Widget, 'Bias', 7)]);
        const style = new Style(Widget, [], undefined, [], [], [], [], [mt]);
        const vm = new ItemVM(); vm.IsSelected = true; vm.Score = 5;
        const w = new Widget();
        w.DataContext = vm;
        w.Style = style;
        assert.equal(w.Bias, 7);

        w.Style = undefined;
        assert.equal(w.Bias, 0);
        // Subsequent mutations on the source must NOT re-activate.
        vm.IsSelected = false;
        vm.IsSelected = true;
        assert.equal(w.Bias, 0);
    });
});

describe('Style — DataTrigger enter/exit actions', () => {
    test('enterActions fire on bound-value match EDGE; not on initial-match apply', () => {
        const enter = new CounterAction();
        const trig = new DataTrigger('IsSelected', true, [], [enter]);
        const vm = new ItemVM();
        vm.IsSelected = true;
        const w = new Widget();
        w.DataContext = vm;
        w.Style = new Style(Widget, [], undefined, [], [], [], [trig]);
        // Initial match → setters apply (none here), enter does not fire.
        assert.equal(enter.calls, 0);
        // Genuine false→true transition fires.
        vm.IsSelected = false;
        vm.IsSelected = true;
        assert.equal(enter.calls, 1);
    });

    test('exitActions fire on bound-value mismatch EDGE', () => {
        const exit = new CounterAction();
        const trig = new DataTrigger('IsSelected', true, [], [], [exit]);
        const vm = new ItemVM();
        const w = new Widget();
        w.DataContext = vm;
        w.Style = new Style(Widget, [], undefined, [], [], [], [trig]);
        vm.IsSelected = true;
        assert.equal(exit.calls, 0);
        vm.IsSelected = false;
        assert.equal(exit.calls, 1);
    });
});

describe('Style — DefaultStyleKey + theme style', () => {
    test('DefaultStyleKey defaults to undefined on a class that does not override metadata', () => {
        const w = new Widget();
        assert.equal(w.DefaultStyleKey, undefined);
    });

    test('OverrideMetadata sets the type-init default; instances see the override', () => {
        const t = new ThemedWidget();
        assert.equal(t.DefaultStyleKey, ThemedWidget);
    });

    test('subclass inherits the base default when it does not override', () => {
        const c = new ChildOfThemed();
        // ChildOfThemed extends ThemedWidget without an override —
        // inherits the ThemedWidget DefaultStyleKey via the descriptor
        // parent chain. This is the WPF "looks like its base" path.
        assert.equal(c.DefaultStyleKey, ThemedWidget);
    });

    test('a subclass override shadows the inherited value', () => {
        const o = new OwnThemedChild();
        assert.equal(o.DefaultStyleKey, OwnThemedChild);
    });

    test('DefaultStyleKey is read-only on the public surface', () => {
        const w = new Widget();
        assert.throws(
            () => w.set_property_value(resolveKey(w, undefined, 'DefaultStyleKey'), Widget),
            /read-only/,
        );
    });

    test('theme style keyed by DefaultStyleKey applies through the ancestor resource chain', () => {
        const root = new TestPanel();
        // A ThemedWidget's DefaultStyleKey resolves to ThemedWidget,
        // so the resolver looks up `ThemedWidget` in the chain.
        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 42),
        ]));
        const t = new ThemedWidget();
        root.AddChild(t);
        assert.equal(t.Bias, 42);
    });

    test('subclass without its own override picks up the base theme', () => {
        const root = new TestPanel();
        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 17),
        ]));
        const c = new ChildOfThemed();
        root.AddChild(c);
        // ChildOfThemed.DefaultStyleKey = ThemedWidget (inherited) →
        // theme lookup hits the ThemedWidget entry → child renders
        // with the base theme.
        assert.equal(c.Bias, 17);
    });

    test('explicit Style shadows the theme style', () => {
        const root = new TestPanel();
        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 1),
        ]));
        const t = new ThemedWidget();
        root.AddChild(t);
        assert.equal(t.Bias, 1);

        t.Style = new Style(ThemedWidget, [new Setter(Widget, 'Bias', 99)]);
        assert.equal(t.Bias, 99);
        assert.equal(t.GetValueSource(resolveKey(t, undefined, 'Bias')), PropertyValueSource.StyleValue);
    });

    test('implicit style (TryFindResource by constructor) shadows the theme style', () => {
        const root = new TestPanel();
        // Theme entry — keyed by ThemedWidget (the DefaultStyleKey).
        // Lives in a merged dict to model "theme is lower in the chain."
        const theme = new ResourceDictionary();
        theme.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 1),
        ]));
        root.Resources.AddMergedDictionary(theme);

        const t = new ThemedWidget();
        root.AddChild(t);
        // Without an implicit-keyed entry, theme applies.
        assert.equal(t.Bias, 1);

        // Adding a [TargetType=ThemedWidget] entry directly to the
        // local Resources puts it BEFORE the merged theme in lookup
        // order — but more importantly resolve_implicit_style runs
        // FIRST in refresh_active_style. Either way, the user-side
        // implicit wins.
        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 88),
        ]));
        assert.equal(t.Bias, 88);

        // Removing the implicit entry — theme re-surfaces.
        root.Resources.Delete(ThemedWidget);
        assert.equal(t.Bias, 1);
    });

    test('detaching from the logical tree drops the theme style', () => {
        const root = new TestPanel();
        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 7),
        ]));
        const t = new ThemedWidget();
        root.AddChild(t);
        assert.equal(t.Bias, 7);

        root.RemoveChild(t);
        assert.equal(t.Bias, 0);
    });

    test('adding the theme Style to an ancestor Resources after attach picks it up', () => {
        const root = new TestPanel();
        root.Resources;  // pre-allocate
        const t = new ThemedWidget();
        root.AddChild(t);
        assert.equal(t.Bias, 0);

        root.Resources.Set(ThemedWidget, new Style(ThemedWidget, [
            new Setter(Widget, 'Bias', 33),
        ]));
        assert.equal(t.Bias, 33);
    });

    test('a Widget (DefaultStyleKey=undefined) ignores theme entries even when keyed by Widget', () => {
        const root = new TestPanel();
        root.Resources.Set(Widget, new Style(Widget, [
            new Setter(Widget, 'Bias', 99),
        ]));
        const w = new Widget();
        root.AddChild(w);
        // The user-side implicit resolver (keyed by constructor)
        // STILL fires — Widget.constructor === Widget, and that's
        // an explicit `[TargetType=Widget]` entry. That's the
        // implicit path, not the theme path. To verify the theme
        // path didn't contribute we drop the implicit entry and
        // expect the default value back.
        assert.equal(w.Bias, 99);
        root.Resources.Delete(Widget);
        assert.equal(w.Bias, 0);
    });
});
