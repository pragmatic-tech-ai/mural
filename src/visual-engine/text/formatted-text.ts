import type { TextMetrics } from '../../runtime/index.js';
import type { Brush } from '../drawing/brush.js';

// Boldness of a glyph. Normal (400) / Medium (500) / Bold (700) cover
// the three weights M3 typography roles call out — Title and Label
// tiers spec Medium, everything else spec Normal or Bold. Numeric
// values are CSS-valid `font-weight` strings; SVG renderers emit them
// verbatim as the `font-weight` attribute.
export enum FontWeight
{
    Normal   = 'normal',
    Medium   = '500',
    SemiBold = '600',
    Bold     = 'bold',
}

// Italic vs upright. Same shape as WPF FontStyles.
export enum FontStyle
{
    Normal = 'normal',
    Italic = 'italic',
}

// Line embellishments drawn over/under the glyph run — WPF's
// TextDecorations, but modelled as a combinable bit-flag set rather
// than a collection. A run can carry several at once (Underline +
// Strikethrough), so the members are powers of two and combine with
// bitwise OR: `TextDecorations.Underline | TextDecorations.Strikethrough`.
//
// This is the one enum in the family with NUMERIC values instead of the
// usual string wire-form: decorations are a SET, and only integer flags
// compose under `|`/`&`. `decorationsToCss` maps a flag set to the
// space-separated CSS `text-decoration-line` value SVG/HTML emit
// natively (`underline line-through`). `hasDecoration` tests membership.
export enum TextDecorations
{
    None          = 0,
    Underline     = 1,
    Strikethrough = 2,
    Overline      = 4,
}

// Per-line horizontal alignment of text WITHIN its block. Left (default)
// starts every line at x=0; Center and Right shift each line by
// `(slotWidth - lineWidth) * factor` so text centers / right-aligns inside
// a slot wider than its natural content. Justify distributes the leftover
// slack across the inter-word gaps of every line EXCEPT the last (and lines
// ended by a hard break), so both edges align — the layout engine widens
// the spaces per line rather than shifting the whole line by one offset.
// Shared by TextBlock and the flow-document Block tier — lives here, next to
// the other character/paragraph format enums, so the documents/ content
// model can reference it without importing a Visual.
export enum TextAlignment
{
    Left    = 'Left',
    Center  = 'Center',
    Right   = 'Right',
    Justify = 'Justify',
}

// True when `set` contains `flag`. Single-flag test — pass one member.
export function hasDecoration(set: TextDecorations, flag: TextDecorations): boolean
{
    return (set & flag) !== 0;
}

// Map a decoration flag set to a CSS `text-decoration` value
// (space-separated line keywords), or '' for None. Order is fixed
// (underline, overline, line-through) so output is deterministic.
export function decorationsToCss(set: TextDecorations): string
{
    if (set === TextDecorations.None) return '';
    const parts: string[] = [];
    if (hasDecoration(set, TextDecorations.Underline))     parts.push('underline');
    if (hasDecoration(set, TextDecorations.Overline))      parts.push('overline');
    if (hasDecoration(set, TextDecorations.Strikethrough)) parts.push('line-through');
    return parts.join(' ');
}

// A snapshot of laid-out text ready to be rendered. NOT a MuralBase — it's
// an immutable value built by a Visual's OnRender from its own
// properties (FontFamily, FontSize, …) and handed to
// DrawingContext.DrawText.
//
// Foreground is optional — undefined lets the renderer fall back to its
// default (black for SVG). Concrete Visuals (TextBlock, Run, …) decide
// whether to pass through `undefined` or supply an explicit default.
export class FormattedText
{
    public readonly Text: string;
    public readonly FontFamily: string;
    public readonly FontSize: number;
    public readonly Foreground: Brush | undefined;
    public readonly FontWeight: FontWeight;
    public readonly FontStyle: FontStyle;
    // Pre-computed metrics from the measurer that sized this text
    // during MeasureOverride. Renderers use Metrics.Ascent for proper
    // baseline placement (SVG y = origin.Y + Ascent). Optional — when
    // undefined, renderers fall back to an approximation based on
    // FontSize.
    public readonly Metrics: TextMetrics | undefined;
    // Extra space between adjacent glyphs, in DIPs. M3 typography
    // tokens spec this as `tracking` (e.g. DisplayLarge = -0.25,
    // LabelLarge = 0.1). Defaults to 0 (browser default kerning).
    // Renderers emit `letter-spacing` on the SVG `<text>` element when
    // non-zero. Note: not factored into Metrics.Width, so wrapping
    // ignores it — fine for the small M3 tracking values, would need
    // measurer integration for larger values.
    public readonly LetterSpacing: number;
    // Line embellishments (underline / strikethrough / overline) as a
    // combinable flag set. Defaults to None. Renderers emit the CSS
    // `text-decoration` from decorationsToCss when non-None.
    public readonly Decorations: TextDecorations;

    constructor(
        text: string,
        fontFamily: string,
        fontSize: number,
        foreground: Brush | undefined,
        fontWeight: FontWeight = FontWeight.Normal,
        fontStyle: FontStyle = FontStyle.Normal,
        metrics?: TextMetrics,
        letterSpacing: number = 0,
        decorations: TextDecorations = TextDecorations.None,
    )
    {
        this.Text = text;
        this.FontFamily = fontFamily;
        this.FontSize = fontSize;
        this.Foreground = foreground;
        this.FontWeight = fontWeight;
        this.FontStyle = fontStyle;
        this.Metrics = metrics;
        this.LetterSpacing = letterSpacing;
        this.Decorations = decorations;
    }
}
