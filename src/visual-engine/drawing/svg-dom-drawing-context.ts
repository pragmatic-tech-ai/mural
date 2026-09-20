import type { Point, Rect } from '../primitives.js';
import type { DrawingContext } from '../../runtime/index.js';
import {
    AlignmentX,
    AlignmentY,
    Brush,
    GradientSpreadMethod,
    ImageBrush,
    LinearGradientBrush,
    PatternBrush,
    PatternKind,
    RadialGradientBrush,
    SolidColorBrush,
} from './brush.js';
import { DashStyle, LineCap, LineJoin, type Pen } from './pen.js';
import { EllipseGeometry, GeometryGroup, LineGeometry, PathGeometry, RectangleGeometry, type Geometry } from '../geometry/geometry.js';
import { pathGeometryToSvgD } from '../geometry/path-to-svg.js';
import { Transform } from './transform.js';
import { FontStyle, FontWeight, decorationsToCss, type FormattedText } from '../text/formatted-text.js';
import { Stretch, type ImageSource } from './image-source.js';

// DOM-mode DrawingContext. Mirrors SvgDrawingContext (string builder)
// but appends real SVG elements to a host node instead of accumulating
// markup. Used by SvgRenderer to paint into HtmlTarget's live surface
// — the in-DOM tree means hit-testing can use `event.target` to recover
// the Visual that owns each node (via the renderer's back-reference
// stamps on each visual's outer `<g>`).
//
// Construction takes the SVGElement the DC will paint into (typically
// the visual's "own primitives" group). Push* calls create nested
// `<g>` wrappers inside that root and push them as the new insertion
// point; Pop returns to the parent.
//
// The clip-path `<clipPath>` defs go into a shared `<defs>` element
// owned by the renderer — passed in at construction so multiple DC
// instances rendering the same surface share one id space.

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgDomDrawingContextOptions
{
    /** `<defs>` element that collects clip paths and (future) gradient
     *  / pattern definitions across all visuals on the surface. */
    defs: SVGDefsElement;
    /** Monotonic counter for unique clip-path IDs. Pass a shared
     *  closure so siblings rendered into the same `<defs>` don't
     *  collide. */
    nextClipId: () => string;
    /** Monotonic counter for unique gradient IDs — same shared-closure
     *  contract as `nextClipId`. Optional for backwards compat; when
     *  absent, gradient brushes fall back to `nextClipId`'s namespace. */
    nextGradientId?: () => string;
    /** Cross-DC cache of materialised ImageBrush `<pattern>` defs.
     *  Keyed by `${URI}::${preserveAspectRatio}` — same URI under a
     *  different Stretch / Alignment needs its own pattern. Lives on
     *  the renderer so repaintOwn cycles don't churn the `<image>`
     *  href on every paint. When a key hits, the pattern is reused
     *  in-place; on miss, the DC creates the pattern in `defs` and
     *  caches the resulting id here. */
    imagePatternCache?: Map<string, string>;
    /** Owner document — defaults to globalThis.document, but the
     *  renderer can supply a different one for off-screen rendering
     *  (jsdom in tests, OffscreenCanvas adjacency, etc.). */
    document?: Document;
}

export class SvgDomDrawingContext implements DrawingContext
{
    private readonly stack: SVGElement[];
    private readonly defs:           SVGDefsElement;
    private readonly nextClipId:     () => string;
    private readonly nextGradientId: () => string;
    private readonly imagePatternCache: Map<string, string>;
    private readonly doc:            Document;

    constructor(root: SVGElement, options: SvgDomDrawingContextOptions)
    {
        this.stack          = [root];
        this.defs           = options.defs;
        this.nextClipId     = options.nextClipId;
        this.nextGradientId = options.nextGradientId ?? options.nextClipId;
        this.imagePatternCache = options.imagePatternCache ?? new Map<string, string>();
        this.doc            = options.document ?? globalThis.document;
    }

