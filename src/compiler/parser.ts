import { Lexer } from './lexer.js';
import {
    TokenKind,
    type Comment,
    type SourceLocation,
    type SourceSpan,
    type Token,
} from './tokens.js';
import { TriggerPresence } from './ast.js';
import type {
    AnimationDecl,
    Attribute,
    AttrPath,
    BeginStoryboardNode,
    BindingValue,
    ConverterRef,
    InvokeCommandNode,
    PauseStoryboardNode,
    ResumeStoryboardNode,
    StopStoryboardNode,
    BodyItem,
    ColorValue,
    DataTemplateBody,
    Document,
    DefForm,
    IncludeForm,
    MergeForm,
    GlyphsForm,
    GlyphEntry,
    FontsForm,
    FontEntry,
    DynamicResourceValue,
    ElementNode,
    EventTriggerGroup,
    IdentValue,
    ImportForm,
    InlineExprValue,
    KeyValueResource,
    ListValue,
    MacroHoleValue,
    MacroParam,
    NamedAttr,
    NumberValue,
    PropertySetter,
    ResourceForm,
    ResourcesBlock,
    ResourcesImport,
    SchemeBlock,
    SetterItem,
    SetterList,
    SizeValue,
    SlotAssign,
    MemberBlock,
    ModuleForm,
    ModulesBlock,
    ServicesBlock,
    ServiceEntry,
    ServiceConfigEntry,
    StaticResourceValue,
    StringBody,
    StringBodyChunk,
    StringValue,
    StructuredBody,
    TemplateBindingValue,
    TemplateSelectorBody,
    ThemeBlock,
    TokenCatalogEntry,
    TopForm,
    TriggerActionNode,
    TriggerExpr,
    TriggerGroup,
    TupleValue,
    ValueNode,
    XAttr,
} from './ast.js';

// Errors carry the source span so callers can render line:col diagnostics.
export enum MacroArgMode
{
    Named      = 'named',
    Positional = 'positional',
}

export class ParseError extends Error
{
    public readonly span: SourceSpan;
    constructor(message: string, span: SourceSpan)
    {
        super(`${message} (at ${span.start.line}:${span.start.column})`);
        this.span = span;
    }
}

// Expand a `@Foo1..@Foo8`-style range into the individual token names.
// Both ends must share a common alphabetic prefix and end in a numeric
// suffix; the prefix is preserved and the numeric range is generated
// inclusively. `expandTokenRange('Space1', 'Space8', span)` returns
// `['Space1', 'Space2', 'Space3', 'Space4', 'Space5', 'Space6',
//   'Space7', 'Space8']`.
function expandTokenRange(first: string, last: string, span: SourceSpan): string[]
{
    const m1 = /^([A-Za-z_]+)(\d+)$/.exec(first);
    const m2 = /^([A-Za-z_]+)(\d+)$/.exec(last);
    if (m1 === null || m2 === null)
    {
        throw new ParseError(
            `token range '${first}..${last}' must end in numeric suffixes`,
            span);
    }
    if (m1[1] !== m2[1])
    {
        throw new ParseError(
            `token range '${first}..${last}' must share a common prefix (got '${m1[1]}' vs '${m2[1]}')`,
            span);
    }
    const prefix = m1[1]!;
    const lo = parseInt(m1[2]!, 10);
    const hi = parseInt(m2[2]!, 10);
    if (lo > hi)
    {
        throw new ParseError(
            `token range '${first}..${last}' is descending (${lo} > ${hi})`,
            span);
    }
    const out: string[] = [];
    for (let i = lo; i <= hi; i++) out.push(`${prefix}${i}`);
    return out;
}

const RESOURCE_KEYWORDS = new Set([
    'Style', 'Template', 'DataTemplate',
    'HierarchicalDataTemplate', 'ItemsPanelTemplate', 'TemplateSelector',
]);

// Subset of RESOURCE_KEYWORDS that produce a *template* value (something
// invoked at apply time) — these are accepted both as keyed entries in a
// ResourceDictionary AND as inline values of a slot-assign (e.g.,
// `ItemsPanel: ItemsPanelTemplate { … }`). `Style` is excluded: styles
// only ever live as keyed dictionary entries today.
const INLINE_TEMPLATE_KEYWORDS = new Set([
    'Template', 'DataTemplate',
    'HierarchicalDataTemplate', 'ItemsPanelTemplate',
]);

export interface ParserOptions
{
    // Called by the parser when it sees `Name{` to decide whether the
    // body should be parsed in text mode (string slot — Lexer.NextTextChunk)
    // or structured mode (default — element list with SlotAssigns).
    // Returning `true` switches the lexer into text mode for that body.
    // Default: always `false` (structured).
    isStringBody?: (controlName: string) => boolean;
}

// Recursive-descent parser. Two-token lookahead via a small ring buffer
// — enough to disambiguate SlotAssign (`Ident Colon`) from Element
// (`Ident LBracket|LBrace|<anything else>`).
//
// Scope: structural mode only. Text-mode bodies (TextBlock{Hello world})
// require the parser to switch the lexer into text mode at the right
// `{`; that hook lives in a future phase along with the control-default-
// slot registry. For now, string content must be expressed as an
// attribute (`TextBlock[Text="Hello"]`).
export class Parser
{
    private readonly lexer: Lexer;
    private readonly buffer: Token[] = [];
    private readonly isStringBody: (name: string) => boolean;

    constructor(source: string, options: ParserOptions = {})
    {
        this.lexer = new Lexer(source);
        this.isStringBody = options.isStringBody ?? (() => false);
    }

    // ── Public entry ────────────────────────────────────────────────

    // Comments captured during the parse, in source order. Empty unless
    // the source carried `//` / `/* */` comments. Read by the formatter
    // after ParseDocument(); the compiler never consults it.
    public get comments(): readonly Comment[]
    {
        return this.lexer.comments;
    }

    public ParseDocument(): Document
    {
        const start = this.peek().span.start;
        const forms: TopForm[] = [];
        while (this.peek().kind !== TokenKind.EOF)
        {
            forms.push(this.parseTopForm());
        }
        const end = this.peek().span.end;
        return { kind: 'document', forms, span: this.span(start, end) };
    }

    // ── Top-level dispatch ──────────────────────────────────────────

    private parseTopForm(): TopForm
    {
        const tk = this.peek();
        if (tk.kind === TokenKind.Ident)
        {
            switch (tk.value)
            {
                case 'import':       return this.parseImport();
                case 'def':          return this.parseDefForm();
                case 'resources':    return this.parseResourcesBlock();
                case 'theme':        return this.parseThemeBlock();
                case 'scheme':       return this.parseSchemeBlock();
                case 'module':       return this.parseModuleForm();
                case 'Style':
                case 'Template':
                case 'DataTemplate':
                case 'HierarchicalDataTemplate':
                case 'ItemsPanelTemplate': return this.parseResourceForm();
                default:             return this.parseElement();
            }
        }
        throw new ParseError(`unexpected token '${tk.value}' at top level`, tk.span);
    }

    // `resources Identifier { import Alias from "..."; …entries… }` —
    // the canonical root form. Compiles to `class Identifier extends
    // ResourceDictionary` with a private ctor and a static Clone factory
    // (see ast.ts ResourcesBlock for the shape). Body uses the same
    // structured-body item grammar that `ResourceDictionary { … }` used,
    // plus a header of `import` clauses that scope to this block only.
    private parseResourcesBlock(): ResourcesBlock
    {
        const head  = this.expectIdent('resources');
        const start = head.span.start;
        const name  = this.expect(TokenKind.Ident).value;
        this.expect(TokenKind.LBrace);

        // Header: zero or more `import Alias from "..."` clauses. The
        // moment we see a body-item start token (resource form, element,
        // `@name = …`), the header is closed.
        const imports: ResourcesImport[] = [];
        while (
            this.peek().kind === TokenKind.Ident
            && this.peek().value === 'import'
        )
        {
            imports.push(this.parseResourcesImport());
        }

        // Body is the same structured-body shape as the old
        // ResourceDictionary root — reuse the existing parser.
        const body = this.parseStructuredBody();
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return {
            kind: 'resources-block',
            name,
            imports,
            body,
            span: this.span(start, end),
        };
    }

    // `module Identifier [attrs] { Capability … }` — a named ShellModule.
    // After the identifier, the remainder parses exactly like a ShellModule
    // element (implicit type): an optional `[ … ]` attribute block then an
    // optional `{ … }` body of Capability children. Emits `export const
    // Identifier = (() => { … })()`.
    private parseModuleForm(): ModuleForm
    {
        const head       = this.expectIdent('module');
        const start      = head.span.start;
        const exportName = this.expect(TokenKind.Ident).value;

        const attrs: Attribute[] = [];
        if (this.peek().kind === TokenKind.LBracket)
        {
            this.consume();
            attrs.push(...this.parseAttrListBody());
            this.expect(TokenKind.RBracket);
        }
        let body: StructuredBody | null = null;
        if (this.peek().kind === TokenKind.LBrace)
        {
            this.consume();
            body = this.parseStructuredBody();
            this.expect(TokenKind.RBrace);
        }
        const end = this.lastEnd();
        const span = this.span(start, end);
        // Synthesize the implicit ShellModule element the body describes, so
        // the compiler reuses the ordinary element pipeline (attrs → property
        // sets, children → AddChild).
        const root: ElementNode = {
            kind: 'element',
            name: 'ShellModule',
            xAttrs: [],
            attrs,
            body,
            span,
        };
        return { kind: 'module-form', exportName, root, span };
    }

