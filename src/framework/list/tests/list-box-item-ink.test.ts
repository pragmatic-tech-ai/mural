// Regression: a ListBox row's headline ink must be reactive.
//
// A string item is wrapped in a bare TextBlock with no Foreground
// (ListBox.PrepareContainerForItemOverride), slotted into the
// ListBoxItem's PART_HeadlineSlot. Before the fix it took the
// non-reactive render-time @Fg1 fallback (its Foreground DP stayed
// undefined), so on a theme / scheme swap the list kept the previous
// scheme's colour until a re-render — e.g. selecting a row — happened to
// repaint it. The fix sets a reactive TextBlock.Foreground on the
// ListBoxItem Style; the headline inherits it (DynamicResource) and
// re-tints on every swap.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ThemeManager } from '../../../runtime/index.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Selector } from '../selector.js';
import { ListBox, ListBoxItem } from '../list-box.js';
import { TextBlock } from '../../../basic/text-block.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { PragmaticLight, PragmaticDark } from '../../../resources/pragmatic/pragmatic.js';

function tokenCss(app: Application, key: string): string
{
    const b = app.Resources.Resolve(key);
    assert.ok(b instanceof SolidColorBrush, `${key} resolves to a brush`);
    return b.Color.ToCss();
}

function fg(tb: TextBlock): string | undefined
{
    const b = tb.Foreground;
    return b instanceof SolidColorBrush ? b.Color.ToCss() : undefined;
}

describe('ListBoxItem — headline ink is reactive (re-tints on scheme swap)', () => {

    test('a string row inherits a reactive @Fg1 that follows the scheme', () => {
        const app = initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const lb = new ListBox();
        lb.Items = ['Alpha', 'Beta', 'Gamma'];
        const item = lb.Generator.ContainerFromItem('Alpha') as ListBoxItem;
        const headline = item.Content as TextBlock;
        assert.ok(headline instanceof TextBlock, 'string item wrapped in a TextBlock');

        // Reactive inherited ink — NOT undefined (the pre-fix fallback path).
        assert.equal(fg(headline), tokenCss(app, 'Fg1'), 'light: headline = @Fg1');

        ThemeManager.ActivateScheme(PragmaticDark.name);
        assert.equal(fg(headline), tokenCss(app, 'Fg1'),
            'dark: headline followed the swap (reactive, not frozen)');

        ThemeManager.ActivateScheme(PragmaticLight.name);
        assert.equal(fg(headline), tokenCss(app, 'Fg1'), 'light again: still tracking');
    });

    test('a selected row takes @BrandGreenInk', () => {
        const app = initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const lb = new ListBox();
        lb.Items = ['Alpha', 'Beta'];
        const item = lb.Generator.ContainerFromItem('Beta') as ListBoxItem;
        const headline = item.Content as TextBlock;

        Selector.SetIsSelected(item, true);
        assert.equal(fg(headline), tokenCss(app, 'BrandGreenInk'),
            'selected headline = @BrandGreenInk');
    });
});
