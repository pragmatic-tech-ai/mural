// Regression: a TextBox's text must re-tint when its Foreground changes.
//
// TextBox paints nothing itself — a child TextEditorSurface (PART_Editor)
// draws the glyphs, reading `textBox.Foreground` at render time.
// Foreground is Render-only on TextBox (no Measure), and TextBox's own
// visual is empty, so a Foreground change marks only TextBox render-dirty
// and the editor keeps the stale colour. The Style[TextBox] sets
// Foreground=@OnSurface via DynamicResource, so on a theme / scheme swap
// the DP re-resolves but the painted text used to stay frozen on the
// scheme active at first paint (visible as washed-out values in the
// SpinEdit-based number inputs).
//
// The fix forwards Foreground / CaretBrush / SelectionBrush changes to
// `editor.InvalidateVisual()`. This test pins that: a scheme swap that
// re-resolves @OnSurface must invalidate the editor surface.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ThemeManager, Color } from '../../runtime/index.js';
import { SolidColorBrush } from '../../visual-engine/index.js';
import { initTestApp } from './test-app.js';
import { TextBox } from '../text-box.js';
import { PragmaticLight, PragmaticDark } from '../../resources/pragmatic/pragmatic.js';

interface EditorLike { InvalidateVisual(): void }
function editorOf(tb: TextBox): EditorLike
{
    return (tb as unknown as { GetTemplateChild(n: string): EditorLike })
        .GetTemplateChild('PART_Editor');
}

describe('TextBox — editor re-tints on a Foreground (scheme) change', () => {

    test('a scheme swap re-resolving @OnSurface invalidates the editor surface', () => {
        initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const tb = new TextBox();
        tb.Text = 'hello';
        const editor = editorOf(tb);

        let invalidated = 0;
        const orig = editor.InvalidateVisual.bind(editor);
        editor.InvalidateVisual = (): void => { invalidated++; orig(); };

        // Swap to dark → Style[TextBox] @OnSurface DynamicResource updates
        // tb.Foreground → fix forwards to editor.InvalidateVisual.
        ThemeManager.ActivateScheme(PragmaticDark.name);
        assert.ok(invalidated > 0, 'editor invalidated on scheme swap (dark)');

        invalidated = 0;
        ThemeManager.ActivateScheme(PragmaticLight.name);
        assert.ok(invalidated > 0, 'editor invalidated on scheme swap (light)');
    });

    test('a direct Foreground write also invalidates the editor', () => {
        initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const tb = new TextBox();
        tb.Text = 'x';
        const editor = editorOf(tb);
        let invalidated = 0;
        const orig = editor.InvalidateVisual.bind(editor);
        editor.InvalidateVisual = (): void => { invalidated++; orig(); };

        // A concrete Local-tier write (beats the Style's @OnSurface).
        const red = new SolidColorBrush(Color.FromHex('#ff0000'));
        tb.Foreground = red;
        assert.equal(tb.Foreground, red);
        assert.ok(invalidated > 0, 'editor invalidated on a direct Foreground change');
    });
});
