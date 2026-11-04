import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { NoModifiers, PointerButton, RelayCommand, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../index.js';
import { Visibility } from '../../../visual-engine/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Ribbon, RibbonTabHeader } from '../ribbon.js';
import { RibbonTab, RibbonContextualGroup } from '../ribbon-tab.js';
import { RibbonGroup, RibbonSmallButtonColumn } from '../ribbon-group.js';
import { RibbonButton, RibbonToggleButton, RibbonButtonSize } from '../ribbon-buttons.js';
import { RibbonDropDownButton, RibbonSplitButton } from '../ribbon-popup-buttons.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { Orientation } from '../../../basic/panels/orientation.js';
import { Border } from '../../../basic/border.js';
import { Button } from '../../buttons/button.js';

function layout(v: unknown): HeadlessTarget
{
    const target = new HeadlessTarget(1000, 400);
    target.Content = v as never;
    target.Flush();
    return target;
}

function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse',
        ...overrides,
    };
}

// Simulate a full click (press + release inside) on a button.
function click(btn: Button): void
{
    const im = new InputManager();
    im.InjectPointerDown(btn, pointer());
    im.InjectPointerUp(btn, pointer());
}

function tab(header: string): RibbonTab
{
    const t = new RibbonTab();
    t.Header = header;
    const g = new RibbonGroup();
    g.Header = header + ' group';
    const b = new RibbonButton();
    b.Text = header + ' cmd';
    g.AddChild(b);
    t.AddChild(g);
    return t;
}

function stripHeaderCount(r: Ribbon): number
{
    const strip = r.GetTemplateChild('PART_TabStrip');
    return strip === undefined ? 0 : strip.visualChildren.length;
}

describe('Ribbon — tab selection + body', () => {
    beforeEach(() => { initTestApp(); });

    test('stable tabs render a header each; the first tab is selected by default', () => {
        const r = new Ribbon();
        const home = tab('Home');
        r.AddChild(home);
        r.AddChild(tab('Insert'));
        layout(r);

        assert.equal(stripHeaderCount(r), 2, 'two headers in the strip');
        assert.equal(r.SelectedTab, home, 'first stable tab is selected');
    });

    test('selecting a tab slots its body into PART_Body', () => {
        const r = new Ribbon();
        const home = tab('Home');
        const insert = tab('Insert');
        r.AddChild(home);
        r.AddChild(insert);
        layout(r);

        const body = r.GetTemplateChild('PART_Body');
        assert.ok(body !== undefined, 'body presenter exists');
        r.SelectedTab = insert;
        // The presenter's single visual child is the slotted tab.
        assert.equal(body!.visualChildren[0], insert, 'body shows the selected tab');
    });

    test('header IsCurrent tracks the selection', () => {
        const r = new Ribbon();
        const home = tab('Home');
        const insert = tab('Insert');
        r.AddChild(home);
        r.AddChild(insert);
        layout(r);

        const strip = r.GetTemplateChild('PART_TabStrip')!;
        const headers = strip.visualChildren.filter((c): c is RibbonTabHeader => c instanceof RibbonTabHeader);
        assert.equal(headers.length, 2);
        r.SelectedTab = insert;
        const current = headers.filter((h) => h.IsCurrent);
        assert.equal(current.length, 1, 'exactly one header is current');
    });
});

