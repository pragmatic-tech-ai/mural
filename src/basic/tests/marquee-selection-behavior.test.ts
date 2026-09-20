import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { Application, NoModifiers, ObservableCollection, PointerButton, Visual, type ModifierKeys, type PointerEventInit } from '../../runtime/index.js';
import { InputManager } from '../../framework/index.js';;
import { HeadlessTarget } from '../../visual-engine/index.js';
import { DataTemplate } from '../templates/data-template.js';
import { ListBox, ListBoxItem } from '../../framework/list/list-box.js';
import { MarqueeBoundsPolicy, Selector, SelectionMode } from '../../framework/list/selector.js';
import { TextBlock } from '../text-block.js';
import { VirtualizingWrapPanel } from '../panels/virtualisation/virtualizing-wrap-panel.js';

function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   NoModifiers,
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
        ...overrides,
    };
}

function mods(overrides: { Shift?: boolean; Control?: boolean; Alt?: boolean; Meta?: boolean } = {}): ModifierKeys
{
    return toModifierKeys({ shift: overrides.Shift, control: overrides.Control, alt: overrides.Alt, meta: overrides.Meta });
}

// Build a ListBox with three rows of fixed height that align to the
// known StackPanel layout. The host is 200×400, rows are 32px tall by
// default template, items panel sits at the host origin so HostX/HostY
// IS panel-local for these tests.
function buildFixture(): {
    lb: ListBox; a: ListBoxItem; b: ListBoxItem; c: ListBoxItem;
    panel: Visual; target: HeadlessTarget;
}
{
    const lb = new ListBox();
    lb.SelectionMode = SelectionMode.Extended;
    const a = new ListBoxItem(new TextBlock('A'));
    const b = new ListBoxItem(new TextBlock('B'));
    const c = new ListBoxItem(new TextBlock('C'));
    lb.AddChild(a);
    lb.AddChild(b);
    lb.AddChild(c);
    const target = new HeadlessTarget(200, 400);
    target.Content = lb;
    target.Flush();
    const panel = lb.ItemsPanelInstance as Visual;
    return { lb, a, b, c, panel, target };
}

describe('MarqueeSelectionBehavior — DPs and attach state', () => {
    beforeEach(() => { initTestApp(); });

    test('AllowMarqueeSelection defaults to false', () => {
        const lb = new ListBox();
        assert.equal(lb.AllowMarqueeSelection, false);
    });

    test('MarqueeBoundsPolicy defaults to Intersect', () => {
        const lb = new ListBox();
        assert.equal(lb.MarqueeBoundsPolicy, MarqueeBoundsPolicy.Intersect);
    });

    test('flipping AllowMarqueeSelection true → false detaches cleanly', () => {
        const { lb, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.AllowMarqueeSelection = false;
        // Drag on background after detach: no marquee, no selection.
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 4,  HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 50, HostY: 50 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 50, HostY: 50 }));
        assert.equal(lb.SelectedItems.length, 0);
    });
});

describe('MarqueeSelectionBehavior — gesture filtering', () => {
    beforeEach(() => { initTestApp(); });

    test('disabled → drag on background is a no-op', () => {
        const { lb, panel } = buildFixture();
        // AllowMarqueeSelection stays false.
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 4,  HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 50, HostY: 50 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 50, HostY: 50 }));
        assert.equal(lb.SelectedItems.length, 0);
    });

    test('SelectionMode=Single → drag on background ignored even when enabled', () => {
        const { lb, panel } = buildFixture();
        lb.SelectionMode = SelectionMode.Single;
        lb.AllowMarqueeSelection = true;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 4,  HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 50, HostY: 200 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 50, HostY: 200 }));
        assert.equal(lb.SelectedItems.length, 0);
    });

    test('Drag below threshold leaves selection alone (no marquee shown)', () => {
        const { lb, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        const im = new InputManager();
        // 2px move is below the 4px threshold.
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 10 }));
        im.InjectPointerMove(panel, pointer({ HostX: 12, HostY: 11 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 12, HostY: 11 }));
        assert.equal(lb.SelectedItems.length, 0);
    });

    test('Click on a container is left to normal click handling', () => {
        const { lb, a } = buildFixture();
        lb.AllowMarqueeSelection = true;
        const im = new InputManager();
        // Normal click on item a — marquee should NOT trigger.
        im.InjectPointerDown(a, pointer({ HostX: 50, HostY: 16 }));
        im.InjectPointerUp  (a, pointer({ HostX: 50, HostY: 16 }));
        // ListBoxItem's click handler selects via HandleContainerClick.
        assert.equal(lb.SelectedItem, a);
    });
});

