import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Image, InlineUIContainer } from '../../index.js';
import { BitmapImage } from '../../../visual-engine/index.js';
import { SvgInline } from '../svg-inline.js';

function sizeOf(svg: string): { w: number; h: number }
{
    const img = (SvgInline.ToImage(svg) as InlineUIContainer).Child as Image;
    const src = img.Source as BitmapImage;
    return { w: src.NaturalSize.Width, h: src.NaturalSize.Height };
}

test('honours author-set width/height (the custom attributes)', () =>
{
    assert.deepEqual(sizeOf('<svg width="512" height="512" viewBox="0 0 256 256"></svg>'), { w: 512, h: 512 });
    assert.deepEqual(sizeOf('<svg width="128px" height="64px"></svg>'), { w: 128, h: 64 });
});

test('falls back to the viewBox size when width/height are absent', () =>
{
    assert.deepEqual(sizeOf('<svg viewBox="0 0 100 50"></svg>'), { w: 100, h: 50 });
});

test('derives the missing dimension from the viewBox aspect', () =>
{
    // width only → height = width * (vbH / vbW)
    assert.deepEqual(sizeOf('<svg width="200" viewBox="0 0 100 50"></svg>'), { w: 200, h: 100 });
});

test('a percentage width is not treated as pixels (falls back to viewBox)', () =>
{
    assert.deepEqual(sizeOf('<svg width="100%" viewBox="0 0 40 20"></svg>'), { w: 40, h: 20 });
});

test('defaults to a square when neither width/height nor viewBox is present', () =>
{
    assert.deepEqual(sizeOf('<svg></svg>'), { w: 256, h: 256 });
});

test('clamps an oversized SVG to the reading-column width, preserving aspect', () =>
{
    assert.deepEqual(sizeOf('<svg width="2000" height="1000"></svg>'), { w: 680, h: 340 });
});

test('encodes the SVG as a data:image/svg+xml URI', () =>
{
    const img = (SvgInline.ToImage('<svg width="10" height="10"><rect/></svg>') as InlineUIContainer).Child as Image;
    assert.ok((img.Source as BitmapImage).Uri.startsWith('data:image/svg+xml'));
});

test('LooksLikeSvg / Extract recognise a real element and ignore non-SVG', () =>
{
    assert.equal(SvgInline.LooksLikeSvg('  <svg width="1"></svg>'), true);
    assert.equal(SvgInline.LooksLikeSvg('not svg'), false);
    assert.equal(SvgInline.Extract('lead\n<svg viewBox="0 0 1 1"><path/></svg>\ntrail'), '<svg viewBox="0 0 1 1"><path/></svg>');
    assert.equal(SvgInline.Extract('no svg here'), undefined);
});
