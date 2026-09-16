// §19-deferred #4 — opentype.js glyph outline → PathFigure[].
//
// Used by FontMetricsMeasurer.BuildGeometry and text-on-path. The
// fundamental coordinate-system note: opentype.js paths use the
// font-design coordinate system where Y is UP (and the glyph's
// origin sits on its baseline). Mural is Y-DOWN. So we flip Y on the
// way through: every font (x, y) becomes (scale * x, -scale * y).
// Baseline placement is up to the caller — pass `originX` /
// `originY` to position each glyph in world space.
//
// opentype.js path commands:
//   { type: 'M', x, y }            — start a new contour
//   { type: 'L', x, y }            — lineTo
//   { type: 'Q', x1, y1, x, y }    — quadTo
//   { type: 'C', x1, y1, x2, y2, x, y } — cubicTo
//   { type: 'Z' }                  — close

import type * as opentype from 'opentype.js/dist/opentype.mjs';

import { Point } from '../primitives.js';
import {
    CubicBezierSegment,
    LineSegment,
    PathFigure,
    PathGeometry,
    type PathSegment,
    QuadraticBezierSegment,
} from '../geometry/geometry.js';

interface GlyphLowering
{
    figures: PathFigure[];
    /** width of the glyph in world units after `scale` (= advanceWidth * scale). */
    advance: number;
}

export function glyphToFigures(
    glyph: opentype.Glyph,
    scale: number,
    originX: number,
    originY: number,
): GlyphLowering
{
    const figures: PathFigure[] = [];
    const advance = (glyph.advanceWidth ?? 0) * scale;

    if (glyph.path === undefined || glyph.path.commands === undefined)
    {
        return { figures, advance };
    }

    const cmds = glyph.path.commands as ReadonlyArray<{
        type: 'M' | 'L' | 'Q' | 'C' | 'Z';
        x?: number; y?: number;
        x1?: number; y1?: number;
        x2?: number; y2?: number;
    }>;

    const px = (fx: number): number => originX + scale * fx;
    const py = (fy: number): number => originY - scale * fy;   // Y flip

    let segs: PathSegment[] = [];
    let start: Point | undefined = undefined;
    let pen:   Point | undefined = undefined;

    const flush = (closed: boolean): void => {
        if (start !== undefined && segs.length > 0)
        {
            figures.push(new PathFigure(start, segs, closed));
        }
        else if (start !== undefined && segs.length === 0 && closed === false)
        {
            // Lone moveTo (rare — degenerate glyph) — discard.
        }
        segs = [];
        start = undefined;
        pen   = undefined;
    };

    for (const cmd of cmds)
    {
        switch (cmd.type)
        {
            case 'M': {
                flush(false);
                const p = new Point(px(cmd.x!), py(cmd.y!));
                start = p;
                pen   = p;
                break;
            }
            case 'L': {
                if (start === undefined) break;
                const p = new Point(px(cmd.x!), py(cmd.y!));
                segs.push(new LineSegment(p));
                pen = p;
                break;
            }
            case 'Q': {
                if (start === undefined) break;
                const c1 = new Point(px(cmd.x1!), py(cmd.y1!));
                const p  = new Point(px(cmd.x!),  py(cmd.y!));
                segs.push(new QuadraticBezierSegment(c1, p));
                pen = p;
                break;
            }
            case 'C': {
                if (start === undefined) break;
                const c1 = new Point(px(cmd.x1!), py(cmd.y1!));
                const c2 = new Point(px(cmd.x2!), py(cmd.y2!));
                const p  = new Point(px(cmd.x!),  py(cmd.y!));
                segs.push(new CubicBezierSegment(c1, c2, p));
                pen = p;
                break;
            }
            case 'Z': {
                flush(true);
                break;
            }
        }
    }
    flush(false);
    void pen;
    return { figures, advance };
}

// Build a full PathGeometry for a run of text in a single resolved
// opentype.Font, laid out left-to-right with pairwise kerning. The
// glyph outlines are Y-flipped to mural's Y-down space and scaled to
// `fontSize`; the run's baseline sits at y = 0 with the first glyph's
// origin at x = 0.
//
// We walk `charToGlyph` per character rather than opentype.js's full
// layout (font.getPath / getAdvanceWidth), which throws on modern
// fonts whose GSUB tables use lookup formats the library doesn't
// implement. Tradeoff: no ligatures / contextual alternates — callers
// that need an icon-font glyph must pass its raw codepoint character,
// not a ligature name. Shared by FontMetricsMeasurer.BuildGeometry and
// the basic GlyphGeometryConverter so both stay byte-for-byte in sync.
// Build a PathGeometry for a single already-resolved glyph (e.g. one
// looked up by name via font.nameToGlyphIndex, bypassing charToGlyph).
// The outline is Y-flipped to mural's Y-down space and scaled so the
// font's em maps to `emSize`; the glyph origin sits at (0, 0). Pass
// `font.unitsPerEm` as emSize to keep raw font-unit coordinates.
export function glyphOutlineToGeometry(
    glyph: opentype.Glyph,
    emSize: number,
    unitsPerEm: number,
): PathGeometry
{
    const scale = emSize / unitsPerEm;
    return new PathGeometry(glyphToFigures(glyph, scale, 0, 0).figures);
}

export function fontGlyphRunToGeometry(
    font: opentype.Font,
    text: string,
    fontSize: number,
): PathGeometry
{
    if (text === '') return new PathGeometry([]);

    const scale = fontSize / font.unitsPerEm;
    const figures: PathFigure[] = [];
    let cursor = 0;
    let prev: opentype.Glyph | undefined;
    for (const ch of Array.from(text))
    {
        const glyph = font.charToGlyph(ch);
        if (prev !== undefined)
        {
            cursor += font.getKerningValue(prev, glyph) * scale;
        }
        const lowering = glyphToFigures(glyph, scale, cursor, 0);
        for (const f of lowering.figures) figures.push(f);
        cursor += lowering.advance;
        prev = glyph;
    }
    return new PathGeometry(figures);
}