    // Append a `<linearGradient>` for `brush` to the CURRENT insertion
    // group (alongside the rendered primitives that reference it) and
    // return its id. Inlining the def — rather than parking it in the
    // shared `<defs>` — means the gradient gets dropped automatically
    // when the renderer wipes the visual's own group on repaint, so a
    // brush rebuild on every pointer move (the gradient-rail picker
    // pattern) doesn't leak `<linearGradient>` nodes into the document.
    // SVG spec: gradient elements render no pixels themselves, so
    // inlining them next to the rect that references them is legal and
    // doesn't perturb the visual output.
    public materializeLinearGradient(brush: LinearGradientBrush): string
    {
        const id = this.nextGradientId();
        const g = this.doc.createElementNS(SVG_NS, 'linearGradient');
        g.setAttribute('id', id);
        // Brush coords are bbox-normalised ([0,1]×[0,1]) — same default
        // as SVG's `objectBoundingBox` gradientUnits, so no mapping.
        g.setAttribute('x1', formatNumber(brush.StartPoint.X));
        g.setAttribute('y1', formatNumber(brush.StartPoint.Y));
        g.setAttribute('x2', formatNumber(brush.EndPoint.X));
        g.setAttribute('y2', formatNumber(brush.EndPoint.Y));
        const spread = brush.SpreadMethod;
        if (spread === GradientSpreadMethod.Reflect) g.setAttribute('spreadMethod', 'reflect');
        else if (spread === GradientSpreadMethod.Repeat) g.setAttribute('spreadMethod', 'repeat');
        for (const stop of brush.GradientStops)
        {
            const s = this.doc.createElementNS(SVG_NS, 'stop');
            s.setAttribute('offset', formatNumber(stop.Offset));
            s.setAttribute('stop-color', stop.Color.ToCss());
            if (stop.Color.A < 255)
            {
                s.setAttribute('stop-opacity', formatNumber(stop.Color.A / 255));
            }
            g.appendChild(s);
        }
        this.current().appendChild(g);
        return id;
    }

    // Same lifecycle / namespace as materializeLinearGradient, but for
    // SVG `<radialGradient>`. Cosmetic SVG limitation: <radialGradient>
    // only takes a single `r`; an elliptical brush (RadiusX != RadiusY)
    // lowers to `r=RadiusX` plus a gradientTransform that scales the Y
    // axis around the centre to land RadiusY in the perpendicular
    // direction. GradientOrigin (off-centre focal point) isn't on the
    // brush yet; SVG defaults `fx`/`fy` to `cx`/`cy`, matching the
    // brush's "uniform outward" semantics.
    public materializeRadialGradient(brush: RadialGradientBrush): string
    {
        const id = this.nextGradientId();
        const g = this.doc.createElementNS(SVG_NS, 'radialGradient');
        g.setAttribute('id', id);
        const cx = brush.Center.X;
        const cy = brush.Center.Y;
        const rx = brush.RadiusX;
        const ry = brush.RadiusY;
        g.setAttribute('cx', formatNumber(cx));
        g.setAttribute('cy', formatNumber(cy));
        g.setAttribute('r',  formatNumber(rx));
        if (rx !== 0 && rx !== ry)
        {
            // Scale Y around the centre so r=RadiusX in X stays put while
            // the perpendicular reach becomes RadiusY. The translate-scale-
            // translate sandwich keeps the centre fixed.
            const s = ry / rx;
            g.setAttribute(
                'gradientTransform',
                `matrix(1, 0, 0, ${formatNumber(s)}, 0, ${formatNumber(cy * (1 - s))})`,
            );
        }
        const spread = brush.SpreadMethod;
        if (spread === GradientSpreadMethod.Reflect) g.setAttribute('spreadMethod', 'reflect');
        else if (spread === GradientSpreadMethod.Repeat) g.setAttribute('spreadMethod', 'repeat');
        for (const stop of brush.GradientStops)
        {
            const s = this.doc.createElementNS(SVG_NS, 'stop');
            s.setAttribute('offset', formatNumber(stop.Offset));
            s.setAttribute('stop-color', stop.Color.ToCss());
            if (stop.Color.A < 255)
            {
                s.setAttribute('stop-opacity', formatNumber(stop.Color.A / 255));
            }
            g.appendChild(s);
        }
        this.current().appendChild(g);
        return id;
    }

