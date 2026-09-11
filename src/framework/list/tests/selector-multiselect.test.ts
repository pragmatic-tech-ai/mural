import { ModifierKeys, toModifierKeys } from '../../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import {
    Application,
    NoModifiers,
    Visual,
    type ModifierKeys,
} from '../../../runtime/index.js';
import { Border } from '../../../basic/border.js';
import { Selector, SelectionMode } from '../selector.js';

// Tiny Selector subclass for testing the promoted API directly,
// without entangling ListBox/TreeView template wiring. Containers
// are attached via the public AttachContainer hook so they land in
// logicalChildren without going through Items / GetContainer / template
// realization — that's the path the multi-select machinery cares about.
// resolveItemAt / resolveIndexOf / containerForItem walk logicalChildren
// directly because we bypass the Items pipeline.
class TestSelector extends Selector
{
    constructor() { super(); }
    public AddTestChild(c: Visual): void { this.AttachContainer(c); }
    protected override resolveItemAt(idx: number): unknown
    {
        const cs = this.logicalChildren;
        return idx >= 0 && idx < cs.length ? cs[idx] : undefined;
    }
    protected override resolveIndexOf(item: unknown): number
    {
        return this.logicalChildren.indexOf(item as Visual);
    }
    protected override containerForItem(item: unknown): Visual | undefined
    {
        return this.logicalChildren.includes(item as Visual) ? (item as Visual) : undefined;
    }
}

function modifiers(extras: { Shift?: boolean; Control?: boolean; Alt?: boolean; Meta?: boolean } = {}): ModifierKeys
{
    return toModifierKeys({ shift: extras.Shift, control: extras.Control, alt: extras.Alt, meta: extras.Meta });
}

describe('Selector — defaults', () => {
    beforeEach(() => { initTestApp(); });

    test('SelectionMode defaults to Single', () => {
        const s = new TestSelector();
        assert.equal(s.SelectionMode, SelectionMode.Single);
    });

    test('SelectedItems is empty initially', () => {
        const s = new TestSelector();
        assert.deepEqual(s.SelectedItems, []);
    });

    test('SelectedIndex / SelectedItem / SelectedValue start unset', () => {
        const s = new TestSelector();
        assert.equal(s.SelectedIndex,  -1);
        assert.equal(s.SelectedItem,   undefined);
        assert.equal(s.SelectedValue,  undefined);
    });
});

describe('Selector — attached IsSelected DP', () => {
    beforeEach(() => { initTestApp(); });

    test('Selector.GetIsSelected defaults to false on any Visual', () => {
        const v = new Border();
        assert.equal(Selector.GetIsSelected(v), false);
    });

    test('Selector.SetIsSelected flips the attached value', () => {
        const v = new Border();
        Selector.SetIsSelected(v, true);
        assert.equal(Selector.GetIsSelected(v), true);
        Selector.SetIsSelected(v, false);
        assert.equal(Selector.GetIsSelected(v), false);
    });

    test('attached IsSelected fires PropertyChanged listeners on each write', () => {
        const v = new Border();
        let last: boolean | undefined;
        v.PropertyChanged(Selector.IsSelectedKey).subscribe(({ newValue }) => {
            last = newValue as boolean;
        });
        Selector.SetIsSelected(v, true);
        assert.equal(last, true);
        Selector.SetIsSelected(v, false);
        assert.equal(last, false);
    });
});

describe('Selector — HandleContainerClick (Single mode)', () => {
    beforeEach(() => { initTestApp(); });

    test('plain click selects one container, exposes via SelectedItem / SelectedItems', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);

        s.HandleContainerClick(a, modifiers());

        assert.equal(s.SelectedItem, a);
        assert.deepEqual(s.SelectedItems, [a]);
        assert.equal(Selector.GetIsSelected(a), true);
        assert.equal(Selector.GetIsSelected(b), false);
    });

    test('clicking a different row replaces the prior selection', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);

        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers());

        assert.equal(s.SelectedItem, b);
        assert.deepEqual(s.SelectedItems, [b]);
        assert.equal(Selector.GetIsSelected(a), false);
        assert.equal(Selector.GetIsSelected(b), true);
    });

    test('Ctrl / Shift modifiers are ignored in Single mode', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);

        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers({ Shift: true }));

        // Shift in Single mode is treated as a plain click.
        assert.deepEqual(s.SelectedItems, [b]);
    });
});

describe('Selector — HandleContainerClick (Multiple mode)', () => {
    beforeEach(() => { initTestApp(); });

    test('plain clicks toggle membership without modifiers', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Multiple;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        const c = new Border(); s.AddTestChild(c);

        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers());
        s.HandleContainerClick(c, modifiers());
        // Toggle b off.
        s.HandleContainerClick(b, modifiers());

        assert.equal(s.SelectedItems.length, 2);
        const sel = new Set(s.SelectedItems);
        assert.equal(sel.has(a), true);
        assert.equal(sel.has(b), false);
        assert.equal(sel.has(c), true);
        assert.equal(Selector.GetIsSelected(b), false);
    });
});

