import { ModifierKeys, toModifierKeys } from '../../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Application, NoModifiers, PointerButton, type ModifierKeys, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';;
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { ItemsPresenter } from '../../../basic/templates/items-presenter.js';
import { ListBox, ListBoxItem, SelectionMode } from '../list-box.js';
import { ScrollViewer } from '../../../framework/surfaces/scroll-viewer.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { Orientation } from '../../../basic/panels/orientation.js';
import { TextBlock } from '../../../basic/text-block.js';
import { MuralBase, Rect, Size } from '../../../runtime/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { ItemsPanelTemplate } from '../../../basic/panels/items-panel-template.js';

function pointer(mods: Partial<ModifierKeys> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
    };
}

// Build the typical "A B C" list of declarative items with TextBlock
// content for tests that exercise the composition path.
function buildDeclarativeFixture()
{
    const lb = new ListBox();
    const a = new ListBoxItem(new TextBlock('A'));
    const b = new ListBoxItem(new TextBlock('B'));
    const c = new ListBoxItem(new TextBlock('C'));
    lb.AddChild(a);
    lb.AddChild(b);
    lb.AddChild(c);
    return { lb, a, b, c };
}

describe('ListBox — composed-markup tree shape', () => {
    beforeEach(() => { initTestApp(); });

    test('AddChild attaches a ListBoxItem both visually and logically', () => {
        const lb = new ListBox();
        const item = new ListBoxItem(new TextBlock('A'));
        lb.AddChild(item);

        // logical: the row is one of ListBox.ItemContainers and shows up
        // in logicalChildren so DataContext / inheritable DPs reach it
        // via the standard walk.
        assert.equal(lb.logicalChildren.length, 1);
        assert.equal(lb.logicalChildren[0], item);
        assert.equal(lb.ItemContainers.length, 1);
        assert.equal(lb.ItemContainers[0], item);

        // visual: ItemsControl shape — ListBox → ScrollViewer → SCP →
        // ItemsPresenter → items panel (StackPanel) → row containers.
        // SCP comes from ScrollViewer's default template (templated SV
        // refactor); ItemsPresenter is the slot the ItemsControl base
        // wires the panel into. Walk via ScrollViewer.ContentPresenter
        // to skip past the template's layout panel.
        const sv = lb.visualChildren[0]!;
        assert.ok(sv instanceof ScrollViewer);
        const presenter = sv.ContentPresenter!.visualChildren[0]!;
        assert.ok(presenter instanceof ItemsPresenter);
        const stack = presenter.visualChildren[0]!;
        assert.ok(stack instanceof StackPanel);
        assert.equal(stack.visualChildren.length, 1);
        assert.equal(stack.visualChildren[0], item);
    });

    test('ListBox rejects non-ListBoxItem children with a clear error', () => {
        const lb = new ListBox();
        assert.throws(() => lb.AddChild(new ListBox()),
            /ListBox only accepts ListBoxItem/);
    });

    test('RemoveChild detaches a row and drops it from ItemContainers', () => {
        const { lb, a, b, c } = buildDeclarativeFixture();
        lb.RemoveChild(b);
        assert.deepEqual(lb.ItemContainers, [a, c]);
        assert.equal(lb.logicalChildren.length, 2);
    });
});

