import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as opentype from 'opentype.js/dist/opentype.mjs';

import { makeGlyphResolver } from '../font-glyph-geometry.js';

// Build a tiny TTF with a named, unicode-mapped 'home' glyph (an open
// triangle) so the resolver can be addressed both by glyph NAME and by
// CODEPOINT. opentype.js writes a post (format 2) table on toArrayBuffer,
// so glyph names survive the round-trip and nameToGlyphIndex works.
function makeFontBuffer(): ArrayBuffer
{
    const notdef = new opentype.Glyph({ name: '.notdef', advanceWidth: 1000, path: new opentype.Path() });
    const home = new opentype.Path();
    home.moveTo(0, 0); home.lineTo(500, 800); home.lineTo(1000, 0); home.close();
    const homeGlyph = new opentype.Glyph({
        name: 'home', unicode: 0xe88a, advanceWidth: 1000, path: home,
    });
    const font = new opentype.Font({
        familyName: 'TestIcons', styleName: 'Regular',
        unitsPerEm: 1000, ascender: 800, descender: -200,
        glyphs: [notdef, homeGlyph],
    });
    return font.toArrayBuffer();
}

const HOME_CP = String.fromCodePoint(0xe88a);

let dir: string;
before(() => {
    dir = mkdtempSync(join(tmpdir(), 'mural-glyphs-'));
    writeFileSync(join(dir, 'icons.ttf'), Buffer.from(makeFontBuffer()));
});
after(() => { rmSync(dir, { recursive: true, force: true }); });

describe('makeGlyphResolver', () => {

    test('resolves a glyph by NAME → a PathGeometry expression + imports', () => {
        const resolve = makeGlyphResolver(dir);
        const res = resolve('icons.ttf', [{ key: 'home', name: 'home' }]);

        assert.equal(res.entries.length, 1);
        assert.equal(res.entries[0]!.key, 'home');
        assert.match(res.entries[0]!.valueJs, /^new PathGeometry\(\[new PathFigure\(/);
        const imp = res.imports![0]!;
        assert.equal(imp.module, '@pragmatic-tech-ai/mural/visual-engine');
        assert.ok(imp.names.includes('PathGeometry'));
        assert.ok(imp.names.includes('PathFigure'));
        assert.ok(imp.names.includes('LineSegment'));
    });

    test('resolves the SAME glyph by CODEPOINT identically', () => {
        const resolve = makeGlyphResolver(dir);
        const byName = resolve('icons.ttf', [{ key: 'home', name: 'home' }]);
        const byCp   = resolve('icons.ttf', [{ key: 'home', codepoint: HOME_CP }]);
        assert.equal(byCp.entries[0]!.valueJs, byName.entries[0]!.valueJs);
    });

    test('outline is Y-flipped at raw font units (triangle apex below baseline)', () => {
        const res = makeGlyphResolver(dir)('icons.ttf', [{ key: 'home', name: 'home' }]);
        // font coords M(0,0) L(500,800) L(1000,0) → Y-down at scale 1:
        // start (0,0), then a line to (500,-800), then (1000,0).
        assert.match(res.entries[0]!.valueJs, /new Point\(500, -800\)/);
    });

    test('many entries in one call share a single parsed font', () => {
        const res = makeGlyphResolver(dir)('icons.ttf', [
            { key: 'a', name: 'home' },
            { key: 'b', codepoint: HOME_CP },
        ]);
        assert.deepEqual(res.entries.map(e => e.key), ['a', 'b']);
    });

    test('unknown glyph name → a clear error pointing at the codepoint escape', () => {
        assert.throws(
            () => makeGlyphResolver(dir)('icons.ttf', [{ key: 'mystery', name: 'mystery' }]),
            /no glyph named 'mystery'.*codepoint/s,
        );
    });

    test('codepoint with no glyph in the font → a clear error', () => {
        assert.throws(
            () => makeGlyphResolver(dir)('icons.ttf', [{ key: 'x', codepoint: String.fromCodePoint(0xe999) }]),
            /no glyph for codepoint U\+E999/,
        );
    });
});
