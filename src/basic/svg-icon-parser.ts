import {
    ArcSegment,
    CubicBezierSegment,
    EllipseGeometry,
    LineGeometry,
    LineSegment,
    PathFigure,
    PathGeometry,
    PathSegment,
    QuadraticBezierSegment,
    RectangleGeometry,
    SweepDirection,
    type Geometry,
} from '../visual-engine/index.js';
import { Color, Point, Rect, Size } from '../visual-engine/primitives.js';
import {
    CURRENT_COLOR,
    IconDefinition,
    type IconPaint,
    type IconShape,
} from './icon.js';

// Subset SVG → IconDefinition parser.
//
// Scope:
//   * Root `<svg viewBox="…">` (or `width=` / `height=` fallback).
//   * Top-level shapes: `<path>`, `<rect>`, `<circle>`, `<ellipse>`,
//     `<line>`, `<polygon>`, `<polyline>`.
//   * Paint attributes: `fill`, `stroke`, `stroke-width`. `currentColor`
//     and missing-fill both lower to the CURRENT_COLOR sentinel (so a
//     Recolor=true Icon paints the silhouette in Foreground).
//   * `<g>` grouping — children inherit paint attributes; nested groups
//     compose. `transform` attribute is NOT yet supported (drop with a
//     parser warning).
//
// Partial support:
//   * Gradient fills — `<linear|radialGradient>` defs are pre-scanned and a
//     `fill="url(#id)"` shape lowers to the gradient's first-stop color (a
//     solid stand-in; no true gradient paint). href-chained gradients skipped.
//
// Out of scope (sketch-level):
//   * `<symbol>`, `<use>` (icon packs that ship sprite sheets need a
//     pre-pass to expand them).
//   * Filters, masks, clip-paths, `<text>`.
//   * CSS styles (`style=` attribute, `<style>` blocks).
//   * Most `transform=` matrix / rotate / skew. Only the parent <g>
//     pattern is flagged; per-shape transforms drop silently for now.
//
// Implementation note: hand-written tokenizer — no DOMParser dep so the
// build tool runs in Node without jsdom. SVG is a constrained-enough
// subset that regex tag extraction + attribute parsing works cleanly.

// ── Public entry points ──────────────────────────────────────────────

export interface ParseOptions
{
    /** Default 24×24 viewBox for SVGs that omit one (Material Symbols
     *  optimized exports sometimes lose the attribute). Matches the
     *  industry-standard icon grid. */
    readonly DefaultViewBoxWidth?:  number;
    readonly DefaultViewBoxHeight?: number;
}

export function parseSvgIcon(svgText: string, opts: ParseOptions = {}): IconDefinition
{
    const defaultW = opts.DefaultViewBoxWidth  ?? 24;
    const defaultH = opts.DefaultViewBoxHeight ?? 24;

    // Find the <svg ...> opener. Tolerates whitespace / newlines / xmlns.
    const svgOpen = /<svg\b([^>]*)>/i.exec(svgText);
    if (svgOpen === null) throw new ParseError('parseSvgIcon: no <svg> root element');

    const svgAttrs = parseAttributes(svgOpen[1] ?? '');
    const viewBoxStr = svgAttrs.get('viewbox');
    let viewBoxW = defaultW;
    let viewBoxH = defaultH;
    if (viewBoxStr !== undefined)
    {
        const nums = parseNumbers(viewBoxStr);
        if (nums.length >= 4)
        {
            // viewBox = "min-x min-y width height" — we don't honor
            // min-x / min-y yet; assume 0/0 (the dominant case for icon
            // sets). A non-zero origin would need a translate frame.
            viewBoxW = nums[2] ?? defaultW;
            viewBoxH = nums[3] ?? defaultH;
        }
    }
    else
    {
        const w = parseFloatOr(svgAttrs.get('width'),  defaultW);
        const h = parseFloatOr(svgAttrs.get('height'), defaultH);
        viewBoxW = w;
        viewBoxH = h;
    }

    // Strip the outer <svg>…</svg> and parse children. The svg root
    // itself participates in the paint inheritance chain — many icon
    // packs (Lucide, Feather, Heroicons-outline) set fill="none" /
    // stroke="currentColor" / stroke-width="2" on the root and rely on
    // child shapes inheriting. Treat the root attrs identically to a
    // wrapping `<g>`.
    const bodyStart = svgOpen.index + svgOpen[0].length;
    const bodyEnd   = svgText.lastIndexOf('</svg>');
    const body      = svgText.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);

    // Pre-scan gradient defs so `fill="url(#id)"` shapes resolve to a solid
    // stand-in (see collectGradients) instead of the CURRENT_COLOR fallback.
    const gradients = collectGradients(body);
    const rootInherited = mergeInherited(EMPTY_INHERITED, svgAttrs, gradients);
    const shapes: IconShape[] = [];
    parseGroup(body, rootInherited, shapes, gradients);
    return new IconDefinition(viewBoxW, viewBoxH, shapes);
}