    // SVG `<pattern>` wrapping a single `<image>` for ImageBrush. Stretch
    // + AlignmentX + AlignmentY combine into a single
    // `preserveAspectRatio` token: Fill = "none", Uniform = "meet",
    // UniformToFill = "slice", None falls back to "xMidYMid meet" at
    // natural-size scaling. Tiling isn't a separate brush flag yet —
    // ImageBrush always paints once, sized to the bbox; if you want
    // tiling, use a PatternBrush.
    public materializeImagePattern(brush: ImageBrush): string | undefined
    {
        const src = brush.ImageSource;
        if (src === undefined) return undefined;
        const href = src.Uri;
        if (href === '') return undefined;

        // Cache key: URI plus the stretch/alignment token. Patterns
        // live in the shared `<defs>` so they survive repaintOwn —
        // each unique (URI, fit) pair produces ONE `<pattern>` reused
        // across every Visual that fills with this brush. Without the
        // cache, dragging a slider that re-emits the same brush on
        // every frame causes a fresh `<image>` element per paint,
        // which the browser may re-resolve over the network (some
        // servers ignore HTTP caching headers on image responses).
        const fit = preserveAspectRatioFor(brush);
        const key = `${href}::${fit}`;
        const cached = this.imagePatternCache.get(key);
        if (cached !== undefined) return cached;

        const id = this.nextGradientId();
        const pat = this.doc.createElementNS(SVG_NS, 'pattern');
        pat.setAttribute('id', id);
        pat.setAttribute('patternUnits', 'objectBoundingBox');
        pat.setAttribute('patternContentUnits', 'objectBoundingBox');
        pat.setAttribute('width',  '1');
        pat.setAttribute('height', '1');

        const img = this.doc.createElementNS(SVG_NS, 'image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
        img.setAttribute('href',  href);
        img.setAttribute('x',     '0');
        img.setAttribute('y',     '0');
        img.setAttribute('width', '1');
        img.setAttribute('height','1');
        img.setAttribute('preserveAspectRatio', fit);
        pat.appendChild(img);

        this.defs.appendChild(pat);
        this.imagePatternCache.set(key, id);
        return id;
    }

    // Procedural hatch pattern. The tile size is in user space (DIPs),
    // so the motif keeps a constant on-screen scale independent of the
    // filled bbox — the natural reading of "8-DIP stripes".
    public materializeHatchPattern(brush: PatternBrush): string
    {
        const id = this.nextGradientId();
        const pat = this.doc.createElementNS(SVG_NS, 'pattern');
        pat.setAttribute('id', id);
        pat.setAttribute('patternUnits',        'userSpaceOnUse');
        pat.setAttribute('patternContentUnits', 'userSpaceOnUse');
        const size = Math.max(1, brush.Size);
        pat.setAttribute('width',  formatNumber(size));
        pat.setAttribute('height', formatNumber(size));
        if (brush.Angle !== 0)
        {
            // Rotate around the tile centre so the motif stays
            // visually anchored as Angle changes.
            pat.setAttribute(
                'patternTransform',
                `rotate(${formatNumber(brush.Angle)} ${formatNumber(size / 2)} ${formatNumber(size / 2)})`,
            );
        }

        // Background — a filled rect under the motif. Transparent
        // backgrounds skip the rect entirely so the pattern composites
        // cleanly over whatever sits behind the brush.
        const bg = brush.Background;
        if (bg.A > 0)
        {
            const bgRect = this.doc.createElementNS(SVG_NS, 'rect');
            bgRect.setAttribute('x', '0');
            bgRect.setAttribute('y', '0');
            bgRect.setAttribute('width',  formatNumber(size));
            bgRect.setAttribute('height', formatNumber(size));
            bgRect.setAttribute('fill', bg.ToCss());
            pat.appendChild(bgRect);
        }

        const fg     = brush.Foreground;
        const stroke = Math.max(0.1, brush.StrokeThickness);
        const fgCss  = fg.ToCss();
        switch (brush.Kind)
        {
            case PatternKind.Stripes:
            {
                // One horizontal stripe per tile, centred. Angle rotation
                // applied at the pattern level orients the run.
                const line = this.doc.createElementNS(SVG_NS, 'line');
                line.setAttribute('x1', '0');
                line.setAttribute('y1', formatNumber(size / 2));
                line.setAttribute('x2', formatNumber(size));
                line.setAttribute('y2', formatNumber(size / 2));
                line.setAttribute('stroke', fgCss);
                line.setAttribute('stroke-width', formatNumber(stroke));
                pat.appendChild(line);
                break;
            }
            case PatternKind.Dots:
            {
                // Centred filled disc, radius = StrokeThickness (so the
                // dot scales with the stroke knob).
                const dot = this.doc.createElementNS(SVG_NS, 'circle');
                dot.setAttribute('cx', formatNumber(size / 2));
                dot.setAttribute('cy', formatNumber(size / 2));
                dot.setAttribute('r',  formatNumber(stroke));
                dot.setAttribute('fill', fgCss);
                pat.appendChild(dot);
                break;
            }
            case PatternKind.Checker:
            {
                // 2×2 grid; foreground fills top-left + bottom-right.
                const half = size / 2;
                const a = this.doc.createElementNS(SVG_NS, 'rect');
                a.setAttribute('x', '0'); a.setAttribute('y', '0');
                a.setAttribute('width',  formatNumber(half));
                a.setAttribute('height', formatNumber(half));
                a.setAttribute('fill', fgCss);
                pat.appendChild(a);
                const b = this.doc.createElementNS(SVG_NS, 'rect');
                b.setAttribute('x', formatNumber(half));
                b.setAttribute('y', formatNumber(half));
                b.setAttribute('width',  formatNumber(half));
                b.setAttribute('height', formatNumber(half));
                b.setAttribute('fill', fgCss);
                pat.appendChild(b);
                break;
            }
            case PatternKind.Grid:
            {
                // L-shape — one horizontal + one vertical line per tile.
                // Tiling repeats them into the full grid without
                // doubling the strokes at the seams.
                const h = this.doc.createElementNS(SVG_NS, 'line');
                h.setAttribute('x1', '0'); h.setAttribute('y1', '0');
                h.setAttribute('x2', formatNumber(size)); h.setAttribute('y2', '0');
                h.setAttribute('stroke', fgCss);
                h.setAttribute('stroke-width', formatNumber(stroke));
                pat.appendChild(h);
                const v = this.doc.createElementNS(SVG_NS, 'line');
                v.setAttribute('x1', '0'); v.setAttribute('y1', '0');
                v.setAttribute('x2', '0'); v.setAttribute('y2', formatNumber(size));
                v.setAttribute('stroke', fgCss);
                v.setAttribute('stroke-width', formatNumber(stroke));
                pat.appendChild(v);
                break;
            }
            case PatternKind.CrossHatch:
            {
                // Two diagonals — corner-to-corner and the perpendicular
                // anti-diagonal. Symmetric under 90° rotation.
                const d1 = this.doc.createElementNS(SVG_NS, 'line');
                d1.setAttribute('x1', '0'); d1.setAttribute('y1', '0');
                d1.setAttribute('x2', formatNumber(size)); d1.setAttribute('y2', formatNumber(size));
                d1.setAttribute('stroke', fgCss);
                d1.setAttribute('stroke-width', formatNumber(stroke));
                pat.appendChild(d1);
                const d2 = this.doc.createElementNS(SVG_NS, 'line');
                d2.setAttribute('x1', formatNumber(size)); d2.setAttribute('y1', '0');
                d2.setAttribute('x2', '0'); d2.setAttribute('y2', formatNumber(size));
                d2.setAttribute('stroke', fgCss);
                d2.setAttribute('stroke-width', formatNumber(stroke));
                pat.appendChild(d2);
                break;
            }
        }

        this.current().appendChild(pat);
        return id;
    }

    // ── DrawingContext surface ─────────────────────────────────────

    public DrawRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect): void
    {
        const r = this.create('rect');
        r.setAttribute('x',      formatNumber(rect.X));
        r.setAttribute('y',      formatNumber(rect.Y));
        r.setAttribute('width',  formatNumber(rect.Width));
        r.setAttribute('height', formatNumber(rect.Height));
        applyFill  (r, brush, this);
        applyStroke(r, pen, this);
        this.current().appendChild(r);
    }

