import { MetaData, MuralBase, type PropertyDescriptor, type Disposable, Visual } from '../../runtime/index.js';
import { FontStyle, FontWeight, ImageSource, Stretch, TextDecorations } from '../../visual-engine/index.js';
import { Inline, type InlineHost } from './text-element.js';
import { InlineCollection } from './inline-collection.js';

// ─────────────────────────────────────────────────────────────────────
// Run — the only inline that carries literal characters. Every other
// inline either groups Runs (Span) or is a non-text atom (LineBreak,
// InlineUIContainer). Setting TextBlock.Text is sugar for a single Run.
export class Run extends Inline
{
    public static readonly TextKey = MuralBase.RegisterProperty<string>(Run, 'Text', '', MetaData.None);

    constructor(text = '')
    {
        super();
        if (text !== '') this.Text = text;
    }

    public get Text(): string { return this.get_property_value(Run.TextKey); }
    public set Text(v: string) { this.set_property_value(Run.TextKey, v); }
}

// ─────────────────────────────────────────────────────────────────────
// Span — a grouping inline. Its own set character-format properties
// override the inherited context for everything in its Inlines subtree;
// its TextDecorations accumulate onto that subtree. Bold / Italic /
// Underline are Spans that preset one property. Hyperlink (its own file)
// is a Span with interactivity.
export class Span extends Inline implements InlineHost
{
    private readonly _inlines: InlineCollection;

    constructor()
    {
        super();
        this._inlines = new InlineCollection(this);
    }

    public get Inlines(): InlineCollection { return this._inlines; }

    // Markup default-slot target — `Bold { "hi" Run{…} }` lowers to
    // `.Inlines.Add(child)`. A bare string content node compiles to a Run.
    public AddChild(child: Inline): void { this._inlines.Add(child); }

    // Bubble a nested-collection change up toward the hosting TextBlock.
    public onInlineTreeChanged(): void { this.invalidateTree(); }
}

// Convenience spans — Office/WPF parity. Each just presets one property
// in the ctor; the flatten applies it like any other Span override.
export class Bold extends Span
{
    constructor() { super(); this.FontWeight = FontWeight.Bold; }
}

export class Italic extends Span
{
    constructor() { super(); this.FontStyle = FontStyle.Italic; }
}

export class Underline extends Span
{
    constructor() { super(); this.TextDecorations = TextDecorations.Underline; }
}

// ─────────────────────────────────────────────────────────────────────
// LineBreak — forces the line to end. No text, no children.
export class LineBreak extends Inline {}

// ─────────────────────────────────────────────────────────────────────
// InlineUIContainer — embeds an arbitrary Visual inline within the text
// flow (a Button, Image, icon, …). The hosting TextBlock attaches Child
// as a real visual child, measures it, and arranges it at the container's
// computed position on the line (baseline-bottom aligned by default). The
// content model just holds the reference; all layout is the host's job.
export class InlineUIContainer extends Inline
{
    public static readonly ChildKey = MuralBase.RegisterProperty<Visual | undefined>(
        InlineUIContainer, 'Child', undefined, MetaData.None);

    constructor(child?: Visual)
    {
        super();
        if (child !== undefined) this.Child = child;
    }

    public get Child(): Visual | undefined  { return this.get_property_value(InlineUIContainer.ChildKey); }
    public set Child(v: Visual | undefined) { this.set_property_value(InlineUIContainer.ChildKey, v); }

    // Markup default slot — `InlineUIContainer { SomeVisual }`.
    public AddChild(child: Visual): void { this.Child = child; }
}

// ─────────────────────────────────────────────────────────────────────
// How an image inline sits in the text flow.
export enum ImageDisplay
{
    /** Flows within the line like a large glyph, middle-aligned to the text. */
    Inline = 'inline',
    /** Occupies its own line (a figure), aligned per the paragraph. */
    Block  = 'block',
}

