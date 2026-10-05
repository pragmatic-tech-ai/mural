import { Key, ModifierKeys, toModifierKeys, type KeyEventInit } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { HeadlessTarget } from '../../visual-engine/index.js';
import { EditableTextBlock } from '../editable-text-block.js';
import { TextBox } from '../text-box.js';

function key(k: Key, mods: Partial<ModifierKeys> = {}, code?: string): KeyEventInit
{
    return {
        Key:       k,
        KeyText:   k,
        Code:      code ?? k,
        Modifiers: toModifierKeys({ shift: mods.Shift, control: mods.Control, alt: mods.Alt, meta: mods.Meta }),
        IsRepeat:  false,
    };
}

// Stand up an EditableTextBlock inside a HeadlessTarget so keyboard
// dispatch (InjectKeyDown) and focus (Focus() -> InputManager.SetFocus)
// flow end-to-end, the same way text-box.test.ts / spin-edit.test.ts
// mount their controls. Mounting directly as target.Content (no Panel
// wrapper) keeps Measure/Arrange running for the active child.
function fixture(): { eb: EditableTextBlock; target: HeadlessTarget; editor: TextBox }
{
    const eb = new EditableTextBlock();
    const target = new HeadlessTarget(200, 60);
    target.Content = eb;
    target.Flush();

    // Reach into the private inner TextBox the same way spin-edit.test.ts
    // reaches `_textBox` — an implementation detail consumers shouldn't
    // depend on, but tests need to assert against it.
    const editor = (eb as unknown as { _editor: TextBox })._editor;
    return { eb, target, editor };
}

describe('EditableTextBlock — display / edit toggle', () => {
    beforeEach(() => { initTestApp(); });

    test('IsEditing=false shows Text and no inner TextBox is active', () => {
        const { eb } = fixture();
        eb.Text = 'Alpha';
        assert.equal(eb.IsEditing, false);
        assert.equal(eb.child instanceof TextBox, false);
    });

    test('entering edit mode shows the inner TextBox seeded from EditingText, focused', () => {
        const { eb, editor } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';

        eb.IsEditing = true;

        assert.equal(eb.child, editor, 'the inner TextBox becomes the active child');
        assert.equal(editor.Text, 'Alpha', 'the editor shows the seeded EditingText');
        assert.equal(editor.IsFocused, true, 'the editor is focused on entry');
    });

    test('entering edit mode selects the whole name so typing replaces it (caret visible)', () => {
        const { eb, editor } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';

        eb.IsEditing = true;

        assert.equal(editor.SelectionStart, 0, 'selection starts at the beginning');
        assert.equal(editor.SelectionLength, 'Alpha'.length, 'the whole name is selected on entry');
    });

    test('typing into the inner TextBox updates EditingText (the reverse sync)', () => {
        const { eb, editor } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';
        eb.IsEditing = true;

        // Simulate the user typing by writing the inner TextBox's own Text
        // DP directly — the same DP a real keystroke mutates via TextBox's
        // own OnKeyDown/insertText path. This exercises the reverse half of
        // the Text<->EditingText sync (editor.Text -> EditingText), not
        // just the forward half (EditingText -> editor.Text) the other
        // tests drive by writing eb.EditingText.
        editor.Text = 'Typed By User';

        assert.equal(eb.EditingText, 'Typed By User');
    });
});

describe('EditableTextBlock — Enter commits', () => {
    beforeEach(() => { initTestApp(); });

    test('Enter fires Committed with the edited value and leaves edit mode', () => {
        const { eb, target } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';
        eb.IsEditing = true;

        // Simulate the user having typed — EditingText is the two-way
        // bound value the inner TextBox's own key handling would have
        // produced; here we drive it directly, mirroring how a caller's
        // binding delivers it, and exercise Enter through the REAL routed
        // KeyEventArgs path (InjectKeyDown), same as text-box.test.ts /
        // spin-edit.test.ts drive their own Key.Return assertions.
        eb.EditingText = 'Alpha Updated';

        let committed: string | undefined;
        eb.Committed.subscribe(value => { committed = value; });
        let cancelled = false;
        eb.Cancelled.subscribe(() => { cancelled = true; });

        const handled = target.InputManager.InjectKeyDown(key(Key.Return));

        assert.equal(handled, true);
        assert.equal(committed, 'Alpha Updated');
        assert.equal(cancelled, false);
        assert.equal(eb.IsEditing, false);
        assert.equal(eb.child instanceof TextBox, false, 'display shows again after commit');
    });

    test('losing focus commits — same as Enter', () => {
        const { eb, target } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';
        eb.IsEditing = true;
        eb.EditingText = 'Blurred Value';

        let committed: string | undefined;
        eb.Committed.subscribe(value => { committed = value; });

        // Moving focus elsewhere blurs the inner TextBox.
        target.InputManager.SetFocus(undefined);

        assert.equal(committed, 'Blurred Value');
        assert.equal(eb.IsEditing, false);
    });
});

describe('EditableTextBlock — Escape cancels', () => {
    beforeEach(() => { initTestApp(); });

    test('Escape fires Cancelled, leaves edit mode, and does not commit', () => {
        const { eb, target } = fixture();
        eb.Text = 'Alpha';
        eb.EditingText = 'Alpha';
        eb.IsEditing = true;
        eb.EditingText = 'Discarded Value';

        let committed = false;
        eb.Committed.subscribe(() => { committed = true; });
        let cancelled = false;
        eb.Cancelled.subscribe(() => { cancelled = true; });

        const handled = target.InputManager.InjectKeyDown(key(Key.Escape));

        assert.equal(handled, true);
        assert.equal(cancelled, true);
        assert.equal(committed, false);
        assert.equal(eb.IsEditing, false);
        // Text was never written by the control itself — only the
        // caller (reacting to Committed) would do that.
        assert.equal(eb.Text, 'Alpha');
    });
});