    public DrawRoundedRectangle(
        brush: Brush | undefined,
        pen: Pen | undefined,
        rect: Rect,
        radiusX: number,
        radiusY: number,
    ): void
    {
        const r = this.create('rect');
        r.setAttribute('x',      formatNumber(rect.X));
        r.setAttribute('y',      formatNumber(rect.Y));
        r.setAttribute('width',  formatNumber(rect.Width));
        r.setAttribute('height', formatNumber(rect.Height));
        if (radiusX > 0) r.setAttribute('rx', formatNumber(radiusX));
        if (radiusY > 0) r.setAttribute('ry', formatNumber(radiusY));
        applyFill  (r, brush, this);
        applyStroke(r, pen, this);
        this.current().appendChild(r);
    }

    public DrawGeometry(brush: Brush | undefined, pen: Pen | undefined, geometry: Geometry): void
    {
        // Geometry.Transform lowers to a wrapping `<g transform=…>` the
        // same way DC.PushTransform does, then closes after the emit.
        // Mirrors svg-drawing-context.ts.
        const tx = geometry.Transform;
        const wrap = tx !== Transform.Identity;
        if (wrap) this.PushTransform(tx);

        if (geometry instanceof EllipseGeometry)
        {
            const e = this.create('ellipse');
            e.setAttribute('cx', formatNumber(geometry.Center.X));
            e.setAttribute('cy', formatNumber(geometry.Center.Y));
            e.setAttribute('rx', formatNumber(geometry.RadiusX));
            e.setAttribute('ry', formatNumber(geometry.RadiusY));
            applyFill  (e, brush, this);
            applyStroke(e, pen, this);
            this.current().appendChild(e);
        }
        else if (geometry instanceof LineGeometry)
        {
            const l = this.create('line');
            l.setAttribute('x1', formatNumber(geometry.StartPoint.X));
            l.setAttribute('y1', formatNumber(geometry.StartPoint.Y));
            l.setAttribute('x2', formatNumber(geometry.EndPoint.X));
            l.setAttribute('y2', formatNumber(geometry.EndPoint.Y));
            // <line> takes only a stroke. Without one it's invisible —
            // pen-less lines are a no-op by SVG semantics.
            applyStroke(l, pen, this);
            this.current().appendChild(l);
        }
        else if (geometry instanceof RectangleGeometry)
        {
            const r = this.create('rect');
            const rect = geometry.Rect;
            r.setAttribute('x',      formatNumber(rect.X));
            r.setAttribute('y',      formatNumber(rect.Y));
            r.setAttribute('width',  formatNumber(rect.Width));
            r.setAttribute('height', formatNumber(rect.Height));
            if (geometry.RadiusX > 0) r.setAttribute('rx', formatNumber(geometry.RadiusX));
            if (geometry.RadiusY > 0) r.setAttribute('ry', formatNumber(geometry.RadiusY));
            applyFill  (r, brush, this);
            applyStroke(r, pen, this);
            this.current().appendChild(r);
        }
        else if (geometry instanceof PathGeometry)
        {
            // Lower to `<path d="…">`. Both DCs share the d-string
            // generator so the two renderers stay in sync.
            const p = this.create('path');
            p.setAttribute('d', pathGeometryToSvgD(geometry));
            if (geometry.FillRule === 'evenodd') p.setAttribute('fill-rule', 'evenodd');
            applyFill  (p, brush, this);
            applyStroke(p, pen, this);
            this.current().appendChild(p);
        }
        else if (geometry instanceof GeometryGroup)
        {
            // Emit each child as its own SVG shape under the group's
            // (already-pushed) transform. Children carry their own
            // transforms, handled by the recursive DrawGeometry call.
            for (const child of geometry.Children)
            {
                this.DrawGeometry(brush, pen, child);
            }
        }
        else
        {
            if (wrap) this.Pop();
            throw new Error(`SvgDomDrawingContext.DrawGeometry: ${geometry.constructor.name} not implemented yet.`);
        }

        if (wrap) this.Pop();
    }

