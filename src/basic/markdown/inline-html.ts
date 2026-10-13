// inline-html.ts — best-effort handling of raw HTML embedded in markdown.
//
// mural renders no HTML, so we map a small whitelist of tags to FlowDocument
// inlines and STRIP everything else (keeping inner text). Two entry points share
// one whitelist:
//   * ParseTag + OpenTagInline — for INLINE html, which marked emits as separate
//     tokens per tag (`<b>`, text, `</b>`); the renderer drives a span stack
//     with these.
//   * FragmentToInlines — for BLOCK-level raw html, which marked hands over as
//     one whole string; this tokenises and walks it itself.
//
// Whitelist: b/strong → Bold, i/em → Italic, a → Hyperlink, code → monospace
// Span, br → LineBreak. Any other tag is dropped, its text content preserved.
import {
    Bold, Hyperlink, Italic, LineBreak, Run, Span, type Inline,
} from '../index.js';
import { FlowStyle } from './flow-style.js';

export enum HtmlTagKind { Open = 'open', Close = 'close', Void = 'void' }

export interface HtmlTag
{
    readonly kind: HtmlTagKind;
    readonly name: string;                       // lower-cased tag name
    readonly attrs: Readonly<Record<string, string>>;
}

export class InlineHtml
{
    // Tags we translate; everything else is stripped to its text content.
    private static readonly Whitelist = new Set(['b', 'strong', 'i', 'em', 'a', 'code', 'br']);
    // Tags that never have children (self-closing regardless of syntax).
    private static readonly VoidTags = new Set(['br']);

    public static IsWhitelistedTag(name: string): boolean
    {
        return InlineHtml.Whitelist.has(name.toLowerCase());
    }

    // Parse a single `<...>` tag string into its kind/name/attrs, or undefined if
    // it isn't a well-formed tag. Handles open (`<a href="x">`), close (`</a>`),
    // and void/self-closing (`<br>`, `<br/>`) forms.
    public static ParseTag(raw: string): HtmlTag | undefined
    {
        const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*(\/)?\s*>$/.exec(raw.trim());
        if (m === null) return undefined;
        const name = m[2]!.toLowerCase();
        const kind = m[1] !== undefined
            ? HtmlTagKind.Close
            : (m[4] !== undefined || InlineHtml.VoidTags.has(name)) ? HtmlTagKind.Void : HtmlTagKind.Open;
        return { kind, name, attrs: InlineHtml.ParseAttrs(m[3] ?? '') };
    }

    // Build the empty Span an OPEN whitelisted tag maps to (the caller fills its
    // children). Returns undefined for tags that aren't span-like (br is a void
    // LineBreak, handled by the caller; non-whitelisted tags are stripped).
    public static OpenTagInline(tag: HtmlTag, openLink: (uri: string) => void): Span | undefined
    {
        switch (tag.name)
        {
            case 'b': case 'strong': return new Bold();
            case 'i': case 'em':     return new Italic();
            case 'code':
            {
                const s = new Span();
                s.FontFamily = FlowStyle.Mono;
                return s;
            }
            case 'a':
            {
                const link = new Hyperlink();
                const uri = tag.attrs['href'] ?? '';
                link.NavigateUri = uri;
                link.Click = (): void => openLink(uri);
                return link;
            }
            default: return undefined;
        }
    }

    // Parse a WHOLE html fragment (block-level raw html) into inlines. Text is
    // kept; whitelisted tags nest via a span stack; non-whitelisted tags are
    // dropped but their content flows on. Unbalanced/uncertain markup degrades to
    // plain text.
    public static FragmentToInlines(html: string, openLink: (uri: string) => void): Inline[]
    {
        const root: Inline[] = [];
        // Each stack frame is a sink to append inlines into; the whitelisted-but-
        // stripped case pushes the SAME sink so its children flow into the parent.
        const stack: { tagName: string; sink: Inline[]; add: (i: Inline) => void }[] = [
            { tagName: '', sink: root, add: (i) => root.push(i) },
        ];
        const top = (): (typeof stack)[number] => stack[stack.length - 1]!;

        for (const piece of InlineHtml.TokenizeFragment(html))
        {
            if (piece.tag === undefined)
            {
                const text = InlineHtml.DecodeEntities(piece.text);
                if (text.length > 0) top().add(new Run(text));
                continue;
            }
            const tag = piece.tag;
            if (tag.kind === HtmlTagKind.Void)
            {
                if (tag.name === 'br') top().add(new LineBreak());
                continue;
            }
            if (tag.kind === HtmlTagKind.Open)
            {
                const span = InlineHtml.OpenTagInline(tag, openLink);
                if (span !== undefined)
                {
                    top().add(span);
                    stack.push({ tagName: tag.name, sink: [], add: (i) => span.AddChild(i) });
                }
                else
                {
                    // Stripped tag — keep a frame so its close pops cleanly, but
                    // its children flow into the current sink.
                    const parent = top();
                    stack.push({ tagName: tag.name, sink: parent.sink, add: parent.add });
                }
                continue;
            }
            // Close — pop to the matching open (tolerant of mismatched nesting).
            for (let k = stack.length - 1; k > 0; k -= 1)
            {
                if (stack[k]!.tagName === tag.name) { stack.length = k; break; }
            }
        }
        return root;
    }

    private static ParseAttrs(s: string): Record<string, string>
    {
        const attrs: Record<string, string> = {};
        const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(s)) !== null) attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? '';
        return attrs;
    }

    // Split a fragment into text/tag pieces in document order.
    private static TokenizeFragment(html: string): { text: string; tag?: HtmlTag }[]
    {
        const out: { text: string; tag?: HtmlTag }[] = [];
        const re = /<[^>]+>/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null)
        {
            if (m.index > last) out.push({ text: html.slice(last, m.index) });
            const tag = InlineHtml.ParseTag(m[0]);
            if (tag !== undefined) out.push({ text: m[0], tag });
            else out.push({ text: m[0] });          // not a real tag — literal text
            last = re.lastIndex;
        }
        if (last < html.length) out.push({ text: html.slice(last) });
        return out;
    }

    // Decode the handful of HTML entities that appear in markdown-embedded html.
    // Canonical home — the renderer reuses this through FragmentToInlines rather
    // than keeping a second copy.
    private static DecodeEntities(s: string): string
    {
        return s
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&');
    }
}
