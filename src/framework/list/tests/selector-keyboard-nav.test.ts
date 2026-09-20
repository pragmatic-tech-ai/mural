import { ModifierKeys, toModifierKeys } from '../../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import {
    KeyEventArgs,
    Key,
    NoModifiers,    Visual,
    type ModifierKeys,
} from '../../../runtime/index.js';
import { Border } from '../../../basic/border.js';
import { Selector, SelectionMode } from '../selector.js';

// § 10.8 — Keyboard navigation surface on Selector / ListBox / TreeView.
//
// These tests drive OnKeyDown directly via a typed cast so the route /
// InputManager / focus-sink stack stays out of the picture; the
// keyboard logic is purely a function of (focused container, key,
// modifiers, SelectionMode) → (selection state, focused container).

class TestSelector extends Selector
{
    constructor() { super(); }
    public AddTestChild(c: Visual): void { this.AttachContainer(c); }
    public TriggerKey(key: Key, mods: Partial<ModifierKeys> = {}): boolean
    {
        const args = new KeyEventArgs('KeyDown', this, {
            Key: key, KeyText: key, Code: key,            Modifiers: toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
            IsRepeat: false,
        });
        (this as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
        return args.Handled;
    }
    public SetFocused(c: Visual | undefined): void
    {
        (this as unknown as { _focusedContainer: Visual | undefined })._focusedContainer = c;
    }
    public SetAnchor(c: Visual | undefined): void
    {
        (this as unknown as { _anchor: Visual | undefined })._anchor = c;
    }
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

function makeSelector(count: number, mode: SelectionMode = SelectionMode.Extended): {
    selector: TestSelector;
    children: Visual[];
}
{
    const s = new TestSelector();
    s.SelectionMode = mode;
    const children: Visual[] = [];
    for (let i = 0; i < count; i++)
    {
        const c = new Border();
        s.AddTestChild(c);
        children.push(c);
    }
    return { selector: s, children };
}

describe('§ 10.8 — Selector keyboard navigation', () => {

    beforeEach(() => { initTestApp(); });

    test('ArrowDown with no prior focus selects the first container', () => {
        const { selector, children } = makeSelector(5);
        assert.equal(selector.TriggerKey(Key.Down), true);
        assert.equal(selector.FocusedContainer, children[0]);
        assert.equal(selector.SelectedItem, children[0]);
    });

    test('ArrowDown advances focus + selection by one container', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[1]);
        selector.TriggerKey(Key.Down);
        assert.equal(selector.FocusedContainer, children[2]);
        assert.equal(selector.SelectedItem, children[2]);
    });

    test('ArrowDown at the end stays on the last container', () => {
        const { selector, children } = makeSelector(3);
        selector.SetFocused(children[2]);
        selector.TriggerKey(Key.Down);
        assert.equal(selector.FocusedContainer, children[2]);
    });

    test('ArrowUp at the start stays on the first container', () => {
        const { selector, children } = makeSelector(3);
        selector.SetFocused(children[0]);
        selector.TriggerKey(Key.Up);
        assert.equal(selector.FocusedContainer, children[0]);
    });

    test('Home jumps to the first container', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[3]);
        selector.TriggerKey(Key.Home);
        assert.equal(selector.FocusedContainer, children[0]);
        assert.equal(selector.SelectedItem, children[0]);
    });

    test('End jumps to the last container', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[0]);
        selector.TriggerKey(Key.End);
        assert.equal(selector.FocusedContainer, children[4]);
        assert.equal(selector.SelectedItem, children[4]);
    });

    test('PageDown advances by viewport count (default 10) clamped at end', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[0]);
        selector.TriggerKey(Key.PageDown);
        assert.equal(selector.FocusedContainer, children[4]);
    });

    test('PageUp retreats by viewport count clamped at start', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[3]);
        selector.TriggerKey(Key.PageUp);
        assert.equal(selector.FocusedContainer, children[0]);
    });

    test('Shift+ArrowDown extends selection from anchor through new focus', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[1]);
        selector.SetAnchor(children[1]);
        selector.TriggerKey(Key.Down, { Shift: true });
        assert.equal(selector.FocusedContainer, children[2]);
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, [children[1], children[2]]);
    });

    test('Shift+End extends selection from anchor through last container', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[1]);
        selector.SetAnchor(children[1]);
        selector.TriggerKey(Key.End, { Shift: true });
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, [children[1], children[2], children[3], children[4]]);
    });

    test('Ctrl+ArrowDown moves focus without altering selection (Extended)', () => {
        const { selector, children } = makeSelector(5);
        selector.SetFocused(children[1]);
        selector.SetAnchor(children[1]);
        // Pre-seed a selection so we can verify it doesn't change.
        (selector as unknown as { setSelectedContainers(c: readonly Visual[]): void })
            .setSelectedContainers([children[1]]);
        selector.TriggerKey(Key.Down, { Control: true });
        assert.equal(selector.FocusedContainer, children[2]);
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, [children[1]],
            'Ctrl+ArrowDown should NOT alter selection');
    });

    test('Space toggles selection of focused container (Multiple mode)', () => {
        const { selector, children } = makeSelector(3, SelectionMode.Multiple);
        selector.SetFocused(children[1]);
        selector.TriggerKey(Key.Space);
        const after1 = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(after1, [children[1]]);
        selector.TriggerKey(Key.Space);
        const after2 = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(after2, []);
    });

    test('Ctrl+A selects all containers (Extended mode)', () => {
        const { selector, children } = makeSelector(4);
        selector.TriggerKey(Key.A, { Control: true });
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, children);
    });

    test('Ctrl+A is a no-op in Single mode', () => {
        const { selector, children } = makeSelector(4, SelectionMode.Single);
        selector.TriggerKey(Key.A, { Control: true });
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, []);
        void children;
    });

    test('Single mode: Shift+ArrowDown still single-selects (no extension)', () => {
        const { selector, children } = makeSelector(5, SelectionMode.Single);
        selector.SetFocused(children[1]);
        selector.TriggerKey(Key.Down, { Shift: true });
        const picked = selector.SelectedItems as readonly Visual[];
        assert.deepEqual(picked, [children[2]],
            'Single mode collapses Shift+Arrow to a plain single-select');
    });

    test('Unhandled keys (Tab, Escape) leave Handled=false', () => {
        const { selector, children } = makeSelector(3);
        selector.SetFocused(children[0]);
        assert.equal(selector.TriggerKey(Key.Tab),    false);
        assert.equal(selector.TriggerKey(Key.Escape), false);
    });

    test('Empty selector ignores arrow keys cleanly', () => {
        const s = new TestSelector();
        // No children — arrow key should be a no-op without throwing.
        assert.doesNotThrow(() => s.TriggerKey(Key.Down));
        assert.equal(s.FocusedContainer, undefined);
    });

    test('HandleContainerClick updates _focusedContainer so subsequent arrows continue from clicked row', () => {
        const { selector, children } = makeSelector(5);
        selector.HandleContainerClick(children[2], NoModifiers);
        assert.equal(selector.FocusedContainer, children[2]);
        selector.TriggerKey(Key.Down);
        assert.equal(selector.FocusedContainer, children[3]);
    });
});