describe('Ribbon — contextual groups', () => {
    beforeEach(() => { initTestApp(); });

    test('a contextual tab is hidden until its group IsActive flips true', () => {
        const r = new Ribbon();
        r.AddChild(tab('Home'));

        const group = new RibbonContextualGroup();
        group.Header = 'Drawing Tools';
        const fmt = tab('Format');
        group.AddChild(fmt);
        r.ContextualGroups.Add(group);
        layout(r);

        assert.equal(stripHeaderCount(r), 1, 'only the stable tab shows while the group is inactive');

        group.IsActive = true;
        assert.equal(stripHeaderCount(r), 2, 'the contextual tab appears when the group activates');

        group.IsActive = false;
        assert.equal(stripHeaderCount(r), 1, 'and disappears when it deactivates');
    });

    test('selection falls back to a stable tab when the active contextual tab is hidden', () => {
        const r = new Ribbon();
        const home = tab('Home');
        r.AddChild(home);
        const group = new RibbonContextualGroup();
        const fmt = tab('Format');
        group.AddChild(fmt);
        r.ContextualGroups.Add(group);
        layout(r);

        group.IsActive = true;
        r.SelectedTab = fmt;
        assert.equal(r.SelectedTab, fmt);

        group.IsActive = false;
        assert.equal(r.SelectedTab, home, 'selection falls back to the still-visible stable tab');
    });
});

describe('Ribbon — QAT + minimize', () => {
    beforeEach(() => { initTestApp(); });

    test('QuickAccessItems render into PART_Qat', () => {
        const r = new Ribbon();
        r.AddChild(tab('Home'));
        const qatBtn = new RibbonButton();
        qatBtn.Text = 'Save';
        r.QuickAccessItems.Add(qatBtn);
        layout(r);

        const qat = r.GetTemplateChild('PART_Qat');
        assert.ok(qat !== undefined);
        assert.ok(qat!.visualChildren.includes(qatBtn), 'the QAT hosts the invoker');
    });

    test('IsMinimized collapses the body container', () => {
        const r = new Ribbon();
        r.AddChild(tab('Home'));
        layout(r);

        const bodyC = r.GetTemplateChild('PART_BodyContainer') as Border;
        assert.equal(bodyC.Visibility, Visibility.Visible);
        r.IsMinimized = true;
        assert.equal(bodyC.Visibility, Visibility.Collapsed, 'body collapses when minimized');
        r.IsMinimized = false;
        assert.equal(bodyC.Visibility, Visibility.Visible, 'and restores when expanded');
    });
});

describe('RibbonButton — content composition by Size', () => {
    beforeEach(() => { initTestApp(); });

    test('Large stacks vertically, Medium/Small horizontally', () => {
        const b = new RibbonButton();
        b.Text = 'Delete';
        b.Size = RibbonButtonSize.Large;
        assert.ok(b.Content instanceof StackPanel);
        assert.equal((b.Content as StackPanel).Orientation, Orientation.Vertical);

        b.Size = RibbonButtonSize.Medium;
        assert.equal((b.Content as StackPanel).Orientation, Orientation.Horizontal);

        b.Size = RibbonButtonSize.Small;
        assert.equal((b.Content as StackPanel).Orientation, Orientation.Horizontal);
    });

    test('Small is icon-only; Medium keeps the label', () => {
        const icon = () => new Border();
        // Medium: icon + label → two children.
        const m = new RibbonButton();
        m.Text = 'Cut';
        m.SmallIcon = icon();
        m.Size = RibbonButtonSize.Medium;
        assert.equal((m.Content as StackPanel).visualChildren.length, 2);

        // Small with an icon: icon only → one child (label dropped).
        const s = new RibbonButton();
        s.Text = 'Cut';
        s.SmallIcon = icon();
        s.Size = RibbonButtonSize.Small;
        assert.equal((s.Content as StackPanel).visualChildren.length, 1);

        // Small with NO icon falls back to the label so it isn't empty.
        const t = new RibbonButton();
        t.Text = 'Cut';
        t.Size = RibbonButtonSize.Small;
        assert.equal((t.Content as StackPanel).visualChildren.length, 1);
    });

    test('RibbonToggleButton carries the same composition + IsChecked', () => {
        const t = new RibbonToggleButton();
        t.Text = 'Bold';
        t.Size = RibbonButtonSize.Medium;
        assert.equal((t.Content as StackPanel).Orientation, Orientation.Horizontal);
        assert.equal(t.IsChecked, false);
        t.IsChecked = true;
        assert.equal(t.IsChecked, true);
    });
});