export class ParseError extends Error
{
    constructor(message: string) { super(message); this.name = 'ParseError'; }
}

// ── Group / shape walker ─────────────────────────────────────────────

// Attribute inheritance state — paint values walk down from each
// enclosing <g>. SVG's actual cascade is richer (CSS, presentation
// attributes); we only track the three we care about for icons.
interface InheritedPaint
{
    Fill:        IconPaint;
    Stroke:      IconPaint;
    StrokeWidth: number;
}
const EMPTY_INHERITED: InheritedPaint = Object.freeze({
    Fill:        CURRENT_COLOR,
    Stroke:      undefined,
    StrokeWidth: 0,
});

// Walk one body section, emitting shapes into `out`. Recurses into <g>.
function parseGroup(body: string, inherited: InheritedPaint, out: IconShape[], gradients: Map<string, Color>): void
{
    // Tag-level tokenizer. Each iteration finds the next opening tag,
    // extracts its attributes, and either:
    //   * Self-closing or no body → emit a single shape.
    //   * <g> → find matching </g>, recurse with merged inheritance.
    // Skips comments, processing instructions, text whitespace, and
    // unknown tags.
    let i = 0;
    while (i < body.length)
    {
        const open = body.indexOf('<', i);
        if (open === -1) break;
        // Comment / CDATA / PI / DOCTYPE — skip to '>'.
        if (body.startsWith('<!--', open))
        {
            const end = body.indexOf('-->', open + 4);
            if (end === -1) break;
            i = end + 3;
            continue;
        }
        if (body[open + 1] === '?' || body[open + 1] === '!')
        {
            const end = body.indexOf('>', open + 1);
            if (end === -1) break;
            i = end + 1;
            continue;
        }
        // Closing tag at this depth — bail out (caller handles it).
        if (body[open + 1] === '/') break;

        // Extract tag name + attribute body.
        const tagEnd = body.indexOf('>', open);
        if (tagEnd === -1) break;
        const tagBody = body.slice(open + 1, tagEnd);
        const selfClose = tagBody.endsWith('/');
        const inner = selfClose ? tagBody.slice(0, -1) : tagBody;
        const space = inner.search(/\s/);
        const tagName = (space === -1 ? inner : inner.slice(0, space)).toLowerCase();
        const attrsText = space === -1 ? '' : inner.slice(space + 1);
        const attrs = parseAttributes(attrsText);

        if (tagName === 'g')
        {
            // A self-closing `<g .../>` is an empty group (Adobe Illustrator
            // exports empty layers this way). It has no children to emit — skip
            // it. Treating it as an open <g> would leave findMatchingClose
            // depth-counting a phantom open it can never balance, so it returns
            // -1 and the whole parse bails out with zero shapes.
            if (selfClose)
            {
                i = tagEnd + 1;
                continue;
            }
            const merged = mergeInherited(inherited, attrs, gradients);
            // Walk to matching </g>. Nesting-aware (skip <g> opens that
            // aren't ours).
            const subEnd = findMatchingClose(body, tagEnd + 1, 'g');
            if (subEnd === -1) break;
            parseGroup(body.slice(tagEnd + 1, subEnd), merged, out, gradients);
            i = body.indexOf('>', subEnd) + 1;
            continue;
        }

        const shape = buildShape(tagName, attrs, inherited, gradients);
        if (shape !== undefined) out.push(shape);

        if (!selfClose)
        {
            // Non-shape tags with bodies (rare for icons — usually <text>
            // or <style>) — skip to matching close.
            const closeEnd = findMatchingClose(body, tagEnd + 1, tagName);
            if (closeEnd === -1) break;
            i = body.indexOf('>', closeEnd) + 1;
        }
        else
        {
            i = tagEnd + 1;
        }
    }
}

