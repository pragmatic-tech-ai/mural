import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    CompositeStyle,
    MetaData,
    MuralBase,
    PropertyTrigger,
    Setter,
    Size,
    Style,
    Element,
    type DrawingContext,
} from '../index.js';
import { resolveKey } from '../model-internals.js';
import { initTestApp } from '../../basic/tests/test-app.js';

// Styling target: two value props (Ink for conflict-resolution, Size for
// unique-contribution) and two bool props to drive triggers.
class Box extends Element
{
    static
    {
        MuralBase.RegisterProperty(Box, 'Ink',  'black', MetaData.None);
        MuralBase.RegisterProperty(Box, 'Size', 10,      MetaData.None);
        MuralBase.RegisterProperty(Box, 'Hot',  false,   MetaData.None);
        MuralBase.RegisterProperty(Box, 'Lit',  false,   MetaData.None);
    }
    public get Ink(): string { return this.get_property_value(resolveKey(this, undefined, 'Ink')); }
    public set Ink(v: string) { this.set_property_value(resolveKey(this, undefined, 'Ink'), v); }
    public get Size(): number { return this.get_property_value(resolveKey(this, undefined, 'Size')); }
    public set Size(v: number) { this.set_property_value(resolveKey(this, undefined, 'Size'), v); }
    public get Hot(): boolean { return this.get_property_value(resolveKey(this, undefined, 'Hot')); }
    public set Hot(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'Hot'), v); }
    public get Lit(): boolean { return this.get_property_value(resolveKey(this, undefined, 'Lit')); }
    public set Lit(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'Lit'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

class SubBox extends Box { }
class Other extends Element
{
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Dedicated target for the theme-base mixin test so its app-level base
// registration doesn't leak into the Box-based tests above.
class ThemedBox extends Element
{
    static
    {
        MuralBase.RegisterProperty(ThemedBox, 'Ink',  'black', MetaData.None);
        MuralBase.RegisterProperty(ThemedBox, 'Size', 10,      MetaData.None);
    }
    public get Ink(): string { return this.get_property_value(resolveKey(this, undefined, 'Ink')); }
    public set Ink(v: string) { this.set_property_value(resolveKey(this, undefined, 'Ink'), v); }
    public get Size(): number { return this.get_property_value(resolveKey(this, undefined, 'Size')); }
    public set Size(v: number) { this.set_property_value(resolveKey(this, undefined, 'Size'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

describe('CompositeStyle / Style.Combine', () => {
    test('Style.Combine returns a CompositeStyle (usable as a Style)', () => {
        const c = Style.Combine(new Style(Box, []), new Style(Box, []));
        assert.ok(c instanceof CompositeStyle);
        assert.ok(c instanceof Style);
    });

    test('merges setters from every component; rightmost wins on conflict', () => {
        const heading = new Style(Box, [
            new Setter(Box, 'Ink',  'red'),
            new Setter(Box, 'Size', 20),
        ]);
        const link = new Style(Box, [
            new Setter(Box, 'Ink', 'blue'),   // conflicts with heading.Ink
        ]);

        const c = Style.Combine(heading, link);
        c.Seal();
        const setters = c.ResolveSetters();

        assert.equal((setters.get('Box.Ink')  as Setter).value, 'blue', 'rightmost component wins');
        assert.equal((setters.get('Box.Size') as Setter).value, 20,     'unique setter from the left component survives');
    });

    test('applies end-to-end: Element.Style = Style.Combine(a, b)', () => {
        const box = new Box();
        box.Style = Style.Combine(
            new Style(Box, [new Setter(Box, 'Ink', 'red'), new Setter(Box, 'Size', 20)]),
            new Style(Box, [new Setter(Box, 'Ink', 'blue')]),
        );
        assert.equal(box.Ink,  'blue');
        assert.equal(box.Size, 20);
    });

    test('triggers from every component install and fire', () => {
        const box = new Box();
        box.Style = Style.Combine(
            new Style(Box, [], undefined, [
                new PropertyTrigger(Box, 'Hot', true, [new Setter(Box, 'Ink', 'orange')]),
            ]),
            new Style(Box, [], undefined, [
                new PropertyTrigger(Box, 'Lit', true, [new Setter(Box, 'Size', 99)]),
            ]),
        );

        assert.equal(box.Ink,  'black', 'triggers rest until their condition matches');
        assert.equal(box.Size, 10);

        box.Hot = true;
        assert.equal(box.Ink, 'orange', 'first component\'s trigger fired');

        box.Lit = true;
        assert.equal(box.Size, 99, 'second component\'s trigger fired');

        box.Hot = false;
        assert.equal(box.Ink, 'black', 'trigger deactivation unwinds');
    });

    test('mixin merge: a component does not re-assert the theme default over another\'s explicit setter', () => {
        // The correctness crux. Theme base gives Size=10; @heading overrides
        // Size=32 and touches nothing else; @link sets Ink and never mentions
        // Size. A naive flat-map merge would let @link's theme-inherited
        // Size=10 clobber @heading's explicit 32 — the mixin merge subtracts
        // theme-inherited setters by identity, so 32 survives.
        initTestApp();
        const base = new Style(ThemedBox, [
            new Setter(ThemedBox, 'Ink',  'gray'),
            new Setter(ThemedBox, 'Size', 10),
        ]);
        Application.current!.Resources.Set(ThemedBox, base);

        const heading = new Style(ThemedBox, [new Setter(ThemedBox, 'Size', 32)]);
        const link    = new Style(ThemedBox, [new Setter(ThemedBox, 'Ink',  'blue')]);

        const box = new ThemedBox();
        box.Style = Style.Combine(heading, link);

        assert.equal(box.Size, 32,    'heading\'s explicit Size is NOT clobbered by link\'s inherited default');
        assert.equal(box.Ink,  'blue', 'link\'s explicit Ink wins');
    });

    test('resolves thunk components at Seal (the deferred @key form)', () => {
        const resolved = new Style(Box, [new Setter(Box, 'Ink', 'green')]);
        const box = new Box();
        box.Style = Style.Combine(
            () => resolved,                                       // deferred component
            new Style(Box, [new Setter(Box, 'Size', 7)]),
        );
        assert.equal(box.Ink,  'green');
        assert.equal(box.Size, 7);
    });

    test('a thunk resolving to undefined is dropped (missing key)', () => {
        const box = new Box();
        box.Style = Style.Combine(
            () => undefined,                                      // absent key
            new Style(Box, [new Setter(Box, 'Ink', 'pink')]),
        );
        assert.equal(box.Ink, 'pink');
    });

    test('TargetType is the most-derived shared type; applies to that subclass', () => {
        const box = new SubBox();
        // Box + SubBox are one inheritance line — most-derived is SubBox.
        box.Style = Style.Combine(
            new Style(Box,    [new Setter(Box, 'Ink', 'red')]),
            new Style(SubBox, [new Setter(Box, 'Size', 5)]),
        );
        assert.equal(box.Ink,  'red');
        assert.equal(box.Size, 5);
    });

    test('composing incompatible TargetTypes throws at Seal', () => {
        const c = Style.Combine(new Style(Box, []), new Style(Other, []));
        assert.throws(() => c.Seal(), /incompatible TargetType/);
    });
});