    public DrawText(text: FormattedText, origin: Point): void
    {
        // SVG `<text y=…>` places the baseline at y; WPF passes the
        // top-left of the text rect. Shift y down by the ascender to
        // align — matches svg-drawing-context.ts.
        const baselineOffset = text.Metrics?.Ascent ?? text.FontSize * 0.85;

        const t = this.create('text');
        t.setAttribute('x', formatNumber(origin.X));
        t.setAttribute('y', formatNumber(origin.Y + baselineOffset));
        t.setAttribute('font-family', text.FontFamily);
        t.setAttribute('font-size',   formatNumber(text.FontSize));
        // Preserve whitespace — see svg-drawing-context.ts for rationale.
        // Without this, typing space into a TextBox would visually do
        // nothing because trailing spaces are stripped by the default
        // SVG whitespace handling. Namespaced setAttributeNS is required
        // for the SVG engine to recognise the attribute; plain
        // setAttribute would write a literal local-name with a colon
        // in it. Also set the CSS white-space property as belt-and-
        // suspenders for SVG2-compliant renderers.
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        (t as unknown as { style: CSSStyleDeclaration }).style.whiteSpace = 'pre';
        if (text.FontWeight !== FontWeight.Normal)
        {
            t.setAttribute('font-weight', text.FontWeight);
        }
        if (text.FontStyle !== FontStyle.Normal)
        {
            t.setAttribute('font-style', text.FontStyle);
        }
        if (text.LetterSpacing !== 0)
        {
            t.setAttribute('letter-spacing', formatNumber(text.LetterSpacing));
        }
        const decoration = decorationsToCss(text.Decorations);
        if (decoration !== '')
        {
            t.setAttribute('text-decoration', decoration);
        }
        applyTextFill(t, text.Foreground);
        // No textLength / lengthAdjust here — see the matching block
        // in svg-drawing-context.ts. Forcing the SVG render width to
        // the measurer's width stretched glyphs visibly whenever the
        // two engines disagreed by sub-pixels. CanvasTextMeasurer is
        // accurate enough for caret math at natural widths.
        t.textContent = text.Text;
        this.current().appendChild(t);
    }