function findMatchingClose(body: string, from: number, tagName: string): number
{
    const open  = new RegExp(`<${tagName}\\b`, 'i');
    const close = new RegExp(`</${tagName}\\s*>`, 'i');
    let depth = 1;
    let i = from;
    while (i < body.length)
    {
        open.lastIndex = i;
        close.lastIndex = i;
        const o = body.slice(i).search(open);
        const c = body.slice(i).search(close);
        if (c === -1) return -1;
        if (o !== -1 && o < c)
        {
            depth++;
            i += o + 1;
            continue;
        }
        depth--;
        if (depth === 0) return i + c;
        i += c + 1;
    }
    return -1;
}

function mergeInherited(parent: InheritedPaint, attrs: Map<string, string>, gradients: Map<string, Color>): InheritedPaint
{
    const fillAttr   = attrs.get('fill');
    const strokeAttr = attrs.get('stroke');
    const swAttr     = attrs.get('stroke-width');
    return {
        Fill:        fillAttr   !== undefined ? parsePaint(fillAttr, gradients)   : parent.Fill,
        Stroke:      strokeAttr !== undefined ? parsePaint(strokeAttr, gradients) : parent.Stroke,
        StrokeWidth: swAttr     !== undefined ? parseFloat(swAttr)     : parent.StrokeWidth,
    };
}

