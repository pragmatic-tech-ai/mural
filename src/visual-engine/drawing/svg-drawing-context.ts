import type { Point, Rect } from '../primitives.js';
import type { DrawingContext } from '../../runtime/index.js';
import { Brush, SolidColorBrush } from './brush.js';
import { DashStyle, LineCap, type Pen } from './pen.js';
import { EllipseGeometry, GeometryGroup, LineGeometry, PathGeometry, RectangleGeometry, type Geometry } from '../geometry/geometry.js';
import { pathGeometryToSvgD } from '../geometry/path-to-svg.js';
import { Transform } from './transform.js';
import { FontStyle, FontWeight, decorationsToCss, type FormattedText } from '../text/formatted-text.js';
import { Stretch, type ImageSource } from './image-source.js';

// Minimal SVG implementation of DrawingContext. Translates draw calls
// into string-form SVG elements buffered in `output`; the consumer (a
// renderer, a test script, …) wraps them in an outer <svg> element with
// the desired width/height/viewBox.
//
// Surface implemented:
//   * DrawRectangle  — for SolidColorBrush fills and SolidColorBrush-backed Pen strokes
//   * DrawText       — for SolidColorBrush foreground; defaults to black when undefined
//   * PushTransform / Pop — emits <g transform="matrix(…)"> wrappers
//
// Surface still pending:
//   * DrawGeometry — throws NotImplemented until a Geometry-using Visual needs it
//   * Non-solid Brushes (Linear/Radial gradients, ImageBrush) — need
//     <defs> + id-based references
//   * Brush.Opacity + Pen.DashStyle + LineCap/LineJoin/MiterLimit
//
// Not a full renderer yet — there's no slot tree, no dirty tracking,
// no DOM mount. Just the DC seam that turns draw calls into SVG strings.
// The full SvgRenderer (which owns the slot map and ties into
// HtmlTarget) is a later step.
export class SvgDrawingContext implements DrawingContext
{
    private readonly output: string[] = [];
    // <clipPath> elements collected separately so they emit at the
    // top of the document inside a single <defs> block — SVG allows
    // inline <defs> but render order through some viewers gets weird
    // when a clip-path="url(#id)" reference appears before its
    // definition. Collecting up front avoids the issue.
    private readonly defs: string[] = [];
    private clipCounter: number = 0;

    public DrawRectangle(brush: Brush | undefined, pen: Pen | undefined, rect: Rect): void
    {
        const attrs: string[] = [
            `x="${formatNumber(rect.X)}"`,
            `y="${formatNumber(rect.Y)}"`,
            `width="${formatNumber(rect.Width)}"`,
            `height="${formatNumber(rect.Height)}"`,
            fillAttr(brush),
            ...strokeAttrs(pen),
        ];
        this.output.push(`<rect ${attrs.join(' ')} />`);
    }

    public DrawRoundedRectangle(
        brush: Brush | undefined,
        pen: Pen | undefined,
        rect: Rect,
        radiusX: number,
        radiusY: number,
    ): void
    {
        const attrs: string[] = [
            `x="${formatNumber(rect.X)}"`,
            `y="${formatNumber(rect.Y)}"`,
            `width="${formatNumber(rect.Width)}"`,
            `height="${formatNumber(rect.Height)}"`,
        ];
        if (radiusX > 0) attrs.push(`rx="${formatNumber(radiusX)}"`);
        if (radiusY > 0) attrs.push(`ry="${formatNumber(radiusY)}"`);
        attrs.push(fillAttr(brush));
        attrs.push(...strokeAttrs(pen));
        this.output.push(`<rect ${attrs.join(' ')} />`);
    }