describe('MarqueeSelectionBehavior — Intersect policy (default)', () => {
    beforeEach(() => { initTestApp(); });

    test('rect touching first two rows selects them', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        const im = new InputManager();
        // Rows arrange at y=0..32 (a), 32..64 (b), 64..96 (c).
        // Drag from (10,4) to (40,40) — covers rows a and b.
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 40 }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, false);
    });

    test('rect grazing the bottom of row b includes it', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        const im = new InputManager();
        // Drag from (10,30) to (40,34) — grazes the bottom of a and the
        // top of b. Both should be Intersect-selected.
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 30 }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 34 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 34 }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, false);
    });
});

describe('MarqueeSelectionBehavior — Contained policy', () => {
    beforeEach(() => { initTestApp(); });

    test('partial overlap is NOT enough — full containment required', () => {
        const { lb, a, b, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.MarqueeBoundsPolicy = MarqueeBoundsPolicy.Contained;
        const im = new InputManager();
        // Drag from (10,4) to (40,40) — touches a but doesn't fully
        // contain it (rows are 200px wide; rect is only 30px wide).
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 40 }));
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, false);
    });

    test('rect fully enclosing rows a and b selects both', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.MarqueeBoundsPolicy = MarqueeBoundsPolicy.Contained;
        const im = new InputManager();
        // 200px wide ListBox; drag from (-10,-4) to (210,68) fully
        // encloses rows a (0-32) and b (32-64).
        im.InjectPointerDown(panel, pointer({ HostX: -10, HostY: -4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 210, HostY: 68 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 210, HostY: 68 }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, false);
    });
});

describe('MarqueeSelectionBehavior — modifier modes', () => {
    beforeEach(() => { initTestApp(); });

    test('Plain drag (replace) clears prior selection then adds rect contents', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        // Pre-select c via the Selector API so _selectedContainers stays
        // in sync; writing the IsSelected attached directly only flips
        // the chrome, not the Selector's internal set.
        lb.SelectedItem = c;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4 }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 40 }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, false, 'replace clears previously-selected c');
    });

    test('Ctrl+drag (add) overlays rect contents onto existing selection', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.SelectedItem = c;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4,  Modifiers: mods({ Control: true }) }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40, Modifiers: mods({ Control: true }) }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 40, Modifiers: mods({ Control: true }) }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, true, 'add preserves c');
    });

    test('Shift+drag (extend) layers rect contents over the prior snapshot', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.SelectedItem = c;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4,  Modifiers: mods({ Shift: true }) }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40, Modifiers: mods({ Shift: true }) }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 40, Modifiers: mods({ Shift: true }) }));
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, true, 'extend preserves snapshot');
    });
});

describe('MarqueeSelectionBehavior — click-on-empty-space clears selection', () => {
    beforeEach(() => { initTestApp(); });

    test('Plain click on background clears the existing selection', () => {
        const { lb, a, b, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        // Pre-select c via the Selector API so _selectedContainers stays
        // in sync.
        lb.SelectedItem = c;
        assert.equal(c.IsSelected, true);
        const im = new InputManager();
        // PointerDown + PointerUp on background at the SAME spot — no
        // drag, no marquee. Plain click → replace mode → clear.
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 200 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 10, HostY: 200 }));
        assert.equal(a.IsSelected, false);
        assert.equal(b.IsSelected, false);
        assert.equal(c.IsSelected, false, 'plain click on empty space clears prior c');
        assert.equal(lb.SelectedItems.length, 0);
    });

    test('Ctrl-click on background leaves the selection intact (Explorer parity)', () => {
        const { lb, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.SelectedItem = c;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 200, Modifiers: mods({ Control: true }) }));
        im.InjectPointerUp  (panel, pointer({ HostX: 10, HostY: 200, Modifiers: mods({ Control: true }) }));
        assert.equal(c.IsSelected, true, 'Ctrl-click on empty preserves selection');
    });

    test('Shift-click on background leaves the selection intact', () => {
        const { lb, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.SelectedItem = c;
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 200, Modifiers: mods({ Shift: true }) }));
        im.InjectPointerUp  (panel, pointer({ HostX: 10, HostY: 200, Modifiers: mods({ Shift: true }) }));
        assert.equal(c.IsSelected, true, 'Shift-click on empty preserves selection');
    });

    test('Click on background when nothing is selected is a no-op (no spurious SelectionChanged)', () => {
        const { lb, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        let fires = 0;
        lb.AddSelectionChangedListener(() => { fires++; });
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 200 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 10, HostY: 200 }));
        assert.equal(fires, 0, 'no SelectionChanged when nothing was selected to begin with');
    });

    test('Sub-threshold drag on background still counts as click and clears', () => {
        const { lb, c, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        lb.SelectedItem = c;
        const im = new InputManager();
        // 2px move is below the 4px threshold → no marquee, but still
        // a click → still clears.
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 200 }));
        im.InjectPointerMove(panel, pointer({ HostX: 12, HostY: 201 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 12, HostY: 201 }));
        assert.equal(c.IsSelected, false);
    });
});