describe('ListBox — Items convenience path', () => {
    beforeEach(() => { initTestApp(); });

    test('setting Items auto-generates one ListBoxItem per source value', () => {
        const lb = new ListBox();
        lb.Items = ['Apples', 'Bananas', 'Cherries'];
        assert.equal(lb.ItemContainers.length, 3);
        // Each generated row stores the source value in Tag.
        assert.equal(lb.ItemContainers[0]!.Tag, 'Apples');
        assert.equal(lb.ItemContainers[1]!.Tag, 'Bananas');
        assert.equal(lb.ItemContainers[2]!.Tag, 'Cherries');
    });

    test('DisplayMemberPath renders item[path], not a stringified object', () => {
        // Objects with no Label/Name/Text used to fall to String(item) →
        // "[object Object]"; DisplayMemberPath must select the named field.
        const lb = new ListBox();
        lb.DisplayMemberPath = 'id';
        lb.Items = [{ id: 'front_door' }, { id: 'cosmos_db' }];
        assert.equal(lb.ItemContainers.length, 2);
        const c0 = lb.ItemContainers[0]!.Content as InstanceType<typeof TextBlock>;
        assert.ok(c0 instanceof TextBlock);
        assert.equal(c0.Text, 'front_door');
        const c1 = lb.ItemContainers[1]!.Content as InstanceType<typeof TextBlock>;
        assert.equal(c1.Text, 'cosmos_db');
    });

    test('resetting Items replaces every container, declarative or not (WPF parity)', () => {
        // Behaviour change since the ItemsControl refactor: there is
        // now ONE items collection, not two. Setting Items = arr
        // replaces the whole list — including any prior declarative
        // children. Authors that want a mix should mutate the items
        // collection incrementally (`lb.Items.Add(...)`) rather than
        // re-assigning. WPF parity.
        const lb     = new ListBox();
        const sticky = new ListBoxItem(new TextBlock('Sticky'));
        lb.AddChild(sticky);                          // joins Items
        lb.Items = ['a', 'b'];                        // wipes + replaces
        assert.equal(lb.ItemContainers.length, 2);
        assert.equal(lb.ItemContainers[0]!.Tag, 'a');
        assert.equal(lb.ItemContainers[1]!.Tag, 'b');
        // Sticky's old container is gone from the realized list.
        assert.equal(lb.ItemContainers.includes(sticky), false);

        lb.Items = ['x'];
        assert.equal(lb.ItemContainers.length, 1);
        assert.equal(lb.ItemContainers[0]!.Tag, 'x');
    });

    test('object items with a Label / Name / Text field display the named field', () => {
        const lb = new ListBox();
        lb.Items = [
            { Label: 'Apples' },
            { Name:  'Bananas' },
            { Text:  'Cherries' },
        ];
        // Display string lives inside the generated row's Content TextBlock.
        const labels = lb.ItemContainers.map(li =>
            (li.Content as TextBlock).Text);
        assert.deepEqual(labels, ['Apples', 'Bananas', 'Cherries']);
    });
});

describe('ListBox — selection (Single mode default)', () => {
    beforeEach(() => { initTestApp(); });

    test('plain click selects one item and exposes it via SelectedItem', () => {
        const { lb, a } = buildDeclarativeFixture();
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());

        assert.equal(lb.SelectedItem, a);
        assert.deepEqual(lb.SelectedItems, [a]);
        assert.equal(a.IsSelected, true);
        assert.equal(lb.SelectedIndex, 0);
    });

    test('plain click on a different row clears the previous selection', () => {
        const { lb, a, b } = buildDeclarativeFixture();
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());
        im.InjectPointerDown(b, pointer());
        im.InjectPointerUp  (b, pointer());

        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, true);
        assert.deepEqual(lb.SelectedItems, [b]);
    });

    test('Ctrl / Shift modifiers are ignored in Single mode', () => {
        const { lb, a, b } = buildDeclarativeFixture();
        // SelectionMode defaults to Single — verify modifiers don't extend.
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());
        im.InjectPointerDown(b, pointer({ Control: true }));
        im.InjectPointerUp  (b, pointer({ Control: true }));

        // Single mode treats Ctrl-click as a plain click — selection
        // moves to b, doesn't extend.
        assert.deepEqual(lb.SelectedItems, [b]);
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, true);
    });

    test('SelectedItem returns the Tag in Items mode', () => {
        const lb = new ListBox();
        lb.Items = ['x', 'y', 'z'];
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(lb.ItemContainers[1]!, pointer());
        im.InjectPointerUp  (lb.ItemContainers[1]!, pointer());

        assert.equal(lb.SelectedItem, 'y');
        assert.deepEqual(lb.SelectedItems, ['y']);
        assert.equal(lb.SelectedIndex, 1);
    });
});

describe('ListBox — selection (Multiple mode)', () => {
    beforeEach(() => { initTestApp(); });

    test('plain clicks toggle membership without modifiers', () => {
        const { lb, a, b, c } = buildDeclarativeFixture();
        lb.SelectionMode = SelectionMode.Multiple;
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());
        im.InjectPointerDown(b, pointer());
        im.InjectPointerUp  (b, pointer());
        im.InjectPointerDown(c, pointer());
        im.InjectPointerUp  (c, pointer());

        const sel = new Set(lb.SelectedItems);
        assert.equal(sel.size, 3);
        assert.ok(sel.has(a) && sel.has(b) && sel.has(c));

        // Click b again — toggles off.
        im.InjectPointerDown(b, pointer());
        im.InjectPointerUp  (b, pointer());
        const sel2 = new Set(lb.SelectedItems);
        assert.equal(sel2.size, 2);
        assert.ok(!sel2.has(b));
    });
});

