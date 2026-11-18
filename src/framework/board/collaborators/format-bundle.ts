import { type TextAlignment } from '../../../visual-engine/index.js';
import { type DataTemplate } from '../../../basic/templates/data-template.js';
import { type ITextStyleTarget, TextPlacement } from '../shape-text.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import {
    serializeBrush, deserializeBrush, serializeStroke, deserializeStroke,
    type SerializedBrush, type StrokeFields,
} from '../serialization/brush-serialization.js';

// A transferable snapshot of a figure's / connector's FORMAT — the "Copy
// Format" (format-painter) payload. It carries paint (fill + stroke), text
// STYLE (font family / size / colour / decorations / alignment / placement —
// never the text CONTENT), the aspect-ratio lock, and, for connectors, the
// end-cap settings. Geometry (position / size) is deliberately excluded.
//
// A channel key is present only when the source carried that channel, so
// applyFormat can tell "the source had a None fill" (fill present, value null)
// from "the source had no fill channel at all" (fill key absent). This mirrors
// the node serializer's own `'fill' in data` idiom.

// The character + paragraph style lifted off a shape's label. `foreground` is a
// serialized brush (null when the label uses the theme default ink, so a stamp
// leaves the target theme-reactive rather than pinning it to black).
export interface CapturedText
{
    readonly family:     string;
    readonly size:       number;
    readonly foreground: SerializedBrush;
    readonly bold:       boolean;
    readonly italic:     boolean;
    readonly underline:  boolean;
    readonly strike:     boolean;
    readonly alignment:  TextAlignment;
    readonly placement:  TextPlacement;
}

// A connector's two end-caps (template + per-end scale). Templates are shared
// immutable resources, so the reference is copied as-is.
export interface CapturedCaps
{
    readonly sourceTemplate: DataTemplate | undefined;
    readonly targetTemplate: DataTemplate | undefined;
    readonly sourceScale:    number;
    readonly targetScale:    number;
}

export interface FormatBundle
{
    fill?:            SerializedBrush;   // present ⇒ captured (null encodes "None")
    stroke?:          StrokeFields;
    text?:            CapturedText;
    lockAspectRatio?: boolean;
    caps?:            CapturedCaps;
}

// The source / target of a format transfer — a self-painting shape/container
// Figure or a Connector.
export type FormatTarget = Figure | Connector;

// Snapshot `source`'s format into a transferable bundle. Reads only the
// channels the source actually owns: Fill / LockAspectRatio are Figure-only,
// caps are Connector-only, Stroke + text style are on both.
export function captureFormat(source: FormatTarget): FormatBundle
{
    const out: FormatBundle = {};
    if (source instanceof Figure)
    {
        out.fill            = serializeBrush(source.Fill);
        out.lockAspectRatio = source.LockAspectRatio;
    }
    if (source.Stroke !== undefined) out.stroke = serializeStroke(source.Stroke);
    out.text = captureText(source.Text);
    if (source instanceof Connector)
    {
        out.caps = {
            sourceTemplate: source.SourceCapTemplate,
            targetTemplate: source.TargetCapTemplate,
            sourceScale:    source.SourceCapScale,
            targetScale:    source.TargetCapScale,
        };
    }
    return out;
}

// Stamp `bundle` onto `target`, applying only the channels the target can
// accept — a connector ignores fill / lock / (a figure's absent) caps, a figure
// ignores caps. Fill (and every other channel) is copied by value, so the
// target's brushes / pens keep their own identity.
export function applyFormat(target: FormatTarget, bundle: FormatBundle): void
{
    if (target instanceof Figure)
    {
        if ('fill' in bundle)                    target.Fill            = deserializeBrush(bundle.fill);
        if (bundle.lockAspectRatio !== undefined) target.LockAspectRatio = bundle.lockAspectRatio;
    }
    if (bundle.stroke !== undefined)
    {
        const pen = deserializeStroke(bundle.stroke);
        if (pen !== undefined) target.Stroke = pen;
    }
    if (bundle.text !== undefined) applyText(target.Text, bundle.text);
    if (target instanceof Connector && bundle.caps !== undefined)
    {
        target.SourceCapTemplate = bundle.caps.sourceTemplate;
        target.TargetCapTemplate = bundle.caps.targetTemplate;
        target.SourceCapScale    = bundle.caps.sourceScale;
        target.TargetCapScale    = bundle.caps.targetScale;
    }
}

// A shape's label carries paragraph alignment (ITextStyleTarget) plus a block
// Placement (ShapeText DP). Both Figure.Text and Connector.Text are ShapeTexts,
// so this covers both.
type TextTarget = ITextStyleTarget & { Placement: TextPlacement };

function captureText(t: TextTarget): CapturedText
{
    return {
        family:     t.CurrentFontFamily(),
        size:       t.CurrentFontSize(),
        foreground: serializeBrush(t.CurrentForeground()),
        bold:       t.CurrentBold(),
        italic:     t.CurrentItalic(),
        underline:  t.CurrentUnderline(),
        strike:     t.CurrentStrikethrough(),
        alignment:  t.CurrentParagraphAlignment(),
        placement:  t.Placement,
    };
}

function applyText(t: TextTarget, text: CapturedText): void
{
    // An empty family means "inherit" — applying '' would clobber the target's
    // inherited font, so leave it untouched.
    if (text.family !== '') t.ApplyFontFamily(text.family);
    t.ApplyFontSize(text.size);
    const fg = deserializeBrush(text.foreground);
    if (fg !== undefined) t.ApplyForeground(fg);
    t.ApplyBold(text.bold);
    t.ApplyItalic(text.italic);
    t.ApplyUnderline(text.underline);
    t.ApplyStrikethrough(text.strike);
    t.ApplyParagraphAlignment(text.alignment);
    t.Placement = text.placement;
}