describe('RibbonSmallButtonColumn — coerces children to Medium', () => {
    beforeEach(() => { initTestApp(); });

    test('added ribbon buttons become Size=Medium', () => {
        const col = new RibbonSmallButtonColumn();
        const a = new RibbonButton(); a.Size = RibbonButtonSize.Large;
        const b = new RibbonToggleButton(); b.Size = RibbonButtonSize.Large;
        col.AddChild(a);
        col.AddChild(b);
        assert.equal(a.Size, RibbonButtonSize.Medium);
        assert.equal(b.Size, RibbonButtonSize.Medium);
        assert.equal(col.Orientation, Orientation.Vertical);
    });
});

describe('RibbonGroup — dialog launcher', () => {
    beforeEach(() => { initTestApp(); });

    test('launcher is collapsed with no LaunchCommand, shown when one is set', () => {
        const g = new RibbonGroup();
        g.Header = 'Font';
        layout(g);

        const launcher = g.GetTemplateChild('PART_Launcher') as Button;
        assert.equal(launcher.Width, 0, 'launcher collapsed by default');

        g.LaunchCommand = new RelayCommand(() => { /* open dialog */ });
        assert.ok(Number.isNaN(launcher.Width), 'launcher auto-sizes once a command is set');
    });

    test('clicking the launcher invokes LaunchCommand', () => {
        const g = new RibbonGroup();
        let fired = 0;
        g.LaunchCommand = new RelayCommand(() => { fired++; });
        layout(g);
        const launcher = g.GetTemplateChild('PART_Launcher') as Button;
        click(launcher);
        assert.equal(fired, 1);
    });
});

describe('Ribbon popup buttons', () => {
    beforeEach(() => { initTestApp(); });

    test('RibbonDropDownButton materialises a trigger + content host', () => {
        const dd = new RibbonDropDownButton();
        dd.Text = 'Theme';
        layout(dd);
        assert.equal(dd.IsOpen, false);
    });

    test('RibbonSplitButton primary Command executes; arrow toggles the popup open', () => {
        const sb = new RibbonSplitButton();
        let fired = 0;
        sb.Command = new RelayCommand(() => { fired++; });
        sb.Text = 'Paste';
        layout(sb);

        // Primary region → Command.
        const primary = findButton(sb, 'PART_Primary');
        assert.ok(primary !== undefined, 'has a primary region');
        click(primary!);
        assert.equal(fired, 1, 'primary click ran the command');

        // Arrow region → opens the dropdown.
        const arrow = findButton(sb, 'PART_Arrow');
        assert.ok(arrow !== undefined, 'has an arrow region');
        click(arrow!);
        assert.equal(sb.IsOpen, true, 'arrow opened the dropdown');
    });

    // Same rule as Button: the primary region follows the command's
    // CanExecute (disabled + dimmed); the arrow keeps the dropdown reachable.
    test('RibbonSplitButton primary disables with CanExecute; the arrow still opens', () => {
        const sb = new RibbonSplitButton();
        let open = false;
        let ran = 0;
        const cmd = new RelayCommand(() => { ran++; }, () => open);
        sb.Command = cmd;
        sb.Text = 'Paste';
        layout(sb);

        const primary = findButton(sb, 'PART_Primary')!;
        const arrow   = findButton(sb, 'PART_Arrow')!;
        assert.equal(primary.IsEnabled, false, 'the primary region is disabled');
        assert.equal(arrow.IsEnabled, true, 'the arrow region stays enabled');
        click(primary);
        assert.equal(ran, 0);
        click(arrow);
        assert.equal(sb.IsOpen, true, 'the arrow still opens the dropdown');
        sb.IsOpen = false;

        open = true;
        cmd.RaiseCanExecuteChanged();
        assert.equal(primary.IsEnabled, true, 'CanExecuteChanged re-enables the primary region');
        click(primary);
        assert.equal(ran, 1);
    });
});