function buildShape(
    tag:        string,
    attrs:      Map<string, string>,
    inherited:  InheritedPaint,
    gradients:  Map<string, Color>,
): IconShape | undefined
{
    const fillRaw   = attrs.get('fill');
    const strokeRaw = attrs.get('stroke');
    const swRaw     = attrs.get('stroke-width');
    const fill:        IconPaint = fillRaw   !== undefined ? parsePaint(fillRaw, gradients)   : inherited.Fill;
    const stroke:      IconPaint = strokeRaw !== undefined ? parsePaint(strokeRaw, gradients) : inherited.Stroke;
    const strokeWidth: number    = swRaw     !== undefined ? parseFloat(swRaw)     : inherited.StrokeWidth;

    let geometry: Geometry | undefined;
    switch (tag)
    {
        case 'path':
        {
            const d = attrs.get('d');
            if (d === undefined || d.trim() === '') return undefined;
            const figures = parsePathData(d);
            if (figures.length === 0) return undefined;
            geometry = new PathGeometry(figures);
            break;
        }
        case 'rect':
        {
            const x  = parseFloatOr(attrs.get('x'),      0);
            const y  = parseFloatOr(attrs.get('y'),      0);
            const w  = parseFloatOr(attrs.get('width'),  0);
            const h  = parseFloatOr(attrs.get('height'), 0);
            const rx = parseFloatOr(attrs.get('rx'),     0);
            const ry = parseFloatOr(attrs.get('ry'),     rx);
            if (w <= 0 || h <= 0) return undefined;
            geometry = new RectangleGeometry(new Rect(x, y, w, h), rx, ry);
            break;
        }
        case 'circle':
        {
            const cx = parseFloatOr(attrs.get('cx'), 0);
            const cy = parseFloatOr(attrs.get('cy'), 0);
            const r  = parseFloatOr(attrs.get('r'),  0);
            if (r <= 0) return undefined;
            geometry = new EllipseGeometry(new Point(cx, cy), r, r);
            break;
        }
        case 'ellipse':
        {
            const cx = parseFloatOr(attrs.get('cx'), 0);
            const cy = parseFloatOr(attrs.get('cy'), 0);
            const rx = parseFloatOr(attrs.get('rx'), 0);
            const ry = parseFloatOr(attrs.get('ry'), 0);
            if (rx <= 0 || ry <= 0) return undefined;
            geometry = new EllipseGeometry(new Point(cx, cy), rx, ry);
            break;
        }
        case 'line':
        {
            const x1 = parseFloatOr(attrs.get('x1'), 0);
            const y1 = parseFloatOr(attrs.get('y1'), 0);
            const x2 = parseFloatOr(attrs.get('x2'), 0);
            const y2 = parseFloatOr(attrs.get('y2'), 0);
            geometry = new LineGeometry(new Point(x1, y1), new Point(x2, y2));
            break;
        }
        case 'polygon':
        case 'polyline':
        {
            const pts = parseNumbers(attrs.get('points') ?? '');
            if (pts.length < 4) return undefined;
            const start = new Point(pts[0]!, pts[1]!);
            const segs: PathSegment[] = [];
            for (let k = 2; k + 1 < pts.length; k += 2)
            {
                segs.push(new LineSegment(new Point(pts[k]!, pts[k + 1]!)));
            }
            const figure = new PathFigure(start, segs, tag === 'polygon');
            geometry = new PathGeometry([figure]);
            break;
        }
        default:
            return undefined;
    }

    // Fold SVG opacity into the paints. `opacity` composites the whole element
    // (fill AND stroke); `fill-opacity` / `stroke-opacity` scale each channel.
    // A fully-transparent channel (e.g. the `fill="white" fill-opacity="0"`
    // full-canvas placeholder rect Figma/Fluent exports prepend) becomes no
    // paint at all, so it stops rendering as an opaque background square; a
    // partial value rides on the Color's alpha so semi-transparent shapes
    // convert faithfully.
    const elementOpacity = parseOpacity(attrs.get('opacity'));
    return {
        Geometry:    geometry,
        Fill:        applyOpacity(fill,   parseOpacity(attrs.get('fill-opacity'))   * elementOpacity),
        Stroke:      applyOpacity(stroke, parseOpacity(attrs.get('stroke-opacity')) * elementOpacity),
        StrokeWidth: strokeWidth,
    };
}

// Parse an SVG opacity attribute (`opacity` / `fill-opacity` / `stroke-opacity`)
// to a 0..1 factor, clamped; a missing / non-numeric value is fully opaque (1).
function parseOpacity(s: string | undefined): number
{
    if (s === undefined) return 1;
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(1, n));
}

// Apply an opacity factor to a paint: >= 1 leaves it untouched, <= 0 drops it
// to "no paint" (an invisible shape contributes nothing), and a partial value
// scales an authored Color's alpha. The currentColor sentinel can't carry an
// alpha, so a partial factor leaves it as-is (it recolours to Foreground).
function applyOpacity(paint: IconPaint, factor: number): IconPaint
{
    if (factor >= 1) return paint;
    if (factor <= 0) return undefined;
    if (paint === undefined || paint === CURRENT_COLOR) return paint;
    return paint.WithAlpha(Math.round(paint.A * factor));
}

// ── Attribute + token helpers ────────────────────────────────────────

function parseAttributes(text: string): Map<string, string>
{
    const out = new Map<string, string>();
    // name = "value" | name = 'value' | name=value (bare)
    const RE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(text)) !== null)
    {
        const name = (m[1] ?? '').toLowerCase();
        const value = m[2] ?? m[3] ?? m[4] ?? '';
        out.set(name, value);
    }
    return out;
}

function parseFloatOr(s: string | undefined, fallback: number): number
{
    if (s === undefined) return fallback;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
}