// ── TreeView Left / Right collapse + expand ────────────────────────────

import { TreeView, TreeViewItem } from '../tree-view.js';

describe('§ 10.8 — TreeView Left/Right expand-collapse', () => {

    beforeEach(() => { initTestApp(); });

    function triggerKeyOnTree(tree: TreeView, key: Key): boolean
    {
        const args = new KeyEventArgs('KeyDown', tree, {
            Key: key, KeyText: key, Code: key,            Modifiers: NoModifiers,
            IsRepeat: false,
        });
        (tree as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
        return args.Handled;
    }

    function setFocused(tree: TreeView, c: TreeViewItem): void
    {
        (tree as unknown as { _focusedContainer: TreeViewItem })._focusedContainer = c;
    }

    test('ArrowRight on a collapsed node with children expands it', () => {
        const tree = new TreeView();
        const parent = new TreeViewItem();
        const child  = new TreeViewItem();
        parent.AddChild(child);
        tree.AddChild(parent);
        parent.IsExpanded = false;

        setFocused(tree, parent);
        const handled = triggerKeyOnTree(tree, Key.Right);

        assert.equal(handled, true);
        assert.equal(parent.IsExpanded, true);
    });

    test('ArrowLeft on an expanded node collapses it', () => {
        const tree = new TreeView();
        const parent = new TreeViewItem();
        const child  = new TreeViewItem();
        parent.AddChild(child);
        tree.AddChild(parent);
        parent.IsExpanded = true;

        setFocused(tree, parent);
        const handled = triggerKeyOnTree(tree, Key.Left);

        assert.equal(handled, true);
        assert.equal(parent.IsExpanded, false);
    });

    test('ArrowLeft on a collapsed leaf does NOT throw and is not handled (no parent)', () => {
        const tree = new TreeView();
        const leaf = new TreeViewItem();
        tree.AddChild(leaf);

        setFocused(tree, leaf);
        const handled = triggerKeyOnTree(tree, Key.Left);

        // Leaf with no parent: no expand/collapse, no parent to climb
        // to, so the key falls through to base Selector which doesn't
        // recognize ArrowLeft → handled stays false.
        assert.equal(handled, false);
        assert.equal(leaf.IsExpanded, false);
    });

    test('ArrowRight on an expanded node consumes the key without changing state', () => {
        const tree = new TreeView();
        const parent = new TreeViewItem();
        const child  = new TreeViewItem();
        parent.AddChild(child);
        tree.AddChild(parent);
        parent.IsExpanded = true;

        setFocused(tree, parent);
        const handled = triggerKeyOnTree(tree, Key.Right);

        assert.equal(handled, true,
            'ArrowRight on expanded node is consumed (parity with Explorer / VS Code)');
        assert.equal(parent.IsExpanded, true);
    });
});
