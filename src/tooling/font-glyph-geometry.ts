// Filesystem-backed `glyphs` resolver for the build pipeline.
//
// The compiler's `glyphs` keyword is policy-free — it delegates to this
// resolver, which owns font-file access and outline → geometry baking.
// Sibling of include-resolver.ts (which does .svg → geometry); here the
// source is a font file and each entry names one glyph.
//
// For each entry the resolver resolves an opentype.Glyph either by name
// (`home` → font.nameToGlyphIndex) or by codepoint (`home = ""`),
// extracts its outline as a PathGeometry at raw font-unit coordinates
// (Shape's fit-transform scales to the slot), and serializes it with the
// shared geometryToJs so SVG-include and font-glyph emit identically.
//
// Fonts are parsed once per absolute path and cached across entries and
// blocks within a single build.

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import * as opentype from 'opentype.js/dist/opentype.mjs';

import type { GlyphResolver, IncludeResolution } from '../compiler/compiler.js';
import { glyphOutlineToGeometry } from '../visual-engine/index.js';
import { geometryToJs } from './svg-geometry.js';

const VISUAL_ENGINE = '@pragmatic-tech-ai/mural/visual-engine';

export function makeGlyphResolver(baseDir: string): GlyphResolver
{
    const cache = new Map<string, opentype.Font>();

    const loadFont = (fontPath: string): opentype.Font =>
    {
        const abs = isAbsolute(fontPath) ? fontPath : resolve(baseDir, fontPath);
        let font = cache.get(abs);
        if (font === undefined)
        {
            const buf = readFileSync(abs);
            // opentype.parse wants an ArrayBuffer; slice exactly the file's
            // bytes out of Node's (possibly pooled) Buffer.
            const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            font = opentype.parse(ab);
            cache.set(abs, font);
        }
        return font;
    };

    return (fontPath, entries): IncludeResolution =>
    {
        const font  = loadFont(fontPath);
        const names = new Set<string>();
        const out: Array<{ key: string; valueJs: string }> = [];

        for (const e of entries)
        {
            const glyph = e.codepoint !== undefined
                ? glyphByCodepoint(font, e.codepoint, e.key)
                : glyphByName(font, e.name ?? e.key, e.key);
            // emSize = unitsPerEm → scale 1 → raw font-unit coordinates.
            const geo = glyphOutlineToGeometry(glyph, font.unitsPerEm, font.unitsPerEm);
            const { valueJs, names: used } = geometryToJs(geo);
            for (const u of used) names.add(u);
            out.push({ key: e.key, valueJs });
        }

        return {
            entries: out,
            imports: names.size > 0
                ? [{ module: VISUAL_ENGINE, names: [...names].sort() }]
                : [],
        };
    };
}

function glyphByName(font: opentype.Font, name: string, key: string): opentype.Glyph
{
    // Fast path: the `post` (format 2) name index. Many modern icon fonts
    // ship `post` format 3 (no names), where nameToGlyphIndex returns -1
    // even though glyph.name still resolves — so fall back to a scan.
    let glyph: opentype.Glyph | undefined;
    const idx = font.nameToGlyphIndex(name);
    if (idx >= 1)
    {
        glyph = font.glyphs.get(idx);
    }
    else
    {
        for (let i = 0; i < font.glyphs.length; i++)
        {
            const g = font.glyphs.get(i);
            if (g.name === name) { glyph = g; break; }
        }
    }
    if (glyph === undefined || glyph.name !== name)
    {
        throw new Error(
            `no glyph named '${name}' for resource '${key}' — give an explicit codepoint `
            + `(\`${key} = "\\uXXXX"\`) or check the name matches one in the font.`);
    }
    return glyph;
}

function glyphByCodepoint(font: opentype.Font, codepoint: string, key: string): opentype.Glyph
{
    const cp = codepoint.codePointAt(0);
    if (cp === undefined)
    {
        throw new Error(`empty codepoint string for resource '${key}'`);
    }
    const glyph = font.charToGlyph(String.fromCodePoint(cp));
    if (glyph === undefined || glyph.index === 0)
    {
        throw new Error(
            `font has no glyph for codepoint U+${cp.toString(16).toUpperCase().padStart(4, '0')} `
            + `(resource '${key}').`);
    }
    return glyph;
}