// Splits a string of SVG numbers (e.g. "0 0 24 24", "1,2,3.4 -5"). SVG
// number lists tolerate any combination of whitespace and commas.
function parseNumbers(s: string): number[]
{
    return (s.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

function parsePaint(s: string, gradients: Map<string, Color>): IconPaint
{
    const v = s.trim();
    if (v === '' || v.toLowerCase() === 'none') return undefined;
    if (v.toLowerCase() === 'currentcolor')     return CURRENT_COLOR;
    // `fill="url(#id)"` — resolve a gradient reference to its solid stand-in
    // (first stop). Unknown / non-gradient refs keep the currentColor fallback.
    const url = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(v);
    if (url !== null) return gradients.get(url[1]!) ?? CURRENT_COLOR;
    // SVG accepts named colors too — we'd need a table; for sketch we
    // hex / rgb only. Anything unrecognised falls back to currentColor
    // so the icon still paints.
    const color = parseColor(v);
    return color ?? CURRENT_COLOR;
}

// Pre-scan `<linearGradient>` / `<radialGradient>` defs into id → first-stop
// color. A gradient can't be a solid IconPaint, so a `url(#id)` fill lowers to
// the gradient's first stop — the convention Azure/Fluent icons follow (a
// darker base stop as the representative brand color). Gradients that only
// inherit stops via href (no own <stop>) are skipped; their url() falls back to
// CURRENT_COLOR, unchanged from before.
function collectGradients(body: string): Map<string, Color>
{
    const out = new Map<string, Color>();
    const re = /<(?:linear|radial)Gradient\b([^>]*)>([\s\S]*?)<\/(?:linear|radial)Gradient>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null)
    {
        const id = parseAttributes(m[1] ?? '').get('id');
        if (id === undefined) continue;
        const color = firstStopColor(m[2] ?? '');
        if (color !== undefined) out.set(id, color);
    }
    return out;
}

function firstStopColor(inner: string): Color | undefined
{
    const stop = /<stop\b([^>]*?)\/?>/i.exec(inner);
    if (stop === null) return undefined;
    const attrs = parseAttributes(stop[1] ?? '');
    const raw = attrs.get('stop-color') ?? styleProp(attrs.get('style'), 'stop-color');
    return raw !== undefined ? parseColor(raw.trim()) : undefined;
}

// Read one `prop: value` out of a `style="…"` attribute (icon packs sometimes
// put stop-color there instead of the presentation attribute).
function styleProp(style: string | undefined, prop: string): string | undefined
{
    if (style === undefined) return undefined;
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
    return m !== null ? m[1]!.trim() : undefined;
}

function parseColor(s: string): Color | undefined
{
    // Hex: #rgb, #rrggbb (with or without alpha)
    if (s.startsWith('#')) return safeHexColor(s);
    // rgb(r, g, b) / rgba(r, g, b, a)
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(s);
    if (rgb !== null)
    {
        const r = parseInt(rgb[1]!, 10);
        const g = parseInt(rgb[2]!, 10);
        const b = parseInt(rgb[3]!, 10);
        const a = rgb[4] !== undefined ? Math.round(parseFloat(rgb[4]) * 255) : 255;
        return new Color(r, g, b, a);
    }
    return undefined;
}

function safeHexColor(s: string): Color | undefined
{
    try { return Color.FromHex(s); }
    catch { return undefined; }
}

// ── SVG path data parser ─────────────────────────────────────────────

// Tokenizes an SVG path 'd' attribute into a sequence of PathFigures.
// Supports the full path-data grammar except elliptical-arc shorthand
// quirks (large-arc-flag / sweep-flag must be a single 0 or 1 — already
// the spec).
//
// SVG state machine:
//   * M / m sets the pen position AND opens a new figure.
//     Subsequent implicit commands after M default to L.
//   * Z / z closes the current figure (implicit lineto back to the
//     figure's StartPoint).
//   * After Z, the pen position is the figure's StartPoint until the
//     next M.
export function parsePathData(d: string): PathFigure[] {
    const figures: PathFigure[] = [];

    // Walk-state. `curX/Y` is the SVG pen; `figureStartX/Y` is the
    // anchor we close back to; `segs` accumulates the current figure;
    // `lastCubicCtrl{X,Y}` and `lastQuadCtrl{X,Y}` are kept for S / T
    // reflection.
    let curX = 0, curY = 0;
    let figureStartX = 0, figureStartY = 0;
    let segs: PathSegment[] = [];
    let figureOpen = false;
    let lastCmd = '';
    let lastCubicCtrlX: number | undefined;
    let lastCubicCtrlY: number | undefined;
    let lastQuadCtrlX:  number | undefined;
    let lastQuadCtrlY:  number | undefined;

    function flushFigure(isClosed: boolean): void
    {
        if (figureOpen && segs.length > 0)
        {
            figures.push(new PathFigure(new Point(figureStartX, figureStartY), segs, isClosed));
        }
        segs = [];
        figureOpen = false;
    }

    // Tokenizer state — emit either commands (single letters) or numbers
    // (signed float, optional exponent). SVG path-data also allows
    // flag-style 0/1 unit-tokens for arc commands; the generic number
    // matcher handles those too.
    const tokens = tokenizePathData(d);
    let ti = 0;

    while (ti < tokens.length)
    {
        const t = tokens[ti];
        if (typeof t !== 'string')
        {
            // Bare number with no preceding command means "repeat the
            // previous command", and after M / m the implicit repeat
            // is L / l.
            if (lastCmd === '') throw new ParseError(`SVG path: bare number with no command (${t})`);
            // re-dispatch using the previous command. Don't consume.
            executeCommand(lastCmd, false);
            continue;
        }

        const cmd = t;
        ti++;
        executeCommand(cmd, true);
    }

    flushFigure(false);
    return figures;

    // Inner closures access the walk state via closure. Reading numbers
    // calls `readNumber()` which advances `ti`. `consumedAsCmd` flags
    // whether the caller already advanced past the command letter — for
    // implicit-repeat dispatch we re-enter with the previous cmd letter
    // without advancing past anything.
    function executeCommand(cmd: string, _consumedAsCmd: boolean): void
    {
        const rel = cmd.toLowerCase() === cmd;
        const lc  = cmd.toLowerCase();

        // Implicit M-after-M repeats as L; otherwise lastCmd updates.
        let effective = cmd;
        switch (lc)
        {
            case 'm':
            {
                const x = readNumber() + (rel ? curX : 0);
                const y = readNumber() + (rel ? curY : 0);
                // First moveto in a path starts a figure at absolute
                // (rel m treats the implicit origin as (0,0)).
                flushFigure(false);
                curX = x;
                curY = y;
                figureStartX = x;
                figureStartY = y;
                figureOpen = true;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                // After M, implicit repeats are L (or l for lowercase m).
                effective = rel ? 'l' : 'L';
                break;
            }
            case 'l':
            {
                const x = readNumber() + (rel ? curX : 0);
                const y = readNumber() + (rel ? curY : 0);
                segs.push(new LineSegment(new Point(x, y)));
                curX = x; curY = y;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                break;
            }
            case 'h':
            {
                const x = readNumber() + (rel ? curX : 0);
                segs.push(new LineSegment(new Point(x, curY)));
                curX = x;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                break;
            }
            case 'v':
            {
                const y = readNumber() + (rel ? curY : 0);
                segs.push(new LineSegment(new Point(curX, y)));
                curY = y;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                break;
            }
            case 'c':
            {
                const c1x = readNumber() + (rel ? curX : 0);
                const c1y = readNumber() + (rel ? curY : 0);
                const c2x = readNumber() + (rel ? curX : 0);
                const c2y = readNumber() + (rel ? curY : 0);
                const  ex = readNumber() + (rel ? curX : 0);
                const  ey = readNumber() + (rel ? curY : 0);
                segs.push(new CubicBezierSegment(
                    new Point(c1x, c1y),
                    new Point(c2x, c2y),
                    new Point(ex, ey),
                ));
                curX = ex; curY = ey;
                lastCubicCtrlX = c2x; lastCubicCtrlY = c2y;
                lastQuadCtrlX  = lastQuadCtrlY = undefined;
                break;
            }
            case 's':
            {
                // S takes a single control point; the first control point
                // is the reflection of the previous cubic's second control
                // about the current point. When there's no previous cubic,
                // the reflection collapses to the current point.
                const c1x = lastCubicCtrlX !== undefined ? 2 * curX - lastCubicCtrlX : curX;
                const c1y = lastCubicCtrlY !== undefined ? 2 * curY - lastCubicCtrlY : curY;
                const c2x = readNumber() + (rel ? curX : 0);
                const c2y = readNumber() + (rel ? curY : 0);
                const  ex = readNumber() + (rel ? curX : 0);
                const  ey = readNumber() + (rel ? curY : 0);
                segs.push(new CubicBezierSegment(
                    new Point(c1x, c1y),
                    new Point(c2x, c2y),
                    new Point(ex, ey),
                ));
                curX = ex; curY = ey;
                lastCubicCtrlX = c2x; lastCubicCtrlY = c2y;
                lastQuadCtrlX  = lastQuadCtrlY = undefined;
                break;
            }
            case 'q':
            {
                const cx = readNumber() + (rel ? curX : 0);
                const cy = readNumber() + (rel ? curY : 0);
                const ex = readNumber() + (rel ? curX : 0);
                const ey = readNumber() + (rel ? curY : 0);
                segs.push(new QuadraticBezierSegment(
                    new Point(cx, cy),
                    new Point(ex, ey),
                ));
                curX = ex; curY = ey;
                lastQuadCtrlX = cx; lastQuadCtrlY = cy;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                break;
            }
            case 't':
            {
                const cx = lastQuadCtrlX !== undefined ? 2 * curX - lastQuadCtrlX : curX;
                const cy = lastQuadCtrlY !== undefined ? 2 * curY - lastQuadCtrlY : curY;
                const ex = readNumber() + (rel ? curX : 0);
                const ey = readNumber() + (rel ? curY : 0);
                segs.push(new QuadraticBezierSegment(
                    new Point(cx, cy),
                    new Point(ex, ey),
                ));
                curX = ex; curY = ey;
                lastQuadCtrlX = cx; lastQuadCtrlY = cy;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                break;
            }
            case 'a':
            {
                const rx        = readNumber();
                const ry        = readNumber();
                const xrotation = readNumber();
                const largeArc  = readNumber() !== 0;
                const sweepFlag = readNumber() !== 0;
                const ex        = readNumber() + (rel ? curX : 0);
                const ey        = readNumber() + (rel ? curY : 0);
                segs.push(new ArcSegment(
                    new Point(ex, ey),
                    new Size(rx, ry),
                    xrotation,
                    largeArc,
                    sweepFlag ? SweepDirection.Clockwise : SweepDirection.Counterclockwise,
                ));
                curX = ex; curY = ey;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                break;
            }
            case 'z':
            {
                flushFigure(true);
                curX = figureStartX;
                curY = figureStartY;
                lastCubicCtrlX = lastCubicCtrlY = undefined;
                lastQuadCtrlX  = lastQuadCtrlY  = undefined;
                break;
            }
            default:
                throw new ParseError(`SVG path: unknown command '${cmd}'`);
        }
        lastCmd = effective;
    }

    function readNumber(): number
    {
        const t = tokens[ti];
        if (t === undefined)        throw new ParseError(`SVG path: unexpected end of data`);
        if (typeof t === 'string')  throw new ParseError(`SVG path: expected number, got command '${t}'`);
        ti++;
        return t;
    }
}

// Path-d tokenizer. Emits a stream of strings (single-letter commands)
// and numbers. Inserts implicit separators where SVG's number list
// allows a leading sign without whitespace ("M10,20-30-40" splits as
// 10 20 -30 -40).
function tokenizePathData(d: string): (string | number)[]
{
    const out: (string | number)[] = [];
    let i = 0;
    while (i < d.length)
    {
        const c = d[i] ?? '';
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',')
        {
            i++;
            continue;
        }
        if (/[a-zA-Z]/.test(c))
        {
            out.push(c);
            i++;
            continue;
        }
        // Number — optional sign + digits + optional decimal + optional
        // exponent. We don't validate inside the regex; we just consume
        // characters while they look numeric.
        const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
        if (m === null) throw new ParseError(`SVG path: unexpected character '${c}' at ${i}`);
        out.push(parseFloat(m[0]));
        i += m[0].length;
    }
    return out;
}
