import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { BitmapImage, Size, Stretch } from '../../../visual-engine/index.js';
import { ImageInline, ImageDisplay, DEFAULT_IMAGE_SIZE } from '../inlines.js';
import type { InlineHost } from '../text-element.js';

function newApp(): void { Application.current = null; new Application(); }

describe('ImageInline model', () => {
    test('defaults: Uniform stretch, Inline display, no explicit size', () => {
        newApp();
        const img = new ImageInline(new BitmapImage('data:image/png;base64,AAAA'));
        assert.equal(img.Stretch, Stretch.Uniform);
        assert.equal(img.Display, ImageDisplay.Inline);
        assert.equal(img.Width, undefined);
        assert.equal(img.Height, undefined);
        assert.equal(img.Source?.Uri, 'data:image/png;base64,AAAA');
    });

    test('LayoutWidth/Height: explicit wins, else NaturalSize, else default', () => {
        newApp();
        const src = new BitmapImage('http://x/y.png');
        const img = new ImageInline(src);
        // no explicit, no natural → default box
        assert.equal(img.LayoutWidth, DEFAULT_IMAGE_SIZE);
        assert.equal(img.LayoutHeight, DEFAULT_IMAGE_SIZE);
        // natural known → used
        src.NaturalSize = new Size(320, 200);
        assert.equal(img.LayoutWidth, 320);
        assert.equal(img.LayoutHeight, 200);
        // explicit overrides natural
        img.Width = 64;
        assert.equal(img.LayoutWidth, 64);
        assert.equal(img.LayoutHeight, 200);   // height still from natural
    });

    test('a late-known NaturalSize invalidates the hosting tree (re-layout)', () => {
        newApp();
        const src = new BitmapImage('blob:abc');
        const img = new ImageInline(src);
        let notified = 0;
        const host: InlineHost = { onInlineTreeChanged: () => { notified++; } };
        img.Parent = host;
        notified = 0;                       // ignore the assignment-time noise
        src.NaturalSize = new Size(48, 48);  // source decodes later
        assert.ok(notified >= 1, 'NaturalSize change bubbled a tree invalidation');
    });

    test('block-display image is configurable via ctor opts', () => {
        newApp();
        const img = new ImageInline(new BitmapImage('data:,'), { display: ImageDisplay.Block, width: 200, height: 120, stretch: Stretch.Fill });
        assert.equal(img.Display, ImageDisplay.Block);
        assert.equal(img.Width, 200);
        assert.equal(img.Height, 120);
        assert.equal(img.Stretch, Stretch.Fill);
    });
});