describe('ListBox — selection (Extended mode: Ctrl + Shift)', () => {
    beforeEach(() => { initTestApp(); });

    function buildExtended()
    {
        const lb = new ListBox();
        lb.SelectionMode = SelectionMode.Extended;
        const items = ['a', 'b', 'c', 'd'].map(t =>
            new ListBoxItem(new TextBlock(t)));
        for (const i of items) lb.AddChild(i);
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();
        return { lb, items };
    }

    test('Ctrl+click toggles individual rows without clearing the rest', () => {
        const { lb, items } = buildExtended();
        const [a, b] = items;
        const im = new InputManager();
        im.InjectPointerDown(a!, pointer());
        im.InjectPointerUp  (a!, pointer());
        im.InjectPointerDown(b!, pointer({ Control: true }));
        im.InjectPointerUp  (b!, pointer({ Control: true }));

        const sel = new Set(lb.SelectedItems);
        assert.equal(sel.size, 2);
        assert.ok(sel.has(a!) && sel.has(b!));

        im.InjectPointerDown(a!, pointer({ Control: true }));
        im.InjectPointerUp  (a!, pointer({ Control: true }));
        assert.deepEqual(lb.SelectedItems, [b!]);
    });

    test('Shift+click extends range from anchor in insertion order', () => {
        const { lb, items } = buildExtended();
        const [a, , , d] = items;
        const im = new InputManager();
        // Plain click on a — anchor = a.
        im.InjectPointerDown(a!, pointer());
        im.InjectPointerUp  (a!, pointer());
        // Shift+click on d — range [a, b, c, d].
        im.InjectPointerDown(d!, pointer({ Shift: true }));
        im.InjectPointerUp  (d!, pointer({ Shift: true }));

        assert.equal(lb.SelectedItems.length, 4);
        const sel = new Set(lb.SelectedItems);
        for (const i of items) assert.ok(sel.has(i));
    });

    test('Shift+click pivots against the anchor across successive Shift+clicks', () => {
        const { lb, items } = buildExtended();
        const [a, b, c] = items;
        const im = new InputManager();
        // Anchor at a.
        im.InjectPointerDown(a!, pointer());
        im.InjectPointerUp  (a!, pointer());
        // Shift+click on c — [a, b, c].
        im.InjectPointerDown(c!, pointer({ Shift: true }));
        im.InjectPointerUp  (c!, pointer({ Shift: true }));
        assert.equal(lb.SelectedItems.length, 3);
        // Shift+click on b — anchor stays at a, range collapses to [a, b].
        im.InjectPointerDown(b!, pointer({ Shift: true }));
        im.InjectPointerUp  (b!, pointer({ Shift: true }));
        assert.equal(lb.SelectedItems.length, 2);
        const sel = new Set(lb.SelectedItems);
        assert.ok(sel.has(a!) && sel.has(b!));
        assert.ok(!sel.has(c!));
    });
});

describe('ListBox — programmatic selection via DPs', () => {
    beforeEach(() => { initTestApp(); });

    test('SelectedIndex setter selects the row at that position', () => {
        const { lb, b } = buildDeclarativeFixture();
        lb.SelectedIndex = 1;
        assert.equal(lb.SelectedItem, b);
        assert.equal(b.IsSelected, true);
    });

    test('SelectedItem setter looks up by Tag identity in Items mode', () => {
        const lb = new ListBox();
        lb.Items = ['x', 'y', 'z'];
        lb.SelectedItem = 'y';
        assert.equal(lb.SelectedIndex, 1);
        assert.equal(lb.ItemContainers[1]!.IsSelected, true);
    });

    test('SelectedItem = undefined clears selection', () => {
        const { lb, a } = buildDeclarativeFixture();
        lb.SelectedIndex = 0;
        assert.equal(a.IsSelected, true);
        lb.SelectedItem = undefined;
        assert.equal(a.IsSelected, false);
        assert.equal(lb.SelectedIndex, -1);
        assert.deepEqual(lb.SelectedItems, []);
    });

    test('out-of-range SelectedIndex clears selection without throwing', () => {
        const { lb } = buildDeclarativeFixture();
        lb.SelectedIndex = 99;
        assert.equal(lb.SelectedIndex, -1);
        assert.deepEqual(lb.SelectedItems, []);
    });
});

