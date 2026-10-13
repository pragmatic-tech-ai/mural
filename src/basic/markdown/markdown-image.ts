// markdown-image.ts — inline image support for the markdown renderer.
//
// A markdown image becomes an InlineUIContainer wrapping a mural Image. The
// FlowDocument builds SYNCHRONOUSLY with an empty (zero-size) Image; the pixels
// resolve ASYNCHRONOUSLY and, once known, set Image.Source — a Measure|Render DP
// whose change re-lays-out the inline so the picture pops in.
//
// Two source kinds:
//   * remote  (http/https/data/blob) — the URI is handed straight to the renderer
//     (`<image href>` fetches it); we only decode it to learn its natural size.
//   * local   (a relative path) — read from the project IStorage as bytes and
//     inlined as a data: URL, so it works regardless of the render host's base URL.
//
// mural's Image sizes to Source.NaturalSize, so we MUST know the dimensions or
// the slot collapses to zero — hence the decode step. `measure` is injected
// (default decodes via a browser HTMLImageElement) so this unit-tests headless.
//
// ResolveUri / MimeForPath / BytesToDataUri are PUBLIC statics: diagram media
// (media-node-vm, media-storage) call them without rendering any markdown.
import { Size } from '../../runtime/index.js';
import { Image, InlineUIContainer } from '../index.js';
import { BitmapImage, Stretch } from '../../visual-engine/index.js';
import { FlowStyle } from './flow-style.js';

// The one storage capability image resolution needs: read a resolved path's raw
// bytes. A project-relative IStorage satisfies it (the .md viewer), and so does
// an absolute-OS-path reader (the agent chat) — the seam stays agnostic to which.
export interface ImageByteSource
{
    ReadBytes(path: string): Promise<Uint8Array>;
}

export interface MarkdownImageContext
{
    // Byte source for local image paths (project storage, or an OS-path reader).
    readonly storage?: ImageByteSource;
    // Directory (project-relative) of the .md file — local image paths resolve
    // against it.
    readonly baseDir: string;
    // Cap the rendered width; larger images scale down preserving aspect ratio.
    readonly maxWidth?: number;
    // Decode a URI to its intrinsic size. Injected for tests; the default uses a
    // browser HTMLImageElement and returns undefined off the main thread.
    readonly measure?: (uri: string) => Promise<Size | undefined>;
}

export class MarkdownImage
{
    // Widest an image renders before it's scaled down to fit the reading column.
    private static readonly DefaultMaxWidth = FlowStyle.MaxWidth;

    // Build the inline image container. Returns synchronously; the picture fills
    // in once its bytes + dimensions resolve. A resolution failure leaves the slot
    // empty (best-effort — a broken image never breaks the document).
    public static Create(src: string, _alt: string, ctx: MarkdownImageContext): InlineUIContainer
    {
        const image = new Image();
        image.Stretch = Stretch.Uniform;
        const container = new InlineUIContainer(image);
        void MarkdownImage.LoadInto(image, src, ctx).catch(() => {});
        return container;
    }

    // The awaitable worker (public for tests): resolve the URI, decode its size,
    // clamp it, and set Image.Source.
    public static async LoadInto(image: Image, src: string, ctx: MarkdownImageContext): Promise<void>
    {
        const uri = await MarkdownImage.ResolveUri(src, ctx);
        if (uri === undefined) return;
        const measure = ctx.measure ?? MarkdownImage.DecodeSizeInBrowser;
        const natural = await measure(uri);
        if (natural === undefined || natural.Width <= 0 || natural.Height <= 0) return;
        const display = MarkdownImage.ClampSize(natural, ctx.maxWidth ?? MarkdownImage.DefaultMaxWidth);
        image.Source = new BitmapImage(uri, display);
    }

    // Resolve a markdown image src to a URI the renderer can load: remote URIs
    // pass through; local paths are read from storage and inlined as data URLs.
    // Returns undefined when a local path can't be read (missing file, no storage).
    public static async ResolveUri(src: string, ctx: MarkdownImageContext): Promise<string | undefined>
    {
        if (MarkdownImage.IsRemoteUri(src)) return src;
        if (ctx.storage === undefined) return undefined;
        const path = MarkdownImage.ResolveLocalPath(ctx.baseDir, src);
        try
        {
            const bytes = await ctx.storage.ReadBytes(path);
            return MarkdownImage.BytesToDataUri(bytes, MarkdownImage.MimeForPath(path));
        }
        catch
        {
            return undefined;
        }
    }

    // A URI the render host fetches directly (no storage read needed).
    public static IsRemoteUri(src: string): boolean
    {
        return /^(https?:|data:|blob:)/i.test(src.trim());
    }

    // Join a markdown-relative image path to a project-relative storage path,
    // normalising `.`/`..` and collapsing separators. A leading `/` is treated as
    // project-root-relative. Query/hash suffixes are dropped.
    public static ResolveLocalPath(baseDir: string, src: string): string
    {
        const clean = src.replace(/[?#].*$/, '').replace(/\\/g, '/');
        const rootRelative = clean.startsWith('/');
        const base = rootRelative ? [] : baseDir.replace(/\\/g, '/').split('/').filter((s) => s.length > 0);
        const parts = clean.split('/').filter((s) => s.length > 0);
        const out = base.slice();
        for (const part of parts)
        {
            if (part === '.') continue;
            if (part === '..') { out.pop(); continue; }
            out.push(part);
        }
        return out.join('/');
    }

    // A conservative image mime from a file extension (default png).
    public static MimeForPath(path: string): string
    {
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        switch (ext)
        {
            case 'jpg': case 'jpeg': return 'image/jpeg';
            case 'gif':              return 'image/gif';
            case 'svg':              return 'image/svg+xml';
            case 'webp':             return 'image/webp';
            case 'bmp':              return 'image/bmp';
            case 'ico':              return 'image/x-icon';
            case 'png':
            default:                 return 'image/png';
        }
    }

    // Base64 data URL from raw bytes (Buffer in node, btoa in the browser).
    public static BytesToDataUri(bytes: Uint8Array, mime: string): string
    {
        return `data:${mime};base64,${MarkdownImage.BytesToBase64(bytes)}`;
    }

    private static BytesToBase64(bytes: Uint8Array): string
    {
        // Reach the optional node Buffer through globalThis with a narrow local
        // shape; falls back to btoa in a plain browser context.
        const nodeBuffer = (globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }).Buffer;
        if (nodeBuffer !== undefined) return nodeBuffer.from(bytes).toString('base64');
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
    }

    // Scale a natural size down to fit maxWidth, preserving aspect ratio.
    private static ClampSize(natural: Size, maxWidth: number): Size
    {
        if (natural.Width <= maxWidth) return natural;
        const scale = maxWidth / natural.Width;
        return new Size(maxWidth, Math.round(natural.Height * scale));
    }

    // Default browser decoder — loads the URI into an HTMLImageElement and reads
    // its intrinsic size. Resolves undefined when there's no DOM (unit tests) or
    // the image fails to load.
    private static DecodeSizeInBrowser(uri: string): Promise<Size | undefined>
    {
        const Ctor = (globalThis as { Image?: new () => HTMLImageElement }).Image;
        if (Ctor === undefined) return Promise.resolve(undefined);
        return new Promise((resolve) =>
        {
            const el = new Ctor();
            el.onload = (): void => resolve(new Size(el.naturalWidth, el.naturalHeight));
            el.onerror = (): void => resolve(undefined);
            el.src = uri;
        });
    }
}
