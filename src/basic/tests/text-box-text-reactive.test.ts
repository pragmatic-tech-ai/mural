// Regression: a TextBox's editor must repaint when Text changes via a path
// that bypasses the `set Text` accessor — i.e. a two-way / one-way binding
// pushing a new source value into the Text DP, or any raw set_property_value.
//
// The accessor (set Text) and the internal edit primitives (insertText /
// replaceRange) invalidate the child TextEditorSurface explicitly. A binding
// writes the DP through the effective-value system, NOT the accessor, so
// without a TextKey property-changed listener the editor kept painting the old
// glyphs — a VM clearing a two-way-bound TextBox saw the value clear but the
// text stay on screen. The fix forwards TextKey changes to editor
// Invalidate{Measure,Visual}. This test pins that.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ThemeManager } from '../../runtime/index.js';
import { initTestApp } from './test-app.js';
import { TextBox } from '../text-box.js';
import { PragmaticLight } from '../../resources/pragmatic/pragmatic.js';

interface EditorLike { InvalidateVisual(): void }
function editorOf(tb: TextBox): EditorLike
{
    return (tb as unknown as { GetTemplateChild(n: string): EditorLike })
        .GetTemplateChild('PART_Editor');
}

describe('TextBox — editor repaints on a binding / VM-driven Text change', () => {

    test('a raw set_property_value on TextKey (the binding path) invalidates the editor', () => {
        initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const tb = new TextBox();
        tb.Text = 'hello';
        const editor = editorOf(tb);

        let invalidated = 0;
        const orig = editor.InvalidateVisual.bind(editor);
        editor.InvalidateVisual = (): void => { invalidated++; orig(); };

        // Simulate a two-way binding pushing the source's new value into the
        // target DP — this is the path that bypasses `set Text`.
        tb.set_property_value(TextBox.TextKey, '');

        assert.equal(tb.Text, '');
        assert.ok(invalidated > 0, 'editor invalidated on a binding-style Text change');
    });
});
