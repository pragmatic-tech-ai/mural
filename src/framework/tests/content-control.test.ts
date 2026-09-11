import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Color, MetaData, MuralBase, Rect, Size, Element, Visual, type DrawingContext } from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { Pen, SolidColorBrush, FontWeight } from '../../visual-engine/index.js';
import { Border, ContentPresenter, ControlTemplate, TemplateBinding, DataTemplate, TextBlock } from '../../basic/index.js';
import { findDataTemplateForType } from '../../basic/templates/data-template.js';
import { ContentControl } from '@pragmatic-tech-ai/mural/framework';

// Test-side accessors for Visual's protected parent / templatedParent
// getters. Production API keeps them encapsulated.
function visualParentOf(v: Visual | undefined): Visual | undefined
{
    if (v === undefined) return undefined;
    return (v as unknown as { visualParent: Visual | undefined }).visualParent;
}
function logicalParentOf(v: Visual | undefined): Visual | undefined
{
    if (v === undefined) return undefined;
    return (v as unknown as { logicalParent: Visual | undefined }).logicalParent;
}

// A minimal leaf Visual used as Content — just a fixed-size box so
// Measure / Arrange assertions are predictable. Property registration
// covers the inheritance flow test below.
class Leaf extends Element
{
    static {
        // Inheritable property — proves walk_inherited rides logical, not visual.
        MuralBase.RegisterProperty(Leaf, 'Tint', 'default', MetaData.Inherits);
    }

    constructor(private box: Size = new Size(10, 10)) { super(); }

    public get Tint(): string { return this.get_property_value(resolveKey(this, undefined, 'Tint')); }
    public set Tint(value: string) { this.set_property_value(resolveKey(this, undefined, 'Tint'), value); }

    protected override MeasureOverride(_a: Size): Size { return this.box; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Helper to construct a template that wraps Content in a Border with
// a ContentPresenter inside. Mimics the WPF "Button with a Border
// surround" template shape.
function borderTemplate(): ControlTemplate
{
    return new ControlTemplate(_templatedParent => {
        const border = new Border();
        const presenter = new ContentPresenter();
        border.SetChild(presenter);
        return border;
    });
}

describe('ContentControl + ControlTemplate', () => {
    test('without a Template, the control has no visual children even if Content is set', () => {
        const cc = new ContentControl();
        cc.Content = new Leaf();
        assert.equal(cc.visualChildren.length, 0);
        // Content is still in the logical tree.
        assert.equal(cc.logicalChildren.length, 1);
    });

    test('applying a Template installs the template root as the visual child', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        assert.equal(cc.visualChildren.length, 1);
        assert.ok(cc.visualChildren[0] instanceof Border);
    });

    test('the trees diverge for slotted Content', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();

        const leaf = new Leaf();
        cc.Content = leaf;

        // Logical parent walk: leaf → ContentControl (directly).
        assert.equal(logicalParentOf(leaf), cc);

        // Visual parent walk: leaf → ContentPresenter → Border → ContentControl.
        const visualP1 = visualParentOf(leaf);
        assert.ok(visualP1 instanceof ContentPresenter);
        const visualP2 = visualParentOf(visualP1);
        assert.ok(visualP2 instanceof Border);
        const visualP3 = visualParentOf(visualP2);
        assert.equal(visualP3, cc);

        // The trees are genuinely different instances at the immediate parent.
        assert.notEqual(logicalParentOf(leaf), visualParentOf(leaf));
    });

    test('property value inheritance flows through the logical tree (skipping the template)', () => {
        // The payoff: inheritance behaves as if the template weren't there.
        // Setting Tint on the ContentControl reaches the Leaf via Leaf's
        // logical parent — even though visually the Leaf is two levels
        // deep inside the template.
        const cc = new ContentControl();
        MuralBase.RegisterProperty(ContentControl, 'Tint', 'default', MetaData.Inherits);
        cc.Template = borderTemplate();

        const leaf = new Leaf();
        cc.Content = leaf;

        cc.set_property_value(resolveKey(cc, Leaf, 'Tint'), 'crimson');
        assert.equal(leaf.Tint, 'crimson');
    });

    test('template-internal Visuals have templatedParent set to the control', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const border = cc.visualChildren[0] as Border;
        assert.equal(border.templatedParent, cc);
        const presenter = border.child as ContentPresenter;
        assert.equal(presenter.templatedParent, cc);
    });