describe('Selector — HandleContainerClick (Extended mode)', () => {
    beforeEach(() => { initTestApp(); });

    test('Ctrl+click toggles a row without clearing the rest', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Extended;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        const c = new Border(); s.AddTestChild(c);

        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers({ Control: true }));
        s.HandleContainerClick(c, modifiers({ Control: true }));

        assert.equal(s.SelectedItems.length, 3);
    });

    test('Shift+click extends range from anchor in items-order', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Extended;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        const c = new Border(); s.AddTestChild(c);
        const d = new Border(); s.AddTestChild(d);

        s.HandleContainerClick(a, modifiers());            // anchor = a
        s.HandleContainerClick(c, modifiers({ Shift: true }));

        assert.deepEqual(new Set(s.SelectedItems), new Set([a, b, c]));
        assert.equal(Selector.GetIsSelected(d), false);
    });

    test('Shift+click pivots against the anchor across successive Shift+clicks', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Extended;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        const c = new Border(); s.AddTestChild(c);
        const d = new Border(); s.AddTestChild(d);

        s.HandleContainerClick(b, modifiers());                  // anchor = b
        s.HandleContainerClick(d, modifiers({ Shift: true }));   // b..d
        s.HandleContainerClick(a, modifiers({ Shift: true }));   // a..b — pivots back

        assert.deepEqual(new Set(s.SelectedItems), new Set([a, b]));
    });
});

describe('Selector — ClearSelection / SelectionChanged', () => {
    beforeEach(() => { initTestApp(); });

    test('ClearSelection empties the selection and fires SelectionChanged once', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Multiple;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers());

        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });
        s.ClearSelection();

        assert.equal(s.SelectedItems.length, 0);
        assert.equal(Selector.GetIsSelected(a), false);
        assert.equal(Selector.GetIsSelected(b), false);
        assert.equal(fires, 1);
    });

    test('ClearSelection on an empty selection is a silent no-op', () => {
        const s = new TestSelector();
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });
        s.ClearSelection();
        assert.equal(fires, 0);
    });

    test('SelectionChanged fires on each modifying click', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });
        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers());
        assert.equal(fires, 2);
    });
});

describe('Selector — BeginUpdate / EndUpdate bulk transaction', () => {
    beforeEach(() => { initTestApp(); });

    test('mutations inside Begin/End coalesce into ONE SelectionChanged fire', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Multiple;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        const c = new Border(); s.AddTestChild(c);
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });

        s.BeginUpdate();
        s.HandleContainerClick(a, modifiers());
        s.HandleContainerClick(b, modifiers());
        s.HandleContainerClick(c, modifiers());
        // No listener fires yet — still inside the transaction.
        assert.equal(fires, 0);
        s.EndUpdate();
        assert.equal(fires, 1);
        assert.equal(s.SelectedItems.length, 3);
    });

    test('nested transactions only flush on the outermost EndUpdate', () => {
        const s = new TestSelector();
        s.SelectionMode = SelectionMode.Multiple;
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });

        s.BeginUpdate();
        s.HandleContainerClick(a, modifiers());
        s.BeginUpdate();
        s.HandleContainerClick(b, modifiers());
        s.EndUpdate();
        assert.equal(fires, 0, 'inner End does not flush');
        s.EndUpdate();
        assert.equal(fires, 1, 'outer End flushes');
    });

    test('EndUpdate without an outstanding BeginUpdate is a no-op', () => {
        const s = new TestSelector();
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });
        s.EndUpdate();
        s.EndUpdate();
        assert.equal(fires, 0);
    });

    test('a transaction with no mutations does NOT fire SelectionChanged', () => {
        const s = new TestSelector();
        let fires = 0;
        s.AddSelectionChangedListener(() => { fires++; });
        s.BeginUpdate();
        s.EndUpdate();
        assert.equal(fires, 0);
    });
});

describe('Selector — programmatic SelectedIndex / SelectedItem writes', () => {
    beforeEach(() => { initTestApp(); });

    test('SelectedIndex setter flips IsSelected on the matching container', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);
        s.SelectedIndex = 1;

        assert.equal(Selector.GetIsSelected(b), true);
        assert.deepEqual(s.SelectedItems, [b]);
    });

    test('SelectedItem setter selects the container directly', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        const b = new Border(); s.AddTestChild(b);

        s.SelectedItem = a;
        assert.equal(Selector.GetIsSelected(a), true);
        assert.deepEqual(s.SelectedItems, [a]);
    });

    test('SelectedItem = undefined clears the selection', () => {
        const s = new TestSelector();
        const a = new Border(); s.AddTestChild(a);
        s.SelectedItem = a;
        assert.equal(Selector.GetIsSelected(a), true);

        s.SelectedItem = undefined;
        assert.equal(Selector.GetIsSelected(a), false);
        assert.deepEqual(s.SelectedItems, []);
    });
});