    private parseResourcesImport(): ResourcesImport
    {
        const start = this.expectIdent('import').span.start;
        const alias = this.expect(TokenKind.Ident).value;
        this.expectIdent('from');
        const source = this.expect(TokenKind.String).value;
        const end = this.lastEnd();
        return {
            kind: 'resources-import',
            alias,
            source,
            span: this.span(start, end),
        };
    }

    // `include "<path>" [as <key>]` — a resource-dictionary body item that
    // splices an external file in at compile time. `as <key>` is only
    // meaningful for a single-file path; a glob keys each match by
    // basename (enforced in the emit pass, which knows how many files the
    // resolver matched).
    private parseIncludeForm(): IncludeForm
    {
        const start = this.expectIdent('include').span.start;
        // Optional leading modifiers, any order: `colored`, `x:single`.
        let colored = false;
        let single  = false;
        for (;;)
        {
            const t = this.peek();
            if (t.kind === TokenKind.Ident && t.value === 'colored') { this.consume(); colored = true; continue; }
            if (t.kind === TokenKind.ScopeExt && t.value === 'single') { this.consume(); single = true; continue; }
            break;
        }
        const path  = this.expect(TokenKind.String).value;
        let key: string | undefined;
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'as')
        {
            this.consume();
            key = this.expect(TokenKind.Ident).value;
        }
        const end = this.lastEnd();
        return { kind: 'include-form', path, key, colored, single, span: this.span(start, end) };
    }

    // `merge <Alias>` — fold a file-level-imported dictionary's entries into
    // the enclosing dictionary body. `Alias` names a `resources NAME` dict a
    // top-level `import Alias from "…"` brought into scope.
    private parseMergeForm(): MergeForm
    {
        const start = this.expectIdent('merge').span.start;
        const alias = this.expect(TokenKind.Ident).value;
        return { kind: 'merge-form', alias, span: this.span(start, this.lastEnd()) };
    }

    // `glyphs "<font>" { <key> | <key> = "<cp>" … }` — a resource-dictionary
    // body item that bakes font-glyph outlines in at compile time, one
    // PathGeometry resource per entry. A bare `key` is looked up by glyph
    // name; `key = "<cp>"` takes the glyph from the string's first
    // codepoint. HOW a font becomes geometry is the resolver's job (emit
    // pass); the parser just captures font + entries.
    private parseGlyphsForm(): GlyphsForm
    {
        const start = this.expectIdent('glyphs').span.start;
        // Font source is either a literal path (`glyphs "x.ttf"`) or a
        // family reference to a preceding `fonts` block (`glyphs @Inter`).
        let font = '';
        let fontFamily: string | undefined;
        if (this.peek().kind === TokenKind.At)
        {
            this.consume();
            fontFamily = this.expect(TokenKind.Ident).value;
        }
        else
        {
            font = this.expect(TokenKind.String).value;
        }
        this.expect(TokenKind.LBrace);

        const entries: GlyphEntry[] = [];
        while (
            this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF
        )
        {
            const keyTok = this.expect(TokenKind.Ident);
            let codepoint: string | undefined;
            if (this.peek().kind === TokenKind.Equals)
            {
                this.consume();
                codepoint = this.expect(TokenKind.String).value;
            }
            entries.push({
                key: keyTok.value,
                codepoint,
                span: this.span(keyTok.span.start, this.lastEnd()),
            });
        }
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return { kind: 'glyphs-form', font, fontFamily, entries, span: this.span(start, end) };
    }

    // `fonts { Family from "<path>" [Weight=Bold, Style=Italic]  … }` — a
    // resource-dictionary body item that registers font faces with the
    // runtime FontManager and publishes a `@<family>` FontFamily resource.
    // Each entry: a family ident, the `from` keyword, a source-path string,
    // and an optional `[Weight=…, Style=…]` attribute block (members of
    // FontWeight / FontStyle). The path is fetched at runtime — the parser
    // captures it verbatim; no compile-time font reading happens here.
    private parseFontsForm(): FontsForm
    {
        const start = this.expectIdent('fonts').span.start;
        this.expect(TokenKind.LBrace);

        const entries: FontEntry[] = [];
        while (
            this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF
        )
        {
            const familyTok = this.expect(TokenKind.Ident);
            this.expectIdent('from');
            const source = this.expect(TokenKind.String).value;

            let weight: string | undefined;
            let style:  string | undefined;
            if (this.peek().kind === TokenKind.LBracket)
            {
                this.consume();
                while (this.peek().kind !== TokenKind.RBracket
                    && this.peek().kind !== TokenKind.EOF)
                {
                    const nameTok = this.expect(TokenKind.Ident);
                    this.expect(TokenKind.Equals);
                    const valTok = this.expect(TokenKind.Ident);
                    if (nameTok.value === 'Weight')      weight = valTok.value;
                    else if (nameTok.value === 'Style')  style  = valTok.value;
                    else throw new ParseError(
                        `fonts: unknown attribute '${nameTok.value}' — expected Weight or Style`,
                        nameTok.span);
                    if (this.peek().kind === TokenKind.Comma) this.consume();
                }
                this.expect(TokenKind.RBracket);
            }

            entries.push({
                family: familyTok.value,
                source,
                weight,
                style,
                span: this.span(familyTok.span.start, this.lastEnd()),
            });
        }
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return { kind: 'fonts-form', entries, span: this.span(start, end) };
    }

    // `theme Identifier { import …; tokens { … }; …body… }`
    //
    // Compiles to a ResourceDictionary subclass (`class Identifier
    // extends ResourceDictionary`) plus a sibling `IdentifierCatalog`
    // export that holds the token catalog. Body shape is the same as
    // `resources` — templates, default Styles, DataTemplates ride here.
    private parseThemeBlock(): ThemeBlock
    {
        const head  = this.expectIdent('theme');
        const start = head.span.start;
        const name  = this.expect(TokenKind.Ident).value;
        this.expect(TokenKind.LBrace);

        // Header order:
        //   1. zero or more `import Alias from "..."` clauses
        //   2. optional `schemes: [Ident, Ident, …]` line
        //   3. optional `defaultScheme: Ident` line
        //   4. optional `dictionaries: [Ident, Ident, …]` line
        //   5. optional `tokens { … }` block
        //   6. body
        //
        // Headers may appear in any order amongst themselves once the
        // imports are done; the loop below probes for each keyword.
        const imports: ResourcesImport[] = [];
        while (
            this.peek().kind === TokenKind.Ident
            && this.peek().value === 'import'
        )
        {
            imports.push(this.parseResourcesImport());
        }

        let tokens: TokenCatalogEntry[] = [];
        const schemes: string[] = [];
        const dictionaries: string[] = [];
        let   defaultScheme: string | undefined;
        let   readHeaders = true;
        while (readHeaders && this.peek().kind === TokenKind.Ident)
        {
            const word = this.peek().value;
            if (word === 'tokens')
            {
                tokens = this.parseTokenCatalog();
            }
            else if (word === 'schemes')
            {
                this.consume();
                this.expect(TokenKind.Colon);
                this.expect(TokenKind.LBracket);
                if (this.peek().kind !== TokenKind.RBracket)
                {
                    for (;;)
                    {
                        schemes.push(this.expect(TokenKind.Ident).value);
                        if (this.peek().kind === TokenKind.Comma)
                        {
                            this.consume();
                            continue;
                        }
                        break;
                    }
                }
                this.expect(TokenKind.RBracket);
            }
            else if (word === 'defaultScheme')
            {
                this.consume();
                this.expect(TokenKind.Colon);
                defaultScheme = this.expect(TokenKind.Ident).value;
            }
            else if (word === 'dictionaries')
            {
                this.consume();
                this.expect(TokenKind.Colon);
                this.expect(TokenKind.LBracket);
                if (this.peek().kind !== TokenKind.RBracket)
                {
                    for (;;)
                    {
                        dictionaries.push(this.expect(TokenKind.Ident).value);
                        if (this.peek().kind === TokenKind.Comma)
                        {
                            this.consume();
                            continue;
                        }
                        break;
                    }
                }
                this.expect(TokenKind.RBracket);
            }
            else
            {
                readHeaders = false;
            }
        }

        const body = this.parseStructuredBody();
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return {
            kind: 'theme-block',
            name,
            imports,
            schemes,
            defaultScheme,
            dictionaries,
            tokens,
            body,
            span: this.span(start, end),
        };
    }

    // `tokens { @Name : Type "desc"  …  @A..@B : Type "desc" }`
    //
    // Each entry binds one or more catalog names to a type plus
    // optional description. The range form (`@A..@B`) requires both
    // ends to share a common alphabetic prefix and end in a numeric
    // suffix that defines the range bounds (`Space1..Space8`).
    private parseTokenCatalog(): TokenCatalogEntry[]
    {
        this.expectIdent('tokens');
        this.expect(TokenKind.LBrace);
        const entries: TokenCatalogEntry[] = [];
        while (this.peek().kind === TokenKind.At)
        {
            entries.push(this.parseTokenCatalogEntry());
        }
        this.expect(TokenKind.RBrace);
        return entries;
    }

    private parseTokenCatalogEntry(): TokenCatalogEntry
    {
        const at = this.expect(TokenKind.At);
        const first = this.expect(TokenKind.Ident).value;
        // Optional range form `@Foo1..@Foo8`. Two consecutive dots
        // form the range operator. The grammar reserves `..` for this
        // — it doesn't appear elsewhere at this position.
        const names: string[] = [first];
        if (this.peek().kind === TokenKind.Dot
            && this.peek(1).kind === TokenKind.Dot)
        {
            this.consume(); // first dot
            this.consume(); // second dot
            this.expect(TokenKind.At);
            const second = this.expect(TokenKind.Ident).value;
            const expanded = expandTokenRange(first, second, at.span);
            names.length = 0;
            names.push(...expanded);
        }
        this.expect(TokenKind.Colon);
        // Type name — bare ident (`Brush`, `CornerRadius`, `number`,
        // `Typography`, `Effect`, `Easing`). Union types live as
        // descriptions for now; the runtime catalog stores the type
        // verbatim and the contract validator does an exact-name match.
        const typeText = this.expect(TokenKind.Ident).value;
        let description: string | undefined;
        if (this.peek().kind === TokenKind.String)
        {
            description = this.consume().value;
        }
        const end = this.lastEnd();
        return {
            kind:        'token-catalog-entry',
            names,
            typeText,
            description,
            span:        this.span(at.span.start, end),
        };
    }

    // `scheme Identifier against ThemeName [basedOn Other.scheme] { … }`
    //
    // Compiles to a `defineScheme({ … })` call exported as the named
    // constant. Body uses the same StructuredBody shape; bind / emit
    // pass enforces that only `@Name = value` assignments appear.
    private parseSchemeBlock(): SchemeBlock
    {
        const head  = this.expectIdent('scheme');
        const start = head.span.start;
        const name  = this.expect(TokenKind.Ident).value;
        this.expectIdent('against');
        const theme = this.expect(TokenKind.Ident).value;

        let basedOn: string | undefined;
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'basedOn')
        {
            this.consume();
            const parentTheme = this.expect(TokenKind.Ident).value;
            this.expect(TokenKind.Dot);
            const parentScheme = this.expect(TokenKind.Ident).value;
            basedOn = `${parentTheme}.${parentScheme}`;
        }

        this.expect(TokenKind.LBrace);
        const imports: ResourcesImport[] = [];
        while (
            this.peek().kind === TokenKind.Ident
            && this.peek().value === 'import'
        )
        {
            imports.push(this.parseResourcesImport());
        }

        const body = this.parseStructuredBody();
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return {
            kind: 'scheme-block',
            name,
            theme,
            basedOn,
            imports,
            body,
            span: this.span(start, end),
        };
    }

    private parseImport(): ImportForm
    {
        const start = this.expectIdent('import').span.start;
        const name  = this.expect(TokenKind.Ident).value;
        let source: string | null = null;
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'from')
        {
            this.consume();
            source = this.expect(TokenKind.String).value;
        }
        const end = this.lastEnd();
        return { kind: 'import', name, source, span: this.span(start, end) };
    }

    private parseDefForm(): DefForm
    {
        const start = this.expectIdent('def').span.start;
        const name  = this.expect(TokenKind.Ident).value;
        this.expect(TokenKind.LBracket);
        const params = this.parseMacroParamList();
        this.expect(TokenKind.RBracket);
        this.expect(TokenKind.LBrace);
        const body = this.parseElement();
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return { kind: 'def', name, params, body, span: this.span(start, end) };
    }

    private parseMacroParamList(): MacroParam[]
    {
        const out: MacroParam[] = [];
        if (this.peek().kind === TokenKind.RBracket) return out;
        for (;;)
        {
            out.push(this.parseMacroParam());
            if (this.peek().kind === TokenKind.Comma) { this.consume(); continue; }
            break;
        }
        return out;
    }

    private parseMacroParam(): MacroParam
    {
        const tk    = this.expect(TokenKind.HashBody);
        const holeName   = tk.value;
        const positional = /^[0-9]+$/.test(holeName);

        let typeRef: string | null = null;
        if (this.peek().kind === TokenKind.Colon)
        {
            this.consume();
            typeRef = this.expect(TokenKind.Ident).value;
        }
        let defaultValue: ValueNode | null = null;
        if (this.peek().kind === TokenKind.Equals)
        {
            this.consume();
            defaultValue = this.parseValue();
        }
        const end = this.lastEnd();
        return {
            kind: 'macro-param',
            holeName,
            positional,
            typeRef,
            defaultValue,
            span: this.span(tk.span.start, end),
        };
    }

    // ── Resource forms ──────────────────────────────────────────────

    private parseResourceForm(): ResourceForm
    {
        const head    = this.expect(TokenKind.Ident);
        const keyword = head.value as 'Style' | 'Template' | 'DataTemplate' | 'HierarchicalDataTemplate' | 'ItemsPanelTemplate' | 'TemplateSelector';
        if (!RESOURCE_KEYWORDS.has(keyword))
        {
            throw new ParseError(`expected resource keyword, got '${keyword}'`, head.span);
        }

        // Scope extensions (`x:key`, future `x:*`) lead — read before
        // the `[ … ]` block, mirroring parseElement.
        const xAttrs = this.parseLeadingXAttrs();

        // The `[ meta=value, … ]` block is OPTIONAL — `Template` /
        // `DataTemplate` / `HierarchicalDataTemplate` need it (TargetType /
        // DataType / itemsselector are required there), but
        // `ItemsPanelTemplate` and inline-only forms have no required
        // meta-attrs, so the bracket pair can be omitted entirely. The
        // compiler validates required meta-attrs per-keyword downstream.
        const metaAttrs: NamedAttr[] = [];
        if (this.peek().kind === TokenKind.LBracket)
        {
            this.consume();
            const attrs = this.parseAttrListBody();
            this.expect(TokenKind.RBracket);
            // Resource form meta-attrs are named only; positionals are a
            // syntactic error at this point.
            for (const a of attrs)
            {
                if (a.kind === 'named-attr') metaAttrs.push(a);
                else throw new ParseError(
                    'resource forms do not accept positional attributes', a.span);
            }
        }

        this.expect(TokenKind.LBrace);
        let body: SetterList | ElementNode | DataTemplateBody | TemplateSelectorBody;
        if (keyword === 'Style')
        {
            body = this.parseSetterList();
        }
        else if (keyword === 'DataTemplate' || keyword === 'HierarchicalDataTemplate' || keyword === 'Template')
        {
            // Trailing trigger groups / event triggers are allowed after
            // the root element — WPF parity for DataTemplate.Triggers
            // AND ControlTemplate.Triggers. For Template (ControlTemplate),
            // the triggers' default source is the templated parent (the
            // control being templated), so `when(IsSelected) {
            // PART_Border.Fill = …; }` inside a `Template
            // [TargetType=ListBoxItem]` watches the ListBoxItem's
            // IsSelected and writes to the named PART_Border via
            // TargetedSetter. Same body shape downstream — the
            // resource-form keyword discriminates the trigger-source
            // resolution in the compiler / runtime.
            //
            // When NO trailing triggers are present, the body collapses
            // to the single-element shape — preserves snapshot stability
            // for existing trigger-free templates.
            const bodyStart = this.peek().span.start;
            const root = this.parseElement();
            const triggers:      TriggerGroup[]      = [];
            const eventTriggers: EventTriggerGroup[] = [];
            while (this.peek().kind === TokenKind.Ident)
            {
                const ident = this.peek();
                if (ident.value === 'when')
                {
                    triggers.push(this.parseTriggerGroup());
                    continue;
                }
                if (ident.value === 'on')
                {
                    eventTriggers.push(this.parseEventTriggerGroup());
                    continue;
                }
                break;
            }
            // Skip optional trailing semicolons between trigger blocks
            // and the closing brace, mirroring setter-list / when()
            // trailing-`;` tolerance.
            while (this.peek().kind === TokenKind.Semicolon) this.consume();
            if (triggers.length === 0 && eventTriggers.length === 0)
            {
                body = root;
            }
            else
            {
                const bodyEnd = this.lastEnd();
                body = {
                    kind:          'data-template-body',
                    root,
                    triggers,
                    eventTriggers,
                    span:          this.span(bodyStart, bodyEnd),
                };
            }
        }
        else if (keyword === 'TemplateSelector')
        {
            body = this.parseTemplateSelectorBody();
        }
        else
        {
            body = this.parseElement();
        }
        const rbrace = this.expect(TokenKind.RBrace);
        return {
            kind:    'resource-form',
            keyword,
            metaAttrs,
            xAttrs,
            body,
            span:    this.span(head.span.start, rbrace.span.end),
        };
    }

    // Body of a `TemplateSelector` resource form — a child list of
    // `DataTemplate [DataType=X] { … }` typed cases and at most one bare
    // `@key` default. Runs after parseResourceForm has consumed the opening
    // `{`, so it reads entries up to (not including) the closing `}`.
    private parseTemplateSelectorBody(): TemplateSelectorBody
    {
        const start = this.peek().span.start;
        const entries: (ResourceForm | StaticResourceValue)[] = [];
        while (this.peek().kind !== TokenKind.RBrace)
        {
            const tk = this.peek();
            if (tk.kind === TokenKind.Ident && tk.value === 'DataTemplate')
            {
                entries.push(this.parseResourceForm());
            }
            else if (tk.kind === TokenKind.At)
            {
                entries.push(this.parseStaticResource());
            }
            else
            {
                throw new ParseError(
                    'TemplateSelector body accepts only `DataTemplate [DataType=…] { … }` cases and a single `@key` default',
                    tk.span);
            }
            while (this.peek().kind === TokenKind.Semicolon) this.consume();
        }
        return { kind: 'template-selector-body', entries, span: this.span(start, this.lastEnd()) };
    }

    // ── Setter list (inside a style body) ──────────────────────────

    private parseSetterList(): SetterList
    {
        const start = this.peek().span.start;
        const items: SetterItem[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            items.push(this.parseSetterItem());
        }
        const end = this.lastEnd();
        return { kind: 'setter-list', items, span: this.span(start, end) };
    }

    private parseSetterItem(): SetterItem
    {
        const tk = this.peek();
        if (tk.kind === TokenKind.Ident && tk.value === 'when')
        {
            return this.parseTriggerGroup();
        }
        if (tk.kind === TokenKind.Ident && tk.value === 'on')
        {
            return this.parseEventTriggerGroup();
        }
        if (tk.kind === TokenKind.Ident && tk.value === 'Behaviors'
            && this.peek(1).kind === TokenKind.LBrace)
        {
            return this.parseBehaviorsBlock();
        }
        return this.parsePropertySetter();
    }

    // `Behaviors { BehaviorClass[Foo=…] BehaviorClass2[…] }` inside a
    // `when()` trigger body. Each child is a Behavior class invocation
    // (parsed via the normal element parser). Compiler lowers each into
    // an AttachBehaviorAction / DetachBehaviorAction pair on the
    // trigger's enter / exit edges. A `Behaviors { … }` block at Style
    // body level (outside any trigger) is rejected by the compiler —
    // the parser still accepts it so the error message points at the
    // emit phase rather than a parser confusion.
    private parseBehaviorsBlock(): import('./ast.js').BehaviorsBlock
    {
        const start = this.expectIdent('Behaviors').span.start;
        this.expect(TokenKind.LBrace);
        const entries: ElementNode[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            entries.push(this.parseElement());
        }
        const closer = this.expect(TokenKind.RBrace);
        // Trailing semicolon is consistent with on{} / when{} blocks.
        if (this.peek().kind === TokenKind.Semicolon) this.consume();
        return {
            kind:    'behaviors-block',
            entries,
            span:    this.span(start, closer.span.end),
        };
    }

    // `on EventName { TriggerAction-list }` — declarative routed-event
    // trigger. Currently EventName accepts any bare identifier; the
    // runtime maps the string to a concrete subscription (Click maps to
    // Button.AddClickHandler; other names get a runtime warning).
    private parseEventTriggerGroup(): EventTriggerGroup
    {
        const start     = this.expectIdent('on').span.start;
        const eventName = this.expect(TokenKind.Ident).value;
        this.expect(TokenKind.LBrace);
        const actions: TriggerActionNode[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            actions.push(this.parseTriggerAction());
        }
        const closer = this.expect(TokenKind.RBrace);
        // Trailing `;` accepted for visual consistency with `when{}`.
        if (this.peek().kind === TokenKind.Semicolon) this.consume();
        return {
            kind: 'event-trigger',
            eventName,
            actions,
            span: this.span(start, closer.span.end),
        };
    }

    private parseTriggerAction(): TriggerActionNode
    {
        const tk = this.peek();
        if (tk.kind === TokenKind.Ident)
        {
            if (tk.value === 'BeginStoryboard')  return this.parseBeginStoryboard();
            if (tk.value === 'StopStoryboard')   return this.parseStopStoryboard();
            if (tk.value === 'PauseStoryboard')  return this.parsePauseStoryboard();
            if (tk.value === 'ResumeStoryboard') return this.parseResumeStoryboard();
            if (tk.value === 'InvokeCommand')    return this.parseInvokeCommand();
        }
        throw new ParseError(
            `expected BeginStoryboard / StopStoryboard / PauseStoryboard / ResumeStoryboard / InvokeCommand inside event-trigger body; got '${tk.value}'`,
            tk.span);
    }

    // `InvokeCommand[Command=$SaveCommand]` — one required attribute,
    // Command, holding a binding to an ICommand on the firing Visual's
    // DataContext. No body. The compiler lowers this to
    // `new InvokeCommandAction((target) => <bound command>)`.
    private parseInvokeCommand(): InvokeCommandNode
    {
        const start = this.expectIdent('InvokeCommand').span.start;
        const lbracket = this.peek();
        if (lbracket.kind !== TokenKind.LBracket)
        {
            throw new ParseError(
                'InvokeCommand requires a [Command=...] attribute',
                lbracket.span);
        }
        this.expect(TokenKind.LBracket);
        const attrs = this.parseAttrListBody();
        const closer = this.expect(TokenKind.RBracket);
        if (attrs.length !== 1)
        {
            throw new ParseError(
                'InvokeCommand requires exactly one attribute: Command',
                lbracket.span);
        }
        const attr = attrs[0]!;
        if (attr.kind !== 'named-attr' || attr.path.parts.length !== 1
            || attr.path.parts[0] !== 'Command')
        {
            throw new ParseError(
                'InvokeCommand only accepts the Command attribute',
                attr.span);
        }
        return {
            kind:    'invoke-command',
            command: attr.value,
            span:    this.span(start, closer.span.end),
        };
    }

    // `BeginStoryboard [Name="fade"] { Animation[…] Animation[…] }` — the
    // `[Name=…]` attribute block is optional. Without it the storyboard
    // is anonymous (no Stop/Pause/Resume target).
    private parseBeginStoryboard(): BeginStoryboardNode
    {
        const start = this.expectIdent('BeginStoryboard').span.start;
        const name  = this.parseOptionalNamedActionAttrs('BeginStoryboard');
        this.expect(TokenKind.LBrace);
        const animations: AnimationDecl[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            animations.push(this.parseAnimationDecl());
        }
        const closer = this.expect(TokenKind.RBrace);
        return {
            kind: 'begin-storyboard',
            name,
            animations,
            span: this.span(start, closer.span.end),
        };
    }

    private parseStopStoryboard(): StopStoryboardNode
    {
        const start = this.expectIdent('StopStoryboard').span.start;
        const name  = this.parseRequiredNamedActionAttrs('StopStoryboard');
        const end   = this.lastEnd();
        return { kind: 'stop-storyboard', name, span: this.span(start, end) };
    }

    private parsePauseStoryboard(): PauseStoryboardNode
    {
        const start = this.expectIdent('PauseStoryboard').span.start;
        const name  = this.parseRequiredNamedActionAttrs('PauseStoryboard');
        const end   = this.lastEnd();
        return { kind: 'pause-storyboard', name, span: this.span(start, end) };
    }

    private parseResumeStoryboard(): ResumeStoryboardNode
    {
        const start = this.expectIdent('ResumeStoryboard').span.start;
        const name  = this.parseRequiredNamedActionAttrs('ResumeStoryboard');
        const end   = this.lastEnd();
        return { kind: 'resume-storyboard', name, span: this.span(start, end) };
    }

    // Common `[Name=...]` block parser shared between BeginStoryboard
    // (optional) and Stop / Pause / ResumeStoryboard (required). The
    // attribute list is restricted to a single `Name` named attr with a
    // string or bare-ident value — anything else throws.
    private parseOptionalNamedActionAttrs(actionKind: string): string | undefined
    {
        if (this.peek().kind !== TokenKind.LBracket) return undefined;
        return this.parseRequiredNamedActionAttrs(actionKind);
    }

    private parseRequiredNamedActionAttrs(actionKind: string): string
    {
        const tk = this.peek();
        if (tk.kind !== TokenKind.LBracket)
        {
            throw new ParseError(
                `${actionKind} requires a [Name=...] attribute`,
                tk.span);
        }
        const lbracket = this.expect(TokenKind.LBracket);
        const attrs    = this.parseAttrListBody();
        this.expect(TokenKind.RBracket);
        if (attrs.length !== 1)
        {
            throw new ParseError(
                `${actionKind} requires exactly one attribute [Name=...]`,
                lbracket.span);
        }
        const attr = attrs[0]!;
        if (attr.kind !== 'named-attr' || attr.path.parts.length !== 1
            || attr.path.parts[0] !== 'Name')
        {
            throw new ParseError(
                `${actionKind} only accepts the Name attribute`,
                attr.span);
        }
        if (attr.value.kind !== 'string' && attr.value.kind !== 'ident')
        {
            throw new ParseError(
                `${actionKind} Name must be a string or bare identifier`,
                attr.value.span);
        }
        return attr.value.kind === 'string' ? attr.value.value : attr.value.name;
    }

    private parseAnimationDecl(): AnimationDecl
    {
        const head = this.expect(TokenKind.Ident);
        // `[attr=value, …]` block — required so animations always carry
        // at least a TargetProperty.
        if (this.peek().kind !== TokenKind.LBracket)
        {
            throw new ParseError(
                `animation '${head.value}' requires an attribute block — at minimum [TargetProperty=...]`,
                head.span);
        }
        this.expect(TokenKind.LBracket);
        const attrs = this.parseAttrListBody();
        const closer = this.expect(TokenKind.RBracket);
        return {
            kind:      'animation-decl',
            className: head.value,
            attrs,
            span:      this.span(head.span.start, closer.span.end),
        };
    }

    // Setter terminator: PropertySetters are required to end with `;`,
    // TriggerGroups end naturally with `}` and tolerate an optional
    // trailing `;` for consistency. The setter list driver consumes
    // any trailing `;` after a trigger so neither shape forces a
    // particular style on the author.
    private parsePropertySetter(): PropertySetter
    {
        const path  = this.parseAttrPath();
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        this.expect(TokenKind.Semicolon);
        const end   = this.lastEnd();
        return {
            kind: 'property-setter',
            path,
            value,
            span: this.span(path.span.start, end),
        };
    }

    private parseTriggerGroup(): TriggerGroup
    {
        const start = this.expectIdent('when').span.start;
        // Condition in `(…)` — reads like an `if` predicate, separates
        // the trigger condition from the setter block visually.
        this.expect(TokenKind.LParen);
        const condition = this.parseTriggerExpr();
        this.expect(TokenKind.RParen);
        this.expect(TokenKind.LBrace);
        const setters = this.parseSetterList();
        const closer  = this.expect(TokenKind.RBrace);
        // Optional trailing `;` after the trigger block.
        if (this.peek().kind === TokenKind.Semicolon) this.consume();
        return {
            kind: 'trigger-group',
            condition,
            setters,
            span: this.span(start, closer.span.end),
        };
    }

    private parseTriggerExpr(): TriggerExpr
    {
        return this.parseTriggerOr();
    }

    private parseTriggerOr(): TriggerExpr
    {
        let left = this.parseTriggerAnd();
        while (this.peek().kind === TokenKind.Ident && this.peek().value === 'or')
        {
            this.consume();
            const right = this.parseTriggerAnd();
            left = { kind: 'trigger-or', left, right, span: this.span(left.span.start, right.span.end) };
        }
        return left;
    }

    private parseTriggerAnd(): TriggerExpr
    {
        let left = this.parseTriggerTerm();
        while (this.peek().kind === TokenKind.Ident && this.peek().value === 'and')
        {
            this.consume();
            const right = this.parseTriggerTerm();
            left = { kind: 'trigger-and', left, right, span: this.span(left.span.start, right.span.end) };
        }
        return left;
    }

    private parseTriggerTerm(): TriggerExpr
    {
        const tk = this.peek();
        if (tk.kind === TokenKind.LParen)
        {
            this.consume();
            const expr = this.parseTriggerExpr();
            this.expect(TokenKind.RParen);
            return expr;
        }
        let negated = false;
        if (tk.kind === TokenKind.Ident && tk.value === 'not')
        {
            this.consume();
            negated = true;
        }
        // `$Path` or `$Path.tail` — DataTrigger form. Resolves against
        // the styled target's DataContext, mirroring binding syntax in
        // attribute values. Same dotted-path tail as $-bindings.
        //
        // `Ident.Ident` (no `$`) — PART-sourced PropertyTrigger. The
        // first segment names a template PART, the second the property
        // on that part to watch (`when(PART_Row.IsMouseOver)`). Lowers
        // to TemplatePropertyTrigger.sourceName so the runtime
        // subscribes to the named visual's property change instead of
        // the templated parent's. Only two segments are accepted —
        // deeper dotted paths against PARTs aren't a thing today.
        let property:   string | undefined;
        let sourceName: string | undefined;
        let path:       string | undefined;
        let startTk:    Token = tk;
        if (this.peek().kind === TokenKind.Dollar)
        {
            const dollar = this.consume();
            startTk = dollar;
            const firstSeg = this.expect(TokenKind.Ident).value;
            const segments: string[] = [firstSeg];
            while (this.peek().kind === TokenKind.Dot)
            {
                this.consume();
                segments.push(this.expect(TokenKind.Ident).value);
            }
            path = segments.join('.');
        }
        else
        {
            const idTk = this.expect(TokenKind.Ident);
            if (this.peek().kind === TokenKind.Dot)
            {
                // PART-source form: idTk is the part name, next ident
                // is the property.
                this.consume();
                sourceName = idTk.value;
                property   = this.expect(TokenKind.Ident).value;
            }
            else
            {
                property = idTk.value;
            }
        }
        let value: ValueNode | null = null;
        let presence: TriggerPresence | undefined;
        // `P is unset` / `P is set` — presence predicate. Matches on the
        // property being nullish / non-nullish rather than by equality.
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'is')
        {
            this.consume();
            const kw = this.expect(TokenKind.Ident);
            if (kw.value === 'unset')    presence = TriggerPresence.Unset;
            else if (kw.value === 'set') presence = TriggerPresence.Set;
            else throw new ParseError(`expected 'set' or 'unset' after 'is', got '${kw.value}'`, kw.span);
        }
        else if (this.peek().kind === TokenKind.Equals)
        {
            this.consume();
            value = this.parseValue();
        }
        const end = this.lastEnd();
        return {
            kind: 'trigger-term',
            negated,
            property,
            sourceName,
            path,
            value,
            presence,
            span: this.span(startTk.span.start, end),
        };
    }

    // ── Element / attributes ────────────────────────────────────────

    private parseElement(): ElementNode
    {
        const head   = this.expect(TokenKind.Ident);
        // Scope extensions (`x:key="…"`, `x:root`, …) live between the
        // element name and the `[ … ]` block. The bracket list is
        // strictly property assignments after this change.
        const xAttrs = this.parseLeadingXAttrs();
        const attrs: Attribute[] = [];
        if (this.peek().kind === TokenKind.LBracket)
        {
            this.consume();
            attrs.push(...this.parseAttrListBody());
            this.expect(TokenKind.RBracket);
        }
        let body: StructuredBody | StringBody | null = null;
        if (this.peek().kind === TokenKind.LBrace)
        {
            this.consume();
            if (this.isStringBody(head.value))
            {
                body = this.parseStringBody();
            }
            else
            {
                body = this.parseStructuredBody();
            }
            this.expect(TokenKind.RBrace);
        }
        const end = this.lastEnd();
        return {
            kind: 'element',
            name: head.value,
            xAttrs,
            attrs,
            body,
            span: this.span(head.span.start, end),
        };
    }

    // Read zero or more leading XAttrs (`x:foo` flag-style, or
    // `x:foo = value`) appearing between a form keyword / element name
    // and the optional `[ … ]` attribute block. Stops at the first
    // non-ScopeExt token. Used by parseElement and parseResourceForm.
    private parseLeadingXAttrs(): XAttr[]
    {
        const out: XAttr[] = [];
        while (this.peek().kind === TokenKind.ScopeExt)
        {
            const tk = this.consume();
            let value: ValueNode | null = null;
            if (this.peek().kind === TokenKind.Equals)
            {
                this.consume();
                value = this.parseValue();
            }
            const end = this.lastEnd();
            out.push({
                kind: 'x-attr',
                name: tk.value,
                value,
                span: this.span(tk.span.start, end),
            });
        }
        return out;
    }

    // Text-mode body. Entered right after `{`; the buffer MUST be
    // empty here (peeking past LBrace would have lexed structural
    // tokens past the text). Loop pulls TextRun chunks from the lexer
    // until NextTextChunk reports an upcoming `}`. We deliberately
    // DO NOT push the RBrace onto the buffer or advance past it —
    // NextTextChunk peeks the close without consuming the source
    // character, so the next structural call (expect(RBrace) in the
    // caller) will see the same `}` and advance over it normally.
    private parseStringBody(): StringBody
    {
        if (this.buffer.length > 0)
        {
            // Defensive: the surrounding parser shouldn't peek between
            // consuming `{` and calling parseStringBody. If it did, we'd
            // be re-lexing past where the structural tokens already are.
            throw new ParseError(
                'internal: lookahead buffer non-empty entering text mode',
                this.buffer[0]!.span);
        }
        const start = this.lexer.Position();
        const chunks: StringBodyChunk[] = [];
        for (;;)
        {
            const tk = this.lexer.NextTextChunk();
            if (tk.kind === TokenKind.RBrace)
            {
                // Don't push, don't consume. The caller's expect(RBrace)
                // will lex this character in structural mode.
                break;
            }
            if (tk.kind === TokenKind.EOF)
            {
                throw new ParseError('unterminated text body', tk.span);
            }
            if (tk.kind === TokenKind.LDoubleBrace)
            {
                // Inline-expression hole inside text — capture the body
                // up to `}}` and resume text-mode scanning afterwards.
                const body = this.lexer.NextInlineExprBody();
                if (body.kind === TokenKind.EOF)
                {
                    throw new ParseError('unterminated `{{ … }}` inline expression in text body', tk.span);
                }
                chunks.push({
                    kind: 'inline-expr',
                    raw:  body.value,
                    span: this.span(tk.span.start, body.span.end),
                });
                continue;
            }
            chunks.push({ kind: 'text-chunk', text: tk.value });
        }
        const end = this.lexer.Position();
        return { kind: 'string-body', chunks, span: this.span(start, end) };
    }

    // Parses attributes between `[` and `]` — the brackets are consumed
    // by the caller so this can be re-used by both Element and resource
    // forms. Enforces "positional and named cannot mix" (spec decision 7).
    private parseAttrListBody(): Attribute[]
    {
        const out: Attribute[] = [];
        if (this.peek().kind === TokenKind.RBracket) return out;
        let mode: MacroArgMode | null = null;
        for (;;)
        {
            const a = this.parseAttr();
            const isPositional = a.kind === 'positional-attr';
            const thisMode: MacroArgMode = isPositional ? MacroArgMode.Positional : MacroArgMode.Named;
            if (mode === null) mode = thisMode;
            else if (mode !== thisMode)
            {
                throw new ParseError(
                    'cannot mix positional and named attributes in the same list',
                    a.span,
                );
            }
            out.push(a);
            if (this.peek().kind === TokenKind.Comma) { this.consume(); continue; }
            break;
        }
        return out;
    }

    private parseAttr(): Attribute
    {
        const tk = this.peek();

        // Scope extensions (`x:foo`) are not allowed inside `[ … ]` —
        // they live before the bracket list, between the element name
        // and the `[`. Reject with a clear migration hint.
        if (tk.kind === TokenKind.ScopeExt)
        {
            throw new ParseError(
                "scope extensions (x:" + tk.value + ") belong before the `[ … ]` block, not inside it",
                tk.span);
        }

        // NamedAttr starts with Ident (path), PositionalAttr starts with
        // any other value-token (sigils, literals, brackets). An Ident
        // followed by anything other than `.` or `=` demotes to a
        // positional IdentValue — covers `Name`-as-enum and the rare
        // case of bare-name positional macro args.
        if (tk.kind === TokenKind.Ident)
        {
            const first = this.expect(TokenKind.Ident);
            // Two-segment path?
            if (this.peek().kind === TokenKind.Dot)
            {
                this.consume();
                const second = this.expect(TokenKind.Ident);
                this.expect(TokenKind.Equals);
                const value = this.parseValue();
                const end   = this.lastEnd();
                const path: AttrPath = {
                    kind:  'attr-path',
                    parts: [first.value, second.value],
                    span:  this.span(first.span.start, second.span.end),
                };
                return {
                    kind: 'named-attr',
                    path,
                    value,
                    span: this.span(first.span.start, end),
                };
            }
            if (this.peek().kind === TokenKind.Equals)
            {
                this.consume();
                const value = this.parseValue();
                const end   = this.lastEnd();
                const path: AttrPath = {
                    kind:  'attr-path',
                    parts: [first.value],
                    span:  first.span,
                };
                return {
                    kind: 'named-attr',
                    path,
                    value,
                    span: this.span(first.span.start, end),
                };
            }
            // Positional ident value.
            const ident: IdentValue = {
                kind: 'ident',
                name: first.value,
                span: first.span,
            };
            return {
                kind:  'positional-attr',
                value: ident,
                span:  first.span,
            };
        }

        // Positional value (number, string, sigil, hash, paren, etc.).
        const v = this.parseValue();
        return { kind: 'positional-attr', value: v, span: v.span };
    }

    // Helper: one or two dotted idents. Used by PropertySetter (which
    // is structurally a NamedAttr without the `[]` wrapper).
    private parseAttrPath(): AttrPath
    {
        const first = this.expect(TokenKind.Ident);
        if (this.peek().kind === TokenKind.Dot)
        {
            this.consume();
            const second = this.expect(TokenKind.Ident);
            return {
                kind:  'attr-path',
                parts: [first.value, second.value],
                span:  this.span(first.span.start, second.span.end),
            };
        }
        return {
            kind:  'attr-path',
            parts: [first.value],
            span:  first.span,
        };
    }

    // ── Structured body (element list + slot assigns + resources) ──

    private parseStructuredBody(): StructuredBody
    {
        const start = this.peek().span.start;
        const items: BodyItem[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            items.push(this.parseBodyItem());
        }
        const end = this.lastEnd();
        return { kind: 'structured-body', items, span: this.span(start, end) };
    }

    private parseBodyItem(): BodyItem
    {
        const tk = this.peek();

        // Quoted string among element children — WPF-style mixed inline
        // content (`TextBlock { "Hi " Bold { "there" } }`). Lowered to
        // `new Run("…")` by the compiler; only inline hosts accept it.
        if (tk.kind === TokenKind.String)
        {
            const t = this.consume();
            return { kind: 'text-chunk-body-item', value: t.value, span: t.span };
        }

        // @key = value primitive resource entry
        if (tk.kind === TokenKind.At) return this.parseKeyValueResource();

        // Macro hole in body position — `#1`, `#bg`. Meaningful only
        // inside a def body; the bind pass errors if it appears outside
        // a macro expansion.
        if (tk.kind === TokenKind.HashBody)
        {
            const v = this.consume();
            return {
                kind: 'macro-hole-body-item',
                name: v.value,
                span: v.span,
            };
        }

        // `.Member: { … }` — a dotted member-block (aggregate property).
        // A single leading Dot; `..`-prefixed forms belong elsewhere.
        if (tk.kind === TokenKind.Dot && this.peek(1).kind !== TokenKind.Dot)
        {
            return this.parseMemberBlock();
        }

        if (tk.kind === TokenKind.Ident)
        {
            switch (tk.value)
            {
                case 'Style':
                case 'Template':
                case 'DataTemplate':
                case 'HierarchicalDataTemplate':
                case 'ItemsPanelTemplate':
                case 'TemplateSelector': return this.parseResourceForm();
                case 'def':          return this.parseDefForm();
                case 'include':      return this.parseIncludeForm();
                case 'merge':        return this.parseMergeForm();
                case 'glyphs':       return this.parseGlyphsForm();
                case 'fonts':        return this.parseFontsForm();
                default:
                    // SlotAssign vs Element disambiguation.
                    if (this.peek(1).kind === TokenKind.Colon)
                    {
                        return this.parseSlotAssign();
                    }
                    return this.parseElement();
            }
        }

        throw new ParseError(
            `unexpected token '${tk.value}' in body`, tk.span);
    }

    // `.Member: { … }` — a dotted aggregate-property block. The generic
    // form's body is an element list (each entry appended to the
    // surrounding element's `Member` collection by the emitter). The
    // `services` member is the one named exception: its body is a list of
    // DI registrations parsed by the service-entry grammar, not elements.
    private parseMemberBlock(): MemberBlock | ServicesBlock | ModulesBlock
    {
        const dot  = this.expect(TokenKind.Dot);
        const name = this.expect(TokenKind.Ident).value;
        this.expect(TokenKind.Colon);
        this.expect(TokenKind.LBrace);
        // `.services:` and `.modules:` are the named members with bespoke
        // entry grammar; everything else is a generic element list.
        if (name === 'services')
        {
            return this.parseServicesBlock(dot.span.start);
        }
        if (name === 'modules')
        {
            return this.parseModulesBlock(dot.span.start);
        }
        const body = this.parseStructuredBody();
        this.expect(TokenKind.RBrace);
        const end = this.lastEnd();
        return {
            kind: 'member-block',
            name,
            body,
            span: this.span(dot.span.start, end),
        };
    }

    // `.services: { entry* }` body — called with the opening brace already
    // consumed; consumes through the closing brace.
    private parseServicesBlock(start: SourceLocation): ServicesBlock
    {
        const entries: ServiceEntry[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            entries.push(this.parseServiceEntry());
        }
        this.expect(TokenKind.RBrace);
        return {
            kind: 'services-block',
            entries,
            span: this.span(start, this.lastEnd()),
        };
    }

    // `.modules: { Ident* }` body — called with the opening brace already
    // consumed. Each entry is the identifier of an imported `module NAME`
    // const; lowered to `app.Modules.Add(Ident)`.
    private parseModulesBlock(start: SourceLocation): ModulesBlock
    {
        const entries: string[] = [];
        while (this.peek().kind !== TokenKind.RBrace
            && this.peek().kind !== TokenKind.EOF)
        {
            entries.push(this.expect(TokenKind.Ident).value);
        }
        this.expect(TokenKind.RBrace);
        return {
            kind: 'modules-block',
            entries,
            span: this.span(start, this.lastEnd()),
        };
    }

    // One DI registration: `[lifetime] Impl [ -> Token ]`.
    private parseServiceEntry(): ServiceEntry
    {
        const startTok = this.peek();

        // Lifetime keyword only when it's followed by another ident (the
        // impl) — so a service class literally named `Scoped` standing
        // alone still reads as the impl.
        let lifetime: ServiceEntry['lifetime'];
        const head = this.peek();
        if (head.kind === TokenKind.Ident
            && (head.value === 'singleton' || head.value === 'scoped' || head.value === 'transient')
            && this.peek(1).kind === TokenKind.Ident)
        {
            lifetime = this.consume().value as ServiceEntry['lifetime'];
        }

        const implTok = this.expect(TokenKind.Ident);
        const impl    = implTok.value;

        // Constructor-dependency lists were removed: every service ctor
        // takes the provider (the IServiceProvider contract) and resolves
        // its own collaborators. Catch the old `Impl(Dep, …)` form with a
        // pointed message rather than a bare "unexpected token".
        if (this.peek().kind === TokenKind.LParen)
        {
            throw new ParseError(
                `service '${impl}': constructor-dependency syntax 'Impl(...)' was `
                + `removed. A service receives the provider and resolves its own `
                + `dependencies (e.g. this.Provider.getRequired(Dep.Key)).`,
                this.peek().span);
        }

        // Optional inline-config block: `{ prop: value … }` — seed DPs with
        // literals and/or inject services via `$service(Token)`.
        let config: ServiceConfigEntry[] | undefined;
        if (this.peek().kind === TokenKind.LBrace)
        {
            this.consume();
            config = [];
            while (this.peek().kind !== TokenKind.RBrace
                && this.peek().kind !== TokenKind.EOF)
            {
                const propTok = this.expect(TokenKind.Ident);
                this.expect(TokenKind.Colon);
                const value = this.parseValue();
                config.push({
                    name:  propTok.value,
                    value,
                    span:  this.span(propTok.span.start, this.lastEnd()),
                });
            }
            this.expect(TokenKind.RBrace);
        }

        // Optional explicit token: `-> Token`.
        let token: string | undefined;
        if (this.peek().kind === TokenKind.Arrow)
        {
            this.consume();
            token = this.expect(TokenKind.Ident).value;
        }

        return {
            lifetime,
            impl,
            config,
            token,
            span: this.span(startTok.span.start, this.lastEnd()),
        };
    }

    private parseSlotAssign(): SlotAssign
    {
        const ident = this.expect(TokenKind.Ident);
        this.expect(TokenKind.Colon);
        let value: ValueNode | StructuredBody | ResourceForm;
        if (this.peek().kind === TokenKind.LBrace)
        {
            this.consume();
            value = this.parseStructuredBody();
            this.expect(TokenKind.RBrace);
        }
        else if (this.peek().kind === TokenKind.Ident
              && INLINE_TEMPLATE_KEYWORDS.has(this.peek().value as string))
        {
            // Inline template at the slot-value position:
            //   `ItemsPanel: ItemsPanelTemplate { WrapPanel[…] }`
            //   `ItemTemplate: DataTemplate [DataType=FooVM] { … }`
            // Parses identically to a keyed resource form; the compiler
            // emits an anonymous template construction at the assignment
            // site (no x:key required).
            value = this.parseResourceForm();
        }
        else
        {
            value = this.parseValue();
        }
        const end = this.lastEnd();
        return {
            kind:  'slot-assign',
            name:  ident.value,
            value,
            span:  this.span(ident.span.start, end),
        };
    }

    private parseKeyValueResource(): KeyValueResource
    {
        const at   = this.expect(TokenKind.At);
        const name = this.expect(TokenKind.Ident).value;
        let key    = name;
        if (this.peek().kind === TokenKind.Colon)
        {
            this.consume();
            const tail = this.expect(TokenKind.Ident).value;
            // The colon is a key-namespace separator, not a rename: the
            // full string after `@` (including the colon) is the
            // dictionary key, matching how `@theme:primary` resolves
            // in value positions.
            key = `${name}:${tail}`;
        }
        this.expect(TokenKind.Equals);
        const value = this.parseValue();
        const end   = this.lastEnd();
        return {
            kind: 'key-value-resource',
            key,
            name,
            value,
            span: this.span(at.span.start, end),
        };
    }

    // ── Values ──────────────────────────────────────────────────────

    private parseValue(): ValueNode
    {
        const first = this.parseModifiableValue();
        // A `+` here composes styles: `@h1 + @hypertext` → a ComposedValue
        // the emitter lowers to `Style.Combine(…)`. `+` binds looser than
        // the `<<` converter chain (handled inside parseModifiableValue),
        // so `@a << conv + @b` parses as `(@a << conv) + @b`. Only style
        // composition uses `+`; there's no general arithmetic in values.
        if (this.peek().kind !== TokenKind.Plus) return first;
        const parts: ValueNode[] = [first];
        while (this.peek().kind === TokenKind.Plus)
        {
            this.consume();
            parts.push(this.parseModifiableValue());
        }
        return { kind: 'composed', parts, span: this.span(first.span.start, this.lastEnd()) };
    }

    // A primary value with an optional trailing `<<` converter chain.
    // Factored out of parseValue so the `+` composition operator can wrap
    // whole modifiable operands without re-implementing the chain rule.
    private parseModifiableValue(): ValueNode
    {
        const base = this.parsePrimaryValue();
        // A `<<` here means a converter chain piped onto a NON-binding
        // base (e.g. `#0d47a1 << Lighten(0.5)`, `@Primary << Darken(0.2)`).
        // Bindings consume their own chain inside parsePrimaryValue (it's
        // threaded into the binding factory to stay reactive), so by the
        // time control returns here a binding base never has a trailing
        // `<<`. Wrap everything else in a ModifiedValue.
        if (this.peek().kind === TokenKind.LessLess)
        {
            const converters = this.parseConverterChain();
            return { kind: 'modified', base, converters, span: this.span(base.span.start, this.lastEnd()) };
        }
        return base;
    }

    private parsePrimaryValue(): ValueNode
    {
        const tk = this.peek();
        switch (tk.kind)
        {
            case TokenKind.Number:        return this.consumeAsNumber();
            case TokenKind.String:        return this.consumeAsString();
            case TokenKind.Ident:         return this.consumeAsIdent();
            case TokenKind.HashBody:      return this.consumeAsHash();
            case TokenKind.LParen:        return this.parseTuple();
            case TokenKind.LAngle:        return this.parseSize();
            case TokenKind.LBracket:      return this.parseList();
            case TokenKind.Dollar:        return this.parseBindingPath();
            case TokenKind.DollarDollar:  return this.parseTemplateBinding();
            case TokenKind.At:            return this.parseStaticResource();
            case TokenKind.AtAt:          return this.parseDynamicResource();
            case TokenKind.LDoubleBrace:  return this.parseInlineExpr();
            case TokenKind.DollarParen:
                throw new ParseError('inline expressions are spelled `{{ … }}` (the $( … )$ form is retired)', tk.span);
            default:
                throw new ParseError(`expected value, got '${tk.value}'`, tk.span);
        }
    }

    private consumeAsNumber(): NumberValue
    {
        const tk = this.consume();
        return { kind: 'number', raw: tk.value, span: tk.span };
    }

    private consumeAsString(): StringValue
    {
        const tk = this.consume();
        return { kind: 'string', value: tk.value, span: tk.span };
    }

    private consumeAsIdent(): IdentValue | ElementNode
    {
        const tk = this.consume();
        // `Type.Member` — dotted static-member reference in value
        // position (e.g. `@ShapeFull = CornerRadius.Full`). Only one
        // tail segment is permitted; arbitrary `A.B.C` chains would
        // collide with attached-property syntax used elsewhere in the
        // grammar and we don't need them today. The emitter validates
        // both halves against the symbol table / STATIC_MEMBERS.
        if (this.peek().kind === TokenKind.Dot)
        {
            this.consume();
            const tail = this.expect(TokenKind.Ident);
            return {
                kind: 'ident',
                name: `${tk.value}.${tail.value}`,
                span: this.span(tk.span.start, tail.span.end),
            };
        }
        // Element-node value: `Ident [ Prop = val, … ]` — emit-time
        // becomes `new Ident(); _e.Prop = val; return _e`. Lets schemes
        // write `@Elevation1 = MaterialElevationEffect [Level = 1]`
        // without falling back to inline JS or imperative TS sidecars.
        //
        // The body form (`Ident { … }`) is intentionally NOT supported
        // in value position — `{ Prop = val; … }` would collide with
        // parseStructuredBody's element-or-slot-assign dispatch. The
        // attribute-list form is enough for the common case (single
        // property on a value-type-like Effect / Transform / Brush) and
        // matches the existing element-node attribute syntax exactly.
        if (this.peek().kind === TokenKind.LBracket)
        {
            this.consume();
            const attrs = this.parseAttrListBody();
            this.expect(TokenKind.RBracket);
            const end = this.lastEnd();
            return {
                kind:   'element',
                name:   tk.value,
                xAttrs: [],
                attrs,
                body:   null,
                span:   this.span(tk.span.start, end),
            };
        }
        return { kind: 'ident', name: tk.value, span: tk.span };
    }

    // `#` body — interpreted by the bind pass into Color, NamedColor,
    // or NamedMacroHole. Short digit-only bodies (1-2 chars) are
    // positional macro holes (`#1`, `#2`). Anything 3+ chars that's
    // valid hex shape is a hex colour (`#abc`, `#000000`, `#ff00ff00`).
    // The bind pass distinguishes "named colour" vs "named macro hole"
    // by surrounding context — inside a `def` body, named bodies are
    // macro-hole references; outside, they're colour names.
    private consumeAsHash(): ColorValue | MacroHoleValue
    {
        const tk = this.consume();
        const v = tk.value;
        if (v.length <= 2 && /^[0-9]+$/.test(v))
        {
            return { kind: 'macro-hole', name: v, span: tk.span };
        }
        return { kind: 'color', raw: v, span: tk.span };
    }

    private parseTuple(): TupleValue
    {
        const lp = this.expect(TokenKind.LParen);
        const values: ValueNode[] = [];
        if (this.peek().kind !== TokenKind.RParen)
        {
            for (;;)
            {
                values.push(this.parseValue());
                if (this.peek().kind === TokenKind.Comma) { this.consume(); continue; }
                break;
            }
        }
        const rp = this.expect(TokenKind.RParen);
        return { kind: 'tuple', values, span: this.span(lp.span.start, rp.span.end) };
    }

    private parseSize(): SizeValue
    {
        const la     = this.expect(TokenKind.LAngle);
        const width  = this.parseValue();
        this.expect(TokenKind.Comma);
        const height = this.parseValue();
        const ra     = this.expect(TokenKind.RAngle);
        return { kind: 'size', width, height, span: this.span(la.span.start, ra.span.end) };
    }

    private parseList(): ListValue
    {
        const lb = this.expect(TokenKind.LBracket);
        const values: ValueNode[] = [];
        if (this.peek().kind !== TokenKind.RBracket)
        {
            for (;;)
            {
                values.push(this.parseValue());
                if (this.peek().kind === TokenKind.Comma) { this.consume(); continue; }
                break;
            }
        }
        const rb = this.expect(TokenKind.RBracket);
        return { kind: 'list', values, span: this.span(lb.span.start, rb.span.end) };
    }

    private parseBindingPath(): BindingValue
    {
        const dollar = this.expect(TokenKind.Dollar);

        // Relative source `$Self.(Owner.Prop)` — binds to the TARGET
        // element's own property (typically an inherited attached
        // property, e.g. `$Self.(TextBlock.Foreground)`). Recognised only
        // by the `.(` attached-path follow — bare `$Self` (and `$Self.x`)
        // keep their existing meaning (a self-reference / DataContext
        // path, e.g. `DropReceiver = $Self`).
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'Self'
            && this.peek(1).kind === TokenKind.Dot
            && this.peek(2).kind === TokenKind.LParen)
        {
            this.consume();                       // 'Self'
            this.consume();                       // '.'
            this.consume();                       // '('
            const owner = this.expect(TokenKind.Ident).value;
            this.expect(TokenKind.Dot);
            const property = this.expect(TokenKind.Ident).value;
            this.expect(TokenKind.RParen);        // ')'
            const converters = this.parseConverterChain();
            return {
                kind: 'binding',
                path: [],
                source: 'self',
                attached: { owner, property },
                converters: converters.length > 0 ? converters : undefined,
                span: this.span(dollar.span.start, this.lastEnd()),
            };
        }

        // Service source `$service(Token).path` — resolves a service from
        // the ambient provider and binds the trailing DP path against it.
        // Reserved head `service` followed by `(Token)`; a service class
        // (or VM) literally named `service` would have to be reached via
        // DataContext, which is fine — `service` isn't a sensible property.
        if (this.peek().kind === TokenKind.Ident && this.peek().value === 'service'
            && this.peek(1).kind === TokenKind.LParen)
        {
            this.consume();                       // 'service'
            this.consume();                       // '('
            const token = this.expect(TokenKind.Ident).value;
            this.expect(TokenKind.RParen);        // ')'
            const path: string[] = [];
            while (this.peek().kind === TokenKind.Dot)
            {
                this.consume();
                path.push(this.expect(TokenKind.Ident).value);
            }
            const converters = this.parseConverterChain();
            return {
                kind: 'binding',
                path,
                source: 'service',
                serviceToken: token,
                converters: converters.length > 0 ? converters : undefined,
                span: this.span(dollar.span.start, this.lastEnd()),
            };
        }

        const path: string[] = [];
        path.push(this.expect(TokenKind.Ident).value);
        while (this.peek().kind === TokenKind.Dot)
        {
            this.consume();
            path.push(this.expect(TokenKind.Ident).value);
        }
        const converters = this.parseConverterChain();
        return {
            kind: 'binding',
            path,
            converters: converters.length > 0 ? converters : undefined,
            span: this.span(dollar.span.start, this.lastEnd()),
        };
    }

    // Optional converter chain: `<< conv1 << conv2 …`. Each link is an
    // imported ValueConverter symbol, either bare (`<< Upper`) or called
    // with arguments (`<< Lighten(0.5)`, `<< Mix(#ff0000, 0.25)`) — the
    // call form names a converter FACTORY. They compose left-to-right.
    private parseConverterChain(): ConverterRef[]
    {
        const converters: ConverterRef[] = [];
        while (this.peek().kind === TokenKind.LessLess)
        {
            this.consume();
            const id = this.expect(TokenKind.Ident);
            const args: ValueNode[] = [];
            if (this.peek().kind === TokenKind.LParen)
            {
                this.consume();
                if (this.peek().kind !== TokenKind.RParen)
                {
                    for (;;)
                    {
                        args.push(this.parseValue());
                        if (this.peek().kind === TokenKind.Comma) { this.consume(); continue; }
                        break;
                    }
                }
                this.expect(TokenKind.RParen);
            }
            converters.push({ name: id.value, args, span: this.span(id.span.start, this.lastEnd()) });
        }
        return converters;
    }

    private parseTemplateBinding(): TemplateBindingValue
    {
        const dd = this.expect(TokenKind.DollarDollar);
        const id = this.expect(TokenKind.Ident);
        return {
            kind: 'template-binding',
            name: id.value,
            span: this.span(dd.span.start, id.span.end),
        };
    }

    private parseStaticResource(): StaticResourceValue
    {
        const at = this.expect(TokenKind.At);
        const id = this.expect(TokenKind.Ident);
        // Allow @ns:name forms? Spec §9.1 uses @theme:primary as a
        // keyed-primitive resource — that lives at definition time
        // (KeyValueResource). At lookup time, the key is a string with
        // the colon in it. So parse the optional `:ident` here too.
        let key = id.value;
        if (this.peek().kind === TokenKind.Colon)
        {
            this.consume();
            const tail = this.expect(TokenKind.Ident).value;
            key = `${id.value}:${tail}`;
        }
        return {
            kind: 'static-resource',
            key,
            span: this.span(at.span.start, this.lastEnd()),
        };
    }

    private parseDynamicResource(): DynamicResourceValue
    {
        const at = this.expect(TokenKind.AtAt);
        const id = this.expect(TokenKind.Ident);
        let key = id.value;
        if (this.peek().kind === TokenKind.Colon)
        {
            this.consume();
            const tail = this.expect(TokenKind.Ident).value;
            key = `${id.value}:${tail}`;
        }
        return {
            kind: 'dynamic-resource',
            key,
            span: this.span(at.span.start, this.lastEnd()),
        };
    }

    // `{{ … }}` inline expression. The lexer handed back `{{` as
    // LDoubleBrace; we delegate the body capture to NextInlineExprBody
    // which scans to the matching `}}` and returns the raw text. The
    // bind / emit pass decides whether to fold the body as a constant
    // or lower it to a MultiBinding.
    //
    // Same lookahead-buffer constraint as parseStringBody: we mustn't
    // have peeked past `{{` before calling into the body lexer, so
    // assert the buffer is empty.
    private parseInlineExpr(): InlineExprValue
    {
        const open = this.expect(TokenKind.LDoubleBrace);
        if (this.buffer.length > 0)
        {
            throw new ParseError(
                'internal: lookahead buffer non-empty entering inline expression',
                this.buffer[0]!.span);
        }
        const body = this.lexer.NextInlineExprBody();
        if (body.kind === TokenKind.EOF)
        {
            throw new ParseError('unterminated `{{ … }}` inline expression', open.span);
        }
        return {
            kind: 'inline-expr',
            raw:  body.value,
            span: this.span(open.span.start, body.span.end),
        };
    }

    // ── Token plumbing ──────────────────────────────────────────────

    private peek(offset = 0): Token
    {
        while (this.buffer.length <= offset)
        {
            this.buffer.push(this.lexer.NextToken());
        }
        return this.buffer[offset]!;
    }

    private consume(): Token
    {
        if (this.buffer.length === 0)
        {
            this.buffer.push(this.lexer.NextToken());
        }
        return this.buffer.shift()!;
    }

    private expect(kind: TokenKind): Token
    {
        const tk = this.peek();
        if (tk.kind !== kind)
        {
            throw new ParseError(
                `expected ${kind}, got ${tk.kind} '${tk.value}'`, tk.span);
        }
        return this.consume();
    }

    private expectIdent(text: string): Token
    {
        const tk = this.peek();
        if (tk.kind !== TokenKind.Ident || tk.value !== text)
        {
            throw new ParseError(
                `expected '${text}', got '${tk.value}'`, tk.span);
        }
        return this.consume();
    }

    private span(start: SourceLocation, end: SourceLocation): SourceSpan
    {
        return { start, end };
    }

    // The end position of the most-recently-consumed token, used to
    // close out span ranges that started before the current peek.
    private lastEnd(): SourceLocation
    {
        // After consume(), buffer.shift() returned a token but we no
        // longer hold a reference. We approximate via the current
        // lexer position — which is the start of the next token's
        // lookahead and therefore strictly >= the end of whatever was
        // last consumed. Good enough for diagnostics.
        return this.lexer.Position();
    }

}