    test('consumer-supplied Content does NOT have templatedParent set', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const leaf = new Leaf();
        cc.Content = leaf;
        // markTemplated runs over the template subtree at Apply time —
        // BEFORE the leaf is slotted — so the leaf never gets stamped.
        assert.equal(leaf.templatedParent, undefined);
    });

    test('re-templating preserves the Content as the same instance', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const leaf = new Leaf();
        cc.Content = leaf;
        assert.equal(logicalParentOf(leaf), cc);

        // Swap in a fresh template. Logical tree shouldn't change.
        cc.Template = borderTemplate();
        assert.equal(cc.Content, leaf);                  // same instance
        assert.equal(logicalParentOf(leaf), cc);         // still logical child of cc
        // Visual parent is the NEW presenter (different instance).
        assert.ok(visualParentOf(leaf) instanceof ContentPresenter);
    });

    test('clearing Template detaches the visual tree but keeps Content logically attached', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const leaf = new Leaf();
        cc.Content = leaf;

        cc.Template = undefined;
        assert.equal(cc.visualChildren.length, 0);
        assert.equal(cc.Content, leaf);
        assert.equal(logicalParentOf(leaf), cc);
        // Content has no visual home now.
        assert.equal(visualParentOf(leaf), undefined);
    });

    test('Measure / Arrange delegate to the template root', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        cc.Content = new Leaf(new Size(40, 20));

        cc.Measure(new Size(100, 100));
        assert.equal(cc.DesiredSize.Width,  40);
        assert.equal(cc.DesiredSize.Height, 20);

        cc.Arrange(new Rect(0, 0, 40, 20));
        // Template root (Border) got the full slot.
        const border = cc.visualChildren[0]!;
        assert.equal(border.ArrangedRect.Width,  40);
        assert.equal(border.ArrangedRect.Height, 20);
    });

    test('replacing Content swaps the presenter slot to the new instance', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const a = new Leaf();
        const b = new Leaf();
        cc.Content = a;
        const presenter = visualParentOf(a) as ContentPresenter;
        assert.equal(presenter.visualChildren[0], a);

        cc.Content = b;
        assert.equal(presenter.visualChildren[0], b);
        // Old content has no visual or logical parent now.
        assert.equal(visualParentOf(a),  undefined);
        assert.equal(logicalParentOf(a), undefined);
    });

    // ----------------------------------------------------------------
    // Template-internal inheritance
    // ----------------------------------------------------------------

    test('template internals inherit from the templated control via templatedParent fallback', () => {
        // A template that contains a Leaf as a static template-internal
        // element (not via ContentPresenter). It has no logical parent
        // — its inheritance must walk through templatedParent to reach
        // the ContentControl where Tint is set.
        const template = new ControlTemplate(_tp => new Leaf());
        const cc = new ContentControl();
        cc.set_property_value(resolveKey(cc, Leaf, 'Tint'), 'royalblue');
        cc.Template = template;

        const inner = cc.visualChildren[0] as Leaf;
        // _refresh_inheritance_subtree was called by rebuildTemplate after
        // attach, so the value is already pulled in.
        assert.equal(inner.Tint, 'royalblue');
    });

    test('changing a value on the templated control AFTER template is applied propagates to template internals', () => {
        const template = new ControlTemplate(_tp => new Leaf());
        const cc = new ContentControl();
        cc.Template = template;

        const inner = cc.visualChildren[0] as Leaf;
        assert.equal(inner.Tint, 'default');  // no value set yet

        cc.set_property_value(resolveKey(cc, Leaf, 'Tint'), 'crimson');
        assert.equal(inner.Tint, 'crimson');
    });

    test('template internals nested under template root also inherit', () => {
        // Border > Leaf via SetChild — the Leaf has logicalParent = Border,
        // Border has logicalParent = undefined but templatedParent = cc.
        // Inheritance walk: Leaf → Border (logical) → cc (templated).
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            const leaf = new Leaf();
            b.SetChild(leaf);
            return b;
        });
        const cc = new ContentControl();
        cc.Template = template;
        cc.set_property_value(resolveKey(cc, Leaf, 'Tint'), 'amber');

        const border = cc.visualChildren[0] as Border;
        const nestedLeaf = border.child as Leaf;
        assert.equal(nestedLeaf.Tint, 'amber');
    });

    // ----------------------------------------------------------------
    // TemplateBinding
    // ----------------------------------------------------------------

    // ----------------------------------------------------------------
    // Namescopes — per-template named-element scoping
    // ----------------------------------------------------------------

    test('GetTemplateChild resolves a named template part', () => {
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'PART_Background';
            b.SetChild(new ContentPresenter());
            return b;
        });
        const cc = new ContentControl();
        cc.Template = template;

        const part = cc.GetTemplateChild('PART_Background');
        assert.ok(part instanceof Border);
        assert.equal(part, cc.visualChildren[0]);
    });

    test('FindName from a template-internal Visual walks to the template root namescope', () => {
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'PART_Outer';
            const presenter = new ContentPresenter();
            presenter.Name = 'PART_Inner';
            b.SetChild(presenter);
            return b;
        });
        const cc = new ContentControl();
        cc.Template = template;

        const inner = cc.GetTemplateChild('PART_Inner');
        assert.ok(inner instanceof ContentPresenter);
        // Calling FindName from the inner visual itself resolves in the
        // same scope (walking up logical ancestors).
        assert.equal(inner.FindName('PART_Outer'), cc.visualChildren[0]);
        assert.equal(inner.FindName('PART_Inner'), inner);
    });

    test('the same Name in two different template instances resolves to different Visuals', () => {
        // Per-instance NameScope means PART_Background in template A
        // and template B are independent. Two controls each get their
        // own Border, each registered under PART_Background in their
        // own scope.
        const tpl = () => new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'PART_Background';
            b.SetChild(new ContentPresenter());
            return b;
        });
        const cc1 = new ContentControl();
        cc1.Template = tpl();
        const cc2 = new ContentControl();
        cc2.Template = tpl();

        const a = cc1.GetTemplateChild('PART_Background');
        const b = cc2.GetTemplateChild('PART_Background');
        assert.notEqual(a, b);
        assert.equal(a, cc1.visualChildren[0]);
        assert.equal(b, cc2.visualChildren[0]);
    });

    test('FindName returns undefined for a name not registered in any enclosing scope', () => {
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'PART_A';
            return b;
        });
        const cc = new ContentControl();
        cc.Template = template;
        assert.equal(cc.GetTemplateChild('PART_B'), undefined);
    });

    test('consumer-supplied Content does NOT see template-internal names', () => {
        // The slotted Content has logicalParent = ContentControl, not
        // the template root, so its FindName walk skips the template's
        // NameScope entirely.
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'PART_Background';
            b.SetChild(new ContentPresenter());
            return b;
        });
        const cc = new ContentControl();
        cc.Template = template;
        const slotted = new Leaf();
        cc.Content = slotted;

        assert.equal(slotted.FindName('PART_Background'), undefined);
    });

    test('duplicate Name in the same template throws at Apply time', () => {
        const template = new ControlTemplate(_tp => {
            const b = new Border();
            b.Name = 'DUP';
            const presenter = new ContentPresenter();
            presenter.Name = 'DUP';
            b.SetChild(presenter);
            return b;
        });
        const cc = new ContentControl();
        assert.throws(() => { cc.Template = template; }, /already registered/);
    });

    test('TemplateBinding wires a template-internal property to the templated control', () => {
        // A template whose Border.Background is bound to the templated
        // control's own (Background) — defined on ContentControl below.
        MuralBase.RegisterProperty(ContentControl, 'Background', undefined, MetaData.Render);

        const template = new ControlTemplate(tp => {
            const b = new Border();
            b.set_property_value(resolveKey(b, undefined, 'Fill'), TemplateBinding(tp, 'Background'));
            b.Stroke = new Pen(new SolidColorBrush(Color.Black), 1);
            return b;
        });

        const cc = new ContentControl();
        cc.Template = template;

        const blue = new SolidColorBrush(Color.Blue);
        cc.set_property_value(resolveKey(cc, undefined, 'Background'), blue);

        const border = cc.visualChildren[0] as Border;
        assert.equal(border.Fill, blue);

        // Changing the source pushes the new value to the bound target.
        const red = new SolidColorBrush(Color.Red);
        cc.set_property_value(resolveKey(cc, undefined, 'Background'), red);
        assert.equal(border.Fill, red);
    });

    // ----------------------------------------------------------------
    // Resources — Visual.Resources + FindResource walking logical tree
    // ----------------------------------------------------------------

    test('TryFindResource resolves a key set on an ancestor', () => {
        const cc = new ContentControl();
        cc.Resources.Set('Accent', 'royalblue');
        cc.Template = borderTemplate();
        const leaf = new Leaf();
        cc.Content = leaf;
        assert.equal(leaf.TryFindResource('Accent'), 'royalblue');
    });

    test('a closer ancestor shadows a farther one (same key, different value)', () => {
        const outer = new ContentControl();
        outer.Resources.Set('Accent', 'outer-blue');
        outer.Template = borderTemplate();

        const inner = new ContentControl();
        inner.Resources.Set('Accent', 'inner-red');
        inner.Template = borderTemplate();
        outer.Content = inner;

        const leaf = new Leaf();
        inner.Content = leaf;

        // Closest wins — inner's Accent shadows outer's.
        assert.equal(leaf.TryFindResource('Accent'), 'inner-red');
    });

    test('template-internal Visuals see resources defined on the templated control', () => {
        // Same templatedParent fallback as inheritance — a template-
        // internal Border can resolve a resource set on the
        // ContentControl it was generated for.
        const template = new ControlTemplate(_tp => new Border());
        const cc = new ContentControl();
        cc.Resources.Set('Tone', 'sage');
        cc.Template = template;

        const innerBorder = cc.visualChildren[0]!;
        assert.equal(innerBorder.TryFindResource('Tone'), 'sage');
    });

    test('TryFindResource returns undefined when no ancestor has the key', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        const leaf = new Leaf();
        cc.Content = leaf;
        assert.equal(leaf.TryFindResource('Missing'), undefined);
    });

    test('FindResource throws when the key is not present anywhere up the chain', () => {
        const cc = new ContentControl();
        const leaf = new Leaf();
        cc.Template = borderTemplate();
        cc.Content = leaf;
        assert.throws(() => leaf.FindResource('Missing'), /not found in any logical ancestor/);
    });

    test('Resources accessor does NOT allocate on read-only walks', () => {
        // Touching a Visual's resources via FindResource on an empty
        // tree shouldn't allocate dicts at each step. We can't observe
        // allocations directly, but we can confirm that reading
        // TryFindResource doesn't materialize a dict that subsequent
        // Has() calls would find.
        const a = new Leaf();
        const b = new Leaf();
        a.PropertyChanged(resolveKey(a, undefined, 'Tint')).subscribe(() => {});  // keep `a` referenced
        b.PropertyChanged(resolveKey(b, undefined, 'Tint')).subscribe(() => {});
        // TryFindResource walks past `a` (which has no logical parent),
        // returns undefined. No allocation should have happened.
        assert.equal(a.TryFindResource('K'), undefined);
        // Now allocate explicitly via Resources getter, confirm it's
        // a fresh empty dict.
        assert.equal(a.Resources.Size, 0);
    });
});

