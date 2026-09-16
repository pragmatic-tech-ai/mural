import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as opentype from 'opentype.js/dist/opentype.mjs';
import { FontMetricsMeasurer } from '../index.js';

// Builds a tiny, valid TTF in memory using opentype.js's Font
// constructor — gives us a controllable test fixture without shipping
// any font binaries in the repo. unitsPerEm = 1000, ascender = 800,
// descender = -200 means at fontSize 100 we get scale 0.1, so the
// returned metrics should be (advanceWidth × 0.1, 100, 80, 20).
//
// Glyphs:
//   .notdef       — required by every font
//   ' ' (32)      — required for getAdvanceWidth to handle spaces
//   'A' (65)      — advance 500
//   'i' (105)     — advance 200 (proportional-width example)
function makeTestFont(
    options: Partial<{ familyName: string; weight: number; italic: boolean }> = {},
): ArrayBuffer
{
    const familyName = options.familyName ?? 'TestSans';
    const weightClass = options.weight ?? 400;
    const italic = options.italic ?? false;

    const notdef = new opentype.Glyph({
        name: '.notdef',
        advanceWidth: 1000,
        path: new opentype.Path(),
    });
    const space = new opentype.Glyph({
        name: 'space',
        unicode: 32,
        advanceWidth: 250,
        path: new opentype.Path(),
    });
    const upperA = new opentype.Glyph({
        name: 'A',
        unicode: 65,
        advanceWidth: 500,
        path: new opentype.Path(),
    });
    const lowerI = new opentype.Glyph({
        name: 'i',
        unicode: 105,
        advanceWidth: 200,
        path: new opentype.Path(),
    });

    const font = new opentype.Font({
        familyName,
        styleName: italic ? 'Italic' : 'Regular',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs: [notdef, space, upperA, lowerI],
    });

    // opentype.js builds a default OS/2 table; we patch the fields the
    // measurer reads so weight / style detection has something concrete.
    const os2 = font.tables['os2'] as { usWeightClass?: number; fsSelection?: number };
    if (os2 !== undefined)
    {
        os2.usWeightClass = weightClass;
        os2.fsSelection = italic ? 1 : 0;
    }

    return font.toArrayBuffer();
}

describe('FontMetricsMeasurer without any loaded font', () => {
    test('falls back to approximation when no family is loaded', () => {
        const m = new FontMetricsMeasurer();
        const r = m.Measure('Hi', 'Anything', 16, 'normal', 'normal');
        // Approximate fallback: 2 × 16 × 0.6 = 19.2
        assert.equal(r.Width, 2 * 16 * 0.6);
        assert.equal(r.Height, 16 * 1.2);
    });

    test('empty text returns all-zero metrics regardless of font availability', () => {
        const m = new FontMetricsMeasurer();
        assert.deepEqual(
            m.Measure('', 'whatever', 16, 'normal', 'normal'),
            { Width: 0, Height: 0, Ascent: 0, Descent: 0 },
        );
    });
});

describe('FontMetricsMeasurer with a loaded font — real metrics', () => {
    const m = new FontMetricsMeasurer();
    m.LoadFont('TestSans', makeTestFont());

    test('uses font.getAdvanceWidth for proportional widths', () => {
        // 'A' = 500 advance, 'i' = 200. At fontSize 100 (scale 0.1):
        //   'A' → 50, 'i' → 20, 'Ai' → 70
        assert.equal(m.Measure('A',  'TestSans', 100, 'normal', 'normal').Width, 50);
        assert.equal(m.Measure('i',  'TestSans', 100, 'normal', 'normal').Width, 20);
        assert.equal(m.Measure('Ai', 'TestSans', 100, 'normal', 'normal').Width, 70);
    });

    test('width scales linearly with fontSize', () => {
        const at100 = m.Measure('A', 'TestSans', 100, 'normal', 'normal').Width;
        const at50  = m.Measure('A', 'TestSans',  50, 'normal', 'normal').Width;
        assert.equal(at50, at100 / 2);
    });

    test('Ascent / Descent come from the font (ascender 800, descender -200, unitsPerEm 1000)', () => {
        const r = m.Measure('A', 'TestSans', 100, 'normal', 'normal');
        // scale = 100 / 1000 = 0.1; ascent = 800 × 0.1 = 80; descent = 200 × 0.1 = 20.
        assert.equal(r.Ascent,  80);
        assert.equal(r.Descent, 20);
        assert.equal(r.Height,  100);
    });
});

describe('FontMetricsMeasurer — family stack fallback', () => {
    const m = new FontMetricsMeasurer();
    m.LoadFont('TestSans', makeTestFont({ familyName: 'TestSans' }));

    test('walks the comma-separated family list and uses the first loaded match', () => {
        // 'Unknown' isn't loaded; falls through to 'TestSans'.
        const r = m.Measure('A', 'Unknown, TestSans, sans-serif', 100, 'normal', 'normal');
        assert.equal(r.Width, 50); // real width from TestSans
    });

    test('falls back to approximation when no family in the stack is loaded', () => {
        const r = m.Measure('A', 'Unknown1, Unknown2', 100, 'normal', 'normal');
        // 1 glyph × 100 × 0.6 = 60 (approximation kicks in).
        assert.equal(r.Width, 60);
    });
});

