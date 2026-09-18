// µ-mural source formatter. Parses `.mu` source to the AST (reusing the
// compiler's Lexer + Parser, so the formatter and compiler can never
// disagree about the grammar) and pretty-prints it back to canonical
// `.mu` text. Comments — captured by the lexer as trivia — are re-woven
// in by source position.
//
// Guarantees the test-suite pins:
//   * Semantics-preserving — re-parsing the output yields the same AST
//     (modulo spans) as the input. The formatter never changes meaning.
//   * Idempotent — format(format(x)) === format(x).
//   * Comment-preserving — every `//` / `/* */` comment survives.
//
// House conventions (derived from the existing .mu corpus):
//   * 4-space indent.
//   * Element attrs: `Name [ A = b, C = d ] { … }`, spaced; wrapped one
//     per line with `=` column-aligned when the inline form overflows.
//   * Resource-form meta attrs: tight `[TargetType=X]`.
//   * Blank lines between sibling items are preserved (collapsed to one).

import { Parser } from './parser.js';
import { DEFAULT_SLOT_INFO, type SlotInfo } from './symbol-table.js';
import type { Comment, SourceSpan } from './tokens.js';
import type {
    AnimationDecl, Attribute, AttrPath, BodyItem, ConverterRef,
    DataTemplateBody, DefForm, Document, ElementNode, EventTriggerGroup,
    FontEntry, FontsForm, GlyphEntry, GlyphsForm, ImportForm, IncludeForm,
    KeyValueResource, MacroParam, MemberBlock, ModuleForm, ModulesBlock, TargetsBlock,
    NamedAttr, PropertySetter,
    ResourceForm, ResourcesBlock, ResourcesImport, SchemeBlock, ServiceEntry,
    ServicesBlock, SetterItem, SetterList, SlotAssign, StaticResourceValue, StringBody,
    StructuredBody, TemplateSelectorBody, ThemeBlock, TokenCatalogEntry, TopForm, TriggerActionNode,
    TriggerExpr, TriggerGroup, ValueNode, XAttr, BehaviorsBlock,
} from './ast.js';

export interface FormatOptions
{
    /** Spaces per indent level. Default 4 (the corpus convention). */
    indentWidth?: number;
    /** Soft line-width budget; element attribute lists wrap past it.
     *  Default 100. */
    maxWidth?: number;
    /** Slot registry that tells the parser which control bodies are
     *  string-typed (so `TextBlock { Hello }` lexes as text, not stray
     *  idents). Defaults to the compiler's DEFAULT_SLOT_INFO; pass a
     *  superset when formatting markup that declares custom controls with
     *  string slots. */
    slots?: ReadonlyMap<string, SlotInfo>;
    /** When true, re-parse the formatted output and throw if it doesn't
     *  round-trip to the same AST (modulo spans) as the input. This turns
     *  a printer gap — an unhandled node kind that prints to nothing — from
     *  silent data-loss into a loud failure, so callers that overwrite the
     *  source buffer (format-on-save) can refuse lossy output. Off by
     *  default (the CLI's best-effort contract is unchanged). */
    verify?: boolean;
}

export function format(source: string, options: FormatOptions = {}): string
{
    const slots = options.slots ?? DEFAULT_SLOT_INFO;
    const isStringBody = (name: string) => slots.get(name)?.kind === 'string';
    const parser = new Parser(source, { isStringBody });
    const doc = parser.ParseDocument();
    const printer = new Printer(source, parser.comments, options);
    const out = printer.printDocument(doc);
    if (options.verify)
    {
        // Re-parse our own output; its AST must match the input's (modulo
        // spans). A mismatch means the printer dropped or mangled a node —
        // a formatter bug. Throw rather than hand back lossy text a caller
        // might write over the user's file.
        const reparsed = new Parser(out, { isStringBody }).ParseDocument();
        if (astShape(reparsed) !== astShape(doc))
        {
            throw new Error(
                'formatter output does not round-trip to the same AST — ' +
                'refusing to apply lossy output (formatter bug: an unhandled ' +
                'node kind likely printed to nothing)');
        }
    }
    return out;
}

/** Structural fingerprint of an AST with source spans stripped — two docs
 *  parsed by the same Parser compare equal iff they're the same tree modulo
 *  positions. Used by the `verify` round-trip self-check. */