    public DrawGeometry(brush: Brush | undefined, pen: Pen | undefined, geometry: Geometry): void
    {
        // Geometry.Transform lowers to a wrapping <g transform="…"> the
        // same way DC.PushTransform does, then closes after the emit.
        const tx = geometry.Transform;
        const wrap = tx !== Transform.Identity;
        if (wrap) this.PushTransform(tx);

        if (geometry instanceof EllipseGeometry)
        {
            const attrs: string[] = [
                `cx="${formatNumber(geometry.Center.X)}"`,
                `cy="${formatNumber(geometry.Center.Y)}"`,
                `rx="${formatNumber(geometry.RadiusX)}"`,
                `ry="${formatNumber(geometry.RadiusY)}"`,
                fillAttr(brush),
                ...strokeAttrs(pen),
            ];
            this.output.push(`<ellipse ${attrs.join(' ')} />`);
        }
        else if (geometry instanceof LineGeometry)
        {
            // <line> takes only a stroke (no fill semantics in SVG —
            // setting one is a no-op). Pen-less lines are a no-op too.
            const attrs: string[] = [
                `x1="${formatNumber(geometry.StartPoint.X)}"`,
                `y1="${formatNumber(geometry.StartPoint.Y)}"`,
                `x2="${formatNumber(geometry.EndPoint.X)}"`,
                `y2="${formatNumber(geometry.EndPoint.Y)}"`,
                ...strokeAttrs(pen),
            ];
            this.output.push(`<line ${attrs.join(' ')} />`);
        }
        else if (geometry instanceof RectangleGeometry)
        {
            // Reuse DrawRectangle for the basic case; rounded corners
            // (RadiusX / RadiusY > 0) get rx / ry attributes added.
            const r = geometry.Rect;
            const attrs: string[] = [
                `x="${formatNumber(r.X)}"`,
                `y="${formatNumber(r.Y)}"`,
                `width="${formatNumber(r.Width)}"`,
                `height="${formatNumber(r.Height)}"`,
            ];
            if (geometry.RadiusX > 0) attrs.push(`rx="${formatNumber(geometry.RadiusX)}"`);
            if (geometry.RadiusY > 0) attrs.push(`ry="${formatNumber(geometry.RadiusY)}"`);
            attrs.push(fillAttr(brush));
            attrs.push(...strokeAttrs(pen));
            this.output.push(`<rect ${attrs.join(' ')} />`);
        }
        else if (geometry instanceof PathGeometry)
        {
            // Lower to <path d="…">. Both DCs share the d-string
            // generator so the two renderers stay in sync.
            const attrs: string[] = [
                `d="${pathGeometryToSvgD(geometry)}"`,
            ];
            if (geometry.FillRule === 'evenodd') attrs.push('fill-rule="evenodd"');
            attrs.push(fillAttr(brush));
            attrs.push(...strokeAttrs(pen));
            this.output.push(`<path ${attrs.join(' ')} />`);
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
            throw new Error(`SvgDrawingContext.DrawGeometry: ${geometry.constructor.name} not implemented yet.`);
        }

        if (wrap) this.Pop();
    }

    public DrawText(text: FormattedText, origin: Point): void
    {
        // SVG's <text y=…> places the BASELINE at y, not the top of the
        // bounding box. WPF's DrawText takes origin as the top-left of
        // the text rect. We shift y down by the ascender height — when
        // FormattedText was sized by a real TextMeasurer (FontMetricsMeasurer
        // with a loaded font), Metrics.Ascent is the actual font's
        // ascender for this size. Without metrics (no font loaded /
        // ApproximateTextMeasurer), fall back to the 0.85 ratio that
        // works reasonably for system-ui / sans-serif / common serifs.
        const baselineOffset = text.Metrics?.Ascent ?? text.FontSize * 0.85;

        const attrs: string[] = [
            `x="${formatNumber(origin.X)}"`,
            `y="${formatNumber(origin.Y + baselineOffset)}"`,
            `font-family="${escapeXmlAttr(text.FontFamily)}"`,
            `font-size="${formatNumber(text.FontSize)}"`,
            // Keep whitespace as-is. Without `xml:space="preserve"` the
            // SVG default whitespace handling strips trailing spaces and
            // collapses internal runs to a single space — fatal for any
            // editable text (TextBox) where typing space must visibly
            // advance the caret. Cheap to set unconditionally so every
            // mural-painted text honours the source string verbatim.
            `xml:space="preserve"`,
        ];
        if (text.FontWeight !== FontWeight.Normal)
        {
            attrs.push(`font-weight="${text.FontWeight}"`);
        }
        if (text.FontStyle !== FontStyle.Normal)
        {
            attrs.push(`font-style="${text.FontStyle}"`);
        }
        if (text.LetterSpacing !== 0)
        {
            attrs.push(`letter-spacing="${formatNumber(text.LetterSpacing)}"`);
        }
        const decoration = decorationsToCss(text.Decorations);
        if (decoration !== '')
        {
            attrs.push(`text-decoration="${decoration}"`);
        }
        attrs.push(fillAttrForText(text.Foreground));

        // Deliberately NOT emitting textLength + lengthAdjust here. The
        // earlier attempt to pin the SVG render width to the measurer's
        // width forced the browser to stretch glyphs uniformly whenever
        // the two disagreed by even a fraction of a pixel — visibly
        // tracked-out text in browsers where Canvas.measureText and
        // SVG text shaping use marginally different kerning tables.
        // We rely instead on Visuals that overlay the painted text
        // (TextBox caret) using a measurer that closely tracks the
        // browser's own SVG renderer — CanvasTextMeasurer is the
        // default in HtmlTarget. Any residual sub-pixel mismatch
        // shows up as caret micro-drift rather than visible glyph
        // distortion, which is the better trade-off.
        this.output.push(`<text ${attrs.join(' ')}>${escapeXmlText(text.Text)}</text>`);
    }