    public DrawImage(source: ImageSource, rect: Rect, stretch: Stretch): void
    {
        const i = this.create('image');
        // SVG 2 prefers `href`; legacy `xlink:href` is still accepted
        // by all browsers but emits a deprecation warning in some
        // tooling. Mural targets modern SVG only.
        i.setAttribute('href', source.Uri);
        i.setAttribute('x',      formatNumber(rect.X));
        i.setAttribute('y',      formatNumber(rect.Y));
        i.setAttribute('width',  formatNumber(rect.Width));
        i.setAttribute('height', formatNumber(rect.Height));
        i.setAttribute('preserveAspectRatio', stretchToPreserveAspectRatio(stretch));
        this.current().appendChild(i);
    }

    public PushTransform(transform: Transform): void
    {
        const m = transform.Matrix;
        const g = this.create('g');
        g.setAttribute(
            'transform',
            `matrix(${formatNumber(m.M11)},${formatNumber(m.M12)},${formatNumber(m.M21)},${formatNumber(m.M22)},${formatNumber(m.OffsetX)},${formatNumber(m.OffsetY)})`,
        );
        this.current().appendChild(g);
        this.stack.push(g);
    }

    // Wrap subsequent emissions in a `<g clip-path="url(#id)">`. The
    // referenced `<clipPath id=id>` lands in the renderer-owned `<defs>`
    // so siblings sharing the surface don't collide on IDs.
    public PushClip(geometry: Geometry): void
    {
        const id = this.nextClipId();
        let shape: SVGElement;
        if (geometry instanceof RectangleGeometry)
        {
            shape = this.create('rect');
            const r = geometry.Rect;
            shape.setAttribute('x',      formatNumber(r.X));
            shape.setAttribute('y',      formatNumber(r.Y));
            shape.setAttribute('width',  formatNumber(r.Width));
            shape.setAttribute('height', formatNumber(r.Height));
            if (geometry.RadiusX > 0) shape.setAttribute('rx', formatNumber(geometry.RadiusX));
            if (geometry.RadiusY > 0) shape.setAttribute('ry', formatNumber(geometry.RadiusY));
        }
        else if (geometry instanceof EllipseGeometry)
        {
            shape = this.create('ellipse');
            shape.setAttribute('cx', formatNumber(geometry.Center.X));
            shape.setAttribute('cy', formatNumber(geometry.Center.Y));
            shape.setAttribute('rx', formatNumber(geometry.RadiusX));
            shape.setAttribute('ry', formatNumber(geometry.RadiusY));
        }
        else
        {
            throw new Error(`SvgDomDrawingContext.PushClip: ${geometry.constructor.name} not supported as a clip shape (expected RectangleGeometry or EllipseGeometry).`);
        }
        const clipPath = this.create('clipPath');
        clipPath.setAttribute('id', id);
        clipPath.appendChild(shape);
        this.defs.appendChild(clipPath);

        const g = this.create('g');
        g.setAttribute('clip-path', `url(#${id})`);
        this.current().appendChild(g);
        this.stack.push(g);
    }

