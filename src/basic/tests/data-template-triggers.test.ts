import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MetaData,
    MuralBase,
    NameScope,
    Size,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { TriggerAction } from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import {
    DataTemplate,
    HierarchicalDataTemplate,
    TargetedSetter,
    TemplateDataTrigger,
    TemplateMultiDataTrigger,
    TemplatePropertyTrigger,
    type TemplateDataTriggerCondition,
} from '../templates/data-template.js';

// Counter action — records firing target without dragging the
// storyboard machinery into template-level tests.
class CounterAction extends TriggerAction
{
    public calls: number = 0;
    public Invoke(_target: Visual): void { this.calls++; }
}

// Minimal Visual used as the template root — exposes Tint + Bias so a
// trigger has properties to flip and to watch. RenderOverride no-ops
// because these tests assert state, not paint output.
class Tile extends Element
{
    static
    {
        MuralBase.RegisterProperty(Tile, 'Tint', 'plain',  MetaData.None);
        MuralBase.RegisterProperty(Tile, 'Bias', 0,        MetaData.None);
    }
    public get Tint(): string { return this.get_property_value(resolveKey(this, undefined, 'Tint')); }
    public set Tint(v: string) { this.set_property_value(resolveKey(this, undefined, 'Tint'), v); }
    public get Bias(): number { return this.get_property_value(resolveKey(this, undefined, 'Bias')); }
    public set Bias(v: number) { this.set_property_value(resolveKey(this, undefined, 'Bias'), v); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Backing view-model so DataTriggers have something to bind against.
class ItemVM extends MuralBase
{
    static { MuralBase.RegisterProperty(ItemVM, 'IsSelected', false, MetaData.None); }
    public get IsSelected(): boolean { return this.get_property_value(resolveKey(this, undefined, 'IsSelected')); }
    public set IsSelected(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'IsSelected'), v); }
}

describe('HierarchicalDataTemplate.Triggers — forwarded to base, wired by Apply', () => {
    // Regression: the hierarchical form used to drop body `when()` triggers
    // (compiler passed none; ctor accepted none), so a TreeView row template's
    // rename-swap trigger silently no-op'd. The ctor now forwards triggers to
    // the DataTemplate base, so Apply() attaches them like any row.
    test('fires a TemplateDataTrigger on a hierarchical row', () => {
        const tmpl = new HierarchicalDataTemplate(
            (data) => {
                const t = new Tile();
                t.DataContext = data;
                return t;
            },
            () => undefined,   // itemsSelector — leaf row (no children)
            undefined,         // itemTemplate
            undefined,         // itemContainerStyle
            undefined,         // dataType
            [],                // property triggers
            [new TemplateDataTrigger('IsSelected', true, [
                new TargetedSetter(Tile, 'Tint', 'orange'),
            ])],
        );
        const vm = new ItemVM();
        const root = tmpl.Apply(vm) as Tile;
        assert.equal(root.Tint, 'plain');
        vm.IsSelected = true;
        assert.equal(root.Tint, 'orange');
        vm.IsSelected = false;
        assert.equal(root.Tint, 'plain');
    });
});

describe('DataTemplate.Triggers — TemplateDataTrigger on template root', () => {
    test('fires the trigger when the bound data path matches', () => {
        const tmpl = new DataTemplate(
            (data) => {
                const t = new Tile();
                t.DataContext = data;
                return t;
            },
            undefined,
            [],
            [new TemplateDataTrigger('IsSelected', true, [
                new TargetedSetter(Tile, 'Tint', 'orange'),
            ])],
        );
        const vm = new ItemVM();
        const root = tmpl.Apply(vm) as Tile;
        assert.equal(root.Tint, 'plain');
        vm.IsSelected = true;
        assert.equal(root.Tint, 'orange');
        vm.IsSelected = false;
        assert.equal(root.Tint, 'plain');
    });

    test('every Apply produces a fresh subtree with its own trigger state', () => {
        const tmpl = new DataTemplate(
            (data) => {
                const t = new Tile();
                t.DataContext = data;
                return t;
            },
            undefined,
            [],
            [new TemplateDataTrigger('IsSelected', true, [
                new TargetedSetter(Tile, 'Tint', 'orange'),
            ])],
        );
        const vmA = new ItemVM();
        const vmB = new ItemVM();
        const a = tmpl.Apply(vmA) as Tile;
        const b = tmpl.Apply(vmB) as Tile;
        vmA.IsSelected = true;
        assert.equal(a.Tint, 'orange');
        assert.equal(b.Tint, 'plain');     // independent
        vmB.IsSelected = true;
        assert.equal(b.Tint, 'orange');
    });
});