describe('ListBox — selection change notifications', () => {
    beforeEach(() => { initTestApp(); });

    test('SelectionChanged fires on every selection-modifying click', () => {
        const { lb, a, b } = buildDeclarativeFixture();
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        let fired = 0;
        lb.AddSelectionChangedListener(() => { fired++; });

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());
        im.InjectPointerDown(b, pointer());
        im.InjectPointerUp  (b, pointer());
        assert.equal(fired, 2);
    });

    test('ClearSelection drops every selected item AND fires SelectionChanged once', () => {
        const { lb, a, b } = buildDeclarativeFixture();
        lb.SelectionMode = SelectionMode.Multiple;
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());
        im.InjectPointerDown(b, pointer());
        im.InjectPointerUp  (b, pointer());
        assert.equal(lb.SelectedItems.length, 2);

        let fired = 0;
        lb.AddSelectionChangedListener(() => { fired++; });
        lb.ClearSelection();

        assert.equal(lb.SelectedItems.length, 0);
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, false);
        assert.equal(fired, 1);
    });

    test('removing a selected row drops it from the selection and fires SelectionChanged', () => {
        const { lb, a, b } = buildDeclarativeFixture();
        const target = new HeadlessTarget(300, 400);
        target.Content = lb;
        target.Flush();

        const im = new InputManager();
        im.InjectPointerDown(a, pointer());
        im.InjectPointerUp  (a, pointer());

        let fired = 0;
        lb.AddSelectionChangedListener(() => { fired++; });
        lb.RemoveChild(a);

        assert.equal(fired, 1);
        assert.deepEqual(lb.SelectedItems, []);
        assert.equal(lb.SelectedIndex, -1);
        // Unrelated row b is untouched.
        assert.equal(b.IsSelected, false);
    });
});

// A MuralBase row that ALSO has an implicit DataTemplate registered by type —
// the shape that exposed the tab-strip double-attach bug.
class TabDoc extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(TabDoc, 'Title', '', undefined);
    public get Title(): string { return this.get_property_value(TabDoc.TitleKey); }
    public set Title(v: string) { this.set_property_value(TabDoc.TitleKey, v); }
}

describe('ListBox — ItemTemplate precedence for MuralBase rows', () => {
    beforeEach(() => { initTestApp(); });

    test('an explicit ItemTemplate wins over an implicit DataType-registered DataTemplate', () => {
        // Register an implicit DataTemplate[TabDoc] in app resources. Before
        // the fix, a MuralBase row with such a template rendered through IT even
        // when the ListBox had an explicit ItemTemplate — so a document tab
        // strip (ItemTemplate = title+close) instead materialized each open
        // document's heavy DataType template (a Diagram), double-attaching
        // shared child Visuals and throwing on the second attach.
        let implicitFired = 0;
        Application.current.Resources.Set(
            'TabDocImplicitTemplate',
            new DataTemplate(() => { implicitFired++; return new TextBlock('IMPLICIT'); }, TabDoc));

        const lb = new ListBox();
        lb.ItemsPanel = new ItemsPanelTemplate(() => {
            const sp = new StackPanel(); sp.Orientation = Orientation.Horizontal; return sp;
        });
        let itemTemplateFired = 0;
        lb.ItemTemplate = new DataTemplate((d) => {
            itemTemplateFired++;
            const tb = new TextBlock(''); tb.Text = (d as TabDoc).Title; return tb;
        });
        const doc = new TabDoc(); doc.Title = 'Untitled';
        lb.ItemsSource = [doc];

        lb.Measure(new Size(400, 40));
        lb.Arrange(new Rect(0, 0, 400, 40));

        assert.equal(implicitFired, 0, 'implicit DataType template must NOT fire when ItemTemplate is set');
        assert.ok(itemTemplateFired >= 1, 'the explicit ItemTemplate must render the row');
    });
});