// ─────────────────────────────────────────────────────────────────────
// ImageInline — a bitmap embedded directly in the text flow. Unlike
// InlineUIContainer (which hosts an arbitrary Visual painted as a child),
// an ImageInline is an ATOMIC, non-text element the layout paints itself
// via DrawingContext.DrawImage — so it renders identically on the live
// canvas and in the SVG/PPTX/PNG export (both implement DrawImage), with
// no visual-child machinery. It is one caret stop, never split.
//
// Size: explicit Width/Height win; otherwise the Source's NaturalSize; a
// dimension still unknown falls back to DEFAULT_IMAGE_SIZE until the source
// reports its intrinsic size (NaturalSize is a change-notifying DP, so a
// late-known size re-lays-out through the host).
export const DEFAULT_IMAGE_SIZE = 100;

export class ImageInline extends Inline
{
    public static readonly SourceKey = MuralBase.RegisterProperty<ImageSource | undefined>(
        ImageInline, 'Source', undefined, MetaData.None);
    public static readonly WidthKey = MuralBase.RegisterProperty<number | undefined>(
        ImageInline, 'Width', undefined, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number | undefined>(
        ImageInline, 'Height', undefined, MetaData.None);
    public static readonly StretchKey = MuralBase.RegisterProperty<Stretch>(
        ImageInline, 'Stretch', Stretch.Uniform, MetaData.None);
    public static readonly DisplayKey = MuralBase.RegisterProperty<ImageDisplay>(
        ImageInline, 'Display', ImageDisplay.Inline, MetaData.None);

    // Re-layout when the source's intrinsic size becomes known.
    private _naturalSizeSub: Disposable | undefined;

    constructor(source?: ImageSource, opts?: { width?: number; height?: number; stretch?: Stretch; display?: ImageDisplay })
    {
        super();
        if (source !== undefined)         this.Source  = source;
        if (opts?.width !== undefined)    this.Width   = opts.width;
        if (opts?.height !== undefined)   this.Height  = opts.height;
        if (opts?.stretch !== undefined)  this.Stretch = opts.stretch;
        if (opts?.display !== undefined)  this.Display  = opts.display;
    }

    public get Source(): ImageSource | undefined  { return this.get_property_value(ImageInline.SourceKey); }
    public set Source(v: ImageSource | undefined) { this.set_property_value(ImageInline.SourceKey, v); }
    public get Width(): number | undefined  { return this.get_property_value(ImageInline.WidthKey); }
    public set Width(v: number | undefined) { this.set_property_value(ImageInline.WidthKey, v); }
    public get Height(): number | undefined  { return this.get_property_value(ImageInline.HeightKey); }
    public set Height(v: number | undefined) { this.set_property_value(ImageInline.HeightKey, v); }
    public get Stretch(): Stretch  { return this.get_property_value(ImageInline.StretchKey); }
    public set Stretch(v: Stretch) { this.set_property_value(ImageInline.StretchKey, v); }
    public get Display(): ImageDisplay  { return this.get_property_value(ImageInline.DisplayKey); }
    public set Display(v: ImageDisplay) { this.set_property_value(ImageInline.DisplayKey, v); }

    // The laid-out size: explicit override, else the source's known natural
    // size, else the default box (per axis, independently).
    public get LayoutWidth(): number
    {
        const w = this.Width;
        if (w !== undefined) return w;
        const nat = this.Source?.NaturalSize.Width ?? 0;
        return nat > 0 ? nat : DEFAULT_IMAGE_SIZE;
    }
    public get LayoutHeight(): number
    {
        const h = this.Height;
        if (h !== undefined) return h;
        const nat = this.Source?.NaturalSize.Height ?? 0;
        return nat > 0 ? nat : DEFAULT_IMAGE_SIZE;
    }

    // Keep a NaturalSize subscription bound to the current Source so a
    // late-decoded intrinsic size invalidates the layout.
    protected override OnPropertyChanged(d: PropertyDescriptor, o: unknown, n: unknown): void
    {
        super.OnPropertyChanged(d, o, n);
        if (d === ImageInline.SourceKey.descriptor)
        {
            this._naturalSizeSub?.dispose();
            this._naturalSizeSub = undefined;
            const src = n as ImageSource | undefined;
            if (src !== undefined)
            {
                this._naturalSizeSub = src.PropertyChanged(ImageSource.NaturalSizeKey).subscribe(
                    () => this.invalidateTree());
            }
        }
    }
}