// SourceName + TargetName: the data trigger watches one descendant's
// DataContext while its setter writes to a DIFFERENT named descendant.
// Mirrors WPF's `Trigger.SourceName` + `Setter.TargetName` split, which
// is the headline of DataTemplate.Triggers vs Style triggers (Style can
// only target the styled visual).
describe('DataTemplate.Triggers — TargetName routes setter to a named descendant', () => {
    test('setter applies to the named child, not to the template root', () => {
        // Composite root with a named "chrome" child. The trigger
        // setter targets "chrome", so its Tint flips but the root's
        // stays untouched.
        class Panel extends Element
        {
            public chrome: Tile;
            constructor()
            {
                super();
                this.chrome = new Tile();
                this.chrome.Name = 'chrome';
                this.AttachLogical(this.chrome);
                this.AttachVisual(this.chrome);
            }
            public override get visualChildren(): readonly Visual[] { return [this.chrome]; }
            public override get logicalChildren(): readonly Visual[] { return [this.chrome]; }
            protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
            protected override RenderOverride(_dc: DrawingContext): void { }
        }
        // Manual NameScope registration on the template root so
        // FindName resolves the chrome.
        const tmpl = new DataTemplate(
            (data) => {
                const panel = new Panel();
                panel.DataContext = data;
                // Build the NameScope manually here — the .mu compiler
                // does this automatically (Canvas x:root in markup); in
                // this hand-rolled test we wire it explicitly.
                const ns = new NameScope();
                panel.SetNameScope(ns);
                ns.Register('chrome', panel.chrome);
                return panel;
            },
            undefined,
            [],
            [new TemplateDataTrigger('IsSelected', true, [
                new TargetedSetter(Tile, 'Tint', 'orange', 'chrome'),
            ])],
        );
        const vm = new ItemVM();
        const root = tmpl.Apply(vm) as Panel;
        assert.equal(root.chrome.Tint, 'plain');
        vm.IsSelected = true;
        // Chrome flipped; the root itself is a Panel which carries no
        // Tint — the setter resolved against the chrome by name.
        assert.equal(root.chrome.Tint, 'orange');
        vm.IsSelected = false;
        assert.equal(root.chrome.Tint, 'plain');
    });
});

describe('DataTemplate.Triggers — TemplatePropertyTrigger', () => {
    test('fires when a DP on the template root matches', () => {
        const tmpl = new DataTemplate(
            () => new Tile(),
            undefined,
            [new TemplatePropertyTrigger(Tile, 'Tint', 'hot', [
                new TargetedSetter(Tile, 'Bias', 99),
            ])],
        );
        const root = tmpl.Apply(undefined) as Tile;
        assert.equal(root.Bias, 0);
        root.Tint = 'hot';
        assert.equal(root.Bias, 99);
        root.Tint = 'cold';
        assert.equal(root.Bias, 0);
    });

    test('enterActions fire on transition; not on initial-state match', () => {
        const enter = new CounterAction();
        const tmpl = new DataTemplate(
            () => {
                const t = new Tile();
                t.Tint = 'hot'; // already in matching state at Apply time
                return t;
            },
            undefined,
            [new TemplatePropertyTrigger(
                Tile, 'Tint', 'hot',
                [new TargetedSetter(Tile, 'Bias', 99)],
                undefined,
                [enter],
            )],
        );
        const root = tmpl.Apply(undefined) as Tile;
        // Setter applies — but no enter edge.
        assert.equal(root.Bias, 99);
        assert.equal(enter.calls, 0);
        // Transition off then on — that IS the edge.
        root.Tint = 'cold';
        root.Tint = 'hot';
        assert.equal(enter.calls, 1);
    });
});

describe('DataTemplate.Triggers — TemplateMultiDataTrigger', () => {
    test('activates only when every bound condition matches', () => {
        const conds: TemplateDataTriggerCondition[] = [
            { path: 'IsSelected', value: true },
            { path: 'Score',      value: 5    },
        ];
        const tmpl = new DataTemplate(
            (data) => {
                const t = new Tile();
                t.DataContext = data;
                return t;
            },
            undefined,
            [], [], [],
            [new TemplateMultiDataTrigger(conds, [new TargetedSetter(Tile, 'Bias', 42)])],
        );
        class MultiVM extends MuralBase
        {
            static
            {
                MuralBase.RegisterProperty(MultiVM, 'IsSelected', false, MetaData.None);
                MuralBase.RegisterProperty(MultiVM, 'Score',       0,    MetaData.None);
            }
            public get IsSelected(): boolean { return this.get_property_value(resolveKey(this, undefined, 'IsSelected')); }
            public set IsSelected(v: boolean) { this.set_property_value(resolveKey(this, undefined, 'IsSelected'), v); }
            public get Score(): number { return this.get_property_value(resolveKey(this, undefined, 'Score')); }
            public set Score(v: number) { this.set_property_value(resolveKey(this, undefined, 'Score'), v); }
        }
        const vm = new MultiVM();
        const root = tmpl.Apply(vm) as Tile;
        assert.equal(root.Bias, 0);
        vm.IsSelected = true;
        assert.equal(root.Bias, 0, 'one condition match — still inactive');
        vm.Score = 5;
        assert.equal(root.Bias, 42, 'both match — active');
        vm.IsSelected = false;
        assert.equal(root.Bias, 0, 'break one — inactive');
    });
});

describe('DataTemplate.Triggers — TemplateDataTrigger enter/exit', () => {
    test('enterActions fire only on the activation edge', () => {
        const enter = new CounterAction();
        const tmpl = new DataTemplate(
            (data) => {
                const t = new Tile();
                t.DataContext = data;
                return t;
            },
            undefined,
            [],
            [new TemplateDataTrigger(
                'IsSelected', true,
                [],
                undefined,
                [enter],
            )],
        );
        const vm = new ItemVM();
        const root = tmpl.Apply(vm) as Tile;
        assert.equal(enter.calls, 0);
        vm.IsSelected = true;
        assert.equal(enter.calls, 1);
        vm.IsSelected = false;
        vm.IsSelected = true;
        assert.equal(enter.calls, 2);
    });
});
