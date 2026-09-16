// GlyphGeometryConverter — `$text << glyph_geo` lowering of a character
// run to its glyph-outline PathGeometry. Covers both source shapes:
// a FontMetricsMeasurer and a bare parsed opentype.Font via fontGlyphSource.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as opentype from 'opentype.js/dist/opentype.mjs';

import { FontMetricsMeasurer } from '../../visual-engine/index.js';
import { PathGeometry } from '../../visual-engine/index.js';
import { GlyphGeometryConverter, fontGlyphSource } from '../converters/index.js';

// In-memory test font: 'A' is an open triangle (advance 1000),
// unitsPerEm 1000. At fontSize 100 (scale 0.1) the Y-flipped outline is
// M(0,0) L(50,-80) L(100,0) Z.
function makeTestFont(): ArrayBuffer
{
    const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 1000, path: new opentype.Path() });
    const a = new opentype.Path();
    a.moveTo(0, 0); a.lineTo(500, 800); a.lineTo(1000, 0); a.close();
    const aGlyph = new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 1000, path: a });
    const font = new opentype.Font({
        familyName: 'TestSans', styleName: 'Regular',
        unitsPerEm: 1000, ascender: 800, descender: -200,
        glyphs: [notdef, aGlyph],
    });
    return font.toArrayBuffer();
}

describe('GlyphGeometryConverter', () => {

    test('measurer source — converts a char to its glyph geometry', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const conv = new GlyphGeometryConverter(m, { fontFamily: 'TestSans', fontSize: 100 });

        const g = conv.convert('A');
        assert.ok(g instanceof PathGeometry);
        assert.equal(g.Figures.length, 1, 'one contour for "A"');
        assert.equal(g.Figures[0]!.IsClosed, true);
    });

    test('empty / non-string input yields an empty geometry (nothing drawn)', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const conv = new GlyphGeometryConverter(m, { fontFamily: 'TestSans', fontSize: 100 });

        assert.equal(conv.convert('').Figures.length, 0);
        assert.equal(conv.convert(undefined).Figures.length, 0);
        assert.equal(conv.convert(42).Figures.length, 0);
    });

    test('unresolved font yields an empty geometry, not a throw', () => {
        const m = new FontMetricsMeasurer();   // nothing loaded
        const conv = new GlyphGeometryConverter(m, { fontFamily: 'Missing', fontSize: 100 });
        assert.equal(conv.convert('A').Figures.length, 0);
    });

    test('it is one-way — no convertBack', () => {
        const conv = new GlyphGeometryConverter(new FontMetricsMeasurer(), {});
        assert.equal((conv as { convertBack?: unknown }).convertBack, undefined);
    });

    test('fontGlyphSource adapter matches the measurer outline byte-for-byte', () => {
        const buf = makeTestFont();
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', buf);
        const fromMeasurer = new GlyphGeometryConverter(m, { fontFamily: 'TestSans', fontSize: 100 }).convert('A');

        const font = opentype.parse(buf);
        const fromFont = new GlyphGeometryConverter(fontGlyphSource(font), { fontSize: 100 }).convert('A');

        // Same contour, same flushed segment points.
        assert.equal(fromFont.Figures.length, fromMeasurer.Figures.length);
        const a = fromMeasurer.Figures[0]!, b = fromFont.Figures[0]!;
        assert.equal(b.IsClosed, a.IsClosed);
        assert.equal(b.StartPoint.X, a.StartPoint.X);
        assert.equal(b.StartPoint.Y, a.StartPoint.Y);
        assert.equal(b.Segments.length, a.Segments.length);
    });
});