describe('MarqueeSelectionBehavior — click-on-empty-space with VirtualizingWrapPanel (word-toolbox shape)', () => {
    beforeEach(() => { initTestApp(); });

    // Builds a ListBox laid out like the word-toolbox demo: VirtualizingWrapPanel
    // ItemsPanel with HorizontalSpacing/VerticalSpacing, 9 data items in a 3×3
    // grid, SelectionMode=Extended, AllowMarqueeSelection=true.
    function buildWrapFixture(): { lb: ListBox; panel: VirtualizingWrapPanel; target: HeadlessTarget }
    {
        const lb = new ListBox();
        lb.SelectionMode = SelectionMode.Extended;
        const panel = new VirtualizingWrapPanel();
        panel.ItemWidth         = 60;
        panel.ItemHeight        = 60;
        panel.HorizontalSpacing = 15;
        panel.VerticalSpacing   = 15;
        lb.ItemsPanel   = () => panel;
        lb.ItemTemplate = new DataTemplate((data: unknown) => new TextBlock(String(data)));
        const coll = new ObservableCollection<string>();
        for (let i = 0; i < 9; i++) coll.Add(`w${i}`);
        lb.Items = coll;
        // AllowMarqueeSelection AFTER Items so attachment sees a live panel.
        lb.AllowMarqueeSelection = true;
        const target = new HeadlessTarget(300, 300);
        target.Content = lb;
        target.Flush();
        return { lb, panel, target };
    }

    test('plain click in inter-tile gap clears the prior selection', () => {
        const { lb, panel } = buildWrapFixture();
        // Pre-select w0 (first cell) so we have something to clear.
        lb.SelectedItem = 'w0';
        assert.equal(lb.SelectedItem, 'w0');
        // Cell 0 is at panel-local (0..60, 0..60). Cell 1 at (75..135, 0..60).
        // The inter-cell gap on the X axis is (60..75) — click at x=67, y=30.
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 67, HostY: 30 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 67, HostY: 30 }));
        assert.equal(lb.SelectedItem, undefined, 'selection cleared after gap-click');
        assert.equal(lb.SelectedItems.length, 0);
    });

    test('plain click in the inter-row gap clears the prior selection', () => {
        const { lb, panel } = buildWrapFixture();
        lb.SelectedItem = 'w3'; // start of row 1
        // Row 0 at y=0..60, gap y=60..75, row 1 at y=75..135. Click y=68 in
        // the row gap, x=30 (col 0).
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 30, HostY: 68 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 30, HostY: 68 }));
        assert.equal(lb.SelectedItem, undefined, 'selection cleared after inter-row-gap click');
    });
});

describe('MarqueeSelectionBehavior — SelectionChanged batching', () => {
    beforeEach(() => { initTestApp(); });

    test('one SelectionChanged fire per move sample, not per row', () => {
        const { lb, panel } = buildFixture();
        lb.AllowMarqueeSelection = true;
        let fires = 0;
        lb.AddSelectionChangedListener(() => { fires++; });
        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: 10, HostY: 4 }));
        // Two move samples — each should fire SelectionChanged once
        // (and the initial replace-clear fires once on threshold crossing).
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 40 }));
        im.InjectPointerMove(panel, pointer({ HostX: 40, HostY: 80 }));
        im.InjectPointerUp  (panel, pointer({ HostX: 40, HostY: 80 }));
        assert.ok(fires > 0 && fires < 10,
            `expected a small bounded fire count (~3), got ${fires}`);
    });
});

describe('MarqueeSelectionBehavior — TreeView opt-in', () => {
    beforeEach(() => { initTestApp(); });

    test('Selector base hook works on any Selector descendant', () => {
        // Smoke-test that the DP machinery isn't ListBox-specific.
        const lb = new ListBox();
        assert.equal(Selector.AllowMarqueeSelectionKey !== undefined, true);
        assert.equal(lb.AllowMarqueeSelection, false);
        lb.AllowMarqueeSelection = true;
        assert.equal(lb.AllowMarqueeSelection, true);
    });
});
