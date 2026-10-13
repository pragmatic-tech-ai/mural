// svg-inline.ts — render an agent-authored `<svg>` (raw block or ```svg fence)
// as a DRAWN image, sized from the author-set attributes.
//
// The agent emits SVGs both as raw `<svg width=… height=…>` blocks and in ```svg
// fences, and expects them drawn at the size it sets. mural renders no HTML, so
// we encode the SVG text as a `data:image/svg+xml` URI and hand it to the same
// Image/BitmapImage path used for markdown images. Because the intended pixel
// size is declared on the element, we resolve it here (width/height → viewBox →
// default) and set it synchronously — no decode round-trip.
import { Size } from '../../runtime/index.js';
import { Image, InlineUIContainer } from '../index.js';
import { BitmapImage, Stretch } from '../../visual-engine/index.js';
import { FlowStyle } from './flow-style.js';

export class SvgInline
{
    // Fallback square size when neither width/height nor a viewBox is present.
    private static readonly Default = 256;
    private static readonly SvgDataUriPrefix = 'data:image/svg+xml;charset=utf-8,';
    private static readonly WidthAttr = 'width';
    private static readonly HeightAttr = 'height';

    // Does this text (trimmed) start with an `<svg …>` open tag? Cheap gate before
    // the heavier extract.
    public static LooksLikeSvg(text: string): boolean
    {
        return /^\s*<svg[\s>]/i.test(text);
    }

    // Pull the `<svg …>…</svg>` element out of a larger fragment (marked hands raw
    // HTML blocks with possible surrounding whitespace). Returns undefined when
    // there's no complete element.
    public static Extract(text: string): string | undefined
    {
        const m = /<svg[\s>][\s\S]*?<\/svg\s*>/i.exec(text);
        return m !== null ? m[0] : undefined;
    }

    // Build the drawn image for an `<svg>` string, sized from its attributes.
    public static ToImage(svg: string): InlineUIContainer
    {
        const size = SvgInline.ResolveSize(svg);
        const uri = SvgInline.SvgDataUriPrefix + encodeURIComponent(svg);
        const image = new Image();
        image.Stretch = Stretch.Uniform;
        // The natural size is authoritative here (declared on the element), so set
        // the source synchronously — the Image lays out to Source.NaturalSize.
        image.Source = new BitmapImage(uri, size);
        return new InlineUIContainer(image);
    }

    // The display size: the author-set width/height when numeric (px), else
    // derived from the viewBox aspect, else a default square — then clamped to
    // MaxWidth preserving aspect so an oversized SVG fits the bubble.
    private static ResolveSize(svg: string): Size
    {
        const open = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
        const w = SvgInline.PxAttr(open, SvgInline.WidthAttr);
        const h = SvgInline.PxAttr(open, SvgInline.HeightAttr);
        const vb = SvgInline.ViewBox(open);

        let width: number;
        let height: number;
        if (w !== undefined && h !== undefined) { width = w; height = h; }
        else if (w !== undefined && vb !== undefined) { width = w; height = w * (vb.h / vb.w); }
        else if (h !== undefined && vb !== undefined) { height = h; width = h * (vb.w / vb.h); }
        else if (vb !== undefined) { width = vb.w; height = vb.h; }
        else { width = SvgInline.Default; height = SvgInline.Default; }

        return SvgInline.Clamp(width, height);
    }

    // A numeric pixel attribute value (`width="512"` / `512px`), or undefined for
    // a missing/percentage/non-numeric value (those fall back to the viewBox).
    private static PxAttr(openTag: string, name: string): number | undefined
    {
        const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(openTag);
        const raw = m?.[1] ?? m?.[2];
        if (raw === undefined || raw.includes('%')) return undefined;
        const n = parseFloat(raw);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }

    private static ViewBox(openTag: string): { w: number; h: number } | undefined
    {
        const m = /\bviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(openTag);
        const raw = m?.[1] ?? m?.[2];
        if (raw === undefined) return undefined;
        const parts = raw.trim().split(/[\s,]+/).map(Number);
        if (parts.length !== 4) return undefined;
        const w = parts[2]!;
        const h = parts[3]!;
        return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : undefined;
    }

    private static Clamp(width: number, height: number): Size
    {
        if (width <= FlowStyle.MaxWidth) return new Size(Math.round(width), Math.round(height));
        const scale = FlowStyle.MaxWidth / width;
        return new Size(FlowStyle.MaxWidth, Math.round(height * scale));
    }
}
