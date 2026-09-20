// A Tooltip (ContentControl) handed a bare string must render it AND wrap
// it within the tooltip's MaxWidth. Regression for two coupled gaps:
//   * ContentControl.resolveContentVisual returned undefined for non-Visual
//     primitives, so a bare string (the ToolTipService path) slotted
//     nothing.
//   * The tooltip template's `Content = $Content` bound the presenter to
//     DataContext.Content (never the Tooltip's own Content), so even the
//     workaround path didn't deliver the text.
// Fix: ContentControl stringifies primitives into a wrapping TextBlock, and
// the tooltip uses a bare ContentPresenter it slots into.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Visual, Visibility } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Tooltip } from '../tooltip.js';
import { Button } from '../../buttons/button.js';
import { TextBlock, TextWrapping } from '../../../basic/text-block.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

const LONG = 'This is a fairly long tooltip string that should wrap onto several lines '
    + 'when the surface caps its width, instead of running off in one line past the edge.';

function firstTextBlock(root: Visual): TextBlock | undefined
{
    if (root instanceof TextBlock && (root.Text ?? '').length > 20) return root;
    for (const k of (root as unknown as { visualChildren: Iterable<Visual> }).visualChildren)
    {
        const f = firstTextBlock(k);
        if (f !== undefined) return f;
    }
    return undefined;
}

describe('ContentControl + Tooltip — bare-string content', () => {
    test('ContentControl renders a bare string as a wrapping TextBlock', () => {
        initTestApp();
        const btn = new Button();
        btn.Content = LONG as never;
        btn.MaxWidth = 200;
        new HeadlessTarget(1400, 800, btn).Flush();

        const tb = firstTextBlock(btn);
        assert.ok(tb !== undefined, 'the bare string rendered as a TextBlock');
        assert.equal(tb!.TextWrapping, TextWrapping.Wrap, 'the auto TextBlock wraps');
        // Wrapped: capped to the 200px width and taller than a single line.
        assert.ok(tb!.ArrangedRect.Width <= 200, `text fit within MaxWidth (got ${tb!.ArrangedRect.Width})`);
        assert.ok(tb!.ArrangedRect.Height > 24, `text grew to multiple lines (got ${tb!.ArrangedRect.Height})`);
    });

    test('Tooltip string content wraps within its 320px MaxWidth', () => {
        initTestApp();
        const tip = new Tooltip();
        tip.Content = LONG as never;
        tip.Visibility = Visibility.Visible;
        new HeadlessTarget(1400, 800, tip).Flush();

        const tb = firstTextBlock(tip);
        assert.ok(tb !== undefined, 'tooltip string rendered as a TextBlock');
        assert.equal(tb!.TextWrapping, TextWrapping.Wrap, 'tooltip text wraps');
        // The tooltip surface (Border) caps at MaxWidth=320; the wrapped
        // text is narrower than the raw single-line width and spans >1 line.
        assert.ok(tb!.ArrangedRect.Width <= 320, `wrapped within 320 (got ${tb!.ArrangedRect.Width})`);
        assert.ok(tb!.ArrangedRect.Height > 24, `wrapped to multiple lines (got ${tb!.ArrangedRect.Height})`);
    });
});