    public Pop(): void
    {
        if (this.stack.length <= 1)
        {
            throw new Error('SvgDomDrawingContext.Pop: nothing to pop (Pop without matching Push)');
        }
        this.stack.pop();
    }

    // ── Internals ──────────────────────────────────────────────────

    private create(tag: string): SVGElement
    {
        return this.doc.createElementNS(SVG_NS, tag) as SVGElement;
    }

    private current(): SVGElement
    {
        return this.stack[this.stack.length - 1]!;
    }
}

// ── Attribute helpers — DOM equivalents of svg-drawing-context.ts's
//   string emitters. Kept in this file so the file is self-contained;
//   factor out if a third DC backend appears.

function formatNumber(n: number): string { return n.toString(); }

// Mirrors stretchToPreserveAspectRatio in svg-drawing-context.ts.
function stretchToPreserveAspectRatio(stretch: Stretch): string
{
    switch (stretch)
    {
        case Stretch.None:          return 'xMinYMin meet';
        case Stretch.Fill:          return 'none';
        case Stretch.UniformToFill: return 'xMidYMid slice';
        case Stretch.Uniform:
        default:                    return 'xMidYMid meet';
    }
}

// preserveAspectRatio combining Stretch + AlignmentX/Y, for ImageBrush
// (Stretch.Fill ignores alignment per SVG semantics — "none" already
// stretches both axes).
function preserveAspectRatioFor(brush: ImageBrush): string
{
    if (brush.Stretch === Stretch.Fill) return 'none';
    const ax = brush.AlignmentX === AlignmentX.Left   ? 'xMin'
             : brush.AlignmentX === AlignmentX.Right  ? 'xMax'
             :                                          'xMid';
    const ay = brush.AlignmentY === AlignmentY.Top    ? 'YMin'
             : brush.AlignmentY === AlignmentY.Bottom ? 'YMax'
             :                                          'YMid';
    const meet = brush.Stretch === Stretch.UniformToFill ? 'slice' : 'meet';
    return `${ax}${ay} ${meet}`;
}

function applyFill(el: SVGElement, brush: Brush | undefined, ctx?: SvgDomDrawingContext): void
{
    if (brush instanceof SolidColorBrush)
    {
        el.setAttribute('fill', brush.Color.ToCss());
        applyBrushOpacity(el, brush, 'fill-opacity');
        return;
    }
    if (brush instanceof LinearGradientBrush && ctx !== undefined)
    {
        const id = ctx.materializeLinearGradient(brush);
        el.setAttribute('fill', `url(#${id})`);
        applyBrushOpacity(el, brush, 'fill-opacity');
        return;
    }
    if (brush instanceof RadialGradientBrush && ctx !== undefined)
    {
        const id = ctx.materializeRadialGradient(brush);
        el.setAttribute('fill', `url(#${id})`);
        applyBrushOpacity(el, brush, 'fill-opacity');
        return;
    }
    if (brush instanceof ImageBrush && ctx !== undefined)
    {
        const id = ctx.materializeImagePattern(brush);
        if (id !== undefined)
        {
            el.setAttribute('fill', `url(#${id})`);
            applyBrushOpacity(el, brush, 'fill-opacity');
            return;
        }
    }
    if (brush instanceof PatternBrush && ctx !== undefined)
    {
        const id = ctx.materializeHatchPattern(brush);
        el.setAttribute('fill', `url(#${id})`);
        applyBrushOpacity(el, brush, 'fill-opacity');
        return;
    }
    // Truly unknown brush — transparent so the slot stays out of SVG's
    // default-black fill.
    el.setAttribute('fill', 'none');
}