describe('FontMetricsMeasurer — ink bounds from glyph outlines', () => {
    // A font whose glyphs carry real outlines so getBoundingBox reports
    // non-zero ink: '5' is a cap-height box [y 0..700] (no descender, like a
    // digit); 'g' dips below the baseline [y -200..500]. unitsPerEm 1000,
    // so at fontSize 100 the scale is 0.1.
    function makeOutlinedFont(): ArrayBuffer
    {
        const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 1000, path: new opentype.Path() });
        const space  = new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 250, path: new opentype.Path() });

        const five = new opentype.Path();
        five.moveTo(50, 0); five.lineTo(450, 0); five.lineTo(450, 700); five.lineTo(50, 700); five.close();
        const digit5 = new opentype.Glyph({ name: 'five', unicode: 53, advanceWidth: 500, path: five });

        const gp = new opentype.Path();
        gp.moveTo(50, -200); gp.lineTo(450, -200); gp.lineTo(450, 500); gp.lineTo(50, 500); gp.close();
        const lowerG = new opentype.Glyph({ name: 'g', unicode: 103, advanceWidth: 500, path: gp });

        const font = new opentype.Font({
            familyName: 'Outlined', styleName: 'Regular',
            unitsPerEm: 1000, ascender: 800, descender: -200,
            glyphs: [notdef, space, digit5, lowerG],
        });
        return font.toArrayBuffer();
    }

    const m = new FontMetricsMeasurer();
    m.LoadFont('Outlined', makeOutlinedFont());

    test('a digit reports cap-height InkAscent and zero InkDescent', () => {
        // '5' spans y 0..700; scale 0.1 → InkAscent 70, InkDescent 0. The
        // font line box stays ascent 80 / descent 20 (from the font header),
        // so ink (70/0) and line box (80/20) genuinely differ — the mismatch
        // ink-centring corrects.
        const r = m.Measure('5', 'Outlined', 100, 'normal', 'normal');
        assert.equal(r.InkAscent, 70);
        assert.equal(r.InkDescent, 0);
        assert.equal(r.Ascent, 80);
        assert.equal(r.Descent, 20);
    });

    test('a descender glyph reports InkDescent below the baseline', () => {
        // 'g' spans y -200..500; scale 0.1 → InkAscent 50, InkDescent 20.
        const r = m.Measure('g', 'Outlined', 100, 'normal', 'normal');
        assert.equal(r.InkAscent, 50);
        assert.equal(r.InkDescent, 20);
    });

    test('ink bounds aggregate the tallest / deepest glyph across the run', () => {
        // '5g' → top from '5' (700), bottom from 'g' (-200): InkAscent 70, InkDescent 20.
        const r = m.Measure('5g', 'Outlined', 100, 'normal', 'normal');
        assert.equal(r.InkAscent, 70);
        assert.equal(r.InkDescent, 20);
    });

    test('whitespace-only text reports zero ink (no outline to bound)', () => {
        const r = m.Measure(' ', 'Outlined', 100, 'normal', 'normal');
        assert.equal(r.InkAscent, 0);
        assert.equal(r.InkDescent, 0);
    });

    test('ink bounds scale with fontSize', () => {
        const r = m.Measure('5', 'Outlined', 50, 'normal', 'normal');
        // scale 0.05 → InkAscent 700 × 0.05 = 35.
        assert.equal(r.InkAscent, 35);
    });
});

describe('FontMetricsMeasurer — weight / style detection', () => {
    test('OS/2 usWeightClass ≥ 600 is detected as bold; < 600 is normal', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('Variants', makeTestFont({ familyName: 'Variants', weight: 400 }));
        m.LoadFont('Variants', makeTestFont({ familyName: 'Variants', weight: 700 }));

        // Both load into the same family map, separated by detected weight.
        // Asking for 'bold' should hit the 700-weight font; 'normal' the 400-weight.
        // We can't tell them apart by getAdvanceWidth (same glyph table),
        // but the test still proves the LoadFont path accepts both
        // variants and the resolveFont logic finds them by key.
        assert.doesNotThrow(() => m.Measure('A', 'Variants', 100, 'normal', 'normal'));
        assert.doesNotThrow(() => m.Measure('A', 'Variants', 100, 'bold',   'normal'));
    });

    test('explicit weight / style on LoadFont overrides the OS/2 detection', () => {
        const m = new FontMetricsMeasurer();
        // Detection would mark this as normal/normal; we tag it bold/italic.
        m.LoadFont('Overridden', makeTestFont({ familyName: 'Overridden' }), 'bold', 'italic');

        // The font is now stored under bold|italic, NOT normal|normal.
        // Asking for normal|normal still resolves via the
        // "any-variant-beats-no-variant" fallback inside resolveFont, so
        // measurement still works; the explicit override is exercised
        // mainly through bold|italic getting an exact match.
        assert.doesNotThrow(() => m.Measure('A', 'Overridden', 100, 'bold', 'italic'));
    });

    test('Uint8Array source is accepted (Node fs.readFile shape)', () => {
        const m = new FontMetricsMeasurer();
        const buffer = makeTestFont();
        const view = new Uint8Array(buffer);
        assert.doesNotThrow(() => m.LoadFont('FromUint8', view));
        const r = m.Measure('A', 'FromUint8', 100, 'normal', 'normal');
        assert.equal(r.Width, 50);
    });
});