function astShape(doc: Document): string
{
    return JSON.stringify(doc, (key, value) => key === 'span' ? undefined : value);
}

// ── Printer ─────────────────────────────────────────────────────────

class Printer
{
    private readonly lines: string[] = [];
    private readonly unit: string;
    private readonly maxWidth: number;
    private readonly comments: readonly Comment[];
    private readonly source: string;
    private readonly lineStarts: number[];
    private ci = 0;             // index of next un-emitted comment

    constructor(source: string, comments: readonly Comment[], opts: FormatOptions)
    {
        this.source = source;
        this.comments = comments;
        this.unit = ' '.repeat(opts.indentWidth ?? 4);
        this.maxWidth = opts.maxWidth ?? 100;
        this.lineStarts = [0];
        for (let i = 0; i < source.length; i++) if (source[i] === '\n') this.lineStarts.push(i + 1);
    }

    private lineAt(offset: number): number
    {
        // Binary search the precomputed line-start table. 1-based line.
        let lo = 0, hi = this.lineStarts.length - 1;
        while (lo < hi)
        {
            const mid = (lo + hi + 1) >> 1;
            if (this.lineStarts[mid]! <= offset) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
    }


    printDocument(doc: Document): string
    {
        this.printSequence(doc.forms, 0, f => f.span, f => this.printTopForm(f, 0));
        // Trailing comments after the last form.
        this.flushCommentsBefore(Number.MAX_SAFE_INTEGER, 0);
        // Single trailing newline; no leading/trailing blank lines.
        const body = this.lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
        return body + '\n';
    }

    // ── Line + indent primitives ────────────────────────────────────

    private pad(level: number): string { return this.unit.repeat(level); }

    private push(level: number, text: string): void
    {
        this.lines.push(text === '' ? '' : this.pad(level) + text);
    }

    /** Append to the last emitted line (for trailing comments / brace
     *  attachment that a child built separately). */
    private appendToLast(text: string): void
    {
        if (this.lines.length === 0) this.lines.push(text);
        else this.lines[this.lines.length - 1] += text;
    }

    // Emit one blank line — but never right after an opening brace (no
    // blank at a block start) and never two in a row. This single guard is
    // what keeps blank-line placement clean without per-call bookkeeping.
    private blank(): void
    {
        if (this.lines.length === 0) return;
        const last = this.lines[this.lines.length - 1]!;
        if (last === '' || last.endsWith('{')) return;
        this.lines.push('');
    }

    /** True when the source has a blank line immediately before `offset`
     *  (≥ 2 consecutive newlines of whitespace before the next content). */
    private hasBlankBefore(offset: number): boolean
    {
        let i = offset, nl = 0;
        while (i > 0 && /\s/.test(this.source[i - 1]!))
        {
            if (this.source[i - 1] === '\n') nl++;
            i--;
        }
        return nl >= 2;
    }

    /** True when `offset` has non-whitespace before it on the same source
     *  line — i.e. a comment there is trailing code, not on its own line. */
    private isTrailing(offset: number): boolean
    {
        const lineStart = this.lineStarts[this.lineAt(offset) - 1]!;
        return this.source.slice(lineStart, offset).trim() !== '';
    }

    // ── Comment interleaving ─────────────────────────────────────────
    //
    // Comments are woven in at list boundaries. Before an item that
    // starts at `offset`, flush every pending comment that begins before
    // it. A comment whose start line matches the previous item's end line
    // is a trailing comment (appended to that line); otherwise it lands on
    // its own line, with a blank line preserved when the source had a gap.

    private flushCommentsBefore(offset: number, level: number): void
    {
        while (this.ci < this.comments.length && this.comments[this.ci]!.span.start.offset < offset)
        {
            const c = this.comments[this.ci]!;
            this.ci++;
            const text = c.kind === 'line' ? c.text.replace(/\s+$/, '') : c.text;
            if (this.isTrailing(c.span.start.offset) && this.lines.length > 0)
            {
                // Trailing comment — append to the line just emitted. A
                // multi-line block comment collapses its newlines to spaces
                // when trailing (rare; keeps the line intact).
                this.appendToLast(' ' + text.replace(/\s*\n\s*/g, ' '));
            }
            else
            {
                if (this.hasBlankBefore(c.span.start.offset)) this.blank();
                const parts = text.split('\n');
                this.push(level, parts[0]!.replace(/\s+$/, ''));
                // Continuation lines of a block comment: strip the source's
                // own indentation and re-base to one space past the indent
                // (under the `/*`), so re-formatting can't accrete leading
                // whitespace — keeps block comments idempotent.
                for (let i = 1; i < parts.length; i++)
                {
                    this.push(level, (' ' + parts[i]!.trim()).replace(/\s+$/, ''));
                }
            }
        }
    }

    /** Print a sequence of nodes (forms, body items, setters) with comment
     *  interleaving and blank-line preservation between siblings. */
    private printSequence<T>(
        items: readonly T[],
        level: number,
        spanOf: (t: T) => SourceSpan,
        printOne: (t: T) => void,
    ): void
    {
        for (const item of items)
        {
            const span = spanOf(item);
            this.flushCommentsBefore(span.start.offset, level);
            // Preserve a single blank line where the source had one. The
            // blank() guard drops it at a block start, so the first child
            // never gets a spurious leading blank. Placement is a pure
            // function of local source layout → idempotent.
            if (this.hasBlankBefore(span.start.offset)) this.blank();
            printOne(item);
        }
    }

    // ── Top-level forms ──────────────────────────────────────────────

    private printTopForm(form: TopForm, level: number): void
    {
        switch (form.kind)
        {
            case 'import':          return this.printImport(form, level);
            case 'def':             return this.printDef(form, level);
            case 'element':         return this.printElement(form, level);
            case 'resource-form':   return this.printResourceForm(form, level);
            case 'resources-block': return this.printResourcesBlock(form, level);
            case 'theme-block':     return this.printThemeBlock(form, level);
            case 'scheme-block':    return this.printSchemeBlock(form, level);
            case 'module-form':     return this.printModuleForm(form, level);
        }
    }

    // `module Name [attrs] { … }` / `shell module Name [attrs] { Capability … }` —
    // reprinted by reusing the element printer on the synthetic module root, with
    // the type name swapped for the keyword head. The root's synthesized type
    // (`ShellModule` vs the headless `Module`) selects the `shell module` / `module`
    // keyword; the root's attrs/body then wrap and indent exactly like any element.
    private printModuleForm(form: ModuleForm, level: number): void
    {
        const keyword = form.root.name === 'ShellModule' ? 'shell module' : 'module';
        this.printElement({ ...form.root, name: `${keyword} ${form.exportName}` }, level);
    }

    private printImport(form: ImportForm, level: number): void
    {
        this.push(level, form.source === null
            ? `import ${form.name}`
            : `import ${form.name} from ${q(form.source)}`);
    }

    private printResourcesImport(imp: ResourcesImport, level: number): void
    {
        this.push(level, `import ${imp.alias} from ${q(imp.source)}`);
    }

    private printResourcesBlock(form: ResourcesBlock, level: number): void
    {
        this.push(level, `resources ${form.name} {`);
        for (const imp of form.imports) this.printResourcesImport(imp, level + 1);
        if (form.imports.length > 0 && form.body.items.length > 0) this.blank();
        this.printStructuredBodyItems(form.body, level + 1);
        this.flushCommentsBefore(form.span.end.offset, level + 1);
        this.push(level, '}');
    }

    private printThemeBlock(form: ThemeBlock, level: number): void
    {
        this.push(level, `theme ${form.name} {`);
        const inner = level + 1;
        for (const imp of form.imports) this.printResourcesImport(imp, inner);
        if (form.schemes.length > 0) this.push(inner, `schemes: [${form.schemes.join(', ')}]`);
        if (form.defaultScheme !== undefined) this.push(inner, `defaultScheme: ${form.defaultScheme}`);
        if (form.dictionaries.length > 0) this.push(inner, `dictionaries: [${form.dictionaries.join(', ')}]`);
        if (form.tokens.length > 0)
        {
            this.blank();
            this.push(inner, 'tokens {');
            for (const t of form.tokens) this.printTokenEntry(t, inner + 1);
            this.push(inner, '}');
        }
        if (form.body.items.length > 0) this.blank();
        this.printStructuredBodyItems(form.body, inner);
        this.flushCommentsBefore(form.span.end.offset, inner);
        this.push(level, '}');
    }

    private printTokenEntry(t: TokenCatalogEntry, level: number): void
    {
        const names = t.names.length === 1
            ? `@${t.names[0]}`
            : `@${t.names[0]}..@${t.names[t.names.length - 1]}`;
        const desc = t.description !== undefined ? ` ${q(t.description)}` : '';
        this.push(level, `${names} : ${t.typeText}${desc}`);
    }

    private printSchemeBlock(form: SchemeBlock, level: number): void
    {
        const basedOn = form.basedOn !== undefined ? ` basedOn ${form.basedOn}` : '';
        this.push(level, `scheme ${form.name} against ${form.theme}${basedOn} {`);
        const inner = level + 1;
        for (const imp of form.imports) this.printResourcesImport(imp, inner);
        this.printStructuredBodyItems(form.body, inner);
        this.flushCommentsBefore(form.span.end.offset, inner);
        this.push(level, '}');
    }

    private printDef(form: DefForm, level: number): void
    {
        const params = form.params.map(p => this.printMacroParam(p)).join(', ');
        this.push(level, `def ${form.name}[${params}] {`);
        this.printElement(form.body, level + 1);
        this.push(level, '}');
    }

    private printMacroParam(p: MacroParam): string
    {
        const hole = `#${p.holeName}`;
        const type = p.typeRef !== null ? `: ${p.typeRef}` : '';
        const dflt = p.defaultValue !== null ? ` = ${this.printValue(p.defaultValue)}` : '';
        return `${hole}${type}${dflt}`;
    }

    // ── Elements ─────────────────────────────────────────────────────

    private printElement(el: ElementNode, level: number): void
    {
        const head = this.elementHead(el, level);
        const body = el.body;
        if (body === null)
        {
            this.pushHead(level, head, '');
            return;
        }
        if (body.kind === 'string-body')
        {
            // The chunk text carries its own surrounding whitespace, so it
            // sits between the braces verbatim (no added padding) — that's
            // what round-trips the literal content exactly.
            const text = this.printStringBody(body);
            this.pushHead(level, head, ` {${text}}`);
            return;
        }
        // Structured body.
        if (body.items.length === 0)
        {
            this.pushHead(level, head, ' { }');
            return;
        }
        this.pushHead(level, head, ' {');
        this.printStructuredBodyItems(body, level + 1);
        this.flushCommentsBefore(body.span.end.offset, level + 1);
        this.push(level, '}');
    }

    /** The element's `Name x:attrs [attrs]` head, possibly multi-line when
     *  attributes wrap. `firstLine` is the part the body brace attaches to
     *  when single-line; `lines` are the already-emitted-style extra lines
     *  for a wrapped attr block (emitted by pushHead). */
    private elementHead(el: ElementNode, level: number): ElementHead
    {
        const xa = el.xAttrs.map(x => this.printXAttr(x));
        const namePart = [el.name, ...xa].join(' ');
        if (el.attrs.length === 0) return { firstLine: namePart, lines: [], wrapped: false };

        const inlineAttrs = `[ ${el.attrs.map(a => this.printAttr(a)).join(', ')} ]`;
        const inlineHead = `${namePart} ${inlineAttrs}`;
        if ((this.pad(level) + inlineHead).length <= this.maxWidth && !inlineAttrs.includes('\n'))
        {
            return { firstLine: inlineHead, lines: [], wrapped: false };
        }
        // Wrap: one attr per line, `=` column-aligned, under a `[ ` opener
        // indented one level past the element.
        const named = el.attrs.every(a => a.kind === 'named-attr') ? (el.attrs as NamedAttr[]) : null;
        const wrapIndent = this.pad(level + 1);
        const open = `${wrapIndent}[ `;
        const lines: string[] = [];
        if (named !== null)
        {
            const labels = named.map(a => this.printAttrPath(a.path));
            const w = Math.max(...labels.map(l => l.length));
            named.forEach((a, i) =>
            {
                const lhs = labels[i]!.padEnd(w);
                const rhs = this.printValue(a.value);
                const lead = i === 0 ? open : wrapIndent + '  ';
                const tail = i === named.length - 1 ? ' ]' : ',';
                lines.push(`${lead}${lhs} = ${rhs}${tail}`);
            });
        }
        else
        {
            el.attrs.forEach((a, i) =>
            {
                const lead = i === 0 ? open : wrapIndent + '  ';
                const tail = i === el.attrs.length - 1 ? ' ]' : ',';
                lines.push(`${lead}${this.printAttr(a)}${tail}`);
            });
        }
        return { firstLine: namePart, lines, wrapped: true };
    }

    /** Emit an element head plus the brace/terminator that follows it.
     *  `after` is `''`, `' {'`, `' { }'`, etc. — attached to the line that
     *  carries the `]` (wrapped) or the head (inline). */
    private pushHead(level: number, head: ElementHead, after: string): void
    {
        if (!head.wrapped)
        {
            this.push(level, head.firstLine + after);
            return;
        }
        this.push(level, head.firstLine);
        head.lines.forEach((ln, i) =>
        {
            if (i === head.lines.length - 1) this.lines.push(ln + after);
            else this.lines.push(ln);
        });
    }

    private printXAttr(x: XAttr): string
    {
        if (x.value === null || x.value.kind === 'flag') return `x:${x.name}`;
        return `x:${x.name}=${this.printValue(x.value)}`;
    }

    private printAttr(a: Attribute): string
    {
        if (a.kind === 'positional-attr') return this.printValue(a.value);
        return `${this.printAttrPath(a.path)} = ${this.printValue(a.value)}`;
    }

    private printAttrPath(p: AttrPath): string { return p.parts.join('.'); }

    // ── Bodies ───────────────────────────────────────────────────────

    private printStructuredBodyItems(body: StructuredBody, level: number): void
    {
        this.printSequence(body.items, level, it => it.span, it => this.printBodyItem(it, level));
    }

    private printBodyItem(item: BodyItem, level: number): void
    {
        switch (item.kind)
        {
            case 'element':            return this.printElement(item, level);
            case 'slot-assign':        return this.printSlotAssign(item, level);
            case 'member-block':       return this.printMemberBlock(item, level);
            case 'services-block':     return this.printServicesBlock(item, level);
            case 'modules-block':      return this.printModulesBlock(item, level);
            case 'targets-block':      return this.printTargetsBlock(item, level);
            case 'key-value-resource': return this.printKeyValueResource(item, level);
            case 'resource-form':      return this.printResourceForm(item, level);
            case 'def':                return this.printDef(item, level);
            case 'include-form':       return this.printInclude(item, level);
            case 'merge-form':         return this.push(level, `merge ${item.alias}`);
            case 'glyphs-form':        return this.printGlyphs(item, level);
            case 'fonts-form':         return this.printFonts(item, level);
            case 'macro-hole-body-item': return this.push(level, `#${item.name}`);
            // A quoted string used as a body item (e.g. `Span [...] { "text" }`
            // in rich-text markup) — a text-chunk in a STRUCTURED body. Emit it
            // re-quoted; dropping it silently corrupts the markup.
            case 'text-chunk-body-item': return this.push(level, q(item.value));
        }
    }

    private printSlotAssign(item: SlotAssign, level: number): void
    {
        const v = item.value;
        if ('kind' in v && v.kind === 'structured-body')
        {
            this.push(level, `${item.name}: {`);
            this.printStructuredBodyItems(v, level + 1);
            this.flushCommentsBefore(v.span.end.offset, level + 1);
            this.push(level, '}');
            return;
        }
        if ('kind' in v && v.kind === 'resource-form')
        {
            // Inline template assigned to a slot: `Name: Template { … }`.
            const saved = this.lines.length;
            this.printResourceForm(v, level);
            // Prefix the first emitted line with `Name: `.
            if (this.lines.length > saved)
            {
                const idx = saved;
                this.lines[idx] = this.lines[idx]!.replace(this.pad(level), this.pad(level) + `${item.name}: `);
            }
            return;
        }
        this.push(level, `${item.name}: ${this.printValue(v as ValueNode)}`);
    }

    private printMemberBlock(item: MemberBlock, level: number): void
    {
        if (item.body.items.length === 0)
        {
            this.push(level, `.${item.name}: { }`);
            return;
        }
        this.push(level, `.${item.name}: {`);
        this.printStructuredBodyItems(item.body, level + 1);
        this.flushCommentsBefore(item.body.span.end.offset, level + 1);
        this.push(level, '}');
    }

    private printServicesBlock(item: ServicesBlock, level: number): void
    {
        this.push(level, '.services: {');
        this.printSequence(item.entries, level + 1, e => e.span, e => this.printServiceEntry(e, level + 1));
        this.push(level, '}');
    }

    private printServiceEntry(e: ServiceEntry, level: number): void
    {
        const life = e.lifetime !== undefined ? `${e.lifetime} ` : '';
        const cfg = e.config !== undefined && e.config.length > 0
            ? ` { ${e.config.map(c => `${c.name}: ${this.printValue(c.value)}`).join(', ')} }`
            : '';
        const tok = e.token !== undefined ? ` -> ${e.token}` : '';
        this.push(level, `${life}${e.impl}${cfg}${tok}`);
    }

    private printModulesBlock(item: ModulesBlock, level: number): void
    {
        if (item.entries.length === 0) { this.push(level, '.modules: { }'); return; }
        this.push(level, '.modules: {');
        for (const name of item.entries) this.push(level + 1, name);
        this.push(level, '}');
    }

    private printTargetsBlock(item: TargetsBlock, level: number): void
    {
        if (item.entries.length === 0) { this.push(level, '.targets: { }'); return; }
        this.push(level, '.targets: {');
        for (const name of item.entries) this.push(level + 1, name);
        this.push(level, '}');
    }

    private printKeyValueResource(item: KeyValueResource, level: number): void
    {
        const head = item.key === item.name ? `@${item.name}` : `@key:${item.key}`;
        this.push(level, `${head} = ${this.printValue(item.value)}`);
    }

    private printInclude(item: IncludeForm, level: number): void
    {
        const mod = item.colored ? 'colored ' : '';
        const as  = item.key !== undefined ? ` as ${item.key}` : '';
        this.push(level, `include ${mod}${q(item.path)}${as}`);
    }

    private printGlyphs(item: GlyphsForm, level: number): void
    {
        const src = item.fontFamily !== undefined ? `@${item.fontFamily}` : q(item.font);
        this.push(level, `glyphs ${src} {`);
        for (const g of item.entries) this.printGlyphEntry(g, level + 1);
        this.push(level, '}');
    }

    private printGlyphEntry(g: GlyphEntry, level: number): void
    {
        this.push(level, g.codepoint !== undefined ? `${g.key} = ${q(g.codepoint)}` : g.key);
    }

    private printFonts(item: FontsForm, level: number): void
    {
        this.push(level, 'fonts {');
        for (const f of item.entries) this.printFontEntry(f, level + 1);
        this.push(level, '}');
    }

    private printFontEntry(f: FontEntry, level: number): void
    {
        const mods: string[] = [];
        if (f.weight !== undefined) mods.push(`Weight=${f.weight}`);
        if (f.style !== undefined) mods.push(`Style=${f.style}`);
        const tail = mods.length > 0 ? ` [${mods.join(', ')}]` : '';
        this.push(level, `${f.family} from ${q(f.source)}${tail}`);
    }

    private printStringBody(body: StringBody): string
    {
        return body.chunks.map(c =>
            c.kind === 'text-chunk' ? c.text : `{{${c.raw}}}`).join('');
    }

    // ── Resource forms (Style / Template / DataTemplate / …) ─────────

    private printResourceForm(form: ResourceForm, level: number): void
    {
        const meta = [
            ...form.xAttrs.map(x => this.printXAttr(x)),
        ].join(' ');
        const metaAttrs = form.metaAttrs.length > 0
            ? ` [${form.metaAttrs.map(a => this.printAttr(a)).join(', ')}]`
            : '';
        const head = `${form.keyword}${meta !== '' ? ' ' + meta : ''}${metaAttrs}`;

        const body = form.body;
        if (body.kind === 'setter-list')
        {
            if (body.items.length === 0) { this.push(level, `${head} { }`); return; }
            this.push(level, `${head} {`);
            this.printSetterList(body, level + 1);
            this.flushCommentsBefore(body.span.end.offset, level + 1);
            this.push(level, '}');
            return;
        }
        if (body.kind === 'element')
        {
            this.push(level, `${head} {`);
            this.printElement(body, level + 1);
            this.flushCommentsBefore(form.span.end.offset, level + 1);
            this.push(level, '}');
            return;
        }
        if (body.kind === 'template-selector-body')
        {
            this.push(level, `${head} {`);
            this.printTemplateSelectorBody(body, level + 1);
            this.flushCommentsBefore(form.span.end.offset, level + 1);
            this.push(level, '}');
            return;
        }
        // data-template-body: root element + triggers.
        this.push(level, `${head} {`);
        this.printDataTemplateBody(body, level + 1);
        this.flushCommentsBefore(form.span.end.offset, level + 1);
        this.push(level, '}');
    }

    private printTemplateSelectorBody(body: TemplateSelectorBody, level: number): void
    {
        const items: SeqItem[] = body.entries.map(e => ({
            span:  e.span,
            print: () => e.kind === 'resource-form'
                ? this.printResourceForm(e, level)
                : this.push(level, `@${(e as StaticResourceValue).key}`),
        }));
        this.printSequence(items, level, it => it.span, it => it.print());
    }

    private printDataTemplateBody(body: DataTemplateBody, level: number): void
    {
        // Root element, property triggers and event triggers are sibling
        // body items in source order — merge them into one sequence so
        // comments BETWEEN them (e.g. a section comment above a `when`)
        // interleave at the right spot instead of all sinking to the end.
        const items: SeqItem[] = [
            { span: body.root.span, print: () => this.printElement(body.root, level) },
            ...body.triggers.map(t => ({ span: t.span, print: () => this.printTriggerGroup(t, level) })),
            ...body.eventTriggers.map(e => ({ span: e.span, print: () => this.printEventTrigger(e, level) })),
        ].sort((a, b) => a.span.start.offset - b.span.start.offset);
        this.printSequence(items, level, it => it.span, it => it.print());
    }

    private printSetterList(list: SetterList, level: number): void
    {
        this.printSequence(list.items, level, it => it.span, it => this.printSetterItem(it, level));
    }

    private printSetterItem(item: SetterItem, level: number): void
    {
        switch (item.kind)
        {
            case 'property-setter': return this.printPropertySetter(item, level);
            case 'trigger-group':   return this.printTriggerGroup(item, level);
            case 'event-trigger':   return this.printEventTrigger(item, level);
            case 'behaviors-block': return this.printBehaviorsBlock(item, level);
        }
    }

    private printPropertySetter(s: PropertySetter, level: number): void
    {
        this.push(level, `${this.printAttrPath(s.path)} = ${this.printValue(s.value)};`);
    }

    private printTriggerGroup(t: TriggerGroup, level: number): void
    {
        const cond = this.printTriggerExpr(t.condition);
        const setters = t.setters.items;
        // Inline `when ( cond ) { a = b; }` when it's a short single setter.
        if (setters.length === 1 && setters[0]!.kind === 'property-setter')
        {
            const s = setters[0] as PropertySetter;
            const inline = `when ( ${cond} ) { ${this.printAttrPath(s.path)} = ${this.printValue(s.value)}; }`;
            if ((this.pad(level) + inline).length <= this.maxWidth)
            {
                this.push(level, inline);
                return;
            }
        }
        this.push(level, `when ( ${cond} ) {`);
        this.printSetterList(t.setters, level + 1);
        this.flushCommentsBefore(t.span.end.offset, level + 1);
        this.push(level, '}');
    }

    private printTriggerExpr(e: TriggerExpr): string
    {
        switch (e.kind)
        {
            case 'trigger-and': return `${this.printTriggerExpr(e.left)} and ${this.printTriggerExpr(e.right)}`;
            case 'trigger-or':  return `${this.printTriggerExpr(e.left)} or ${this.printTriggerExpr(e.right)}`;
            case 'trigger-term':
            {
                const neg = e.negated ? 'not ' : '';
                let lhs: string;
                if (e.path !== undefined) lhs = `$${e.path}`;
                else if (e.sourceName !== undefined) lhs = `${e.sourceName}.${e.property}`;
                else lhs = e.property!;
                const rhs = e.presence !== undefined
                    ? ` is ${e.presence}`
                    : (e.value !== null ? ` = ${this.printValue(e.value)}` : '');
                return `${neg}${lhs}${rhs}`;
            }
        }
    }

    private printEventTrigger(e: EventTriggerGroup, level: number): void
    {
        if (e.actions.length === 1)
        {
            const inline = `on ${e.eventName} { ${this.printTriggerAction(e.actions[0]!)} }`;
            if (!inline.includes('\n') && (this.pad(level) + inline).length <= this.maxWidth)
            {
                this.push(level, inline);
                return;
            }
        }
        this.push(level, `on ${e.eventName} {`);
        for (const a of e.actions) this.printTriggerActionBlock(a, level + 1);
        this.push(level, '}');
    }

    private printTriggerAction(a: TriggerActionNode): string
    {
        switch (a.kind)
        {
            case 'stop-storyboard':   return `StopStoryboard [Name=${q(a.name)}]`;
            case 'pause-storyboard':  return `PauseStoryboard [Name=${q(a.name)}]`;
            case 'resume-storyboard': return `ResumeStoryboard [Name=${q(a.name)}]`;
            case 'invoke-command':    return `InvokeCommand [Command=${this.printValue(a.command)}]`;
            case 'begin-storyboard':
            {
                const name = a.name !== undefined ? ` [Name=${q(a.name)}]` : '';
                const anims = a.animations.map(an => this.printAnimation(an)).join(' ');
                return `BeginStoryboard${name} { ${anims} }`;
            }
        }
    }

    private printTriggerActionBlock(a: TriggerActionNode, level: number): void
    {
        if (a.kind === 'begin-storyboard' && a.animations.length > 1)
        {
            const name = a.name !== undefined ? ` [Name=${q(a.name)}]` : '';
            this.push(level, `BeginStoryboard${name} {`);
            for (const an of a.animations) this.push(level + 1, this.printAnimation(an));
            this.push(level, '}');
            return;
        }
        this.push(level, this.printTriggerAction(a));
    }

    private printAnimation(an: AnimationDecl): string
    {
        const attrs = an.attrs.map(a => this.printAttr(a)).join(', ');
        return `${an.className} [${attrs}]`;
    }

    private printBehaviorsBlock(b: BehaviorsBlock, level: number): void
    {
        this.push(level, 'Behaviors {');
        for (const el of b.entries) this.printElement(el, level + 1);
        this.push(level, '}');
    }

    // ── Values ───────────────────────────────────────────────────────

    private printValue(v: ValueNode): string
    {
        switch (v.kind)
        {
            case 'number':            return v.raw;
            case 'string':            return q(v.value);
            case 'ident':             return v.name;
            case 'color':             return `#${v.raw}`;
            case 'tuple':             return `(${v.values.map(x => this.printValue(x)).join(',')})`;
            case 'size':              return `<${this.printValue(v.width)}, ${this.printValue(v.height)}>`;
            case 'list':              return `[${v.values.map(x => this.printValue(x)).join(', ')}]`;
            case 'binding':           return this.printBinding(v);
            case 'template-binding':  return `$$${v.name}`;
            case 'static-resource':   return `@${v.key}`;
            case 'dynamic-resource':  return `@@${v.key}`;
            case 'macro-hole':        return `#${v.name}`;
            case 'inline-expr':       return `{{${v.raw}}}`;
            case 'flag':              return '';
            case 'modified':          return `${this.printValue(v.base)}${this.printConverters(v.converters)}`;
            case 'composed':          return v.parts.map(p => this.printValue(p)).join(' + ');
            case 'element':           return this.printInlineElement(v);
        }
    }

    private printBinding(v: Extract<ValueNode, { kind: 'binding' }>): string
    {
        let head: string;
        if (v.source === 'self' && v.attached !== undefined)
        {
            head = `$Self.(${v.attached.owner}.${v.attached.property})`;
        }
        else if (v.source === 'service')
        {
            const path = v.path.length > 0 ? '.' + v.path.join('.') : '';
            head = `$service(${v.serviceToken})${path}`;
        }
        else
        {
            head = `$${v.path.join('.')}`;
        }
        return head + this.printConverters(v.converters);
    }

    private printConverters(cs: readonly ConverterRef[] | undefined): string
    {
        if (cs === undefined || cs.length === 0) return '';
        return cs.map(c => c.args.length > 0
            ? ` << ${c.name}(${c.args.map(a => this.printValue(a)).join(', ')})`
            : ` << ${c.name}`).join('');
    }

    /** Element used in value position — `Pen [ Brush = @X, Thickness = 1 ]`. */
    private printInlineElement(el: ElementNode): string
    {
        const xa = el.xAttrs.map(x => this.printXAttr(x));
        const namePart = [el.name, ...xa].join(' ');
        if (el.attrs.length === 0) return namePart;
        return `${namePart} [${el.attrs.map(a => this.printAttr(a)).join(', ')}]`;
    }
}

interface ElementHead
{
    firstLine: string;
    lines:     string[];
    wrapped:   boolean;
}

interface SeqItem
{
    span:  SourceSpan;
    print: () => void;
}

// Re-quote a string value with the escapes the lexer would unescape.
function q(s: string): string
{
    const esc = s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r');
    return `"${esc}"`;
}