// Brush.Opacity rides on the base Brush class and multiplies whatever
// alpha is already in the paint (SolidColorBrush.Color.A, per-stop
// alpha on gradients, etc.). SVG models this via the per-channel
// `fill-opacity` / `stroke-opacity` attribute — using the omnibus
// `opacity` instead would also dim sibling attributes and isn't what
// the brush model promises. Skip writing the attribute when the brush
// is fully opaque so the SVG diff stays terse.
function applyBrushOpacity(el: SVGElement, brush: Brush, attr: 'fill-opacity' | 'stroke-opacity'): void
{
    if (brush.Opacity >= 1) return;
    el.setAttribute(attr, formatNumber(Math.max(0, brush.Opacity)));
}

function applyTextFill(el: SVGElement, brush: Brush | undefined): void
{
    if (brush instanceof SolidColorBrush)
    {
        el.setAttribute('fill', brush.Color.ToCss());
        return;
    }
    el.setAttribute('fill', 'rgb(0,0,0)');
}

function applyStroke(el: SVGElement, pen: Pen | undefined, ctx?: SvgDomDrawingContext): void
{
    if (pen === undefined) return;
    const brush = pen.Brush;
    if (brush === undefined) return;

    // Stroke paint resolution mirrors applyFill's branches — solid
    // hex, otherwise an inline-defined paint server referenced via
    // url(#…). Without these branches the SVG stroke attribute stays
    // empty and the whole shape goes invisible whenever a gradient or
    // pattern brush rides on the Pen.
    if (brush instanceof SolidColorBrush)
    {
        el.setAttribute('stroke', brush.Color.ToCss());
    }
    else if (brush instanceof LinearGradientBrush && ctx !== undefined)
    {
        el.setAttribute('stroke', `url(#${ctx.materializeLinearGradient(brush)})`);
    }
    else if (brush instanceof RadialGradientBrush && ctx !== undefined)
    {
        el.setAttribute('stroke', `url(#${ctx.materializeRadialGradient(brush)})`);
    }
    else if (brush instanceof ImageBrush && ctx !== undefined)
    {
        const id = ctx.materializeImagePattern(brush);
        if (id !== undefined) el.setAttribute('stroke', `url(#${id})`);
        else                  return;
    }
    else if (brush instanceof PatternBrush && ctx !== undefined)
    {
        el.setAttribute('stroke', `url(#${ctx.materializeHatchPattern(brush)})`);
    }
    else return;

    applyBrushOpacity(el, brush, 'stroke-opacity');

    el.setAttribute('stroke-width', formatNumber(pen.Thickness));
    const dash = pen.DashStyle;
    if (!dash.Equals(DashStyle.Solid))
    {
        // Pen.DashStyle.Dashes are Thickness-multipliers (WPF
        // semantics); convert to absolute user-space lengths.
        const dashes = dash.Dashes.map(d => formatNumber(d * pen.Thickness)).join(' ');
        el.setAttribute('stroke-dasharray', dashes);
        if (dash.Offset !== 0)
        {
            el.setAttribute('stroke-dashoffset', formatNumber(dash.Offset * pen.Thickness));
        }
    }
    if (pen.LineCap !== LineCap.Flat)
    {
        el.setAttribute('stroke-linecap', pen.LineCap);
    }
    if (pen.LineJoin !== LineJoin.Miter)
    {
        el.setAttribute('stroke-linejoin', pen.LineJoin);
    }
    else if (pen.MiterLimit !== 10)
    {
        // SVG default is 4; we model Pen's default at 10 to match WPF.
        // Only emit when the user has set a non-default value, and
        // only on the miter-join branch where the attribute is
        // honoured.
        el.setAttribute('stroke-miterlimit', formatNumber(pen.MiterLimit));
    }
}