    public DrawImage(source: ImageSource, rect: Rect, stretch: Stretch): void
    {
        const attrs: string[] = [
            `href="${escapeXmlAttr(source.Uri)}"`,
            `x="${formatNumber(rect.X)}"`,
            `y="${formatNumber(rect.Y)}"`,
            `width="${formatNumber(rect.Width)}"`,
            `height="${formatNumber(rect.Height)}"`,
            `preserveAspectRatio="${stretchToPreserveAspectRatio(stretch)}"`,
        ];
        this.output.push(`<image ${attrs.join(' ')} />`);
    }

    public PushTransform(transform: Transform): void
    {
        const m = transform.Matrix;
        this.output.push(
            `<g transform="matrix(${formatNumber(m.M11)},${formatNumber(m.M12)},${formatNumber(m.M21)},${formatNumber(m.M22)},${formatNumber(m.OffsetX)},${formatNumber(m.OffsetY)})">`,
        );
    }

    // Wraps subsequent output in a <g clip-path="url(#…)"> whose
    // referenced <clipPath> contains the geometry's shape. The
    // <clipPath> element gets collected into the document's <defs>
    // block, emitted at the top by ToSvg / ToFragment. Pop emits
    // the closing </g> — same Pop as PushTransform since both stack
    // frames are <g>-shaped.
    //
    // Supported clip shapes: RectangleGeometry and EllipseGeometry
    // (the cases that round-trip cleanly to SVG shape elements
    // inside <clipPath>). Lines / paths / groups throw — clip
    // requires an enclosed region, which a line doesn't have.
    public PushClip(geometry: Geometry): void
    {
        const id = `clip${this.clipCounter++}`;
        let shape: string;
        if (geometry instanceof RectangleGeometry)
        {
            const r = geometry.Rect;
            shape = `<rect x="${formatNumber(r.X)}" y="${formatNumber(r.Y)}" width="${formatNumber(r.Width)}" height="${formatNumber(r.Height)}"`;
            if (geometry.RadiusX > 0) shape += ` rx="${formatNumber(geometry.RadiusX)}"`;
            if (geometry.RadiusY > 0) shape += ` ry="${formatNumber(geometry.RadiusY)}"`;
            shape += ` />`;
        }
        else if (geometry instanceof EllipseGeometry)
        {
            shape = `<ellipse cx="${formatNumber(geometry.Center.X)}" cy="${formatNumber(geometry.Center.Y)}" rx="${formatNumber(geometry.RadiusX)}" ry="${formatNumber(geometry.RadiusY)}" />`;
        }
        else
        {
            throw new Error(`SvgDrawingContext.PushClip: ${geometry.constructor.name} not supported as a clip shape (expected RectangleGeometry or EllipseGeometry).`);
        }
        this.defs.push(`<clipPath id="${id}">${shape}</clipPath>`);
        this.output.push(`<g clip-path="url(#${id})">`);
    }

    public Pop(): void
    {
        this.output.push(`</g>`);
    }

    // Collects everything emitted so far into a self-contained
    // SVG document at the given dimensions. Subsequent draws continue
    // to append to the same buffer — call once at end of rendering.
    public ToSvg(width: number, height: number): string
    {
        const defs = this.defs.length > 0 ? `  <defs>${this.defs.join('')}</defs>\n` : '';
        const inner = this.output.join('\n  ');
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${defs}  ${inner}\n</svg>\n`;
    }

    // Buffered SVG fragments without the <svg> wrapper. Useful when the
    // DC is rendering into an existing SVG slot rather than producing a
    // standalone document. Defs are prepended so consumers wrapping
    // the fragment get the referenced clip paths.
    public ToFragment(): string
    {
        const defs = this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>\n` : '';
        return defs + this.output.join('\n');
    }
}

