// Regression: a NavigationItem's slotted icon must take reactive themed
// ink, not the non-reactive render-time fallback.
//
// The icon is a consumer-supplied Visual (a Material-Symbols TextBlock)
// with no Foreground of its own. Before the fix it fell back to the
// render-time default, which freezes on the scheme active at first paint
// (washed-out icons after a light/dark swap). The fix sets a reactive
// TextBlock.Foreground on the NavigationItem Style (DynamicResource), so
// the slotted icon inherits @Fg2 at rest and
// @BrandGreenInk on the active pill — the Pragmatic icon roles.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { Application, Size, Rect, ThemeManager } from '../../runtime/index.js';
import { SvgRenderer, SolidColorBrush } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { TextBlock } from '../../basic/text-block.js';
import { NavigationItem } from '../navigation/navigation-item.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { PragmaticLight } from '../../resources/pragmatic/pragmatic.js';

function harness(): { renderer: SvgRenderer; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    doc.body.appendChild(surface);
    return { renderer: new SvgRenderer(surface, { document: doc }), surface };
}

function tokenCss(app: Application, key: string): string
{
    const b = app.Resources.Resolve(key);
    assert.ok(b instanceof SolidColorBrush, `${key} resolves to a brush`);
    return b.Color.ToCss();
}

function iconFill(surface: SVGSVGElement): string | null
{
    const t = Array.from(surface.querySelectorAll('text'))
        .find(el => (el.textContent || '').includes('animation'));
    return t ? t.getAttribute('fill') : null;
}

describe('NavigationItem — slotted icon takes reactive themed ink', () => {

    test('unselected icon = @Fg2, selected = @BrandGreenInk', () => {
        const app = initTestApp();
        ThemeManager.ActivateScheme(PragmaticLight.name);

        const item = new NavigationItem();
        item.Icon = new TextBlock('animation');
        const root = new Border();
        root.SetChild(item);

        const { renderer, surface } = harness();
        const paint = (): void => {
            root.Measure(new Size(120, 120));
            root.Arrange(new Rect(0, 0, 120, 120));
            renderer.Render(root, undefined, null, null);
        };

        paint();
        assert.equal(iconFill(surface), tokenCss(app, 'Fg2'),
            'resting icon inherits @Fg2 from the item');

        item.IsSelected = true;
        paint();
        assert.equal(iconFill(surface), tokenCss(app, 'BrandGreenInk'),
            'selected icon inherits @BrandGreenInk');

        // Not the non-reactive @Fg1 default ink (the pre-fix behaviour).
        assert.notEqual(iconFill(surface), tokenCss(app, 'Fg1'),
            'icon ink is themed, not the render-time @Fg1 default ink');
    });
});