// Walk a control's visual subtree for a named Button part (the trigger
// template lives on the control's visualChildren[0], not the primary
// template GetTemplateChild reaches).
function findButton(root: unknown, name: string): Button | undefined
{
    const v = root as { visualChildren: readonly unknown[]; FindName?: (n: string) => unknown };
    const stack: unknown[] = [...(v.visualChildren ?? [])];
    while (stack.length > 0)
    {
        const cur = stack.pop() as { Name?: string; visualChildren?: readonly unknown[] };
        if (cur instanceof Button && (cur as unknown as { Name?: string }).Name === name) return cur;
        if (cur?.visualChildren !== undefined) stack.push(...cur.visualChildren);
    }
    return undefined;
}

// The owner's veto on a template part is its own slot (review N4): it never
// overrides the part's own command veto, and a control can veto only its OWN
// template parts.
class VetoProbe extends Border
{
    public Veto(part: Border | Button, value: boolean): void
    {
        this.SetTemplatePartIsEnabledCore(part, value);
    }
}

describe('Template-part IsEnabledCore veto', () => {
    beforeEach(() => { initTestApp(); });

    test("the owner veto and the part's own command veto are ANDed, neither overrides the other", () => {
        const sb = new RibbonSplitButton();
        let ownerCan = true;
        const ownerCmd = new RelayCommand(() => {}, () => ownerCan);
        sb.Command = ownerCmd;
        layout(sb);
        const primary = findButton(sb, 'PART_Primary')!;
        let partCan = false;
        const partCmd = new RelayCommand(() => {}, () => partCan);
        primary.Command = partCmd;
        assert.equal(primary.IsEnabled, false, "the part's own command vetoes");
        ownerCmd.RaiseCanExecuteChanged();
        assert.equal(primary.IsEnabled, false, "the owner allowing does not override the part's own veto");

        partCan = true;
        partCmd.RaiseCanExecuteChanged();
        assert.equal(primary.IsEnabled, true);
        ownerCan = false;
        ownerCmd.RaiseCanExecuteChanged();
        assert.equal(primary.IsEnabled, false, 'the owner vetoes');
        partCan = false; partCmd.RaiseCanExecuteChanged();
        partCan = true; partCmd.RaiseCanExecuteChanged();
        assert.equal(primary.IsEnabled, false, "the part's own command allowing does not override the owner veto");
    });

    test('clearing the Command lifts each veto: on the owner and on the part', () => {
        const sb = new RibbonSplitButton();
        sb.Command = new RelayCommand(() => {}, () => false);
        layout(sb);
        const primary = findButton(sb, 'PART_Primary')!;
        assert.equal(primary.IsEnabled, false, 'the owner vetoes the primary');
        sb.Command = undefined;
        assert.equal(primary.IsEnabled, true, 'clearing the owner command lifts the owner veto');

        primary.Command = new RelayCommand(() => {}, () => false);
        assert.equal(primary.IsEnabled, false, 'the part vetoes itself');
        primary.Command = undefined;
        assert.equal(primary.IsEnabled, true, 'clearing the part command lifts the part veto');

        sb.Command = new RelayCommand(() => {}, () => false);
        primary.Command = new RelayCommand(() => {}, () => false);
        sb.Command = undefined;
        assert.equal(primary.IsEnabled, false, 'the part veto still holds with the owner veto lifted');
        primary.Command = undefined;
        assert.equal(primary.IsEnabled, true, 'both vetoes lifted');
    });

    test('a control cannot veto an element that is not its own template part', () => {
        const probe = new VetoProbe();
        const sb = new RibbonSplitButton();
        layout(sb);
        assert.throws(() => probe.Veto(findButton(sb, 'PART_Primary')!, false), /not a template part of this control/);
        assert.throws(() => probe.Veto(new Border(), false), /not a template part of this control/);
    });
});