// JS's Number.toString omits the trailing ".0" on integers and emits a
// minimal decimal otherwise — exactly what SVG attribute values want.
function formatNumber(n: number): string
{
    return n.toString();
}

// Brush.Opacity multiplies whatever alpha is already in the paint
// (SolidColorBrush.Color.A). SVG carries it as a separate fill-opacity /
// stroke-opacity attribute — the omnibus `opacity` would also dim the stroke,
// which isn't the intent. Mirrors svg-dom-drawing-context's applyBrushOpacity
// so the string-emitting export path matches the live DOM renderer; returns
// undefined (no attribute) when the brush is fully opaque.
function opacityAttr(brush: Brush | undefined, attr: 'fill-opacity' | 'stroke-opacity'): string | undefined
{
    if (brush === undefined || brush.Opacity >= 1) return undefined;
    return `${attr}="${formatNumber(Math.max(0, brush.Opacity))}"`;
}

function fillAttr(brush: Brush | undefined): string
{
    if (brush instanceof SolidColorBrush)
    {
        const op = opacityAttr(brush, 'fill-opacity');
        const fill = `fill="${brush.Color.ToCss()}"`;
        return op !== undefined ? `${fill} ${op}` : fill;
    }
    // Gradients / ImageBrush land later; for now treat unknown brushes as
    // no fill so the slot stays transparent rather than defaulting to
    // SVG's black.
    return `fill="none"`;
}

function strokeAttrs(pen: Pen | undefined): string[]
{
    if (pen === undefined) return [];
    if (!(pen.Brush instanceof SolidColorBrush)) return [];
    const attrs = [
        `stroke="${pen.Brush.Color.ToCss()}"`,
        `stroke-width="${formatNumber(pen.Thickness)}"`,
    ];
    const strokeOpacity = opacityAttr(pen.Brush, 'stroke-opacity');
    if (strokeOpacity !== undefined) attrs.push(strokeOpacity);
    // Pen.DashStyle.Dashes are multipliers of Thickness (WPF
    // semantics). Multiply on the way out so SVG sees absolute
    // user-space lengths.
    const dash = pen.DashStyle;
    if (!dash.Equals(DashStyle.Solid))
    {
        const dashes = dash.Dashes.map(d => formatNumber(d * pen.Thickness)).join(' ');
        attrs.push(`stroke-dasharray="${dashes}"`);
        if (dash.Offset !== 0)
        {
            attrs.push(`stroke-dashoffset="${formatNumber(dash.Offset * pen.Thickness)}"`);
        }
    }
    // Only emit linecap when it's non-default; defaults to butt
    // (Flat) which is the SVG default too.
    if (pen.LineCap !== LineCap.Flat)
    {
        attrs.push(`stroke-linecap="${pen.LineCap}"`);
    }
    return attrs;
}

// Text foreground defaults to black when no brush is supplied — matches
// the SVG default and gives TextBlock the "just shows up" behavior with
// no Foreground set.
function fillAttrForText(brush: Brush | undefined): string
{
    if (brush instanceof SolidColorBrush)
    {
        const op = opacityAttr(brush, 'fill-opacity');
        const fill = `fill="${brush.Color.ToCss()}"`;
        return op !== undefined ? `${fill} ${op}` : fill;
    }
    return `fill="rgb(0,0,0)"`;
}

// Element content escaping — only & < > matter inside a text node.
function escapeXmlText(s: string): string
{
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Attribute value escaping — additionally double quotes since our
// attributes are always wrapped in double quotes.
function escapeXmlAttr(s: string): string
{
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

// Translate a Stretch enum value to the matching SVG `preserveAspectRatio`
// attribute value.
//
//   * None          — `xMinYMin meet` lets the image render at its
//     natural size anchored at the slot's top-left. Combined with the
//     slot being sized to NaturalSize by Image.MeasureOverride, no
//     stretching happens.
//   * Fill          — `none` disables aspect-ratio preservation.
//   * Uniform       — `xMidYMid meet` scales to fit, centered.
//   * UniformToFill — `xMidYMid slice` scales to fill, centered, clipped.
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