// ----------------------------------------------------------------
// Implicit DataTemplate resolution now walks the SAME resource-scope
// chain as every other resource — local (ancestor) dictionaries, not
// only Application.Resources. (Consolidation of findDataTemplateForType
// onto Element.FindInResourceChain.)
// ----------------------------------------------------------------
describe('implicit DataTemplate resolution walks the resource-scope chain', () => {
    class FooVM extends MuralBase {}
    class DerivedFooVM extends FooVM {}

    const templateFor = (dataType: Function): DataTemplate =>
        new DataTemplate(() => new Leaf(), dataType);

    test('resolves a DataTemplate placed in a LOCAL (ancestor) dictionary', () => {
        const host = new ContentControl();
        const tmpl = templateFor(FooVM);
        host.Resources.Set(FooVM, tmpl);          // local — never touches app resources
        host.Template = borderTemplate();
        const leaf = new Leaf();
        host.Content = leaf;                       // leaf → host logical chain
        assert.equal(findDataTemplateForType(FooVM, leaf), tmpl);
    });

    test('a base-type template in a local dictionary applies to a subtype', () => {
        const host = new ContentControl();
        const baseTmpl = templateFor(FooVM);
        host.Resources.Set(FooVM, baseTmpl);
        host.Template = borderTemplate();
        const leaf = new Leaf();
        host.Content = leaf;
        // No DerivedFooVM entry anywhere — the base FooVM template catches it.
        assert.equal(findDataTemplateForType(DerivedFooVM, leaf), baseTmpl);
    });

    test('nearest scope wins — a closer local template shadows a farther one', () => {
        const outer = new ContentControl();
        outer.Resources.Set(FooVM, templateFor(FooVM));
        outer.Template = borderTemplate();

        const inner = new ContentControl();
        const innerTmpl = templateFor(FooVM);
        inner.Resources.Set(FooVM, innerTmpl);
        inner.Template = borderTemplate();
        outer.Content = inner;

        const leaf = new Leaf();
        inner.Content = leaf;                      // leaf → inner → outer
        assert.equal(findDataTemplateForType(FooVM, leaf), innerTmpl);
    });

    test('within one scope the most-specific type wins over its base', () => {
        const host = new ContentControl();
        const baseTmpl    = templateFor(FooVM);
        const derivedTmpl = templateFor(DerivedFooVM);
        host.Resources.Set(FooVM, baseTmpl);
        host.Resources.Set(DerivedFooVM, derivedTmpl);
        host.Template = borderTemplate();
        const leaf = new Leaf();
        host.Content = leaf;
        assert.equal(findDataTemplateForType(DerivedFooVM, leaf), derivedTmpl);
        assert.equal(findDataTemplateForType(FooVM, leaf),        baseTmpl);
    });
});

// ----------------------------------------------------------------
// When Content is a non-Visual MuralBase and NO DataTemplate resolves for
// its type, ContentControl surfaces a loud red diagnostic instead of
// rendering nothing (the silent-empty-presenter trap).
// ----------------------------------------------------------------
describe('unresolved DataTemplate surfaces a red diagnostic', () => {
    class OrphanVM extends MuralBase {}

    test('renders a big red bold TextBlock naming the unresolved type', () => {
        const cc = new ContentControl();
        cc.Template = borderTemplate();
        cc.Content = new OrphanVM();            // no DataTemplate anywhere

        const border    = cc.visualChildren[0] as Border;
        const presenter = border.visualChildren[0] as ContentPresenter;
        const err       = presenter.visualChildren[0] as TextBlock;

        assert.ok(err instanceof TextBlock, 'diagnostic is a TextBlock');
        assert.equal(err.Text, 'can not resolve template for: OrphanVM');
        assert.ok(err.FontSize >= 20, 'big font');
        assert.equal(err.FontWeight, FontWeight.Bold);
        const fg = err.Foreground as SolidColorBrush;
        assert.ok(fg instanceof SolidColorBrush);
        assert.deepEqual(fg.Color, Color.Red);
    });
});
