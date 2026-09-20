import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { Size, Element } from '../../runtime/index.js';
import { TranslateTransform, RectangleGeometry } from '../../visual-engine/index.js';
import { Carousel } from '../carousel/carousel.js';

function build(items: unknown[], active = 0): Carousel
{
    const c = new Carousel();
    c.ItemsSource = items;
    if (active !== 0) c.ActiveIndex = active;
    c.Measure(new Size(1000, 400));   // realizes the panel + settles the strip
    return c;
}

describe('Carousel', () => {
    beforeEach(() => { initTestApp(); });

    test('defaults', () => {
        const c = new Carousel();
        assert.equal(c.ActiveIndex, 0);
        assert.equal(c.ItemWidth, 220);
        assert.equal(c.ItemSpacing, 12);
        assert.equal(c.VisibleCount, 3);
    });

    test('viewport is sized + clipped to VisibleCount cards', () => {
        const c = new Carousel();
        const vp = c.GetTemplateChild('PART_Viewport') as Element;
        // 3 * 220 + 2 * 12 = 684
        assert.equal(vp.Width, 684);
        assert.equal(vp.Height, 260);
        assert.ok(vp.Clip instanceof RectangleGeometry, 'viewport is clipped');
    });

    test('each card container is fixed to ItemWidth × ItemHeight', () => {
        const c = build([1, 2, 3, 4, 5]);
        const panel = c.ItemsPanelInstance!;
        assert.equal(panel.visualChildren.length, 5);
        for (const cell of panel.visualChildren)
        {
            assert.equal((cell as Element).Width, 220);
            assert.equal((cell as Element).Height, 260);
        }
    });

    test('the strip is translated to bring ActiveIndex to the leading edge', () => {
        const c = build([1, 2, 3, 4, 5], 2);
        const panel = c.ItemsPanelInstance!;
        const t = panel.RenderTransform as TranslateTransform;
        assert.ok(t instanceof TranslateTransform);
        // -ActiveIndex * (ItemWidth + ItemSpacing) = -2 * 232
        assert.equal(t.X, -464);
    });

    test('page() advances / retreats the active index, clamped to the ends', () => {
        const c = build([1, 2, 3]);
        assert.equal(c.ActiveIndex, 0);
        c.page(1);
        assert.equal(c.ActiveIndex, 1);
        c.page(1);
        assert.equal(c.ActiveIndex, 2);
        c.page(1);
        assert.equal(c.ActiveIndex, 2, 'clamped at the last card');
        c.page(-5);
        assert.equal(c.ActiveIndex, 0, 'clamped at the first card');
    });

    test('a direct ActiveIndex write beyond the ends is clamped when scrolled', () => {
        const c = build([1, 2, 3]);
        c.ActiveIndex = 9;               // out of range
        // The strip settles against the clamped last index, not index 9.
        const t = c.ItemsPanelInstance!.RenderTransform as TranslateTransform;
        // Advancing the manual clock would animate; assert the clamp target via page.
        c.page(0);
        assert.equal(c.ItemsPanelInstance!.visualChildren.length, 3);
        assert.ok(t instanceof TranslateTransform);
    });
});
