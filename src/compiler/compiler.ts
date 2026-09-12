import { TriggerPresence } from './ast.js';
import type {
    AnimationDecl,
    Attribute,
    AttrPath,
    BeginStoryboardNode,
    BodyItem,
    ConverterRef,
    ModifiedValue,
    ComposedValue,
    InvokeCommandNode,
    PauseStoryboardNode,
    ResumeStoryboardNode,
    StopStoryboardNode,
    ColorValue,
    DefForm,
    IncludeForm,
    MergeForm,
    GlyphsForm,
    FontsForm,
    Document,
    ElementNode,
    EventTriggerGroup,
    IdentValue,
    InlineExprValue,
    KeyValueResource,
    ModuleForm,
    ModulesBlock,
    PropertySetter,
    ResourceForm,
    ResourcesBlock,
    SchemeBlock,
    ThemeBlock,
    SetterItem,
    SlotAssign,
    MemberBlock,
    ServicesBlock,
    ServiceEntry,
    ServiceConfigEntry,
    StringBody,
    StructuredBody,
    TriggerActionNode,
    TriggerExpr,
    TriggerGroup,
    TupleValue,
    ValueNode,
    XAttr,
} from './ast.js';
import {
    lowerInlineExpr,
    lowerInlineExprWithPaths,
    InlineExprError,
} from './inline-expr.js';

// Format a JS value as a literal expression string for emission. JSON
// covers numbers, strings, booleans, null, arrays, and plain objects;
// the special-cases below handle the few values JSON.stringify
// mis-renders (or refuses to round-trip).
function formatJsLiteral(value: unknown, span: SourceSpan): string
{
    if (value === undefined)               return 'undefined';
    if (typeof value === 'number')
    {
        if (Number.isNaN(value))           return 'NaN';
        if (value === Infinity)            return 'Infinity';
        if (value === -Infinity)           return '-Infinity';
    }
    try { return JSON.stringify(value); }
    catch
    {
        throw new EmitError(
            `inline expression evaluated to a non-serialisable value of type ${typeof value}`,
            span);
    }
}
// Local shape — a flattened disjunct from `flattenOr()`. Reduces a
// TriggerOr / TriggerTerm tree into a list of (property | path, value,
// negated) records. Single-term conjuncts emit as PropertyTrigger or
// DataTrigger depending on which of property / path is set. Multi-term
// conjuncts emit as MultiTrigger (PropertyTrigger-only — mixing
// data-paths in is a follow-up).
interface TriggerTermLite
{
    property:   string | undefined;
    sourceName: string | undefined;
    path:       string | undefined;
    value:      ValueNode | null;
    presence:   TriggerPresence | undefined;
    negated:    boolean;
    span:       SourceSpan;
}

// Macro substitution map. A hole is bound either to a ValueNode (named
// parameter, substituted in value positions like `Fill=#bg`) or
// to a list of BodyItems (positional `#1` content slot, substituted
// where the macro body says `#1` as a body item).
type MacroSubst = Map<
    string,
    | { kind: 'value'; value: ValueNode }
    | { kind: 'body';  items: BodyItem[] }
>;
import {
    DEFAULT_SYMBOLS,
    DEFAULT_SLOT_INFO,
    ENUM_MEMBERS,
    PROPERTY_TO_ENUM,
    STATIC_MEMBERS,
    type SymbolMap,
    type SlotInfo,
} from './symbol-table.js';
import type { SourceSpan } from './tokens.js';
import { MuralBase } from '../runtime/model.js';
import { findDescriptor } from '../runtime/model-internals.js';

// Namespace imports — give the compiler a direct handle on every
// framework class so emitSetDP can resolve a class name to its
// Function value even when the class doesn't register its own DPs
// (MuralBase.find_class only knows classes that registered something).
import * as RuntimeNS  from '../runtime/index.js';
import * as BasicNS    from '../basic/index.js';
import * as EngineNS   from '../visual-engine/index.js';
import * as FrameNS    from '../framework/index.js';
import * as SurfaceNS  from '../framework/surface.js';
import { createRequire } from 'node:module';

const FRAMEWORK_BUNDLES: readonly Record<string, unknown>[] = [
    RuntimeNS as Record<string, unknown>,
    BasicNS    as Record<string, unknown>,
    EngineNS   as Record<string, unknown>,
    FrameNS    as Record<string, unknown>,
    SurfaceNS  as Record<string, unknown>,
];

// The Material theme is COMPILED (from `.mu` into `build/resources/`) by
// this very compiler, so importing it statically here made the compiler
// un-bootstrappable: a clean tree has no `build/`, the static import
// fails, and `build:templates` can't run to create it. Load it lazily and
// tolerate absence — once built, class-name lookups see the real Material*
// classes; during a clean/bootstrap build the load fails and we fall back
// to MuralBase.find_class. No `.mu` references a Material class by name, so the
// fallback path isn't exercised in practice.
let materialBundleCache: Record<string, unknown> | undefined;
function materialBundle(): Record<string, unknown>
{
    if (materialBundleCache === undefined)
    {
        try
        {
            materialBundleCache = createRequire(import.meta.url)(
                '../resources/material/index.js') as Record<string, unknown>;
        }
        catch { materialBundleCache = {}; }
    }
    return materialBundleCache;
}

// Resolve a class name to its Function value. Searches the framework
// bundles first (so subclasses without own DPs — e.g. Ellipse extends
// Shape — are reachable), then the lazily-loaded Material bundle; falls
// back to MuralBase.find_class which knows every class that ever registered a
// DP (the test-defined-inline path).
function resolveClassByName(name: string): Function | undefined
{
    for (const bundle of FRAMEWORK_BUNDLES)
    {
        const v = bundle[name];
        if (typeof v === 'function') return v;
    }
    const m = materialBundle()[name];
    if (typeof m === 'function') return m;
    return MuralBase.find_class(name);
}

// Walks `klass`'s constructor [[Prototype]] chain — the static-field
// inheritance chain — looking for `ancestor`. Returns true when
// `ancestor === klass` or `ancestor` is reachable via `class … extends`.
// Used to decide whether the compiler can name the markup class
// directly (static-field inheritance hands the inherited Key off) or
// must name the registering class (cross-class inheritable DPs cross
// sibling chains, where static-field inheritance doesn't reach).
function isStaticAncestor(klass: Function, ancestor: Function): boolean
{
    let cur: Function | null = klass;
    while (cur !== null && cur !== Function.prototype)
    {
        if (cur === ancestor) return true;
        cur = Object.getPrototypeOf(cur) as Function | null;
    }
    return false;
}

// Collection-block properties whose runtime target is a plain array
// (mutated via `.push`) rather than an ObservableCollection (`.Add`).
// Control.InputBindings / .CommandBindings are lazily-allocated arrays.
const ARRAY_COLLECTION_PROPERTIES: ReadonlySet<string> = new Set([
    'InputBindings',
    'CommandBindings',
]);

// True when `cls` is a MuralBase/DP subclass — its instances carry the
// dependency-property machinery (`set_property_value` on the prototype).
// Plain value-object classes used in markup (KeyBinding, MouseBinding,
// CommandBinding) return false, so the emitter falls back to a direct
// field assignment for their attributes instead of a DP write.
function isDependencyObjectClass(cls: Function): boolean
{
    const proto = (cls as { prototype?: { set_property_value?: unknown } }).prototype;
    return typeof proto?.set_property_value === 'function';
}

// Lifted to top level so callers can `instanceof EmitError` without
// importing the Compiler class.
export class EmitError extends Error
{
    public readonly span: SourceSpan | undefined;
    constructor(message: string, span?: SourceSpan)
    {
        const suffix = span
            ? ` (at ${span.start.line}:${span.start.column})`
            : '';
        super(message + suffix);
        this.span = span;
    }
}

// Resolves an `include "<path>" [as <key>]` directive at compile time.
// The compiler is deliberately agnostic about WHAT a file becomes: it
// hands the resolver the verbatim path (relative to the .mu file) plus any
// explicit `as` key, and the resolver — provided by the build host, which
// owns filesystem access and per-extension policy — returns the resource
// entries to emit and the imports their JS references. A single path may
// resolve to many entries (a glob), each keyed by basename unless `as`
// overrode a one-file include.
export interface IncludeResolution
{
    /** Resource entries to `Set` into the dictionary, in order. A `singleton`
     *  entry is hoisted to a module-scope const (shared across every Clone())
     *  instead of reconstructed per clone — used for immutable binary payloads
     *  (raster images). */
    entries:  ReadonlyArray<{ key: string; valueJs: string; singleton?: boolean }>;
    /** Named imports the entries' `valueJs` reference, grouped by module. */
    imports?: ReadonlyArray<{ module: string; names: readonly string[] }>;
}

export type IncludeResolver = (
    path: string,
    ctx: { key: string | undefined; colored: boolean },
) => IncludeResolution;

// Resolves a `glyphs "<font>" { … }` block. Given the font path and the
// parsed entries (each a resource key plus either an explicit codepoint
// or — absent one — a glyph name to look up), returns the same
// IncludeResolution shape: one `{ key, valueJs }` per entry plus the
// imports their JS references. Font parsing + outline → geometry lives
// in the host-supplied resolver; the compiler only splices the result.
export type GlyphResolver = (
    font: string,
    entries: ReadonlyArray<{ key: string; name?: string; codepoint?: string }>,
) => IncludeResolution;

export interface CompilerOptions
{
    /** Override or augment the default name → module map. */
    symbols?: SymbolMap;
    /** Override or augment the default per-control slot info. */
    slots?:   ReadonlyMap<string, SlotInfo>;
    /** Resolves `include` directives. Absent → `include` is a compile
     *  error (text-only callers / tests don't get filesystem access). */
    include?: IncludeResolver;
    /** Resolves `glyphs` blocks. Absent → `glyphs` is a compile error
     *  (text-only callers can't read font files). */
    glyphs?:  GlyphResolver;
}

export enum ExportName
{
    App    = 'app',
    Create = 'create',
    None   = '',
}

export interface CompilerOutput
{
    /** JS source. For `'fragment'` / `'application'` this is the BODY of
     *  the factory / IIFE (gets wrapped in `function create() { … }` or
     *  `(() => { … })()` by `compile()`). For `'resources'` this is the
     *  COMPLETE module content — one or more `export class` declarations,
     *  no wrapping needed. */
    body:             string;
    /** Module → set of symbol names that should be imported. */
    imports:          Map<string, Set<string>>;
    /** Output shape selector — drives how `compile()` wraps the body. For
     *  `'module'` the body is an IIFE body ending in `return _shellModule;`
     *  wrapped as `export const <moduleName> = (() => { … })()`. */
    kind:             'application' | 'fragment' | 'resources' | 'module';
    /** For `kind === 'module'`: the `export const` name (the identifier after
     *  the `module` keyword). Absent for other kinds. */
    moduleName?:      string;
    /** True when `kind === 'application'`. Retained for callers that
     *  still pattern-match on this flag. */
    isApplication:    boolean;
    /** Suggested export name. For `'resources'` there is no single export,
     *  so this carries the empty string; callers should branch on `kind`. */
    exportName:       ExportName;
    /** For `kind === 'resources'`: one entry per `resources NAME { … }`
     *  block AND per `theme NAME { … }` block (themes ride the same
     *  ResourceDictionary subclass shape). Empty / absent for the
     *  other kinds. */
    resourcesBlocks?: ResourcesBlockMeta[];
    /** Names of any `theme NAME { … }` blocks in the source. Used by
     *  the `.d.ts` emitter to also declare the sibling `NAMECatalog`
     *  const each theme produces. */
    themeNames?:     string[];
    /** Names of any `scheme NAME against THEME { … }` blocks. Used by
     *  the `.d.ts` emitter to declare `export const NAME: Scheme`. */
    schemeNames?:    string[];
}

export interface ResourcesBlockMeta
{
    /** Class name from `resources NAME { … }`. */
    name:      string;
    /** ES-side names imported by the block via `import Alias from "…"`. */
    imports:   string[];
    /** Typed property pairs to emit on the class in the `.d.ts` companion.
     *  `type` is the runtime class name (`Style`, `ControlTemplate`,
     *  `SolidColorBrush`, …) for the x:name'd resource. */
    accessors: Array<{ name: string; type: string }>;
}

// ── Internal value-emission context ─────────────────────────────────

interface ValueCtx
{
    /** The unqualified property name being assigned (used to pick an
     *  enum class on PascalIdent values, etc.). */
    propertyName?: string;
    /** The JS expression that holds the target Visual; non-undefined
     *  means we're in a direct-attribute context (DynamicResource can
     *  bind to this target). Undefined means we're inside a Style
     *  setter and need a per-target SetterFactory wrap. */
    targetExpr?: string;
    /** True when the value is a cell INSIDE a tuple expression (e.g.
     *  Padding = (@Spacing2, @Spacing1, …)). The enclosing Thickness /
     *  CornerRadius constructor expects numbers, not Binding objects,
     *  so `@Token` cells emit a SYNCHRONOUS resource lookup against
     *  the target Visual at template-instantiation time rather than
     *  the usual DynamicResource Binding install. Tokens consumed this
     *  way lose theme-reactivity — but spacing scales (@Spacing*,
     *  @ListRowHeight*, …) don't theme-swap, which is exactly why the
     *  trade-off is acceptable here. Colour brushes inside a tuple are
     *  unusual but if a future template needs that, this flag would
     *  need a per-token escape hatch (or the tuple cell would need to
     *  be hoisted to its own DP write). */
    insideTuple?: boolean;
}

// Visits the AST and produces JS source. Single-pass; bind and emit
// happen together. State carried on the instance: import set, output
// buffer, fresh-var counter. One Compiler instance per source file —
// state is not designed to be reused across compiles.
export class Compiler
{
    private readonly symbols: SymbolMap;
    private readonly slots:   ReadonlyMap<string, SlotInfo>;
    private readonly include: IncludeResolver | undefined;
    private readonly glyphs:  GlyphResolver | undefined;
    private readonly imports: Map<string, Set<string>> = new Map();
    private readonly lines:   string[] = [];
    // Macros collected during Compile() — keyed by macro name. Lookup
    // happens in compileElement before normal class-name dispatch, so
    // macros shadow controls of the same name.
    private macros: Map<string, DefForm> = new Map();
    // Family → source path declared by a `fonts { … }` block, so a later
    // `glyphs @<family> { … }` in the same compilation resolves the font
    // file from the family name instead of repeating the path.
    private fontPaths: Map<string, string> = new Map();
    private varCounter = 0;
    // Variable name of the element that owns the active NameScope —
    // populated when an element carries `x:root` and consumed by every
    // x:name'd descendant to emit a Register() call. NameScopes are
    // emitter-time bookkeeping; the runtime side already supports
    // multi-scope lookups (templates have their own), so this is
    // intentionally limited to the single application-root scope.
    private nameScopeOwnerVar: string | undefined;
    // Inside a DataTemplate body these track x:names declared on
    // descendants of the template root: `templateNameScope` is the
    // set of registered names, and `templateNameOwners` maps each to
    // the element's runtime class. Used by `when()` setter lowering
    // to route `targetName.Property = value` through TargetedSetter
    // instead of treating the first segment as an attached-property
    // owner type. Reset to undefined when not inside a DataTemplate
    // body so Style-side setter compilation is unaffected.
    private templateNameScope:  Set<string>           | undefined;
    private templateNameOwners: Map<string, string>   | undefined;
    // x:name → emitted variable name. Distinct from templateNameOwners
    // (which maps name → element type, used for setter type-checking).
    // Consulted by the `$binding` lowering to detect ElementName-style
    // bindings: when the first path segment matches an entry here, the
    // binding source becomes the named element directly rather than the
    // target's DataContext. The map is populated as elements are emitted
    // in source order — a forward reference (`$foo.Prop` before
    // `Border x:name="foo"`) won't match and falls through to the
    // DataContext path, matching the natural top-down read order of
    // markup.
    private templateNameVars:   Map<string, string>   | undefined;
    // x:key-keyed local resource vars within the CURRENT
    // ResourceDictionary being compiled — populated by
    // registerResourceFormVar, consulted by compileValue's static-resource
    // case. Lets `@key` in a setter (e.g. `Template = @MyTemplate;`)
    // resolve to the local `_tmplN` JS var when the referenced key was
    // declared earlier in the same `ResourceDictionary { … }` block,
    // sidestepping the `Application.current.Resources.Resolve("…")`
    // round-trip that wouldn't work for resources defined in the
    // SAME dict being constructed (the merged dict isn't visible to
    // Application.current.Resources until create() returns).
    private localResourceVars:  Map<string, string>   | undefined;
    // While emitting a `resources` block, singleton entries push their
    // `const _singleN = …;` declaration here; compileResourcesBlock splices them
    // into `this.lines` at module scope (before the class) after the block is
    // emitted. null when not inside a singleton-collecting block — a singleton
    // entry then falls back to the inline copy-per-Clone path.
    private singletonConsts:    string[]              | null = null;
    // Current indent prefix (multiples of 4 spaces) — incremented when
    // we open a nested scope (template factory body, future macro
    // expansions, etc.), decremented at close. Cosmetic for the emitted
    // JS; the JS engine ignores leading whitespace.
    private indent = 0;
    // Tracks whether we're currently inside a template factory body
    // (ControlTemplate or DataTemplate). The `$$Property` sigil
    // (TemplateBinding) is only valid when this is true; the emitted
    // factory closes over `_templatedParent` which the binding
    // references.
    private inTemplateBody = false;

    constructor(opts: CompilerOptions = {})
    {
        // Per-compilation copy — `import Name from "path"` directives at
        // the top of a .mu source extend THIS map only, so user-defined
        // types declared in one file don't leak into the next file
        // compiled by another Compiler instance.
        this.symbols = new Map(opts.symbols ?? DEFAULT_SYMBOLS);
        this.slots   = opts.slots ?? DEFAULT_SLOT_INFO;
        this.include = opts.include;
        this.glyphs  = opts.glyphs;
    }

    public Compile(doc: Document): CompilerOutput
    {
        // Pass 0: ingest top-level `import Name from "path"` directives
        // into the per-compilation symbol table. After this pass, any
        // `ensureImport(Name)` call resolves Name through the same
        // path the .mu source declared, so user-defined VM / DTO
        // classes are first-class type references — `[DataType=NodeVM]`
        // and `[TargetType=MyCustomBorder]` produce real Function
        // identifiers, not strings, end-to-end.
        for (const form of doc.forms)
        {
            if (form.kind !== 'import') continue;
            if (form.source === null)
            {
                throw new EmitError(
                    `import '${form.name}' requires \`from "path"\` — bare imports are reserved and not supported`,
                    form.span);
            }
            const existing = this.symbols.get(form.name);
            if (existing !== undefined && existing !== form.source)
            {
                throw new EmitError(
                    `import '${form.name}' conflicts with an existing symbol bound to '${existing}'`,
                    form.span);
            }
            this.symbols.set(form.name, form.source);
        }

        // Pass 1: collect every top-level `def` form into the macro
        // table. Macros can call each other so this is a flat pre-walk
        // before any emit happens.
        for (const form of doc.forms)
        {
            if (form.kind === 'def')
            {
                if (this.macros.has(form.name))
                {
                    throw new EmitError(
                        `duplicate macro '${form.name}'`, form.span);
                }
                this.macros.set(form.name, form);
            }
        }

        // Module file: a single `module NAME { … }` form → the const export
        // `export const NAME = (() => { … })()`. Handled before the resources
        // / element passes so a module file is its own shape (imports / defs
        // may sit alongside; no other root form may).
        const moduleForms = doc.forms.filter((f): f is ModuleForm => f.kind === 'module-form');
        if (moduleForms.length > 0)
        {
            if (moduleForms.length > 1)
            {
                throw new EmitError(
                    'a file may declare at most one `module NAME { … }`',
                    moduleForms[1]!.span);
            }
            for (const form of doc.forms)
            {
                if (form.kind === 'element' || form.kind === 'resources-block'
                    || form.kind === 'theme-block' || form.kind === 'scheme-block'
                    || form.kind === 'resource-form')
                {
                    throw new EmitError(
                        'a `module NAME { … }` file cannot also contain other ' +
                        'top-level forms (an element root, or resources / theme / ' +
                        'scheme blocks).',
                        form.span);
                }
            }
            const mf = moduleForms[0]!;
            const rootVar = this.compileElement(mf.root);
            this.line(`return ${rootVar};`);
            return {
                body:          this.lines.join('\n'),
                imports:       this.imports,
                kind:          'module',
                isApplication: false,
                exportName:    ExportName.None,
                moduleName:    mf.exportName,
            };
        }

        // Pass 2: scan for `resources NAME { … }`, `theme NAME { … }`,
        // and `scheme NAME against THEME { … }` blocks. A file that
        // contains ANY of these compiles to ONLY class / const
        // declarations — mixing with an Application / element / bare
        // ResourceDictionary root is rejected so the output shape is
        // unambiguous. Themes and Schemes ride the resources-block
        // pipeline because they share the same class-emission shape
        // (Theme = ResourceDictionary subclass + catalog const;
        // Scheme = defineScheme(...) const).
        const resourcesBlocks: ResourcesBlock[]            = [];
        const themeBlocks:     ThemeBlock[]                = [];
        const schemeBlocks:    SchemeBlock[]               = [];
        for (const form of doc.forms)
        {
            if (form.kind === 'resources-block') resourcesBlocks.push(form);
            else if (form.kind === 'theme-block')  themeBlocks.push(form);
            else if (form.kind === 'scheme-block') schemeBlocks.push(form);
        }
        const totalBlocks = resourcesBlocks.length + themeBlocks.length + schemeBlocks.length;

        if (totalBlocks > 0)
        {
            // No other root form is allowed alongside resources blocks.
            for (const form of doc.forms)
            {
                if (form.kind === 'element')
                {
                    throw new EmitError(
                        `compile: top-level element '${form.name}' is not allowed ` +
                        `alongside \`resources\` blocks — a file is either a ` +
                        `resources file (one or more \`resources NAME { … }\` blocks) ` +
                        `or a visual file (a single Application / Visual root).`,
                        form.span);
                }
                if (form.kind === 'resource-form')
                {
                    throw new EmitError(
                        `compile: top-level '${form.keyword}' is not allowed — ` +
                        `wrap it inside a \`resources NAME { … }\` block.`,
                        form.span);
                }
                // import / def / resources-block consumed.
            }
            // Reject duplicate class names early — two `resources NAME`
            // blocks with the same identifier would emit two
            // `export class NAME` declarations and two `const _gate_NAME`
            // bindings, both JS-level redeclaration errors. Catch it
            // at compile time so the diagnostic points at the source
            // line rather than at the loaded module.
            const seenNames = new Map<string, ResourcesBlock>();
            for (const block of resourcesBlocks)
            {
                const prior = seenNames.get(block.name);
                if (prior !== undefined)
                {
                    throw new EmitError(
                        `duplicate \`resources ${block.name}\` block — class names ` +
                        `must be unique within a file (first declared at ` +
                        `${prior.span.start.line}:${prior.span.start.column}).`,
                        block.span);
                }
                seenNames.set(block.name, block);
            }
            const metas: ResourcesBlockMeta[] = [];
            for (const block of resourcesBlocks)
            {
                metas.push(this.compileResourcesBlock(block));
            }
            for (const block of themeBlocks)
            {
                // Theme bundle = ResourcesBlock body + a sibling
                // `NAMECatalog` constant. compileThemeBlock emits both
                // and returns the resources-block meta so callers
                // see the same shape.
                metas.push(this.compileThemeBlock(block));
            }
            for (const block of schemeBlocks)
            {
                this.compileSchemeBlock(block);
            }
            return {
                body:             this.lines.join('\n'),
                imports:          this.imports,
                kind:             'resources',
                isApplication:    false,
                exportName:       ExportName.None,
                resourcesBlocks:  metas,
                themeNames:       themeBlocks.map(b => b.name),
                schemeNames:      schemeBlocks.map(b => b.name),
            };
        }

        // No resources blocks → fall back to the legacy single-root
        // element shape. Bare top-level resource forms are still rejected
        // (wrap them in a `resources NAME { … }` block).
        let root: ElementNode | undefined;
        for (const form of doc.forms)
        {
            if (form.kind === 'element')
            {
                if (root !== undefined)
                {
                    throw new EmitError(
                        'compile: more than one top-level element form', form.span);
                }
                root = form;
            }
            else if (form.kind === 'resource-form')
            {
                throw new EmitError(
                    `compile: top-level '${form.keyword}' is not allowed — ` +
                    `wrap it inside a \`resources NAME { … }\` block.`,
                    form.span);
            }
            // import / def consumed.
        }

        if (root === undefined)
        {
            throw new EmitError(
                'compile: source has no top-level element to emit', doc.span);
        }

        // Two remaining root shapes: Application (with a resources slot)
        // or a plain Visual fragment. The historic
        // `ResourceDictionary { … }` root form has been replaced by the
        // typed `resources NAME { … }` block — point authors at the new
        // syntax with a clear error rather than silently treating it as
        // a Visual.
        if (root.name === 'ResourceDictionary')
        {
            throw new EmitError(
                'ResourceDictionary { … } as a root form is no longer supported. ' +
                'Use a typed `resources NAME { … }` block instead. The compiled ' +
                'output is `export class NAME extends ResourceDictionary` with a ' +
                'static `Clone()` factory.',
                root.span);
        }
        const isApp = (root.name === 'Application');
        const rootVar = isApp
            ? this.compileApplication(root)
            : this.compileElement(root);
        this.line(`return ${rootVar};`);

        return {
            body:          this.lines.join('\n'),
            imports:       this.imports,
            kind:          isApp ? 'application' : 'fragment',
            isApplication: isApp,
            exportName:    isApp ? ExportName.App : ExportName.Create,
        };
    }

    // ── `resources NAME { import …; …entries… }` ────────────────────
    //
    // Emits a class declaration for one `resources` block. Class shape:
    //
    //   const _gate_NAME = Symbol('NAME.ctor');
    //   export class NAME extends ResourceDictionary {
    //       constructor(_g) {
    //           super();
    //           if (_g !== _gate_NAME) throw new Error('NAME is private — use NAME.Clone()');
    //       }
    //       static Clone() {
    //           const t = new NAME(_gate_NAME);
    //           // merge imports (last import wins same-key collisions)
    //           for (const [k, v] of Alias.Clone().Entries()) t.Set(k, v);
    //           // …populate locals — locals override imports…
    //           return t;
    //       }
    //       get FooName() { return this.Resolve('FooName'); }
    //       set FooName(v) { this.Set('FooName', v); }
    //       // …one accessor pair per x:name'd resource…
    //   }
    //
    // The accessor metadata is collected by `gatherNamedResources()` and
    // returned to the build tool via `ResourcesBlockMeta` so the `.d.ts`
    // companion can declare typed property shapes.
    private compileResourcesBlock(block: ResourcesBlock): ResourcesBlockMeta
    {
        this.ensureImport('ResourceDictionary');

        // Register each import — adds an ES `import` line at the top of
        // the emitted module and makes the alias available as a value
        // reference inside the class body.
        for (const imp of block.imports)
        {
            this.ensureExplicitImport(imp.alias, imp.source);
        }

        // Walk the body BEFORE emitting so the accessor list is ready to
        // emit AFTER the static Clone block. Same xAttr lookup the body
        // emitter uses — we want a single source of truth for "what
        // counts as an x:name'd resource".
        const accessors = this.gatherNamedResources(block.body);

        const name = block.name;
        const gateVar = `_gate_${name}`;

        // Singleton entries push their `const _singleN = …;` here; we splice them
        // into `this.lines` at module scope (this index, before the class) after
        // the block emits.
        const singleAt = this.lines.length;
        const savedSingletonConsts = this.singletonConsts;
        this.singletonConsts = [];

        this.line('');
        this.line(`const ${gateVar} = Symbol(${JSON.stringify(`${name}.ctor`)});`);
        this.line(`export class ${name} extends ResourceDictionary {`);
        this.indent += 4;

        // Private ctor — every instance MUST come through Clone().
        this.line(`constructor(_g) {`);
        this.indent += 4;
        this.line(`super();`);
        this.line(`if (_g !== ${gateVar}) {`);
        this.indent += 4;
        this.line(`throw new Error(${JSON.stringify(`${name} is private — use ${name}.Clone()`)});`);
        this.indent -= 4;
        this.line(`}`);
        this.indent -= 4;
        this.line(`}`);

        // Static Clone — produces a fresh, mutable instance every call.
        this.line(`static Clone() {`);
        this.indent += 4;
        this.line(`const t = new ${name}(${gateVar});`);
        for (const imp of block.imports)
        {
            this.line(`for (const [k, v] of ${imp.alias}.Clone().Entries()) t.Set(k, v);`);
        }
        // Populate locals — locals override imports for same-key entries
        // because they're written AFTER the merge loop above. The
        // localResourceVars map gives `compileValue` a shortcut: `@key`
        // references inside this block resolve to the local JS var, not
        // a DynamicResource (the dict isn't observable from the
        // application's resource chain until Clone() returns).
        const savedLocalRes = this.localResourceVars;
        this.localResourceVars = new Map<string, string>();
        this.compileResourcesBody('t', block.body);
        this.localResourceVars = savedLocalRes;
        this.line(`return t;`);
        this.indent -= 4;
        this.line(`}`);

        // Typed accessors — one get/set pair per x:name'd resource.
        // Runtime is untyped (the type info lives in the `.d.ts`).
        for (const acc of accessors)
        {
            const keyJson = JSON.stringify(acc.name);
            this.line(`get ${acc.name}() { return this.Resolve(${keyJson}); }`);
            this.line(`set ${acc.name}(v) { this.Set(${keyJson}, v); }`);
        }

        this.indent -= 4;
        this.line(`}`);

        // Hoist collected singleton consts to module scope, before the class.
        const consts = this.singletonConsts;
        this.singletonConsts = savedSingletonConsts;
        if (consts !== null && consts.length > 0)
        {
            this.lines.splice(singleAt, 0, ...consts);
        }

        return {
            name,
            imports:   block.imports.map(i => i.alias),
            accessors,
        };
    }

    // Walk the resources-block body and return one accessor descriptor
    // for each entry that carries `x:key="…"`. The TS-side type
    // declared on the accessor is the entry's runtime class:
    //
    //   * ResourceForm  → 'Style', 'ControlTemplate', 'DataTemplate', etc.
    //   * Element       → the element's own type (Color, SolidColorBrush, …)
    //   * KeyValueResource (`@key = value`) → keyed by string, type is
    //                                         not statically known →
    //                                         emitted as `unknown`.
    //
    // `x:key` produces BOTH the dictionary key AND the typed class
    // accessor — one extension does both jobs. `x:name` retains its
    // existing NameScope FindName meaning on Visuals nested inside
    // templates; it is not consulted at the resource-root level.
    private gatherNamedResources(body: StructuredBody): Array<{ name: string; type: string }>
    {
        const out: Array<{ name: string; type: string }> = [];
        const seen = new Set<string>();
        const push = (name: string, type: string): void =>
        {
            if (!isValidIdent(name)) return;  // skip non-identifier keys silently
            if (seen.has(name)) return;       // first-write-wins on duplicates
            seen.add(name);
            out.push({ name, type });
        };
        for (const item of body.items)
        {
            if (item.kind === 'resource-form')
            {
                const keyAttr = this.findXAttr(item.xAttrs, 'key');
                if (keyAttr === null || keyAttr.value === null || keyAttr.value.kind !== 'string') continue;
                push(keyAttr.value.value, resourceFormType(item.keyword, item));
            }
            else if (item.kind === 'element')
            {
                const keyAttr = this.findXAttr(item.xAttrs, 'key');
                if (keyAttr === null || keyAttr.value === null || keyAttr.value.kind !== 'string') continue;
                push(keyAttr.value.value, item.name);
            }
            else if (item.kind === 'key-value-resource')
            {
                push(item.key, 'unknown');
            }
        }
        return out;
    }

    // ── `theme NAME { schemes: […] defaultScheme: … dictionaries: […] tokens { … } body }` ──
    //
    // Emits a class extending Theme:
    //
    //   export class NAME extends Theme {
    //       public static readonly Catalog: TokenCatalog = new Map([...]);
    //       public static readonly DefaultScheme: typeof Scheme = <ident>;
    //       public static readonly instance: NAME = new NAME();
    //       constructor() { super({...}); }
    //       static override Activate(scheme?: typeof Scheme) {
    //           const target = scheme ?? NAME.DefaultScheme;
    //           ThemeManager.ActivateTheme(NAME.instance.name,
    //                                              { scheme: target.name });
    //       }
    //   }
    //   // module-load side effects:
    //   ThemeManager.RegisterTheme(NAME.instance);
    //   Application.RegisterDefaultTheme(NAME);
    //
    // ApplicationInitOptions accepts Function references, so callers
    // pass `NAME` (the class) rather than a `'name'` string. Auto-
    // registration means a single `import` of the bundle wires up
    // ThemeManager + Application.DefaultTheme without any further
    // bootstrap code.
    //
    // Dictionary ownership.
    //   The `dictionaries:` header lists ResourceDictionary classes
    //   the theme adopts — typically `MuralBasic`, `MuralFramework`, or
    //   any other shared bundle. The body's own resources (Style /
    //   Template / DataTemplate items) compile to `${name}Resources`
    //   and are appended LAST so the theme's authored entries shadow
    //   shared-bundle entries for the same key. The runtime
    //   `Theme.dictionaries` slot receives the resulting array; when
    //   ThemeManager activates the theme, every entry is merged into
    //   Application.Resources in order.
    private compileThemeBlock(block: ThemeBlock): ResourcesBlockMeta
    {
        if (block.tokens.length === 0)
        {
            throw new EmitError(
                `\`theme ${block.name}\`: tokens { … } block is required.`,
                block.span);
        }
        if (block.schemes.length === 0)
        {
            throw new EmitError(
                `\`theme ${block.name}\`: schemes: [...] header is required.`,
                block.span);
        }
        if (block.defaultScheme === undefined)
        {
            throw new EmitError(
                `\`theme ${block.name}\`: defaultScheme: Ident header is required.`,
                block.span);
        }
        if (!block.schemes.includes(block.defaultScheme))
        {
            throw new EmitError(
                `\`theme ${block.name}\`: defaultScheme '${block.defaultScheme}' must be one of `
                + `the schemes list (${block.schemes.join(', ')}).`,
                block.span);
        }

        this.ensureImport('Theme');
        this.ensureImport('ThemeManager');
        this.ensureImport('Application');

        // Register the theme block's imports as ES imports ourselves —
        // they're Scheme class references (named in `schemes: [...]`),
        // NOT ResourceDictionary subclasses to merge into the templates
        // dict. Passing them through compileResourcesBlock would emit
        // `${alias}.Clone().Entries()` in the templates Clone() method,
        // which fails at runtime for Scheme classes (they don't expose
        // Clone). So we pass an EMPTY imports list to the templates
        // pipeline below and seed the aliases here.
        for (const imp of block.imports)
        {
            this.ensureExplicitImport(imp.alias, imp.source);
        }

        // Reuse the ResourcesBlock pipeline for the body — same shape
        // as a regular resource bundle, but the EXPORTED CLASS is
        // renamed to `${name}Resources` so the Theme class takes the
        // base name.
        const resourcesName = `${block.name}Resources`;
        const meta = this.compileResourcesBlock({
            kind:    'resources-block',
            name:    resourcesName,
            imports: [],
            body:    block.body,
            span:    block.span,
        });

        // Catalog: sibling const for tooling and the Theme ctor's
        // catalog slot. Same shape as the v1 emit.
        const catalogName = `${block.name}Catalog`;
        this.line('');
        this.line(`// Token catalog for theme '${block.name}' (${block.tokens.length} entry`
            + `${block.tokens.length === 1 ? '' : 'ies'}).`);
        this.line(`export const ${catalogName} = new Map([`);
        for (const entry of block.tokens)
        {
            for (const name of entry.names)
            {
                const desc = entry.description !== undefined
                    ? `, description: ${JSON.stringify(entry.description)}`
                    : '';
                this.line(`    [${JSON.stringify(name)}, { type: ${JSON.stringify(entry.typeText)}${desc} }],`);
            }
        }
        this.line(`]);`);

        // Theme class.
        this.line('');
        this.line(`// Theme class for '${block.name}' — auto-registered with`);
        this.line(`// ThemeManager and Application.DefaultTheme at module load.`);
        this.line(`export class ${block.name} extends Theme {`);
        this.line(`    static Catalog = ${catalogName};`);
        this.line(`    static DefaultScheme = ${block.defaultScheme};`);
        this.line(`    static instance = new ${block.name}();`);
        this.line(`    constructor() {`);
        this.line(`        super({`);
        this.line(`            name:           ${JSON.stringify(block.name)},`);
        // User-declared dictionaries first (MuralBasic, MuralFramework,
        // …), the theme's own body dict LAST so its entries shadow
        // shared-bundle entries for the same key.
        const dictionaryEntries: string[] = [
            ...block.dictionaries.map(d => `${d}.Clone()`),
            `${resourcesName}.Clone()`,
        ];
        this.line(`            dictionaries:   [${dictionaryEntries.join(', ')}],`);
        this.line(`            catalog:        ${catalogName},`);
        this.line(`            schemes:        [${block.schemes.map(s => `${s}.instance`).join(', ')}],`);
        this.line(`            defaultScheme:  ${JSON.stringify(block.defaultScheme)},`);
        this.line(`        });`);
        this.line(`    }`);
        this.line(`    static Activate(scheme) {`);
        this.line(`        const target = scheme ?? ${block.name}.DefaultScheme;`);
        this.line(`        ThemeManager.ActivateTheme(${block.name}.instance.name, { scheme: target.name });`);
        this.line(`    }`);
        this.line(`}`);

        // Module-load side effects: register with ThemeManager + flag
        // as Application's default theme. Idempotent guards so re-
        // imports during tests don't throw.
        this.line('');
        this.line(`if (ThemeManager.GetTheme(${JSON.stringify(block.name)}) === undefined) {`);
        this.line(`    ThemeManager.RegisterTheme(${block.name}.instance);`);
        this.line(`}`);
        this.line(`Application.RegisterDefaultTheme(${block.name});`);

        return meta;
    }

    // ── `scheme NAME against THEME [basedOn OTHER] { @x = v … }` ─────
    //
    // Emits a class shape:
    //
    //   export class NAME extends Scheme {
    //       public static readonly instance: NAME = new NAME();
    //       private constructor() { super({ name, theme, basedOn?, tokens }); }
    //   }
    //
    // The class IS the public API — ApplicationInitOptions takes
    // Function references, so callers pass `NAME` (the class) rather
    // than a `'name'` string. The singleton `instance` field exposes
    // the underlying Scheme value for places that need the bare object
    // (ThemeManager scheme list, etc.). No `defineScheme(...)` call is
    // emitted; constructing the class produces the same value the old
    // factory did, with the added benefit of a Function-typed identity.
    private compileSchemeBlock(block: SchemeBlock): void
    {
        this.ensureImport('Scheme');

        // Register any block-scoped `import Alias from "..."` clauses
        // so brushes / effects defined elsewhere are available as
        // values when their tokens are referenced inside this scheme.
        for (const imp of block.imports)
        {
            this.ensureExplicitImport(imp.alias, imp.source);
        }

        // Walk the body and collect every `@Name = value` assignment.
        // Element / style / trigger / def items inside a scheme are a
        // hard error — schemes are pure value dictionaries.
        const tokens: Array<{ name: string; expr: string }> = [];
        for (const item of block.body.items)
        {
            if (item.kind === 'key-value-resource')
            {
                const expr = this.compileValue(item.value, {});
                tokens.push({ name: item.key, expr });
            }
            else
            {
                throw new EmitError(
                    `\`scheme ${block.name}\` body must contain only \`@Name = value\` `
                    + `assignments — got ${item.kind}.`,
                    item.span);
            }
        }

        this.line('');
        this.line(`// Scheme '${block.name}' against theme '${block.theme}'`
            + (block.basedOn !== undefined ? ` based on '${block.basedOn}'` : '')
            + '.');
        this.line(`export class ${block.name} extends Scheme {`);
        this.line(`    static instance = new ${block.name}();`);
        this.line(`    constructor() {`);
        this.line(`        super({`);
        this.line(`            name:    ${JSON.stringify(block.name)},`);
        this.line(`            theme:   ${JSON.stringify(block.theme)},`);
        if (block.basedOn !== undefined)
        {
            this.line(`            basedOn: ${JSON.stringify(block.basedOn)},`);
        }
        this.line(`            tokens:  new Map([`);
        for (const t of tokens)
        {
            this.line(`                [${JSON.stringify(t.name)}, ${t.expr}],`);
        }
        this.line(`            ]),`);
        this.line(`        });`);
        this.line(`    }`);
        this.line(`}`);
    }

    // ── Application root ────────────────────────────────────────────

    private compileApplication(elem: ElementNode): string
    {
        // Application accepts two attributes that drive the lifecycle:
        //   * `Theme=Material`       — the Theme class to activate.
        //   * `Scheme=MaterialLight` — the Scheme class to pair with it.
        // The compiler emits `_app.initialize({ theme, scheme })` right
        // after `new Application()` so the theme is active BEFORE the
        // body builds its visual tree. Without these attributes, the
        // body still constructs but consumers must call initialize
        // themselves on the returned `app` — useful for tests that
        // want to control the lifecycle.
        let themeIdent:  string | undefined;
        let schemeIdent: string | undefined;
        for (const attr of elem.attrs)
        {
            if (attr.kind !== 'named-attr')
            {
                throw new EmitError(
                    'Application: positional attributes are not supported',
                    attr.span);
            }
            const propName = attr.path.parts.join('.');
            if (propName === 'Theme')
            {
                if (attr.value.kind !== 'ident')
                {
                    throw new EmitError(
                        `Application.Theme expects a class identifier`,
                        attr.span);
                }
                themeIdent = attr.value.name;
                this.ensureImport(themeIdent);
            }
            else if (propName === 'Scheme')
            {
                if (attr.value.kind !== 'ident')
                {
                    throw new EmitError(
                        `Application.Scheme expects a class identifier`,
                        attr.span);
                }
                schemeIdent = attr.value.name;
                this.ensureImport(schemeIdent);
            }
            else
            {
                throw new EmitError(
                    `Application: attribute '${propName}' is not supported `
                    + `(allowed: Theme, Scheme)`,
                    attr.span);
            }
        }
        if (elem.body === null || elem.body.kind !== 'structured-body')
        {
            throw new EmitError(
                'Application: expected a `{ resources: { … } }` body block',
                elem.span);
        }
        this.ensureImport('Application');
        const appVar = this.fresh('app');
        this.line(`const ${appVar} = new Application();`);

        // Activate the requested theme + scheme BEFORE the visual tree
        // builds. Any DynamicResource lookup inside the body now sees
        // the active token dictionary on first resolve; controls that
        // read `Application.ResolveDefaultResource(MyClass)` in their
        // constructors find their templates via the theme's
        // dictionaries array (merged in by ThemeManager).
        if (themeIdent !== undefined || schemeIdent !== undefined)
        {
            const parts: string[] = [];
            if (themeIdent !== undefined)  parts.push(`theme: ${themeIdent}`);
            if (schemeIdent !== undefined) parts.push(`scheme: ${schemeIdent}`);
            this.line(`${appVar}.initialize({ ${parts.join(', ')} });`);
        }

        for (const item of elem.body.items)
        {
            if (item.kind === 'slot-assign' && item.name === 'resources')
            {
                this.compileResourcesSlot(`${appVar}.Resources`, item);
                continue;
            }
            if (item.kind === 'services-block')
            {
                this.compileServicesBlock(`${appVar}.Services`, item);
                continue;
            }
            if (item.kind === 'modules-block')
            {
                this.compileModulesBlock(appVar, item);
                continue;
            }
            throw new EmitError(
                `Application: only the 'resources:', '.services:' and '.modules:' blocks ` +
                `are supported (got ${item.kind === 'slot-assign' ? `'${item.name}:'` : item.kind})`,
                item.kind === 'slot-assign' ? item.span : elem.span);
        }
        return appVar;
    }

    // ── ResourceDictionary contents ─────────────────────────────────

    private compileResourcesSlot(rdExpr: string, slot: SlotAssign): void
    {
        if (typeof slot.value !== 'object' || !('kind' in slot.value)
            || slot.value.kind !== 'structured-body')
        {
            throw new EmitError(
                'resources: requires a body block', slot.span);
        }
        // Local handle — keeps emit short.
        const rdVar = this.fresh('rd');
        this.line(`const ${rdVar} = ${rdExpr};`);
        // Track same-dict resource vars so a `@key` reference to an entry
        // declared earlier in THIS block resolves to the local JS var
        // directly — matching the `resources Name { … }` block form
        // (compileResourcesBlock). Without this, `@key` in the
        // `Application { resources: { … } }` slot form always fell through
        // to DynamicResource; a TypeTemplateSelector default needs the
        // concrete DataTemplate instance at construction, not a binding.
        const savedLocalRes = this.localResourceVars;
        this.localResourceVars = new Map<string, string>();
        this.compileResourcesBody(rdVar, slot.value);
        this.localResourceVars = savedLocalRes;
    }

    private compileResourcesBody(rdVar: string, body: StructuredBody): void
    {
        for (const item of body.items)
        {
            switch (item.kind)
            {
                case 'key-value-resource':
                    this.compileKeyValueResource(rdVar, item);
                    continue;
                case 'resource-form':
                    this.compileResourceForm(rdVar, item);
                    continue;
                case 'element':
                    this.compileResourceElement(rdVar, item);
                    continue;
                case 'include-form':
                    this.compileInclude(rdVar, item);
                    continue;
                case 'merge-form':
                    this.compileMerge(rdVar, item);
                    continue;
                case 'glyphs-form':
                    this.compileGlyphs(rdVar, item);
                    continue;
                case 'fonts-form':
                    this.compileFonts(rdVar, item);
                    continue;
                default:
                    throw new EmitError(
                        `resources: ${item.kind} is not allowed here`,
                        'span' in item ? item.span : body.span);
            }
        }
    }

    // `include "<path>" [as <key>]` → ask the injected resolver what the
    // file(s) become, emit one `rd.Set(key, value)` per entry, and pull in
    // the imports their JS references. Resolution (filesystem, globbing,
    // extension dispatch) lives in the host-supplied resolver; the compiler
    // only splices the result.
    private compileInclude(rdVar: string, form: IncludeForm): void
    {
        if (this.include === undefined)
        {
            throw new EmitError(
                `'include' needs a file resolver, but none was configured for this compile `
                + `(text-only callers can't read files). Run through the build pipeline.`,
                form.span);
        }
        let res: IncludeResolution;
        try
        {
            res = this.include(form.path, { key: form.key, colored: form.colored });
        }
        catch (e)
        {
            throw new EmitError(
                `include "${form.path}": ${(e as Error).message}`, form.span);
        }
        if (form.key !== undefined && res.entries.length > 1)
        {
            throw new EmitError(
                `include "${form.path}" as ${form.key}: 'as' names a single resource, but `
                + `the path matched ${res.entries.length} files — drop 'as' to key each by basename.`,
                form.span);
        }
        for (const imp of res.imports ?? [])
        {
            this.addModuleImports(imp.module, imp.names);
        }
        for (const entry of res.entries)
        {
            // Bind each included resource to a local const and register it so a
            // `@key` static-resource elsewhere in the SAME dictionary takes the
            // local-inline fast path (see compileValue's static-resource case)
            // instead of degrading to a DynamicResource. A DynamicResource walks
            // the visual's ancestor resource chain at runtime — which does NOT
            // include this dictionary once a template using the resource is
            // applied outside it (e.g. an entity template rendered in a drawer),
            // so the reference would silently never resolve. Inlining bakes the
            // resource (a geometry — immutable, safe to share) directly in.
            // A singleton entry (a binary payload, or `x:single`) is hoisted to a
            // module-scope const so every Clone() shares one instance; a normal
            // entry binds a fresh local const inside Clone (copy-per-clone).
            const isSingle = (entry.singleton === true || form.single === true)
                && this.singletonConsts !== null;
            if (isSingle)
            {
                const singleVar = this.fresh('single');
                this.singletonConsts!.push(`const ${singleVar} = ${entry.valueJs};`);
                this.line(`${rdVar}.Set(${JSON.stringify(entry.key)}, ${singleVar});`);
                this.localResourceVars?.set(entry.key, singleVar);
            }
            else
            {
                const entryVar = this.fresh('inc');
                this.line(`const ${entryVar} = ${entry.valueJs};`);
                this.line(`${rdVar}.Set(${JSON.stringify(entry.key)}, ${entryVar});`);
                this.localResourceVars?.set(entry.key, entryVar);
            }
        }
    }

    // `merge <Alias>` → fold a top-level-imported dictionary's entries into
    // the target dictionary. `Alias` is a `resources NAME` dict brought in by a
    // file-level `import Alias from "…"`; we copy its Clone()'d entries — the
    // same composition a named `resources` block's `import` header does, exposed
    // as a body directive so an Application's `resources:` (and any dictionary
    // body) can merge a standalone dictionary in markup.
    private compileMerge(rdVar: string, form: MergeForm): void
    {
        this.ensureImport(form.alias);
        this.line(
            `for (const [_k, _v] of ${form.alias}.Clone().Entries()) ${rdVar}.Set(_k, _v);`);
    }

    // `glyphs "<font>" { … }` → ask the injected resolver to turn each
    // entry into a geometry resource, emit one `rd.Set(key, value)` per
    // entry, and pull in the imports the geometry JS references. Font
    // parsing + outline extraction live in the resolver; the compiler
    // only splices the result. Mirrors compileInclude.
    private compileGlyphs(rdVar: string, form: GlyphsForm): void
    {
        if (this.glyphs === undefined)
        {
            throw new EmitError(
                `'glyphs' needs a font resolver, but none was configured for this compile `
                + `(text-only callers can't read font files). Run through the build pipeline.`,
                form.span);
        }
        // Resolve the font source: a literal path, or a family reference
        // (`glyphs @Inter`) to a font registered by an earlier `fonts`
        // block in the same compilation.
        let fontPath = form.font;
        if (form.fontFamily !== undefined)
        {
            const declared = this.fontPaths.get(form.fontFamily);
            if (declared === undefined)
            {
                throw new EmitError(
                    `glyphs @${form.fontFamily}: no font family '${form.fontFamily}' is `
                    + `declared by a 'fonts { … }' block earlier in this dictionary.`,
                    form.span);
            }
            fontPath = declared;
        }

        // Empty codepoint → look up by name (the key); else by codepoint.
        const entries = form.entries.map(e => e.codepoint !== undefined
            ? { key: e.key, codepoint: e.codepoint }
            : { key: e.key, name: e.key });

        let res: IncludeResolution;
        try
        {
            res = this.glyphs(fontPath, entries);
        }
        catch (e)
        {
            throw new EmitError(
                `glyphs "${fontPath}": ${(e as Error).message}`, form.span);
        }
        for (const imp of res.imports ?? [])
        {
            this.addModuleImports(imp.module, imp.names);
        }
        for (const entry of res.entries)
        {
            this.line(`${rdVar}.Set(${JSON.stringify(entry.key)}, ${entry.valueJs});`);
        }
    }

    // `fonts { Family from "<path>" [Weight=…, Style=…]  … }` → register
    // each face with the runtime FontManager (loaded for metrics, embedded
    // for rendering by every target) and publish one `@<family>` FontFamily
    // resource per family for `FontFamily=@Family` references. Unlike
    // `glyphs`, no compile-time font reading is needed — the path is
    // emitted as a runtime-resolved URL (`new URL(path, import.meta.url)`).
    // Each declared family's path is also recorded so a later
    // `glyphs @<family> { … }` in the same dictionary can resolve it.
    private compileFonts(rdVar: string, form: FontsForm): void
    {
        const families = new Set<string>();
        for (const e of form.entries)
        {
            // Record the family → source path for `glyphs @family`. First
            // source per family wins (the upright/normal face is the
            // conventional outline source).
            if (!this.fontPaths.has(e.family)) this.fontPaths.set(e.family, e.source);

            const optsParts: string[] = [];
            const weight = this.fontEnumMember('FontWeight', e.weight,
                ['Normal', 'Medium', 'Bold'], e.span);
            const style  = this.fontEnumMember('FontStyle', e.style,
                ['Normal', 'Italic'], e.span);
            if (weight !== undefined) optsParts.push(`weight: ${weight}`);
            if (style  !== undefined) optsParts.push(`style: ${style}`);
            const opts = optsParts.length > 0 ? `, { ${optsParts.join(', ')} }` : '';

            this.ensureImport('FontManager');
            this.ensureImport('FontSourceKind');
            const url = `new URL(${JSON.stringify(e.source)}, import.meta.url).href`;
            this.line(
                `FontManager.Current.Register(${JSON.stringify(e.family)}, `
                + `{ kind: FontSourceKind.Url, url: ${url} }${opts});`);
            families.add(e.family);
        }

        // One FontFamily resource per family so `@<family>` resolves to a
        // typed FontFamily value (the FontFamily DP getter also accepts a
        // plain string, but publishing the value object is cleaner).
        if (families.size > 0) this.ensureImport('FontFamily');
        for (const fam of families)
        {
            this.line(`${rdVar}.Set(${JSON.stringify(fam)}, new FontFamily(${JSON.stringify(fam)}));`);
        }
    }

    // Validate a `fonts` Weight/Style member against the enum's members and
    // return the qualified reference (`FontWeight.Bold`), or undefined when
    // the attribute was omitted. Imports the enum lazily.
    private fontEnumMember(
        enumName: string,
        member: string | undefined,
        allowed: readonly string[],
        span: SourceSpan,
    ): string | undefined
    {
        if (member === undefined) return undefined;
        if (!allowed.includes(member))
        {
            throw new EmitError(
                `fonts: ${enumName === 'FontWeight' ? 'Weight' : 'Style'}=${member} `
                + `is not a ${enumName} member (${allowed.join(' | ')})`,
                span);
        }
        this.ensureImport(enumName);
        return `${enumName}.${member}`;
    }

    // Lower a `$path << conv1 << conv2` converter chain to the converter
    // argument for a binding factory. Each converter is an imported
    // ValueConverter symbol (resolved through ensureImport — a user
    // `import` clause or a built-in); a single one is passed as-is, a
    // chain composes left-to-right via composeConverters. Returns
    // undefined for a plain (converter-free) binding.
    private converterExpr(converters: readonly ConverterRef[] | undefined): string | undefined
    {
        if (converters === undefined || converters.length === 0) return undefined;
        const exprs = converters.map(c => this.compileConverterRef(c));
        if (exprs.length === 1) return exprs[0]!;
        this.ensureImport('composeConverters');
        return `composeConverters([${exprs.join(', ')}])`;
    }

    // Render one `<< conv` link. A bare converter (`<< Upper`) emits the
    // imported symbol as-is; a called one (`<< Lighten(0.5)`) emits the
    // factory invocation with its compiled args (so `Mix(#ff0000, 0.25)`
    // becomes `Mix(new SolidColorBrush(Color.FromHex('#ff0000')), 0.25)`).
    private compileConverterRef(c: ConverterRef): string
    {
        this.ensureImport(c.name);
        if (c.args.length === 0) return c.name;
        const args = c.args.map(a => this.compileValue(a, {}));
        return `${c.name}(${args.join(', ')})`;
    }

    // Add raw named imports for a module WITHOUT going through the
    // symbol-table (ensureImport). Used by `include`, whose resolver
    // supplies module + names directly for generated expressions.
    private addModuleImports(module: string, names: readonly string[]): void
    {
        let s = this.imports.get(module);
        if (s === undefined)
        {
            s = new Set();
            this.imports.set(module, s);
        }
        for (const name of names) s.add(name);
    }

    private compileKeyValueResource(rdVar: string, kv: KeyValueResource): void
    {
        const expr = this.compileValue(kv.value, {});
        this.line(`${rdVar}.Set(${JSON.stringify(kv.key)}, ${expr});`);
    }

    private compileResourceForm(rdVar: string, rf: ResourceForm): void
    {
        if (rf.keyword === 'Style')
        {
            const styleVar = this.compileStyleForm(rf);
            this.registerResourceFormVar(rdVar, rf, styleVar, /*allowImplicit*/ true);
            return;
        }
        if (rf.keyword === 'Template')
        {
            const tmplVar = this.compileControlTemplateForm(rf);
            // x:key path: registers the Template directly (no wrapping).
            const xKey = this.findXAttr(rf.xAttrs, 'key');
            if (xKey !== null)
            {
                this.registerResourceFormVar(rdVar, rf, tmplVar, /*allowImplicit*/ true);
                return;
            }
            // Implicit path: wrap the Template in a Style so Function
            // keys in the resource chain hold Styles only — same key
            // space as user-side `Style [TargetType=X]` entries and the
            // resolve_implicit_style / resolve_theme_style walkers. The
            // Style carries a single Setter that drives the matching
            // control's Template DP when the Style applies.
            //
            // `Application.ResolveDefaultResource(Klass)` now returns a
            // Style; defaultTemplate(Klass) on the runtime side reads the
            // Template setter's value to get the ControlTemplate for
            // eager constructor-time use.
            const tt = this.requireTargetType(rf);
            this.ensureImport(tt);
            this.ensureImport('Setter');
            this.ensureImport('Style');
            const setterVar = this.fresh('setter');
            const styleVar  = this.fresh('style');
            this.line(
                `const ${setterVar} = new Setter(${tt}, "Template", ${tmplVar});`);
            this.line(
                `const ${styleVar} = new Style(${tt}, [${setterVar}], undefined, [], []);`);
            this.line(`${rdVar}.Set(${tt}, ${styleVar});`);
            return;
        }
        if (rf.keyword === 'DataTemplate')
        {
            const tmplVar = this.compileDataTemplateForm(rf);
            this.registerResourceFormVar(rdVar, rf, tmplVar, /*allowImplicit*/ true);
            return;
        }
        if (rf.keyword === 'HierarchicalDataTemplate')
        {
            const tmplVar = this.compileHierarchicalDataTemplateForm(rf);
            this.registerResourceFormVar(rdVar, rf, tmplVar, /*allowImplicit*/ true);
            return;
        }
        if (rf.keyword === 'ItemsPanelTemplate')
        {
            const tmplVar = this.compileItemsPanelTemplateForm(rf);
            this.registerResourceFormVar(rdVar, rf, tmplVar, /*allowImplicit*/ false);
            return;
        }
        if (rf.keyword === 'TemplateSelector')
        {
            const selVar = this.compileTemplateSelectorForm(rf);
            // A selector has no single implicit type key — it MUST be keyed
            // (allowImplicit=false makes registerResourceFormVar require x:key).
            this.registerResourceFormVar(rdVar, rf, selVar, /*allowImplicit*/ false);
            return;
        }
        throw new EmitError(
            `unknown resource form '${rf.keyword}'`, rf.span);
    }

    // Helper: register a freshly-built resource (Style / Template /
    // DataTemplate) in the dictionary by x:key (string) or, when the
    // form supports implicit registration, by its type-attribute as a
    // real Function reference. The TargetType / DataType identifier
    // is `ensureImport`-ed, so user-defined VM classes used in
    // `[DataType=NodeVM]` must be brought into scope by a top-level
    // `import NodeVM from "./node-vm.mjs"` directive.
    //
    // Template / ItemsPanelTemplate stay opt-out (implicit not enabled);
    // their theme migration will land them inside Style.Setters instead.
    private registerResourceFormVar(
        rdVar: string, rf: ResourceForm, valueVar: string,
        allowImplicit: boolean,
    ): void
    {
        const xKey = this.findXAttr(rf.xAttrs, 'key');
        if (xKey !== null)
        {
            if (xKey.value === null || xKey.value.kind !== 'string')
            {
                throw new EmitError(
                    'x:key requires a string literal value', xKey.span);
            }
            const keyStr = xKey.value.value;
            this.line(
                `${rdVar}.Set(${JSON.stringify(keyStr)}, ${valueVar});`);
            // Make `@key` references within the same RD resolve to the
            // local var directly, not through Application.current.Resources
            // (which won't see this entry until create() returns).
            this.localResourceVars?.set(keyStr, valueVar);
            return;
        }
        if (!allowImplicit)
        {
            throw new EmitError(
                `${rf.keyword} without x:key is not supported (implicit ${rf.keyword} ` +
                `desugaring requires a Style.Template setter — not in v0)`,
                rf.span);
        }
        const tt = this.requireTargetType(rf);
        this.ensureImport(tt);
        this.line(`${rdVar}.Set(${tt}, ${valueVar});`);
    }

    private compileControlTemplateForm(rf: ResourceForm): string
    {
        if (rf.body.kind !== 'element' && rf.body.kind !== 'data-template-body')
        {
            throw new EmitError(
                'template body must be a single element (optionally followed by `when()` triggers)',
                rf.span);
        }
        // TargetType is the control class this template targets. Used
        // as the propertyOwner for any `when(IsSelected)` triggers in
        // the body — the watched property is looked up on this class
        // (or its bases). Also required for the original validation
        // contract: authors can't omit it.
        const targetType = this.requireTargetType(rf);

        const rootElement = rf.body.kind === 'element' ? rf.body : rf.body.root;
        const triggers = rf.body.kind === 'data-template-body' ? rf.body.triggers : [];
        // ControlTemplate event triggers — `on Click { … }` etc.
        // inside the body. Lowered into the EventTriggers tail param
        // of new ControlTemplate(...). The runtime calls
        // root.AddEventTrigger on each freshly-built template root, so
        // every templated instance gets independent per-instance
        // subscriptions (matches WPF's <ControlTemplate.Triggers>
        // shape).
        const eventTriggers = rf.body.kind === 'data-template-body' ? rf.body.eventTriggers : [];

        this.ensureImport('ControlTemplate');
        const tmplVar = this.fresh('tmpl');
        // Trigger-free path: preserve the historical 1-arg
        // `new ControlTemplate(factory)` emit shape so existing snapshot
        // tests of un-triggered templates keep matching.
        if (triggers.length === 0 && eventTriggers.length === 0)
        {
            this.line(`const ${tmplVar} = new ControlTemplate((_templatedParent) => {`);
            this.indent += 4;
            const wasInTemplate = this.inTemplateBody;
            this.inTemplateBody = true;
            // Stash the surrounding DataTemplate's name scope (if any)
            // so x:names declared inside a nested ControlTemplate body
            // don't pollute the data-template-scope used by
            // TargetedSetter lowering above this control template.
            const savedTNS = this.templateNameScope;
            const savedTNO = this.templateNameOwners;
            const savedTNV = this.templateNameVars;
            this.templateNameScope  = undefined;
            this.templateNameOwners = undefined;
            this.templateNameVars   = undefined;
            const rootVar = this.compileElement(rootElement);
            this.templateNameScope  = savedTNS;
            this.templateNameOwners = savedTNO;
            this.templateNameVars   = savedTNV;
            this.inTemplateBody = wasInTemplate;
            this.line(`return ${rootVar};`);
            this.indent -= 4;
            this.line(`});`);
            return tmplVar;
        }

        // Triggered path. The triggers reference x:names registered
        // inside the factory body (via TargetedSetter), so the factory
        // must compile FIRST so templateNameScope is populated when the
        // trigger setters lower. Wrap the whole construction in an IIFE
        // so the `const` declarations stay legal and the factory body
        // runs in a private scope. Same shape DataTemplate uses for
        // triggered output.
        this.line(`const ${tmplVar} = (() => {`);
        this.indent += 4;
        // Open a fresh template-local name scope so the trigger setters'
        // TargetedSetter lowering finds PART_Border et al. inside this
        // template's body, not in any outer template scope. Restored on
        // the way out.
        const savedTNS = this.templateNameScope;
        const savedTNO = this.templateNameOwners;
        const savedTNV = this.templateNameVars;
        const savedInTemplate = this.inTemplateBody;
        this.templateNameScope  = new Set<string>();
        this.templateNameOwners = new Map<string, string>();
        this.templateNameVars   = new Map<string, string>();
        this.inTemplateBody = true;
        // Pre-walk body for x:names so forward x:name refs work — see
        // collectTemplateXNames + emitPreallocatedXNameLets.
        this.collectTemplateXNames(rootElement);
        this.line(`const _factory = (_templatedParent) => {`);
        this.indent += 4;
        this.emitPreallocatedXNameLets();
        const rootVar = this.compileElement(rootElement);
        this.line(`return ${rootVar};`);
        this.indent -= 4;
        this.line(`};`);

        const triggerVars = this.compileControlTemplateTriggers(triggers, targetType);
        // Event-trigger lowering: same shape as DataTemplate's path —
        // EventTrigger ctor takes a string event name + actions; the
        // runtime resolves it through Visual.AddEventTrigger on the
        // freshly-built template root. The empty targetType passed to
        // compileEventTriggerGroup means "no implicit target import"
        // because the routed event is named by string, not by class.
        const eventTriggerVars: string[] = [];
        for (const et of eventTriggers)
        {
            eventTriggerVars.push(this.compileEventTriggerGroup('', et));
        }
        this.templateNameScope  = savedTNS;
        this.templateNameOwners = savedTNO;
        this.templateNameVars   = savedTNV;
        this.inTemplateBody     = savedInTemplate;

        const triggersArr = `[${triggerVars.join(', ')}]`;
        if (eventTriggerVars.length === 0)
        {
            this.line(`return new ControlTemplate(_factory, ${triggersArr});`);
        }
        else
        {
            const eventsArr = `[${eventTriggerVars.join(', ')}]`;
            this.line(`return new ControlTemplate(_factory, ${triggersArr}, ${eventsArr});`);
        }
        this.indent -= 4;
        this.line(`})();`);
        return tmplVar;
    }

    // ControlTemplate trigger compiler. Mirrors DataTemplate's trigger
    // compiler but emits TemplatePropertyTrigger watching the templated
    // parent (the runtime supplies templatedParent as the default
    // source). `when($path = value)` data-trigger form is rejected here
    // — control-template triggers exist to react to the templated
    // control's own DPs, not to its DataContext.
    private compileControlTemplateTriggers(
        triggers: readonly TriggerGroup[],
        targetType: string,
    ): string[]
    {
        const triggerVars: string[] = [];
        for (const tg of triggers)
        {
            const disjuncts = this.flattenToDNF(tg.condition);
            if (disjuncts.length !== 1 || disjuncts[0]!.length !== 1)
            {
                throw new EmitError(
                    'ControlTemplate triggers currently support only a single-term `when( … )` condition',
                    tg.span);
            }
            const term = disjuncts[0]![0]!;
            if (term.negated)
            {
                throw new EmitError(
                    'ControlTemplate triggers do not support `not` — write `Property = false` instead',
                    term.span);
            }
            if (term.path !== undefined)
            {
                throw new EmitError(
                    'ControlTemplate triggers don\'t support `$path` (data) conditions — use a property name (e.g. `when(IsSelected)`)',
                    term.span);
            }
            // Partition: setters use compileTemplateSetter; enter/exit
            // and behaviors blocks lower the same way they do in Style
            // triggers. The runtime fires enterActions/exitActions on
            // the transition edges (no initial-state replay), with the
            // templatedParent as the action target so InvokeCommandAction
            // and BeginStoryboardAction operate against the control
            // whose template this is.
            const { setterVars, enterActionVars, exitActionVars } =
                this.partitionTriggerBody(tg.setters.items, (ps) => this.compileTemplateSetter(ps));
            const settersArrVar = this.fresh('tplSet');
            this.line(`const ${settersArrVar} = [${setterVars.join(', ')}];`);

            let enterArrVar = '[]';
            if (enterActionVars.length > 0)
            {
                enterArrVar = this.fresh('tplEnter');
                this.line(`const ${enterArrVar} = [${enterActionVars.join(', ')}];`);
            }
            let exitArrVar = '[]';
            if (exitActionVars.length > 0)
            {
                exitArrVar = this.fresh('tplExit');
                this.line(`const ${exitArrVar} = [${exitActionVars.join(', ')}];`);
            }
            const hasActions = enterActionVars.length > 0 || exitActionVars.length > 0;

            const valueExpr = this.evaluateTermValue(term);
            this.ensureImport('TemplatePropertyTrigger');
            // `when(Prefix.Property)` has two disambiguated forms:
            //
            //   * PART-source — `Prefix` matches an x:name registered
            //     inside this template's body. The trigger subscribes
            //     to that PART's property change; both the propertyOwner
            //     and the runtime source come from the PART element.
            //
            //   * Class-prefix — `Prefix` matches a known type symbol
            //     (e.g. `ThemeManager.Density` for the static ambient
            //     theme manager, `Visual.IsMouseOver` for a fully-
            //     qualified inherited DP). The propertyOwner is the
            //     class itself; sourceName stays undefined so the
            //     runtime resolves the source as the templated parent
            //     (where the inherited / attached DP's value is read
            //     from the per-Visual property bag).
            //
            // No prefix at all → propertyOwner = templated control's
            // own type (default-source path).
            let ownerType = targetType;
            let sourceArg = 'undefined';
            if (term.sourceName !== undefined)
            {
                const partType = this.templateNameOwners?.get(term.sourceName);
                if (partType !== undefined)
                {
                    // PART-source.
                    ownerType = partType;
                    sourceArg = JSON.stringify(term.sourceName);
                }
                else if (this.symbols.has(term.sourceName))
                {
                    // Class-prefix — runtime source stays as the
                    // templated parent; ownerType becomes the class
                    // ref so the descriptor lookup hits the right
                    // (owner, name) tuple.
                    ownerType = term.sourceName;
                }
                else
                {
                    throw new EmitError(
                        `when(${term.sourceName}.${term.property}): `
                        + `'${term.sourceName}' is neither a template-local x:name `
                        + `nor a known imported type. Add an import for it or `
                        + `check that the PART name matches an x:name in the template body.`,
                        term.span);
                }
            }
            this.ensureImport(ownerType);
            const v = this.fresh('tplTrig');
            if (hasActions)
            {
                // TemplatePropertyTrigger(owner, name, value, setters,
                //                         sourceName, enterActions, exitActions).
                this.line(
                    `const ${v} = new TemplatePropertyTrigger(${ownerType}, ${JSON.stringify(term.property)}, ${valueExpr}, ${settersArrVar}, ${sourceArg}, ${enterArrVar}, ${exitArrVar});`);
            }
            else
            {
                this.line(
                    `const ${v} = new TemplatePropertyTrigger(${ownerType}, ${JSON.stringify(term.property)}, ${valueExpr}, ${settersArrVar}, ${sourceArg});`);
            }
            triggerVars.push(v);
        }
        return triggerVars;
    }

    // Compile a `TemplateSelector` resource form (spec Shape C) into a runtime
    // `TypeTemplateSelector`: typed `DataTemplate [DataType=X] { … }` children
    // become Map<Function, DataTemplate> cases; a single bare `@key` (which must
    // reference a DataTemplate declared earlier in the same resources block)
    // becomes the fallback. Cases and default share the runtime selector's
    // most-derived-first prototype walk, matching implicit-`DataType` semantics.
    private compileTemplateSelectorForm(rf: ResourceForm): string
    {
        if (rf.body.kind !== 'template-selector-body')
        {
            throw new EmitError(
                'TemplateSelector body must be a list of `DataTemplate [DataType=…]` cases and an optional `@key` default',
                rf.span);
        }
        this.ensureImport('TypeTemplateSelector');
        const caseEntries: string[] = [];
        let fallbackVar: string | undefined;
        for (const entry of rf.body.entries)
        {
            if (entry.kind === 'static-resource')
            {
                if (fallbackVar !== undefined)
                {
                    throw new EmitError('TemplateSelector accepts at most one `@key` default', entry.span);
                }
                const localVar = this.localResourceVars?.get(entry.key);
                if (localVar === undefined)
                {
                    throw new EmitError(
                        `TemplateSelector default @${entry.key} must reference a DataTemplate declared earlier in the same resources block`,
                        entry.span);
                }
                fallbackVar = localVar;
                continue;
            }
            // A typed case: a DataTemplate that MUST carry a DataType.
            // requireTargetType throws the standard "missing required 'DataType'"
            // EmitError otherwise.
            const dataType = this.requireTargetType(entry);
            this.ensureImport(dataType);
            const tmplVar = this.compileDataTemplateForm(entry);
            caseEntries.push(`[${dataType}, ${tmplVar}]`);
        }
        const selVar = this.fresh('sel');
        this.line(
            `const ${selVar} = new TypeTemplateSelector(new Map([${caseEntries.join(', ')}]), ${fallbackVar ?? 'undefined'});`);
        return selVar;
    }

    private compileDataTemplateForm(rf: ResourceForm): string
    {
        if (rf.body.kind !== 'element' && rf.body.kind !== 'data-template-body')
        {
            throw new EmitError(
                'DataTemplate body must be a single element (optionally followed by `when()` triggers)',
                rf.span);
        }
        // `DataType=Foo` resolves to a real Function reference — the
        // identifier is `ensureImport`-ed so user-defined VM classes
        // brought in by a top-level `import Foo from "./foo-vm.mjs"`
        // are linkable end-to-end. ContentPresenter / PageView /
        // ItemsControl resolve templates via Function-identity match
        // against `content.constructor`, matching WPF's `{x:Type}`
        // shape rather than name-string lookup.
        const dataType = this.requireTargetType(rf);
        this.ensureImport(dataType);
        const rootElement = rf.body.kind === 'element' ? rf.body : rf.body.root;
        const triggers      = rf.body.kind === 'data-template-body' ? rf.body.triggers      : [];
        const eventTriggers = rf.body.kind === 'data-template-body' ? rf.body.eventTriggers : [];

        this.ensureImport('DataTemplate');
        const tmplVar = this.fresh('tmpl');
        // Open a fresh template-local name scope for this DataTemplate
        // body so x:names declared inside register here (without
        // colliding with another DataTemplate in the same file or the
        // application-root scope). Restored on the way out.
        const savedTNS         = this.templateNameScope;
        const savedTNO         = this.templateNameOwners;
        const savedTNV         = this.templateNameVars;
        const savedInTemplate  = this.inTemplateBody;
        const savedScopeOwner  = this.nameScopeOwnerVar;
        this.templateNameScope  = new Set<string>();
        this.templateNameOwners = new Map<string, string>();
        this.templateNameVars   = new Map<string, string>();
        // Mark "inside a template body" so x:name handling SKIPS the
        // per-name Register emit (Apply walks the subtree at runtime and
        // registers names into the fresh per-instance NameScope). Also
        // clear nameScopeOwnerVar — otherwise an x:name inside this
        // factory would emit Register() against whatever x:root the
        // PREVIOUS template (or the enclosing application root) had,
        // resulting in `<wrong>.nameScope.Register(...)` at runtime and
        // a ReferenceError when the variable isn't in scope.
        this.inTemplateBody    = true;
        this.nameScopeOwnerVar = undefined;
        // Pre-walk the body to allocate vars for every x:named element
        // so forward x:name references compile against a lexically-
        // visible `let` declared at the top of the factory body.
        this.collectTemplateXNames(rootElement);
        if (triggers.length === 0 && eventTriggers.length === 0)
        {
            // Trigger-free path: preserve the historical 2-arg emit
            // shape so existing snapshot tests keep matching.
            this.line(`const ${tmplVar} = new DataTemplate((_data) => {`);
            this.indent += 4;
            this.emitPreallocatedXNameLets();
            const rootVar = this.compileElement(rootElement);
            this.line(`return ${rootVar};`);
            this.indent -= 4;
            this.line(`}, ${dataType});`);
        }
        else
        {
            // Triggers reference x:names declared inside the factory
            // body, so they MUST be compiled after the factory walk
            // (which populates templateNameScope) — but their `const`
            // declarations must SYNTACTICALLY precede the
            // `new DataTemplate(...)` call. Wrapping the whole
            // construction in an IIFE keeps the declaration order
            // legal while letting the factory body run first inside a
            // local scope. Adds one closure per DataTemplate; cheap.
            this.line(`const ${tmplVar} = (() => {`);
            this.indent += 4;
            this.line(`const _factory = (_data) => {`);
            this.indent += 4;
            this.emitPreallocatedXNameLets();
            const rootVar = this.compileElement(rootElement);
            this.line(`return ${rootVar};`);
            this.indent -= 4;
            this.line(`};`);
            const { propertyTriggers, dataTriggers, multiDataTriggers } =
                this.compileDataTemplateTriggers(triggers);
            // EventTrigger lowering reuses the same compile helper the
            // Style.EventTrigger path uses — the runtime EventTrigger
            // shape is identical (RoutedEvent + Actions[]); only the
            // attach surface differs (Visual.AddEventTrigger on the
            // template root vs Style.OnApply on the styled visual).
            const eventTriggerVars: string[] = [];
            for (const et of eventTriggers)
            {
                eventTriggerVars.push(this.compileEventTriggerGroup('', et));
            }
            const propsArr     = `[${propertyTriggers.join(', ')}]`;
            const dataArr      = `[${dataTriggers.join(', ')}]`;
            const multiDataArr = `[${multiDataTriggers.join(', ')}]`;
            // Only emit trailing arguments when populated — keeps the
            // 4-arg constructor call shape stable for templates that
            // only carry when()-style triggers and avoids churn in
            // existing snapshot tests.
            if (eventTriggerVars.length === 0 && multiDataTriggers.length === 0)
            {
                this.line(
                    `return new DataTemplate(_factory, ${dataType}, ${propsArr}, ${dataArr});`);
            }
            else if (multiDataTriggers.length === 0)
            {
                const eventsArr = `[${eventTriggerVars.join(', ')}]`;
                this.line(
                    `return new DataTemplate(_factory, ${dataType}, ${propsArr}, ${dataArr}, ${eventsArr});`);
            }
            else
            {
                const eventsArr = `[${eventTriggerVars.join(', ')}]`;
                this.line(
                    `return new DataTemplate(_factory, ${dataType}, ${propsArr}, ${dataArr}, ${eventsArr}, ${multiDataArr});`);
            }
            this.indent -= 4;
            this.line(`})();`);
        }
        this.templateNameScope  = savedTNS;
        this.templateNameOwners = savedTNO;
        this.templateNameVars   = savedTNV;
        this.inTemplateBody     = savedInTemplate;
        this.nameScopeOwnerVar  = savedScopeOwner;
        return tmplVar;
    }

    // Partition a trigger-group body into (setters, enterActions,
    // exitActions). Used by Style triggers (via compileTriggerGroup
    // inline), DataTemplate triggers, and ControlTemplate triggers —
    // the setter compiler differs (compileSetter vs compileTemplateSetter)
    // so callers pass it in via `compileSetterItem`. Returns variable
    // names that have already been emitted as locals.
    private partitionTriggerBody(
        items: readonly SetterItem[],
        compileSetterItem: (ps: PropertySetter) => string,
    ): { setterVars: string[]; enterActionVars: string[]; exitActionVars: string[] }
    {
        const setterVars:      string[] = [];
        const enterActionVars: string[] = [];
        const exitActionVars:  string[] = [];
        for (const item of items)
        {
            if (item.kind === 'property-setter')
            {
                setterVars.push(compileSetterItem(item));
                continue;
            }
            if (item.kind === 'event-trigger')
            {
                if (item.eventName === 'enter')
                {
                    for (const a of item.actions)
                    {
                        enterActionVars.push(this.compileTriggerAction(a));
                    }
                    continue;
                }
                if (item.eventName === 'exit')
                {
                    for (const a of item.actions)
                    {
                        exitActionVars.push(this.compileTriggerAction(a));
                    }
                    continue;
                }
                throw new EmitError(
                    `inside when(): only 'enter' and 'exit' are valid 'on' names — got '${item.eventName}'`,
                    item.span);
            }
            if (item.kind === 'behaviors-block')
            {
                for (const entry of item.entries)
                {
                    const { attachVar, detachVar } = this.compileTriggeredBehavior(entry);
                    enterActionVars.push(attachVar);
                    exitActionVars.push(detachVar);
                }
                continue;
            }
            throw new EmitError(
                'nested triggers are not supported', item.span);
        }
        return { setterVars, enterActionVars, exitActionVars };
    }

    // Emit a TemplatePropertyTrigger / TemplateDataTrigger /
    // TemplateMultiDataTrigger per `when()` block in a DataTemplate
    // body. DNF flattening produces a list of conjuncts; single-term
    // conjuncts emit TemplateDataTrigger, multi-term `$path`-only
    // conjuncts emit TemplateMultiDataTrigger. Setter LHS resolution:
    // when the first segment matches an x:name registered in the
    // surrounding template scope, it becomes the setter's `targetName`;
    // otherwise it's an attached-property owner type.
    private compileDataTemplateTriggers(
        triggers: readonly TriggerGroup[],
    ): { propertyTriggers: string[]; dataTriggers: string[]; multiDataTriggers: string[] }
    {
        const propertyTriggers:  string[] = [];
        const dataTriggers:      string[] = [];
        const multiDataTriggers: string[] = [];
        for (const tg of triggers)
        {
            const disjuncts = this.flattenToDNF(tg.condition);
            // Partition the body once for the whole `when()` — all
            // disjuncts share the same setter/enter/exit lists.
            const { setterVars, enterActionVars, exitActionVars } =
                this.partitionTriggerBody(tg.setters.items, (ps) => this.compileTemplateSetter(ps));
            const settersArrVar = this.fresh('tplSet');
            this.line(`const ${settersArrVar} = [${setterVars.join(', ')}];`);

            let enterArrVar = '[]';
            if (enterActionVars.length > 0)
            {
                enterArrVar = this.fresh('tplEnter');
                this.line(`const ${enterArrVar} = [${enterActionVars.join(', ')}];`);
            }
            let exitArrVar = '[]';
            if (exitActionVars.length > 0)
            {
                exitArrVar = this.fresh('tplExit');
                this.line(`const ${exitArrVar} = [${exitActionVars.join(', ')}];`);
            }
            const hasActions = enterActionVars.length > 0 || exitActionVars.length > 0;

            for (const conjunct of disjuncts)
            {
                if (conjunct.length === 1)
                {
                    const term = conjunct[0]!;
                    if (term.path === undefined)
                    {
                        throw new EmitError(
                            "property-trigger `when( PropertyName )` inside DataTemplate bodies is not supported yet — use `when( $path )` against the data context",
                            term.span);
                    }
                    const valueExpr = this.evaluateTermValue(term);
                    this.ensureImport('TemplateDataTrigger');
                    const v = this.fresh('tplDataTrig');
                    if (hasActions)
                    {
                        this.line(
                            `const ${v} = new TemplateDataTrigger(${JSON.stringify(term.path)}, ${valueExpr}, ${settersArrVar}, undefined, ${enterArrVar}, ${exitArrVar});`);
                    }
                    else
                    {
                        this.line(
                            `const ${v} = new TemplateDataTrigger(${JSON.stringify(term.path)}, ${valueExpr}, ${settersArrVar});`);
                    }
                    dataTriggers.push(v);
                }
                else
                {
                    // Multi-term conjunct — only pure-$path is supported
                    // inside DataTemplate bodies (DataTemplate's natural
                    // trigger source IS the per-item DataContext).
                    for (const term of conjunct)
                    {
                        if (term.path === undefined)
                        {
                            throw new EmitError(
                                "DP-property terms inside `when( … and … )` are not supported inside DataTemplate bodies — DataTemplate triggers fire on $path conditions, not target DPs",
                                term.span);
                        }
                    }
                    this.ensureImport('TemplateMultiDataTrigger');
                    const conditionExprs: string[] = [];
                    for (const term of conjunct)
                    {
                        const valueExpr = this.evaluateTermValue(term);
                        conditionExprs.push(
                            `{ path: ${JSON.stringify(term.path!)}, value: ${valueExpr} }`);
                    }
                    const v = this.fresh('tplMultiDataTrig');
                    if (hasActions)
                    {
                        this.line(
                            `const ${v} = new TemplateMultiDataTrigger([${conditionExprs.join(', ')}], ${settersArrVar}, undefined, ${enterArrVar}, ${exitArrVar});`);
                    }
                    else
                    {
                        this.line(
                            `const ${v} = new TemplateMultiDataTrigger([${conditionExprs.join(', ')}], ${settersArrVar});`);
                    }
                    multiDataTriggers.push(v);
                }
            }
        }
        return { propertyTriggers, dataTriggers, multiDataTriggers };
    }

    // Lower one DataTemplate-body setter into either a TargetedSetter
    // (when the LHS first segment matches a registered x:name in the
    // current template scope) or a plain Setter (attached-property
    // form). Stays close in shape to compileSetter so the value-side
    // emission is reused.
    private compileTemplateSetter(item: PropertySetter): string
    {
        this.ensureImport('TargetedSetter');
        const parts = item.path.parts;
        if (parts.length === 1)
        {
            // Bare `Property = value;` — owner defaults to the template
            // root's runtime class. We can't statically know that
            // class, so emit a TargetedSetter with targetName=undefined
            // and look up the descriptor by name on the resolved
            // target at apply time. The runtime takes (owner,
            // property, value, targetName) so we still need an owner
            // class. Reject for now until the root-class inference
            // story is solid.
            throw new EmitError(
                "bare `Property = value;` in DataTemplate triggers is not supported yet — write `Owner.Property = value` (e.g. `Border.Fill = …`) or `targetName.Property = value`",
                item.span);
        }
        const first  = parts[0]!;
        const second = parts[1]!;
        const valueExpr = this.compileValue(item.value, {
            propertyName: second,
            targetExpr:   undefined,
        });
        const isName = this.templateNameScope?.has(first) ?? false;
        if (isName)
        {
            // TargetedSetter(owner=undefined?  No — runtime needs an
            // owner class for descriptor lookup. We require a third
            // path segment: TargetName.OwnerClass.Property = value.
            // That's verbose. Pragmatic alternative: infer owner from
            // first segment's recorded class.
            const ownerType = this.templateNameOwners?.get(first);
            if (ownerType === undefined)
            {
                throw new EmitError(
                    `cannot resolve owner class for target '${first}' — ensure the named element is declared earlier in the template body`,
                    item.span);
            }
            this.ensureImport(ownerType);
            return `new TargetedSetter(${ownerType}, ${JSON.stringify(second)}, ${valueExpr}, ${JSON.stringify(first)})`;
        }
        // Attached-property form: `Owner.Property = value` targets the
        // template root. Same shape the Style compiler uses.
        this.ensureImport(first);
        return `new TargetedSetter(${first}, ${JSON.stringify(second)}, ${valueExpr})`;
    }

    // ── HierarchicalDataTemplate ────────────────────────────────────
    //
    // `HierarchicalDataTemplate x:key="…" [DataType=Foo, itemsselector=Bar] { … }`
    // emits a HierarchicalDataTemplate whose itemsSelector pulls `data.Bar`
    // off each parent data item, returning undefined for items without
    // that property (TreeView treats undefined-children as a leaf row).
    // Used by TreeView (and other hierarchical ItemsControls) to walk
    // a recursive data structure with one template per level.
    private compileHierarchicalDataTemplateForm(rf: ResourceForm): string
    {
        // Parser wraps both DataTemplate and HierarchicalDataTemplate
        // bodies in `data-template-body` since both can carry trailing
        // `when()` triggers.
        if (rf.body.kind !== 'element' && rf.body.kind !== 'data-template-body')
        {
            throw new EmitError(
                'HierarchicalDataTemplate body must be a single element (optionally followed by `when()` triggers)',
                rf.span);
        }
        const rootElement   = rf.body.kind === 'element' ? rf.body : rf.body.root;
        const triggers      = rf.body.kind === 'data-template-body' ? rf.body.triggers      : [];
        const eventTriggers = rf.body.kind === 'data-template-body' ? rf.body.eventTriggers : [];
        const dataType = this.requireTargetType(rf);
        this.ensureImport(dataType);
        const selector = this.findIdentMetaAttr(rf, 'itemsselector');
        if (selector === undefined)
        {
            throw new EmitError(
                'HierarchicalDataTemplate requires `itemsselector=<PropertyName>` — names the children property on the data',
                rf.span);
        }
        // Selector reads `data?.<selector>`. Optional chain → returns
        // undefined when the data has no children property (leaf row),
        // which HierarchicalDataTemplate.ItemsOf treats as an empty iterable.
        const childSel = `(data) => data?.${selector}`;

        this.ensureImport('HierarchicalDataTemplate');
        const tmplVar = this.fresh('tmpl');

        if (triggers.length === 0 && eventTriggers.length === 0)
        {
            // Trigger-free path — preserve the historical 5-arg construction
            // shape (keeps existing snapshot output stable).
            this.line(`const ${tmplVar} = new HierarchicalDataTemplate((_data) => {`);
            this.indent += 4;
            const rootVar = this.compileElement(rootElement);
            this.line(`return ${rootVar};`);
            this.indent -= 4;
            this.line(`}, ${childSel}, undefined, undefined, ${dataType});`);
            return tmplVar;
        }

        // Trigger-bearing path — mirrors compileDataTemplateForm: open a fresh
        // template-local name scope, walk the factory inside an IIFE, then
        // compile the `when()` / `on` triggers (which reference x:named parts
        // by targetName, resolved at Apply time) and forward them into the
        // HierarchicalDataTemplate's trailing trigger slots.
        const savedTNS         = this.templateNameScope;
        const savedTNO         = this.templateNameOwners;
        const savedTNV         = this.templateNameVars;
        const savedInTemplate  = this.inTemplateBody;
        const savedScopeOwner  = this.nameScopeOwnerVar;
        this.templateNameScope  = new Set<string>();
        this.templateNameOwners = new Map<string, string>();
        this.templateNameVars   = new Map<string, string>();
        this.inTemplateBody    = true;
        this.nameScopeOwnerVar = undefined;
        this.collectTemplateXNames(rootElement);

        this.line(`const ${tmplVar} = (() => {`);
        this.indent += 4;
        this.line(`const _factory = (_data) => {`);
        this.indent += 4;
        this.emitPreallocatedXNameLets();
        const rootVar = this.compileElement(rootElement);
        this.line(`return ${rootVar};`);
        this.indent -= 4;
        this.line(`};`);
        const { propertyTriggers, dataTriggers, multiDataTriggers } =
            this.compileDataTemplateTriggers(triggers);
        const eventTriggerVars: string[] = [];
        for (const et of eventTriggers)
        {
            eventTriggerVars.push(this.compileEventTriggerGroup('', et));
        }
        const propsArr     = `[${propertyTriggers.join(', ')}]`;
        const dataArr      = `[${dataTriggers.join(', ')}]`;
        const eventsArr    = `[${eventTriggerVars.join(', ')}]`;
        const multiDataArr = `[${multiDataTriggers.join(', ')}]`;
        this.line(
            `return new HierarchicalDataTemplate(_factory, ${childSel}, undefined, undefined, ${dataType}, ${propsArr}, ${dataArr}, ${eventsArr}, ${multiDataArr});`);
        this.indent -= 4;
        this.line(`})();`);

        this.templateNameScope  = savedTNS;
        this.templateNameOwners = savedTNO;
        this.templateNameVars   = savedTNV;
        this.inTemplateBody     = savedInTemplate;
        this.nameScopeOwnerVar  = savedScopeOwner;
        return tmplVar;
    }

    // Inline-template emission shared between the resource-form path
    // (registered in a ResourceDictionary by x:key) and the inline
    // slot-assign path (anonymous, assigned directly to a property).
    // The two paths differ only in how the produced template var is
    // consumed downstream; the construction itself is identical, so
    // this helper just dispatches to the keyword-specific compiler
    // method and returns the emitted variable name. Style is rejected
    // here — styles only ever live as keyed dictionary entries.
    private compileInlineTemplateValue(rf: ResourceForm): string
    {
        if (rf.keyword === 'Template')                  return this.compileControlTemplateForm(rf);
        if (rf.keyword === 'DataTemplate')              return this.compileDataTemplateForm(rf);
        if (rf.keyword === 'HierarchicalDataTemplate')  return this.compileHierarchicalDataTemplateForm(rf);
        if (rf.keyword === 'ItemsPanelTemplate')        return this.compileItemsPanelTemplateForm(rf);
        throw new EmitError(
            `'${rf.keyword}' is not allowed inline as a slot-assign value (only template forms are)`,
            rf.span);
    }

    // ── ItemsPanelTemplate ──────────────────────────────────────────
    //
    // `ItemsPanelTemplate x:key="…" { Panel … }` emits an
    // ItemsPanelTemplate whose Apply() produces a fresh Panel each call.
    // No required meta-attrs — the produced Visual just has to be a
    // Panel-derived class (validated at runtime by the consumer, not at
    // compile time, since the compiler doesn't track Visual subclass
    // hierarchies). Used by ItemsControl.ItemsPanel as the markup-side
    // analog of the JS `() => Panel` factory closure.
    private compileItemsPanelTemplateForm(rf: ResourceForm): string
    {
        if (rf.body.kind !== 'element')
        {
            throw new EmitError(
                'ItemsPanelTemplate body must be a single element', rf.span);
        }
        this.ensureImport('ItemsPanelTemplate');
        const tmplVar = this.fresh('tmpl');
        this.line(`const ${tmplVar} = new ItemsPanelTemplate(() => {`);
        this.indent += 4;
        const rootVar = this.compileElement(rf.body);
        this.line(`return ${rootVar};`);
        this.indent -= 4;
        this.line(`});`);
        return tmplVar;
    }

    private compileResourceElement(rdVar: string, elem: ElementNode): void
    {
        // Macro invocation? Expand first so the x:key / x:root check
        // below sees the post-expansion attrs (macro authors can put
        // `x:key` on the macro's outer element via the expansion body).
        const macro = this.macros.get(elem.name);
        if (macro !== undefined)
        {
            const expanded = this.expandMacro(elem, macro);
            // Forward x:* attrs from the invocation onto the expanded
            // root so `card x:key="X" { ... }` still keys the result.
            const merged: ElementNode = elem.xAttrs.length === 0
                ? expanded
                : { ...expanded, xAttrs: [...expanded.xAttrs, ...elem.xAttrs] };
            this.compileResourceElement(rdVar, merged);
            return;
        }

        const xKey  = this.findXAttr(elem.xAttrs, 'key');
        const xRoot = this.findXAttr(elem.xAttrs, 'root');
        if (xKey === null && xRoot === null)
        {
            throw new EmitError(
                `${elem.name} inside resources requires x:key or x:root`,
                elem.span);
        }
        const elemVar = this.compileElement(elem);
        if (xRoot !== null)
        {
            this.line(`${rdVar}.Root = ${elemVar};`);
        }
        if (xKey !== null)
        {
            if (xKey.value === null || xKey.value.kind !== 'string')
            {
                throw new EmitError(
                    'x:key requires a string literal value', xKey.span);
            }
            this.line(
                `${rdVar}.Set(${JSON.stringify(xKey.value.value)}, ${elemVar});`);
        }
    }

    // ── Style + Setter + PropertyTrigger emission ──────────────────

    private compileStyleForm(rf: ResourceForm): string
    {
        if (rf.body.kind !== 'setter-list')
        {
            throw new EmitError('style body must be a setter list', rf.span);
        }
        this.ensureImport('Style');

        const tt = this.requireTargetType(rf);
        this.ensureImport(tt);

        const setterVars:           string[] = [];
        const triggerVars:          string[] = [];
        const multiTriggerVars:     string[] = [];
        const dataTriggerVars:      string[] = [];
        const multiDataTriggerVars: string[] = [];
        const eventTriggerVars:     string[] = [];
        for (const item of rf.body.items)
        {
            if (item.kind === 'property-setter')
            {
                setterVars.push(this.compileSetter(tt, item));
            }
            else if (item.kind === 'event-trigger')
            {
                eventTriggerVars.push(this.compileEventTriggerGroup(tt, item));
            }
            else if (item.kind === 'behaviors-block')
            {
                // `Behaviors { … }` at Style body level would attach the
                // same per-style Behavior instances to every target —
                // multiple targets would stomp on each other's state.
                // Behaviors inside a Style only make sense scoped to a
                // trigger body (each enter creates a fresh instance via
                // the AttachBehaviorAction factory).
                throw new EmitError(
                    "Behaviors { … } block is only allowed inside a when(…) trigger body — not at Style body level",
                    item.span);
            }
            else
            {
                const out = this.compileTriggerGroup(tt, item);
                triggerVars.push(...out.propertyTriggers);
                multiTriggerVars.push(...out.multiTriggers);
                dataTriggerVars.push(...out.dataTriggers);
                multiDataTriggerVars.push(...out.multiDataTriggers);
            }
        }
        const settersArr           = `[${setterVars.join(', ')}]`;
        const triggersArr          = `[${triggerVars.join(', ')}]`;
        const multiTriggersArr     = `[${multiTriggerVars.join(', ')}]`;
        const dataTriggersArr      = `[${dataTriggerVars.join(', ')}]`;
        const multiDataTriggersArr = `[${multiDataTriggerVars.join(', ')}]`;
        const eventTriggersArr     = `[${eventTriggerVars.join(', ')}]`;

        const basedOn = this.compileStyleBasedOn(rf);

        const styleVar = this.fresh('style');
        // Style(targetType, setters, basedOn, triggers, multiTriggers,
        //       eventTriggers, dataTriggers, multiDataTriggers). Trailing
        // arguments are omitted from the emit when empty so existing
        // snapshot tests of the legacy 5- / 6- / 7-arg forms keep
        // matching — a Style with no event triggers / no data triggers /
        // no multi-data triggers reproduces the historical shorter call.
        // `basedOn` is `undefined` unless an explicit `BasedOn = @key`
        // meta-attr is present, so the legacy shorter forms still match.
        if (eventTriggerVars.length === 0 && dataTriggerVars.length === 0 && multiDataTriggerVars.length === 0)
        {
            this.line(
                `const ${styleVar} = new Style(${tt}, ${settersArr}, ${basedOn}, ${triggersArr}, ${multiTriggersArr});`);
        }
        else if (dataTriggerVars.length === 0 && multiDataTriggerVars.length === 0)
        {
            this.line(
                `const ${styleVar} = new Style(${tt}, ${settersArr}, ${basedOn}, ${triggersArr}, ${multiTriggersArr}, ${eventTriggersArr});`);
        }
        else if (multiDataTriggerVars.length === 0)
        {
            this.line(
                `const ${styleVar} = new Style(${tt}, ${settersArr}, ${basedOn}, ${triggersArr}, ${multiTriggersArr}, ${eventTriggersArr}, ${dataTriggersArr});`);
        }
        else
        {
            this.line(
                `const ${styleVar} = new Style(${tt}, ${settersArr}, ${basedOn}, ${triggersArr}, ${multiTriggersArr}, ${eventTriggersArr}, ${dataTriggersArr}, ${multiDataTriggersArr});`);
        }
        return styleVar;
    }

    // `Style [ TargetType = X, BasedOn = @Key ] { … }` → the JS expression
    // for the Style constructor's 3rd (basedOn) argument. Returns the
    // literal `'undefined'` when no `BasedOn` meta-attr is present.
    //
    // Two shapes, mirroring how `@key` resolves elsewhere:
    //   * base defined earlier in THIS same dictionary → the local JS var
    //     (a fully-constructed Style already in scope); passed eagerly.
    //   * base in another dictionary (a theme token like @TitleSmall, or a
    //     merged dict) → a THUNK `() => Application.current?.Resources
    //     .Resolve('Key')`. Resolution is deferred to Style.Seal (first
    //     apply) because the dictionary this Style lives in is often built
    //     before its theme is merged into Application.Resources — an eager
    //     Resolve would miss it. Style.Seal falls back to the implicit
    //     theme base if the thunk returns nothing.
    private compileStyleBasedOn(rf: ResourceForm): string
    {
        const m = rf.metaAttrs.find(
            a => a.path.parts.length === 1 && a.path.parts[0] === 'BasedOn');
        if (m === undefined) return 'undefined';
        if (m.value.kind !== 'static-resource')
        {
            throw new EmitError(
                "Style BasedOn must be a '@resource' reference "
                + '(e.g. BasedOn = @TitleSmall)', m.span);
        }
        const key = m.value.key;
        const localVar = this.localResourceVars?.get(key);
        if (localVar !== undefined) return localVar;
        this.ensureImport('Application');
        return `() => Application.current?.Resources.Resolve(${JSON.stringify(key)})`;
    }

    // ── EventTrigger emission ──────────────────────────────────────────
    //
    // Each `on Click { BeginStoryboard { Animation[...] } }` lowers to:
    //
    //   const _evt0 = new EventTrigger('Click', [
    //       new BeginStoryboardAction((_target) => {
    //           const _sb1 = new Storyboard();
    //           _sb1.Add(_target, 'Width', new DoubleAnimation({...}));
    //           return _sb1;
    //       }),
    //   ]);
    //
    // The Storyboard is built inside the BeginStoryboardAction's
    // factory so each Visual carrying the style gets a fresh Storyboard
    // instance per fire (a shared Storyboard would stomp itself when
    // multiple Buttons clicked simultaneously).
    private compileEventTriggerGroup(
        _targetType: string, et: EventTriggerGroup,
    ): string
    {
        this.ensureImport('EventTrigger');
        this.ensureImport('BeginStoryboardAction');
        this.ensureImport('Storyboard');

        const actionVars: string[] = [];
        for (const action of et.actions)
        {
            actionVars.push(this.compileTriggerAction(action));
        }
        const evtVar = this.fresh('evt');
        const actionsArr = `[${actionVars.join(', ')}]`;
        this.line(
            `const ${evtVar} = new EventTrigger(${JSON.stringify(et.eventName)}, ${actionsArr});`);
        return evtVar;
    }

    private compileTriggerAction(action: TriggerActionNode): string
    {
        switch (action.kind)
        {
            case 'begin-storyboard':  return this.compileBeginStoryboard(action);
            case 'stop-storyboard':   return this.compileStopStoryboard(action);
            case 'pause-storyboard':  return this.compilePauseStoryboard(action);
            case 'resume-storyboard': return this.compileResumeStoryboard(action);
            case 'invoke-command':    return this.compileInvokeCommand(action);
        }
    }

    // `InvokeCommand[Command=$SaveCommand]` lowers to:
    //   const _act0 = new InvokeCommandAction((_target) =>
    //       _target.DataContext?.SaveCommand);
    // The factory reads the command on every fire so VM-side replacement
    // of the command DP propagates without re-installing the trigger.
    // For multi-part paths (`$VM.Save.Command`) the chain uses optional
    // chaining so an unbound DataContext or missing intermediate stays
    // a silent no-op rather than throwing inside the dispatch loop.
    private compileInvokeCommand(node: InvokeCommandNode): string
    {
        this.ensureImport('InvokeCommandAction');
        const cmd = node.command;
        if (cmd.kind !== 'binding')
        {
            throw new EmitError(
                'InvokeCommand Command attribute must be a $-binding to an ICommand',
                node.span);
        }
        const v = this.fresh('act');
        const chain = cmd.path.map(p => `?.${p}`).join('');
        this.line(
            `const ${v} = new InvokeCommandAction((_target) => _target.DataContext${chain});`);
        return v;
    }

    private compileStopStoryboard(node: StopStoryboardNode): string
    {
        this.ensureImport('StopStoryboardAction');
        const v = this.fresh('act');
        this.line(
            `const ${v} = new StopStoryboardAction(${JSON.stringify(node.name)});`);
        return v;
    }

    private compilePauseStoryboard(node: PauseStoryboardNode): string
    {
        this.ensureImport('PauseStoryboardAction');
        const v = this.fresh('act');
        this.line(
            `const ${v} = new PauseStoryboardAction(${JSON.stringify(node.name)});`);
        return v;
    }

    private compileResumeStoryboard(node: ResumeStoryboardNode): string
    {
        this.ensureImport('ResumeStoryboardAction');
        const v = this.fresh('act');
        this.line(
            `const ${v} = new ResumeStoryboardAction(${JSON.stringify(node.name)});`);
        return v;
    }

    private compileBeginStoryboard(node: BeginStoryboardNode): string
    {
        if (node.animations.length === 0)
        {
            throw new EmitError(
                'BeginStoryboard requires at least one animation declaration', node.span);
        }
        // Ensure imports — covers both the EventTrigger path (which
        // imports them separately at compileEventTriggerGroup) and the
        // PropertyTrigger enter/exit path which calls in here directly.
        this.ensureImport('BeginStoryboardAction');
        this.ensureImport('Storyboard');
        const sbVar     = this.fresh('sb');
        const actionVar = this.fresh('act');
        // The factory body opens with an arrow-function closure that
        // closes over the firing Visual as `_target`. Indent bumps
        // (cosmetic — the emitted JS is single-pass parsed by the JS
        // engine regardless) so nested code reads as indented.
        const nameArg = node.name !== undefined
            ? `, ${JSON.stringify(node.name)}`
            : '';
        this.line(`const ${actionVar} = new BeginStoryboardAction((_target) => {`);
        this.indent += 4;
        this.line(`const ${sbVar} = new Storyboard();`);
        for (const anim of node.animations)
        {
            this.emitAnimationAdd(sbVar, anim);
        }
        this.line(`return ${sbVar};`);
        this.indent -= 4;
        this.line(`}${nameArg});`);
        return actionVar;
    }

    private emitAnimationAdd(sbVar: string, anim: AnimationDecl): void
    {
        this.ensureImport(anim.className);

        // TargetProperty / TargetName are structural — extract them
        // from the attr list so the animation constructor only sees
        // its real props bag.
        let targetProperty: string | undefined;
        let targetName:     string | undefined;
        const ctorAttrs: string[] = [];
        for (const attr of anim.attrs)
        {
            if (attr.kind === 'positional-attr')
            {
                throw new EmitError(
                    `animation '${anim.className}' does not accept positional attributes`,
                    attr.span);
            }
            const path = attr.path;
            if (path.parts.length !== 1)
            {
                throw new EmitError(
                    `animation '${anim.className}' attribute paths must be simple identifiers`,
                    attr.span);
            }
            const propName = path.parts[0]!;
            if (propName === 'TargetProperty')
            {
                if (attr.value.kind !== 'string' && attr.value.kind !== 'ident')
                {
                    throw new EmitError(
                        'TargetProperty must be a string or bare identifier',
                        attr.value.span);
                }
                targetProperty = attr.value.kind === 'string'
                    ? attr.value.value
                    : attr.value.name;
                continue;
            }
            if (propName === 'TargetName')
            {
                // TargetName redirects sb.Add to a NameScope-resolved
                // sibling. Resolved at trigger-fire time via
                // _target.FindName, which walks the visual ancestry to
                // find a NameScope hosting the name.
                if (attr.value.kind !== 'string' && attr.value.kind !== 'ident')
                {
                    throw new EmitError(
                        'TargetName must be a string or bare identifier',
                        attr.value.span);
                }
                targetName = attr.value.kind === 'string'
                    ? attr.value.value
                    : attr.value.name;
                continue;
            }
            const valueExpr = this.compileValue(attr.value, { propertyName: propName });
            ctorAttrs.push(`${propName}: ${valueExpr}`);
        }
        if (targetProperty === undefined)
        {
            throw new EmitError(
                `animation '${anim.className}' requires TargetProperty=...`,
                anim.span);
        }

        const ctorArgs = ctorAttrs.length > 0
            ? `{ ${ctorAttrs.join(', ')} }`
            : '';
        // Resolved target expression: TargetName → FindName lookup with
        // a `?? _target` fallback so a typo'd name silently animates
        // the firing Visual rather than throwing. The runtime warning
        // surface for this lives in the runtime — emitter stays purely
        // structural.
        const targetExpr = targetName !== undefined
            ? `(_target.FindName(${JSON.stringify(targetName)}) ?? _target)`
            : `_target`;
        this.line(
            `${sbVar}.Add(${targetExpr}, ${JSON.stringify(targetProperty)}, new ${anim.className}(${ctorArgs}));`);
    }

    private compileSetter(targetType: string, ps: PropertySetter): string
    {
        this.ensureImport('Setter');
        const owner = this.attrPathOwner(targetType, ps.path);
        this.ensureImport(owner);
        const propName = this.attrPathProperty(ps.path);
        // Style setters apply to many targets — no targetExpr; values
        // that need a host (DynamicResource) get wrapped in SetterFactory.
        const valueExpr = this.compileValue(ps.value, { propertyName: propName });
        const v = this.fresh('setter');
        this.line(
            `const ${v} = new Setter(${owner}, ${JSON.stringify(propName)}, ${valueExpr});`);
        return v;
    }

    private compileTriggerGroup(
        targetType: string, tg: TriggerGroup,
    ): { propertyTriggers: string[]; multiTriggers: string[]; dataTriggers: string[]; multiDataTriggers: string[] }
    {
        this.ensureImport(targetType);

        // Flatten the trigger expression to DNF — a list of conjuncts,
        // each of which is a list of TriggerTerms ANDed together.
        // Single-term conjuncts emit as PropertyTrigger; multi-term
        // conjuncts emit as MultiTrigger.
        const disjuncts = this.flattenToDNF(tg.condition);

        // Partition the body into property setters and `on enter` /
        // `on exit` action groups. Other event names (e.g. `on Click`)
        // are rejected inside a `when()` body — Click is a top-level
        // routed event, not a property-trigger edge.
        const { setterVars, enterActionVars, exitActionVars } =
            this.partitionTriggerBody(tg.setters.items, (ps) => this.compileSetter(targetType, ps));
        const settersArrVar = this.fresh('sArr');
        this.line(`const ${settersArrVar} = [${setterVars.join(', ')}];`);

        // Emit the enter/exit action arrays as locals so the (potentially
        // multiple) PropertyTriggers / MultiTriggers in the DNF expansion
        // can share the same array references.
        let enterArrVar = '[]';
        if (enterActionVars.length > 0)
        {
            enterArrVar = this.fresh('enter');
            this.line(`const ${enterArrVar} = [${enterActionVars.join(', ')}];`);
        }
        let exitArrVar = '[]';
        if (exitActionVars.length > 0)
        {
            exitArrVar = this.fresh('exit');
            this.line(`const ${exitArrVar} = [${exitActionVars.join(', ')}];`);
        }
        // Argument tail — omitted when both action lists are empty so
        // existing snapshot tests of the 4-arg PropertyTrigger form
        // stay matching.
        const triggerTail = (enterActionVars.length > 0 || exitActionVars.length > 0)
            ? `, ${enterArrVar}, ${exitArrVar}`
            : '';

        const propertyTriggers:  string[] = [];
        const multiTriggers:     string[] = [];
        const dataTriggers:      string[] = [];
        const multiDataTriggers: string[] = [];

        for (const conjunct of disjuncts)
        {
            if (conjunct.length === 1)
            {
                const term = conjunct[0]!;
                const valueExpr = this.evaluateTermValue(term);
                if (term.path !== undefined)
                {
                    // DataTrigger — `when($Path)` / `when($Path = expr)`.
                    // Watches the styled target's DataContext for `path`.
                    // Bare-boolean `not $Path` flows through
                    // evaluateTermValue's `term.value === null` branch
                    // which returns 'false' — emitted as
                    // `DataTrigger(path, false, …)` and compared via
                    // strict equality at runtime. The explicit-value
                    // negated form `not $Path = expr` is still rejected
                    // by evaluateTermValue (would need a `!=` mode on
                    // DataTrigger and isn't required for WPF parity —
                    // WPF DataTrigger has no Not mode either).
                    this.ensureImport('DataTrigger');
                    const v = this.fresh('dataTrig');
                    this.line(
                        `const ${v} = new DataTrigger(${JSON.stringify(term.path)}, ${valueExpr}, ${settersArrVar}${triggerTail});`);
                    dataTriggers.push(v);
                }
                else
                {
                    // Owner resolution — same shape as the
                    // ControlTemplate trigger path above. Style triggers
                    // also need to honour the class-prefix form
                    // `when (ThemeManager.Density = …)` so a TargetType-
                    // typed Style can observe an ambient inherited DP
                    // that doesn't live on the target's own class chain.
                    // Without this, the PropertyTrigger emits the Style
                    // target as the owner and resolveKey throws
                    // "Property 'Density' not found in owner
                    // 'ComboBoxItem'" at applyDefaultStyle time. PART-
                    // source forms (`PART_Foo.IsMouseOver`) aren't
                    // meaningful in a Style — there's no template-local
                    // x:name table to consult — so we only honour the
                    // class-prefix form here.
                    let ownerType = targetType;
                    if (term.sourceName !== undefined)
                    {
                        if (this.symbols.has(term.sourceName))
                        {
                            ownerType = term.sourceName;
                            this.ensureImport(ownerType);
                        }
                        else
                        {
                            throw new EmitError(
                                `when(${term.sourceName}.${term.property}): `
                                + `'${term.sourceName}' is not a known imported type. `
                                + `Style triggers only support the class-prefix form `
                                + `(PART-source triggers require a ControlTemplate context).`,
                                term.span);
                        }
                    }
                    this.ensureImport('PropertyTrigger');
                    const v = this.fresh('trigger');
                    this.line(
                        `const ${v} = new PropertyTrigger(${ownerType}, ${JSON.stringify(term.property)}, ${valueExpr}, ${settersArrVar}${triggerTail});`);
                    propertyTriggers.push(v);
                }
            }
            else
            {
                // Multi-term conjunct — partition by source kind. Pure-DP
                // conjuncts lower to MultiTrigger; pure-$path conjuncts
                // lower to MultiDataTrigger (WPF MultiDataTrigger parity).
                // Mixed DP+$path conjuncts are rejected — WPF has the
                // same split (its MultiTrigger.Conditions are property
                // Conditions; its MultiDataTrigger.Conditions are binding
                // Conditions; no mixing).
                let allPaths = true;
                let allProps = true;
                for (const term of conjunct)
                {
                    if (term.path !== undefined) allProps = false;
                    else                          allPaths = false;
                }
                if (!allPaths && !allProps)
                {
                    throw new EmitError(
                        "mixing $path terms and DP terms inside the same `when( … and … )` is not supported — split into separate when() blocks or use MultiTrigger / MultiDataTrigger styles",
                        conjunct[0]!.span);
                }
                if (allPaths)
                {
                    this.ensureImport('MultiDataTrigger');
                    const conditionExprs: string[] = [];
                    for (const term of conjunct)
                    {
                        const valueExpr = this.evaluateTermValue(term);
                        conditionExprs.push(
                            `{ path: ${JSON.stringify(term.path!)}, value: ${valueExpr} }`);
                    }
                    const v = this.fresh('multiDataTrig');
                    this.line(
                        `const ${v} = new MultiDataTrigger([${conditionExprs.join(', ')}], ${settersArrVar}${triggerTail});`);
                    multiDataTriggers.push(v);
                }
                else
                {
                    this.ensureImport('MultiTrigger');
                    const conditionExprs: string[] = [];
                    for (const term of conjunct)
                    {
                        const valueExpr = this.evaluateTermValue(term);
                        conditionExprs.push(
                            `{ propertyOwner: ${targetType}, propertyName: ${JSON.stringify(term.property)}, value: ${valueExpr} }`);
                    }
                    const v = this.fresh('multiTrig');
                    this.line(
                        `const ${v} = new MultiTrigger([${conditionExprs.join(', ')}], ${settersArrVar}${triggerTail});`);
                    multiTriggers.push(v);
                }
            }
        }
        return { propertyTriggers, multiTriggers, dataTriggers, multiDataTriggers };
    }

    // Emits a paired Attach/Detach action for one entry in a trigger's
    // Behaviors block. The factory closure wrapped by
    // AttachBehaviorAction re-invokes the entry's full compileElement
    // path each fire, so each (trigger, target) pair gets a fresh
    // Behavior with its own per-instance DPs.
    private compileTriggeredBehavior(entry: ElementNode): { attachVar: string; detachVar: string }
    {
        this.ensureImport('AttachBehaviorAction');
        this.ensureImport('DetachBehaviorAction');
        const attachVar = this.fresh('attBeh');
        const detachVar = this.fresh('detBeh');
        this.line(`const ${attachVar} = new AttachBehaviorAction(() => {`);
        this.indent += 4;
        const behaviorVar = this.compileElement(entry);
        this.line(`return ${behaviorVar};`);
        this.indent -= 4;
        this.line(`});`);
        this.line(`const ${detachVar} = new DetachBehaviorAction(${attachVar});`);
        return { attachVar, detachVar };
    }

    private evaluateTermValue(term: TriggerTermLite): string
    {
        if (term.presence !== undefined)
        {
            // `P is unset` / `P is set` — emit the runtime sentinel; the
            // trigger match routes nullish / non-nullish through
            // triggerConditionMet instead of strict equality.
            if (term.negated)
            {
                throw new EmitError(
                    "'not' can't combine with 'is set' / 'is unset' — use the opposite predicate",
                    term.span);
            }
            const sym = term.presence === TriggerPresence.Unset ? 'TriggerUnset' : 'TriggerSet';
            this.ensureImport(sym);
            return sym;
        }
        if (term.value === null)
        {
            // Bare property — bool trigger. `not P` matches when P is false.
            return term.negated ? 'false' : 'true';
        }
        if (term.negated)
        {
            throw new EmitError(
                "'not' is only supported on bare boolean properties (no explicit value)",
                term.span);
        }
        return this.compileValue(term.value, { propertyName: term.property });
    }

    // Flatten an arbitrary trigger expression to disjunctive normal
    // form: a list of conjuncts (each conjunct is a list of TriggerTerms
    // ANDed). Distributes AND over OR, so `(A or B) and C` becomes
    // `[[A, C], [B, C]]`.
    private flattenToDNF(expr: TriggerExpr): TriggerTermLite[][]
    {
        if (expr.kind === 'trigger-term')
        {
            return [[{ property:   expr.property,
                       sourceName: expr.sourceName,
                       path:       expr.path,
                       value:      expr.value,
                       presence:   expr.presence,
                       negated:    expr.negated,
                       span:       expr.span }]];
        }
        if (expr.kind === 'trigger-or')
        {
            return [...this.flattenToDNF(expr.left), ...this.flattenToDNF(expr.right)];
        }
        // trigger-and: distribute over OR.
        const left  = this.flattenToDNF(expr.left);
        const right = this.flattenToDNF(expr.right);
        const out: TriggerTermLite[][] = [];
        for (const l of left)
        {
            for (const r of right)
            {
                out.push([...l, ...r]);
            }
        }
        return out;
    }

    // ── Element emission ───────────────────────────────────────────

    private compileElement(elem: ElementNode): string
    {
        // Macro invocation? Expand and recurse on the substituted tree.
        const macro = this.macros.get(elem.name);
        if (macro !== undefined)
        {
            const expanded = this.expandMacro(elem, macro);
            return this.compileElement(expanded);
        }

        this.ensureImport(elem.name);

        // x:named elements in the current template scope reuse the var
        // pre-allocated by collectTemplateXNames — the `let` was emitted
        // at the top of the factory body so forward x:name refs can
        // lexically capture it. Initialize via assignment (no `const`)
        // so the hoisted binding picks up the new value.
        let v: string;
        let preallocated = false;
        const xName = this.findXAttr(elem.xAttrs, 'name');
        if (xName !== null
            && xName.value !== null && xName.value.kind === 'string'
            && this.templateNameVars !== undefined)
        {
            const nameStr = xName.value.value as string;
            const pre = this.templateNameVars.get(nameStr);
            if (pre !== undefined)
            {
                v = pre;
                preallocated = true;
            }
            else
            {
                v = this.fresh(this.varHint(elem.name));
            }
        }
        else
        {
            v = this.fresh(this.varHint(elem.name));
        }
        if (preallocated)
        {
            this.line(`${v} = new ${elem.name}();`);
        }
        else
        {
            this.line(`const ${v} = new ${elem.name}();`);
        }

        // ── x:* meta attributes ────────────────────────────────────
        // Handle these BEFORE the body compiles so the NameScope is
        // already attached to the root by the time descendant elements
        // attempt to register their x:name.
        this.applyXAttrs(v, elem);

        for (const attr of elem.attrs)
        {
            this.compileAttribute(v, elem.name, attr);
        }

        if (elem.body !== null && elem.body.kind === 'structured-body')
        {
            this.compileElementBody(v, elem.name, elem.body);
        }
        else if (elem.body !== null && elem.body.kind === 'string-body')
        {
            const slot = this.slots.get(elem.name);
            if (slot === undefined || slot.kind !== 'string')
            {
                throw new EmitError(
                    `${elem.name} cannot receive a text body`,
                    elem.body.span);
            }
            // Text-only body emits a plain string literal; a body that
            // mixes text with `{{ … }}` chunks falls through to the
            // shared lowering so the converter sees both sides.
            const hasInlineExpr = elem.body.chunks.some(c => c.kind === 'inline-expr');
            if (!hasInlineExpr)
            {
                const text = elem.body.chunks
                    .map(c => c.kind === 'text-chunk' ? c.text : '')
                    .join('');
                this.emitSetDP(v, undefined, elem.name, slot.name, JSON.stringify(text), elem.body.span);
            }
            else
            {
                const expr = this.compileMixedTextBody(elem.body, { targetExpr: v });
                this.emitSetDP(v, undefined, elem.name, slot.name, expr, elem.body.span);
            }
        }
        return v;
    }

    // ── Macros ─────────────────────────────────────────────────────

    // Bind invocation args to macro params, then walk the macro body
    // cloning + substituting holes. Returns a fresh ElementNode that
    // compileElement processes normally.
    private expandMacro(invocation: ElementNode, macro: DefForm): ElementNode
    {
        const subst = this.bindMacroArgs(invocation, macro);
        return this.substElement(macro.body, subst);
    }

    private bindMacroArgs(invocation: ElementNode, macro: DefForm): MacroSubst
    {
        const subst: MacroSubst = new Map();

        // Named params (declared as `#bg`, `#title`, …) — filled in
        // order from the invocation's POSITIONAL attrs.
        const namedParams      = macro.params.filter(p => !p.positional);
        const positionalAttrs  = invocation.attrs.filter(a => a.kind === 'positional-attr');
        const namedAttrs       = invocation.attrs.filter(a => a.kind === 'named-attr');

        if (namedAttrs.length > 0)
        {
            throw new EmitError(
                `macro '${macro.name}': named-argument invocation is not supported in v0 (use positional)`,
                namedAttrs[0]!.span);
        }
        if (positionalAttrs.length > namedParams.length)
        {
            throw new EmitError(
                `macro '${macro.name}': too many positional arguments (expected ${namedParams.length})`,
                invocation.span);
        }

        for (let i = 0; i < namedParams.length; i++)
        {
            const param = namedParams[i]!;
            const arg = positionalAttrs[i];
            if (arg !== undefined)
            {
                subst.set(param.holeName, { kind: 'value', value: arg.value });
            }
            else if (param.defaultValue !== null)
            {
                subst.set(param.holeName, { kind: 'value', value: param.defaultValue });
            }
            else
            {
                throw new EmitError(
                    `macro '${macro.name}': missing required argument #${param.holeName}`,
                    invocation.span);
            }
        }

        // Positional param (typically `#1`) — bound to the invocation's
        // content body. By convention only one positional param is used
        // (the implicit content slot); additional positional declarations
        // would have no way to be filled from the invocation surface and
        // are rejected here as a programmer error.
        const positionalParams = macro.params.filter(p => p.positional);
        if (positionalParams.length > 1)
        {
            throw new EmitError(
                `macro '${macro.name}': more than one positional content param is not supported`,
                macro.span);
        }
        const contentItems: BodyItem[] =
            (invocation.body !== null && invocation.body.kind === 'structured-body')
                ? invocation.body.items
                : [];
        if (positionalParams.length === 1)
        {
            subst.set(positionalParams[0]!.holeName,
                      { kind: 'body', items: contentItems });
        }
        else if (contentItems.length > 0)
        {
            throw new EmitError(
                `macro '${macro.name}': has body content but no content slot (#1) declared`,
                invocation.span);
        }
        return subst;
    }

    // Walk an ElementNode and produce a fresh copy with holes
    // substituted. The recursion mirrors the AST structure.
    private substElement(elem: ElementNode, subst: MacroSubst): ElementNode
    {
        return {
            kind:   'element',
            name:   elem.name,
            xAttrs: elem.xAttrs.map(x => this.substXAttr(x, subst)),
            attrs:  elem.attrs .map(a => this.substAttr (a, subst)),
            body:   elem.body === null
                ? null
                : (elem.body.kind === 'string-body'
                    ? elem.body
                    : {
                        kind: 'structured-body',
                        items: elem.body.items.flatMap(it => this.substBodyItem(it, subst)),
                        span:  elem.body.span,
                      }),
            span: elem.span,
        };
    }

    private substAttr(attr: Attribute, subst: MacroSubst): Attribute
    {
        if (attr.kind === 'positional-attr')
        {
            return { ...attr, value: this.substValue(attr.value, subst) };
        }
        return { ...attr, value: this.substValue(attr.value, subst) };
    }

    private substXAttr(attr: XAttr, subst: MacroSubst): XAttr
    {
        return {
            ...attr,
            value: attr.value === null ? null : this.substValue(attr.value, subst),
        };
    }

    private substValue(val: ValueNode, subst: MacroSubst): ValueNode
    {
        if (val.kind === 'macro-hole')
        {
            const bound = subst.get(val.name);
            if (bound === undefined)
            {
                throw new EmitError(
                    `macro hole #${val.name} is not bound`, val.span);
            }
            if (bound.kind === 'body')
            {
                throw new EmitError(
                    `macro hole #${val.name} was bound to body content; can't use in value position`,
                    val.span);
            }
            return bound.value;
        }
        // A `#name` token inside a def body lexes as ColorValue when
        // the `name` is letter-starting (the parser can't know it's a
        // macro reference without seeing the surrounding def). At
        // expansion time we can disambiguate: if `name` matches a bound
        // macro param, substitute; otherwise leave as a real colour.
        if (val.kind === 'color')
        {
            const bound = subst.get(val.raw);
            if (bound !== undefined)
            {
                if (bound.kind === 'body')
                {
                    throw new EmitError(
                        `macro hole #${val.raw} was bound to body content; can't use in value position`,
                        val.span);
                }
                return bound.value;
            }
            return val;
        }
        if (val.kind === 'tuple')
        {
            return {
                ...val,
                values: val.values.map(v => this.substValue(v, subst)),
            };
        }
        if (val.kind === 'list')
        {
            return {
                ...val,
                values: val.values.map(v => this.substValue(v, subst)),
            };
        }
        if (val.kind === 'size')
        {
            return {
                ...val,
                width:  this.substValue(val.width, subst),
                height: this.substValue(val.height, subst),
            };
        }
        return val;
    }

    private substBodyItem(item: BodyItem, subst: MacroSubst): BodyItem[]
    {
        if (item.kind === 'macro-hole-body-item')
        {
            const bound = subst.get(item.name);
            if (bound === undefined)
            {
                throw new EmitError(
                    `macro hole #${item.name} is not bound`, item.span);
            }
            if (bound.kind === 'value')
            {
                throw new EmitError(
                    `macro hole #${item.name} was bound to a value; can't use in body position`,
                    item.span);
            }
            // Substituted content items are themselves visited so a
            // macro can splice in items that reference other holes.
            return bound.items.flatMap(it => this.substBodyItem(it, subst));
        }
        if (item.kind === 'element')
        {
            return [this.substElement(item, subst)];
        }
        if (item.kind === 'slot-assign')
        {
            const newValue = ('kind' in item.value && item.value.kind === 'structured-body')
                ? {
                    kind: 'structured-body' as const,
                    items: item.value.items.flatMap(i => this.substBodyItem(i, subst)),
                    span:  item.value.span,
                  }
                : this.substValue(item.value as ValueNode, subst);
            return [{ ...item, value: newValue }];
        }
        if (item.kind === 'key-value-resource')
        {
            return [{ ...item, value: this.substValue(item.value, subst) }];
        }
        // resource-form / def-form: pass through unchanged for v0.
        return [item];
    }

    // Emit a typed-key DP write. Resolves the property's registering
    // class via MuralBase.find_class + findDescriptor at compile time and
    // emits `target.set_property_value(Owner.PropKey, value)` against
    // the convention that every DP is exposed as `${Owner}.${Name}Key`.
    //
    // `ownerClassName` is set when the markup used the two-part
    // attached-property form `Owner.Prop`; for the single-name form,
    // pass undefined and `targetClassName` is used for the lookup
    // (which walks the prototype chain to find the descriptor).
    //
    // Static-field inheritance: when the registering class sits in
    // `targetClass`'s constructor [[Prototype]] chain (i.e. `targetClass
    // extends RegisteringClass`), JS resolves `targetClass.PropKey` to
    // the inherited static — so the emit can name the markup class
    // directly instead of leaking the (possibly internal) base. For
    // cross-class inheritable DPs (target is unrelated to the registering
    // class — e.g. `Foreground` on a `Border`), the emit must name the
    // registering class because static-field inheritance doesn't reach
    // across siblings.
    private emitSetDP(
        targetVar:        string,
        ownerClassName:   string | undefined,
        targetClassName:  string,
        propName:         string,
        valueExpr:        string,
        span:             SourceSpan,
    ): void
    {
        const lookupClassName = ownerClassName ?? targetClassName;
        const lookupClass = resolveClassByName(lookupClassName);
        if (lookupClass === undefined)
        {
            throw new EmitError(
                `Cannot resolve class '${lookupClassName}' for property '${propName}'. `
                + `The class must be registered (typically via a side-effect import in compiler.ts) `
                + `before compile() runs.`,
                span);
        }
        const descriptor = findDescriptor(lookupClass, propName);
        if (descriptor === undefined)
        {
            // Plain value-object classes (KeyBinding / MouseBinding /
            // CommandBinding) aren't MuralBase/DP subclasses — they carry
            // ordinary fields, so a DP write would fail. Emit a direct
            // field assignment instead. Restricted to the single-name
            // attribute form (attached `Owner.Prop` syntax only applies to
            // DP classes). A *MuralBase* class with an unknown property is a
            // genuine authoring error and still throws.
            if (ownerClassName === undefined && !isDependencyObjectClass(lookupClass))
            {
                this.line(`${targetVar}.${propName} = ${valueExpr};`);
                return;
            }
            throw new EmitError(
                `Property '${propName}' not registered on class '${lookupClassName}' or any ancestor.`,
                span);
        }
        const rootOwner   = descriptor.RootOwner;
        // Prefer the markup class name (works via JS static inheritance
        // when the lookup class is a descendant of RootOwner). Falls back
        // to the registering class for the cross-class inheritable case.
        const emitClass   = isStaticAncestor(lookupClass, rootOwner)
            ? lookupClassName
            : rootOwner.name;
        this.ensureImport(emitClass);
        this.line(
            `${targetVar}.set_property_value(${emitClass}.${propName}Key, ${valueExpr});`);
    }

    private compileAttribute(targetVar: string, parentClass: string, attr: Attribute): void
    {
        if (attr.kind === 'positional-attr')
        {
            throw new EmitError(
                'positional attributes only apply to macros (not supported in v0)',
                attr.span);
        }
        if (attr.path.parts.length === 2)
        {
            const ownerType = attr.path.parts[0]!;
            const propName  = attr.path.parts[1]!;
            const valueExpr = this.compileValue(attr.value, {
                propertyName: propName,
                targetExpr:   targetVar,
            });
            this.emitSetDP(targetVar, ownerType, parentClass, propName, valueExpr, attr.span);
            return;
        }
        const propName = attr.path.parts[0]!;
        const valueExpr = this.compileValue(attr.value, {
            propertyName: propName,
            targetExpr:   targetVar,
        });
        this.emitSetDP(targetVar, undefined, parentClass, propName, valueExpr, attr.span);
    }

    private compileElementBody(parentVar: string, parentClass: string, body: StructuredBody): void
    {
        const slot = this.slots.get(parentClass);
        for (const item of body.items)
        {
            if (item.kind === 'slot-assign')
            {
                if (item.name === 'resources')
                {
                    this.compileResourcesSlot(`${parentVar}.Resources`, item);
                    continue;
                }
                // Inline template at the value position — emit an
                // anonymous template (no x:key) and assign the resulting
                // var to the slot. Lets consumers write
                //   ListBox { ItemsPanel: ItemsPanelTemplate { WrapPanel[…] } }
                // without registering a keyed dictionary entry just to
                // reference it once.
                if (typeof item.value === 'object' && 'kind' in item.value
                    && item.value.kind === 'resource-form')
                {
                    const tmplVar = this.compileInlineTemplateValue(item.value);
                    this.emitSetDP(parentVar, undefined, parentClass, item.name, tmplVar, item.span);
                    continue;
                }
                // Non-resources slot — set as a regular property.
                if (typeof item.value === 'object' && 'kind' in item.value
                    && item.value.kind === 'structured-body')
                {
                    throw new EmitError(
                        `SlotAssign '${item.name}': nested element bodies are not supported in v0`,
                        item.span);
                }
                const expr = this.compileValue(item.value as ValueNode, {
                    propertyName: item.name,
                    targetExpr:   parentVar,
                });
                this.emitSetDP(parentVar, undefined, parentClass, item.name, expr, item.span);
                continue;
            }
            if (item.kind === 'text-chunk-body-item')
            {
                // Quoted text among inline children → `new Run("…")` added
                // to the parent's Inlines. Only inline hosts (Inlines list
                // default slot: TextBlock / Span / Bold / … ) accept it.
                if (slot?.kind !== 'list' || slot.name !== 'Inlines')
                {
                    throw new EmitError(
                        `text content is only allowed inside an inline host `
                        + `(TextBlock, Span, Bold, …); ${parentClass} does not accept it`,
                        item.span);
                }
                this.ensureImport('Run');
                const runVar = this.fresh('run');
                this.line(`const ${runVar} = new Run(${JSON.stringify(item.value)});`);
                this.assignToDefaultSlot(parentVar, parentClass, slot, runVar, item.span);
                continue;
            }
            if (item.kind === 'member-block')
            {
                this.compileMemberBlock(parentVar, item);
                continue;
            }
            if (item.kind === 'services-block')
            {
                if (parentClass === 'ShellModule')
                {
                    // `.services:` inside a `module { … }` body: the module has
                    // no live provider — it RECORDS each registration
                    // (AddRegistration) and replays them into the app root when
                    // it is composed onto Application.Modules
                    // (Application.registerModuleServices). This is the module's
                    // "register services" seam; a Capability's `ServiceKey` then
                    // references one of these registered tokens.
                    this.compileModuleServicesBlock(parentVar, item);
                    continue;
                }
                // `.services:` on a non-Application element targets that
                // element's own `Services` provider (e.g. a scope-owning
                // host). Runtime-errors if the element exposes none.
                this.compileServicesBlock(`${parentVar}.Services`, item);
                continue;
            }
            if (item.kind === 'element')
            {
                // `Behaviors { … }` block — not a default-slot child;
                // each entry in the body is a Behavior class instance
                // to attach to the parent via Visual.AddBehavior. The
                // compiler routes each inner element through the normal
                // compileElement pipeline (so DPs / setters / bindings
                // all work) and then emits a single AddBehavior call.
                if (item.name === 'Behaviors')
                {
                    this.compileBehaviorsBlock(parentVar, item);
                    continue;
                }
                // Property-collection blocks — `ColumnDefinitions { … }`
                // and `RowDefinitions { … }` under Grid. The block isn't
                // itself an element to instantiate; each inner element is
                // appended to the named ObservableCollection on the parent
                // (Grid.ColumnDefinitions / Grid.RowDefinitions). Mirrors
                // XAML's property-element syntax for collection-typed
                // properties.
                //
                // Scoped to Grid by spec, but the compiler doesn't enforce
                // the parent type: any parent exposing a matching
                // `Xxx.Add(child)` API would accept it. An invalid parent
                // (e.g., `StackPanel { ColumnDefinitions { … } }`) emits
                // code that TypeErrors at runtime — appropriate for an
                // authoring mistake the symbol-table couldn't catch.
                if (item.name === 'ColumnDefinitions' || item.name === 'RowDefinitions')
                {
                    this.compilePropertyCollectionBlock(parentVar, item.name, item);
                    continue;
                }
                // InputBindings { KeyBinding[…] / MouseBinding[…] } and
                // CommandBindings { CommandBinding[…] } — per-instance
                // gesture / command tables on a Control. Each inner element
                // is appended to the (array-backed) collection.
                if (item.name === 'InputBindings' || item.name === 'CommandBindings')
                {
                    this.compilePropertyCollectionBlock(parentVar, item.name, item);
                    continue;
                }
                // Transitions { PropertyTransition[...] } — implicit per-DP
                // animation specs. Each inner element gets pushed into the
                // parent Visual's Transitions ObservableCollection (lazy-
                // allocated on first access via the JS getter).
                if (item.name === 'Transitions')
                {
                    this.compilePropertyCollectionBlock(parentVar, 'Transitions', item);
                    continue;
                }
                // Ribbon's secondary collections — `ContextualGroups {
                // RibbonContextualGroup[…] }` and `QuickAccessItems {
                // RibbonButton[…] }`. Ribbon's DEFAULT slot is Tabs (stable
                // tabs go straight in the body), so these two live in
                // property-element blocks appended to the matching
                // ObservableCollection on the Ribbon.
                if (item.name === 'ContextualGroups' || item.name === 'QuickAccessItems')
                {
                    this.compilePropertyCollectionBlock(parentVar, item.name, item);
                    continue;
                }
                const childVar = this.compileElement(item);
                this.assignToDefaultSlot(parentVar, parentClass, slot, childVar, item.span);
                continue;
            }
            throw new EmitError(
                `${item.kind} is not allowed in an element body`,
                'span' in item ? item.span : body.span);
        }
    }

    // Lowers a `Behaviors { … }` block. Each child element is a
    // Behavior class instance — constructed, populated with its
    // setters, then attached to `parentVar` via AddBehavior. Behaviors
    // are class-based (subclass `Behavior`), so registering a behavior
    // class is symmetric with registering a control class — both go
    // through the symbol table's import map.
    private compileBehaviorsBlock(parentVar: string, behaviorsElem: ElementNode): void
    {
        if (behaviorsElem.attrs.length > 0)
        {
            throw new EmitError(
                "Behaviors { … } block doesn't take attributes — attach Behavior instances inside the body",
                behaviorsElem.span);
        }
        const body = behaviorsElem.body;
        if (body === null || body.kind !== 'structured-body')
        {
            // An empty Behaviors block is a no-op; only structured
            // bodies (zero or more child Behavior elements) make sense
            // here. A string body would be authoring noise.
            if (body !== null) {
                throw new EmitError(
                    "Behaviors block must contain Behavior element entries",
                    behaviorsElem.span);
            }
            return;
        }
        this.emitBehaviorAttachments(parentVar, body);
    }

    // Shared lowering for both the `Behaviors { … }` braces form and the
    // `.Behaviors: { … }` member-section form: each child element is a
    // Behavior instance, constructed + populated, then attached to the
    // parent via AddBehavior.
    private emitBehaviorAttachments(parentVar: string, body: StructuredBody): void
    {
        for (const child of body.items)
        {
            if (child.kind !== 'element')
            {
                throw new EmitError(
                    `Behaviors block only accepts Behavior element entries (got ${child.kind})`,
                    'span' in child ? child.span : body.span);
            }
            const behaviorVar = this.compileElement(child);
            this.line(`${parentVar}.AddBehavior(${behaviorVar});`);
        }
    }

    // Lowers a property-collection block like
    //   `Grid { ColumnDefinitions { ColumnDefinition[Width=Auto] … } }`
    // — each inner element is compiled and appended to the named
    // ObservableCollection on `parentVar` via `.Add(child)`. Behavioural
    // sibling of compileBehaviorsBlock; differs in that the inner
    // elements aren't Behaviors (no AddBehavior contract) — they're
    // regular collection items.
    // Lowers a `.Member: { … }` dotted aggregate-property block. The
    // generic form appends each element entry to the surrounding
    // element's `Member` collection (an ObservableCollection DP) via
    // `.Add(child)` — the same shape as `compilePropertyCollectionBlock`,
    // but reached through the dotted member syntax rather than a bespoke
    // keyword. Named members will branch here for custom lowering (the
    // `services` member lands in a follow-up).
    // Lowers a `.services: { … }` block against a `Services` provider
    // (`providerExpr`, e.g. `app.Services`). Each entry registers an
    // implementation under a token; see ServiceEntry for the grammar.
    //
    // Token resolution is done at RUNTIME via `ServiceProvider.tokenFor`
    // (impl's static `Key` ?? the class itself) rather than at compile
    // time, so app-defined service classes the compiler can't load still
    // register under the same token `addInstance` / code registration use.
    // Lowers a `.modules: { … }` block on the Application. Each entry is the
    // identifier of an imported `module NAME { … }` const — added, in order,
    // to `Application.Modules`. ensureImport resolves the entry against the
    // file's top-level `import NAME from "…"` clause.
    private compileModulesBlock(appVar: string, block: ModulesBlock): void
    {
        for (const name of block.entries)
        {
            this.ensureImport(name);
            this.line(`${appVar}.Modules.Add(${name});`);
        }
    }

    private compileServicesBlock(providerExpr: string, block: ServicesBlock): void
    {
        // Registration is always LAZY (deferred to first resolve), so every
        // sibling in this block is registered before any ctor runs — a service
        // may depend on a later sibling without an ordering hazard.
        for (const e of block.entries)
        {
            const { tokenExpr, factory, lifetime } = this.compileServiceEntry(e);
            if (lifetime === 'scoped')
            {
                this.line(`${providerExpr}.registerScoped(${tokenExpr}, ${factory});`);
            }
            else if (lifetime === 'transient')
            {
                this.line(`${providerExpr}.registerTransient(${tokenExpr}, ${factory});`);
            }
            else
            {
                this.line(`${providerExpr}.register(${tokenExpr}, ${factory}, 'singleton');`);
            }
        }
    }

    // A `.services:` block inside a `module { … }` body. The module has no live
    // provider at declaration time, so each entry is RECORDED on the module
    // (`AddRegistration(token, factory, lifetime)`) and replayed into the app
    // root when the module is added to `Application.Modules`. Same token /
    // factory shape as a live `.services:` block — only the sink differs.
    private compileModuleServicesBlock(moduleVar: string, block: ServicesBlock): void
    {
        for (const e of block.entries)
        {
            const { tokenExpr, factory, lifetime } = this.compileServiceEntry(e);
            this.line(`${moduleVar}.AddRegistration(${tokenExpr}, ${factory}, '${lifetime}');`);
        }
    }

    // Compile one `.services:` entry to its token expression, lazy factory, and
    // lifetime string. Shared by the live-provider lowering (compileServicesBlock)
    // and the module-record lowering (compileModuleServicesBlock).
    //
    // The factory parameter is the RESOLVING scope. Every service ctor takes the
    // provider (the IServiceProvider contract), so construction is uniformly
    // `new Impl(p)`: the service resolves its own collaborators from `p`.
    private compileServiceEntry(e: ServiceEntry): { tokenExpr: string; factory: string; lifetime: string }
    {
        const FP = 'p';
        this.ensureImport(e.impl);
        this.ensureImport('ServiceProvider');

        // Token expression — always through `tokenFor` (explicit `-> Token` or
        // the impl itself), so registration and `$service(Token)` consumption
        // agree: a token class with a static `Key` registers/resolves under that
        // Key, a token constant passes through unchanged.
        const tokenSym  = e.token ?? e.impl;
        if (e.token !== undefined) this.ensureImport(e.token);
        const tokenExpr = `ServiceProvider.tokenFor(${tokenSym})`;

        // Bare entry → a one-liner `(p) => new Impl(p)`. An inline-config block →
        // a constructing arrow that seeds/injects each property through its JS
        // setter before returning the instance.
        let factory: string;
        if (e.config !== undefined && e.config.length > 0)
        {
            const assigns = e.config
                .map((c) => `_s.${c.name} = ${this.compileServiceConfigValue(FP, c)};`)
                .join(' ');
            factory = `(${FP}) => { const _s = new ${e.impl}(${FP}); ${assigns} return _s; }`;
        }
        else
        {
            factory = `(${FP}) => new ${e.impl}(${FP})`;
        }
        return { tokenExpr, factory, lifetime: e.lifetime ?? 'singleton' };
    }

    // One inline-config value for a `.services:` entry. A `$service(Token)`
    // value is resolved EAGERLY from the factory's provider (explicit
    // property injection) — NOT a reactive ServiceBinding; the service is
    // wired once at construction. An optional dotted tail reads a property of
    // the resolved service (`$service(IDoc).Title`). Everything else is a
    // literal compiled in a target-less context. Reactive/contextual value
    // forms (DataContext `$path`, `@resource`, `$Self`) have no meaning at
    // factory time and are rejected.
    private compileServiceConfigValue(providerParam: string, c: ServiceConfigEntry): string
    {
        const v = c.value;
        if (v.kind === 'binding')
        {
            if (v.source !== 'service')
            {
                throw new EmitError(
                    `service config '${c.name}': only literals or $service(Token) are `
                    + `allowed (no DataContext / $Self bindings — there is no target here).`,
                    c.span);
            }
            this.ensureImport('ServiceProvider');
            this.ensureImport(v.serviceToken!);
            const resolved = `${providerParam}.getRequired(ServiceProvider.tokenFor(${v.serviceToken}))`;
            // `$service(Token)` → the service itself; `$service(Token).a.b` →
            // an eager read of that property path off the resolved service.
            return v.path.length > 0 ? `${resolved}.${v.path.join('.')}` : resolved;
        }
        if (v.kind === 'static-resource' || v.kind === 'dynamic-resource')
        {
            throw new EmitError(
                `service config '${c.name}': @resource values need a target visual `
                + `and aren't available at service-construction time.`,
                c.span);
        }
        return this.compileValue(v, {});
    }

    // `.Member: { … }` fills a complex aggregate property by one of two
    // strategies, chosen by the body's shape:
    //
    //   * LIST — bare elements (no `x:key`) append to `target.Member` via
    //     `.Add(child)` (the ObservableCollection contract). The original
    //     form; reproduces the bespoke `ColumnDefinitions { … }` lowering.
    //   * DICTIONARY — KEYED entries (`@Key = value`, or an element/resource
    //     carrying `x:key="K"`) set into `target.Member` via `.Set(key,
    //     value)` (the ResourceDictionary-shaped contract). The same keyed
    //     surface `resources:` uses, behind the general `.Member:` syntax —
    //     so a dictionary-shaped DP can be authored without a bespoke
    //     keyword.
    //
    // The two are mutually exclusive: a body is a dictionary as soon as ONE
    // keyed entry appears, and then every entry must be keyed.
    private compileMemberBlock(parentVar: string, block: MemberBlock): void
    {
        // `.Behaviors:` — the colon-section spelling of the `Behaviors { … }`
        // block, conformed to the `.services:` / `.Resources:` syntax. Same
        // class-based lowering (each entry → AddBehavior); the braces form
        // stays as a back-compat alias.
        if (block.name === 'Behaviors')
        {
            this.emitBehaviorAttachments(parentVar, block.body);
            return;
        }
        // `.settings:` / `.documents:` / `.commands:` are the lowercase spellings
        // (paralleling the `.services:` / `.modules:` module-composition blocks)
        // of a ShellModule's `Settings` / `Documents` / `Commands` collections. A
        // generic member-block otherwise uses its name verbatim as the accessor,
        // so remap these to the PascalCase property the module exposes → the emit
        // is `module.Settings.Add(def)` / `.Documents.Add(def)` / `.Commands.Add(def)`.
        const memberName = block.name === 'settings'         ? 'Settings'
                         : block.name === 'documents'        ? 'Documents'
                         : block.name === 'commands'         ? 'Commands'
                         : block.name === 'projectFactories' ? 'ProjectFactories'
                         : block.name;
        const accessor = `${parentVar}.${memberName}`;
        if (this.isDictionaryMemberBody(block.body))
        {
            // Dictionary strategy — the SAME keyed surface `resources:`
            // populates. Delegated to `compileResourcesBody` (§25 fold) so a
            // `.Member:` dictionary handles EVERY resource entry kind
            // identically to a `resources:` block: `@Key = value`, x:key'd
            // (or x:root) elements, Style / Template / DataTemplate
            // resource-forms (with implicit type-keys), `include`, `glyphs`.
            // The accessor is passed straight through as the dictionary
            // expression, so the emit stays `parent.Member.Set(key, value)`
            // (one getter read per entry, matching the prior behavior).
            //
            // Guard the one case the generic router phrases less helpfully:
            // a BARE element (no x:key / x:root) mixed into a keyed block.
            // Resource-forms are exempt — a `Style [TargetType=…]` keys
            // itself implicitly by its target type.
            for (const item of block.body.items)
            {
                if (item.kind === 'element'
                    && this.findXAttr(item.xAttrs, 'key')  === null
                    && this.findXAttr(item.xAttrs, 'root') === null)
                {
                    throw new EmitError(
                        `.${block.name}: this dictionary block mixes keyed and unkeyed `
                        + `entries — every element needs an x:key once any entry is keyed.`,
                        item.span);
                }
            }
            this.compileResourcesBody(accessor, block.body);
            return;
        }

        // List strategy — bare elements appended in order.
        for (const child of block.body.items)
        {
            if (child.kind !== 'element')
            {
                throw new EmitError(
                    `.${block.name}: block only accepts element entries (got ${child.kind})`,
                    'span' in child ? child.span : block.span);
            }
            const childVar = this.compileElement(child);
            this.line(`${accessor}.Add(${childVar});`);
        }
    }

    // A `.Member:` body is a DICTIONARY (keyed) the moment any entry carries
    // — or implies — a key: a `@Key = value` primitive, an element with
    // `x:key`, or a resource-form / `include` / `glyphs` entry (all of which
    // are inherently keyed dictionary contributions, never list children).
    private isDictionaryMemberBody(body: StructuredBody): boolean
    {
        return body.items.some(it =>
            it.kind === 'key-value-resource'
            || it.kind === 'resource-form'
            || it.kind === 'include-form'
            || it.kind === 'glyphs-form'
            || it.kind === 'fonts-form'
            || (it.kind === 'element' && this.findXAttr(it.xAttrs, 'key') !== null));
    }

    private compilePropertyCollectionBlock(
        parentVar: string,
        propertyName: string,
        blockElem: ElementNode,
    ): void
    {
        if (blockElem.attrs.length > 0)
        {
            throw new EmitError(
                `${propertyName} { … } block doesn't take attributes — `
                + `attach instances inside the body`,
                blockElem.span);
        }
        const body = blockElem.body;
        if (body === null || body.kind !== 'structured-body')
        {
            if (body !== null)
            {
                throw new EmitError(
                    `${propertyName} block must contain element entries`,
                    blockElem.span);
            }
            return;
        }
        // § 1.16 — `Transitions` getter is now pure (returns | undefined);
        // the mutator path goes through `EnsureTransitions()`. Special-
        // case the emit so a `Transitions { … }` block lazy-allocates
        // the collection.
        const accessor = propertyName === 'Transitions'
            ? `${parentVar}.EnsureTransitions()`
            : `${parentVar}.${propertyName}`;
        // Most collection-block targets are ObservableCollections (`.Add`).
        // `InputBindings` / `CommandBindings` on Control are plain arrays
        // (their lazily-allocated getter returns `InputBinding[]` /
        // `CommandBinding[]`, mutated in place), so they append via `.push`.
        const append = ARRAY_COLLECTION_PROPERTIES.has(propertyName) ? 'push' : 'Add';
        for (const child of body.items)
        {
            if (child.kind !== 'element')
            {
                throw new EmitError(
                    `${propertyName} block only accepts element entries (got ${child.kind})`,
                    'span' in child ? child.span : body.span);
            }
            const childVar = this.compileElement(child);
            this.line(`${accessor}.${append}(${childVar});`);
        }
    }

    private assignToDefaultSlot(
        parentVar: string,
        parentClass: string,
        slot: SlotInfo | undefined,
        childVar: string,
        span: SourceSpan,
    ): void
    {
        if (slot === undefined)
        {
            throw new EmitError(
                `${parentClass} has no default-slot info — cannot receive a child`,
                span);
        }
        switch (slot.kind)
        {
            case 'single':
                // Single.SetChild does the Attach/Detach plumbing; the
                // lowercase `child` getter is read-only. The slot's
                // `name` field stays informational ('Child').
                this.line(`${parentVar}.SetChild(${childVar});`);
                return;
            case 'object':
                // Object-typed slot (ContentControl.Content) — the
                // public Content setter exists and routes through the
                // attach plumbing internally.
                this.line(`${parentVar}.${slot.name} = ${childVar};`);
                return;
            case 'list':
                // Panel.Children is read-only — mutation goes through
                // Panel.AddChild (see src/runtime/visual.ts:1318), which
                // also wires AttachLogical for the child.
                this.line(`${parentVar}.AddChild(${childVar});`);
                return;
            case 'string':
                throw new EmitError(
                    `${parentClass}.${slot.name} is a text slot; cannot accept an element child`,
                    span);
        }
    }

    // ── Value emission ─────────────────────────────────────────────

    private compileValue(val: ValueNode, ctx: ValueCtx): string
    {
        switch (val.kind)
        {
            case 'number':
                return val.raw;
            case 'string':
                return JSON.stringify(val.value);
            case 'ident':
                return this.compileIdentValue(val, ctx);
            case 'color':
                return this.compileColorValue(val);
            case 'modified':
                return this.compileModifiedValue(val, ctx);
            case 'composed':
                return this.compileComposedValue(val);
            case 'element':
                return this.compileElementValue(val);
            case 'tuple':
                return this.compileTupleValue(val, ctx);
            case 'size':
            {
                this.ensureImport('Size');
                const w = this.compileValue(val.width,  {});
                const h = this.compileValue(val.height, {});
                return `new Size(${w}, ${h})`;
            }
            case 'list':
            {
                const exprs = val.values.map(v => this.compileValue(v, {}));
                return `[${exprs.join(', ')}]`;
            }
            case 'static-resource':
            {
                // Local-resource fast path: when `@key` references a
                // resource declared earlier in the SAME
                // ResourceDictionary, emit the JS var directly. The
                // round-trip through Application.current.Resources would
                // miss it — the dict being built isn't merged in until
                // create() returns. Lets bundled themes (and demo
                // resources) author `Style { Template = @MyTemplate; }`
                // alongside a keyed `Template x:key="MyTemplate" {…}`
                // in the same file.
                const localVar = this.localResourceVars?.get(val.key);
                if (localVar !== undefined) return localVar;
                // Tuple-cell sync resolution. Thickness / CornerRadius
                // structs aren't DPs — their fields hold raw numbers, so
                // a Binding stored per cell would just sit there as an
                // opaque object (Padding.Top + Padding.Bottom → NaN).
                // Resolve the token synchronously against the target's
                // resource chain at template-instantiation time instead.
                // Lookup falls back through TryFindResource's
                // Application-level branch, so even an unattached
                // template root finds bundled tokens.
                if (ctx.insideTuple && ctx.targetExpr !== undefined)
                {
                    return `${ctx.targetExpr}.TryFindResource(${JSON.stringify(val.key)})`;
                }
                // Non-local `@key` falls through to dynamic-resource
                // semantics: install a Binding that walks the visual's
                // resource chain at construction time and listens for
                // dictionary swaps (theme switching, AddMergedDictionary,
                // local Resources mutations). This makes `@Primary` in a
                // template react to Application.Theme = 'dark' without
                // rebuilding the template.
                this.ensureImport('DynamicResource');
                if (ctx.targetExpr !== undefined)
                {
                    return `DynamicResource(${ctx.targetExpr}, ${JSON.stringify(val.key)})`;
                }
                this.ensureImport('SetterFactory');
                return `new SetterFactory((_t) => DynamicResource(_t, ${JSON.stringify(val.key)}))`;
            }
            case 'dynamic-resource':
                // `@@key` is the explicit-dynamic form, retained for
                // authors who want to be unambiguous even when a key
                // happens to also be local. Same emit as the non-local
                // `@key` branch above. Same tuple-cell special-case as
                // the implicit-static path above.
                if (ctx.insideTuple && ctx.targetExpr !== undefined)
                {
                    return `${ctx.targetExpr}.TryFindResource(${JSON.stringify(val.key)})`;
                }
                this.ensureImport('DynamicResource');
                if (ctx.targetExpr !== undefined)
                {
                    return `DynamicResource(${ctx.targetExpr}, ${JSON.stringify(val.key)})`;
                }
                this.ensureImport('SetterFactory');
                return `new SetterFactory((_t) => DynamicResource(_t, ${JSON.stringify(val.key)}))`;
            case 'binding':
            {
                // Optional `$path << conv1 << conv2` converter chain. Each
                // is an imported ValueConverter symbol; >1 composes
                // left-to-right via composeConverters. Threaded as the
                // trailing factory arg for both binding flavors.
                const convExpr = this.converterExpr(val.converters);
                const convArg  = convExpr !== undefined ? `, ${convExpr}` : '';
                // Relative source `$Self.(Owner.Prop)` — binds to the
                // target element's OWN property, typically an inherited
                // attached property (e.g. `$Self.(TextBlock.Foreground)`,
                // letting a Shape paint its Fill from the inherited ink).
                // `owner` is emitted as a real class reference (imported via
                // the symbol table), never a string proxy.
                if (val.source === 'self')
                {
                    this.ensureImport('SelfBinding');
                    const owner = val.attached!.owner;
                    const prop  = val.attached!.property;
                    this.ensureImport(owner);
                    if (ctx.targetExpr !== undefined)
                    {
                        return `SelfBinding(${ctx.targetExpr}, ${owner}, ${JSON.stringify(prop)}${convArg})`;
                    }
                    this.ensureImport('SetterFactory');
                    return `new SetterFactory((_t) => SelfBinding(_t, ${owner}, ${JSON.stringify(prop)}${convArg}))`;
                }
                // Service source `$service(Token).path` — a fixed-source
                // binding against the service resolved from the ambient
                // provider. Token is derived via tokenFor (mirrors how the
                // `.services:` block registers), so `$service(StatusService)`
                // resolves the same instance `StatusService` registered.
                // Target-independent (like ElementName), so no targetExpr
                // branch / SetterFactory wrap is needed.
                if (val.source === 'service')
                {
                    this.ensureImport('ServiceBinding');
                    this.ensureImport('ServiceProvider');
                    this.ensureImport(val.serviceToken!);
                    const tokenExpr = `ServiceProvider.tokenFor(${val.serviceToken})`;
                    const pathStr   = val.path.join('.');
                    // Target-aware: the binding reads the target's inherited
                    // ServiceScope to find the nearest published provider.
                    if (ctx.targetExpr !== undefined)
                    {
                        return `ServiceBinding(${ctx.targetExpr}, ${tokenExpr}, ${JSON.stringify(pathStr)}${convArg})`;
                    }
                    this.ensureImport('SetterFactory');
                    return `new SetterFactory((_t) => ServiceBinding(_t, ${tokenExpr}, ${JSON.stringify(pathStr)}${convArg}))`;
                }
                // ElementName-style binding — when the first path
                // segment matches an x:name declared earlier in the
                // current template scope, the source is that named
                // element (a fixed Visual) rather than the target's
                // DataContext. Mirrors WPF's
                // `{Binding ElementName=foo, Path=Bar}`. Only fires
                // INSIDE a template body: outside a template the same
                // syntax addresses the DataContext, as before.
                const head = val.path[0];
                if (head !== undefined
                    && this.templateNameVars !== undefined
                    && this.templateNameVars.has(head))
                {
                    this.ensureImport('ElementNameBinding');
                    const sourceVar = this.templateNameVars.get(head)!;
                    const restPath  = val.path.slice(1).join('.');
                    // `$foo` alone — author wants the element itself,
                    // not one of its properties. ElementNameBinding
                    // with an empty path returns the source Visual
                    // directly (no per-segment walk, no DP subscription).
                    // Useful for DropReceiver / Mutator-style DPs where
                    // the value IS the named visual.
                    // Style-setter wrap (ctx.targetExpr undefined) and
                    // direct-target attribute (defined) both resolve
                    // the source the same way: the source is a fixed
                    // Visual captured at factory time, so there's no
                    // per-target re-binding to wrap in a SetterFactory.
                    // The source is passed as a THUNK so the binding
                    // works whether the named element is declared
                    // BEFORE (backward ref — thunk resolves immediately)
                    // or AFTER (forward ref — thunk's first call returns
                    // undefined; binding retries on the next microtask).
                    return `ElementNameBinding(() => ${sourceVar}, ${JSON.stringify(restPath)}${convArg})`;
                }
                this.ensureImport('DataContextBinding');
                const pathStr = val.path.join('.');
                if (ctx.targetExpr !== undefined)
                {
                    return `DataContextBinding(${ctx.targetExpr}, ${JSON.stringify(pathStr)}${convArg})`;
                }
                // Style-setter context — target unknown until apply
                // time. Wrap so each target instantiation gets a fresh
                // binding (each one subscribes to its own target's
                // DataContext events).
                this.ensureImport('SetterFactory');
                return `new SetterFactory((_t) => DataContextBinding(_t, ${JSON.stringify(pathStr)}${convArg}))`;
            }
            case 'template-binding':
            {
                if (!this.inTemplateBody)
                {
                    throw new EmitError(
                        '$$Property is only valid inside a control-template body',
                        val.span);
                }
                this.ensureImport('TemplateBinding');
                // The factory's parameter is always `_templatedParent`,
                // so we reference it directly regardless of the value
                // position (attribute or Style setter). No SetterFactory
                // wrap because the templated parent is fixed per
                // template application, not per target instance.
                return `TemplateBinding(_templatedParent, ${JSON.stringify(val.name)})`;
            }
            case 'macro-hole':
                throw new EmitError('macros are not supported in v0', val.span);
            case 'inline-expr':
                return this.compileInlineExpr(val, ctx);
            case 'flag':
                throw new EmitError(
                    'flag value used outside an x:* attribute', val.span);
        }
    }

    private compileIdentValue(val: IdentValue, ctx: ValueCtx): string
    {
        const name = val.name;
        // 1. Boolean literals — `true` / `false` (case-sensitive). Emitted
        //    as raw JS literals so the runtime receives an actual bool
        //    rather than the truthy strings "true" / "false" (the latter
        //    being a particularly painful footgun: it's truthy).
        if (name === 'true')  return 'true';
        if (name === 'false') return 'false';
        // 1b. Numeric literals authored as bare idents — Infinity and
        //     NaN. Same string-vs-value footgun as boolean literals:
        //     emitting JSON.stringify('Infinity') as a fallback would
        //     poison numeric DPs (RepeatBehavior, Min/Max bounds, etc.).
        if (name === 'Infinity')  return 'Infinity';
        if (name === '-Infinity') return '-Infinity';
        if (name === 'NaN')       return 'NaN';
        // 1c. Dotted static-member reference — `Type.Member`. The parser
        //     produces these in any value position (resource RHS,
        //     attribute RHS, tuple element, …). The head must be a known
        //     PascalCase symbol AND have an entry in STATIC_MEMBERS that
        //     lists the tail. We don't fall back to "emit whatever and
        //     trust runtime" — an unknown tail would silently resolve to
        //     `undefined` at runtime and poison the host DP.
        if (name.includes('.'))
        {
            const dot = name.indexOf('.');
            const head = name.slice(0, dot);
            const tail = name.slice(dot + 1);
            const members = STATIC_MEMBERS.get(head);
            if (members === undefined)
            {
                throw new EmitError(
                    `dotted reference '${name}' — '${head}' has no statically-resolvable members. ` +
                    `Add an entry to STATIC_MEMBERS to expose '${head}.${tail}' to .mu source.`,
                    val.span);
            }
            if (!members.has(tail))
            {
                throw new EmitError(
                    `'${tail}' is not a static member of ${head} (${[...members].join(', ')}).`,
                    val.span);
            }
            this.ensureImport(head);
            return `${head}.${tail}`;
        }
        // 2. Property-name match against an enum class — emit ClassName.Member.
        //    Validate the member: an ident in enum position must be a known
        //    member of that enum, otherwise we'd silently emit `Enum.unknown`
        //    which resolves to `undefined` at runtime and tends to cascade
        //    into NaN through layout math.
        //
        //    Two routes to find the enum class:
        //    (a) the property name itself equals the enum class name
        //        (HorizontalAlignment, Orientation, …).
        //    (b) PROPERTY_TO_ENUM maps a differently-named property onto
        //        the enum class (`Variant: DrawerVariant`, `Anchor:
        //        DrawerAnchor`, …).
        if (ctx.propertyName !== undefined)
        {
            // (a) the property name itself equals the enum class name —
            //     single candidate.
            // (b) PROPERTY_TO_ENUM yields one OR MORE candidate enum
            //     classes — pick the one whose member set contains the
            //     literal. The member sets across candidates don't
            //     overlap today, so first match wins; if none has the
            //     literal, surface the first candidate's set in the
            //     error message (most likely the author intended that
            //     enum).
            const candidates: readonly string[] = ENUM_MEMBERS.has(ctx.propertyName)
                ? [ctx.propertyName]
                : (PROPERTY_TO_ENUM.get(ctx.propertyName) ?? []);
            let enumClass: string | undefined;
            for (const c of candidates)
            {
                if (ENUM_MEMBERS.get(c)?.has(name))
                {
                    enumClass = c;
                    break;
                }
            }
            if (enumClass === undefined && candidates.length > 0)
            {
                // No candidate matched the literal. List every
                // candidate + its valid members so the author sees
                // which enum they meant. Single-candidate path
                // ('HorizontalAlignment') collapses to a one-enum
                // report; the multi-candidate path (`Variant` →
                // ButtonVariant / DrawerVariant) names both.
                const parts: string[] = [];
                for (const c of candidates)
                {
                    const members = ENUM_MEMBERS.get(c)!;
                    parts.push(`${c} (${[...members].join(', ')})`);
                }
                throw new EmitError(
                    `'${name}' is not a member of enum ${parts.join(' or ')}.`,
                    val.span);
            }
            if (enumClass !== undefined)
            {
                this.ensureImport(enumClass);
                return `${enumClass}.${name}`;
            }
        }
        // 3. PascalCase ident known as a class — emit as a type reference.
        if (this.startsUppercase(name) && this.symbols.has(name))
        {
            this.ensureImport(name);
            return name;
        }
        // 4. No resolution path matched. Silently emitting a bare string
        //    literal here is a footgun — it produces values like the
        //    string "Red" sitting on a Brush property, or the string
        //    "center" sitting where a number is expected, with the
        //    failure surfacing far away (NaN in layout, "undefined" in
        //    text). Force the author to be explicit: a quoted string for
        //    a string value, a `#...` literal for a colour, the right
        //    PascalCase member for an enum, or an import for a type ref.
        const hint =
            ctx.propertyName !== undefined
                ? ` (in '${ctx.propertyName}=…' position)`
                : '';
        throw new EmitError(
            `unresolved identifier '${name}'${hint}. ` +
            `Use a quoted string ("${name}") for a string value, ` +
            `'#…' for a colour, the correct enum member, ` +
            `or add an import so '${name}' resolves to a known type.`,
            val.span);
    }

    private compileColorValue(val: ColorValue): string
    {
        this.ensureImport('SolidColorBrush');
        this.ensureImport('Color');
        const raw = val.raw;
        if (this.isHexLiteral(raw))
        {
            return `new SolidColorBrush(Color.FromHex('#${raw}'))`;
        }
        // Named colour — capitalise to match Color statics (Color.Blue
        // etc.). Unknown names throw at runtime when accessed.
        const cap = raw[0]!.toUpperCase() + raw.slice(1);
        return `new SolidColorBrush(Color.${cap})`;
    }

    // `base << conv …` in a NON-binding position. The base determines
    // whether the chain folds to a constant or stays reactive:
    //   * color literal / named-member ident → static, so apply the chain
    //     once at instantiation: `Lighten(0.5).convert(<base>)`.
    //   * `@key` / `@@key` resource → reactive; thread the chain into the
    //     DynamicResource binding so it re-applies on every re-resolve
    //     (theme swap, dictionary mutation). A LOCAL `@key` (declared in
    //     the same dictionary) resolves to a concrete var, so it folds.
    // Bindings (`$path << conv`) never reach here — they carry their own
    // converter chain inline (see the 'binding' case).
    private compileModifiedValue(val: ModifiedValue, ctx: ValueCtx): string
    {
        const conv = this.converterExpr(val.converters)!;   // chain is non-empty
        const base = val.base;
        switch (base.kind)
        {
            case 'color':
            case 'ident':
            {
                const baseExpr = this.compileValue(base, {});
                return `${conv}.convert(${baseExpr})`;
            }
            case 'static-resource':
            case 'dynamic-resource':
            {
                const key = JSON.stringify(base.key);
                if (base.kind === 'static-resource')
                {
                    const localVar = this.localResourceVars?.get(base.key);
                    if (localVar !== undefined) return `${conv}.convert(${localVar})`;
                }
                this.ensureImport('DynamicResource');
                if (ctx.targetExpr !== undefined)
                {
                    return `DynamicResource(${ctx.targetExpr}, ${key}, ${conv})`;
                }
                this.ensureImport('SetterFactory');
                return `new SetterFactory((_t) => DynamicResource(_t, ${key}, ${conv}))`;
            }
            default:
                throw new EmitError(
                    `'<<' modifiers apply to a color literal, a named color, ` +
                    `or an @resource — not a ${base.kind} value`,
                    val.span);
        }
    }

    // `@h1 + @hypertext` → `Style.Combine(<h1>, <hypertext>)`. Each operand
    // must be an `@resource` reference to a Style; it's resolved the same
    // way a Style's `BasedOn = @key` is (compileStyleBasedOn): the local JS
    // var when the style is declared earlier in THIS dictionary, otherwise
    // a deferred thunk resolved at Style.Combine's Seal — so a token in a
    // not-yet-merged theme dictionary resolves at first apply, not now.
    private compileComposedValue(val: ComposedValue): string
    {
        this.ensureImport('Style');
        const parts = val.parts.map(p => this.compileStyleComponent(p));
        return `Style.Combine(${parts.join(', ')})`;
    }

    private compileStyleComponent(part: ValueNode): string
    {
        if (part.kind !== 'static-resource' && part.kind !== 'dynamic-resource')
        {
            throw new EmitError(
                "style composition (`+`) operands must be `@resource` references "
                + `to styles — not a ${part.kind} value`,
                part.span);
        }
        const localVar = part.kind === 'static-resource'
            ? this.localResourceVars?.get(part.key)
            : undefined;
        if (localVar !== undefined) return localVar;
        this.ensureImport('Application');
        return `() => Application.current?.Resources.Resolve(${JSON.stringify(part.key)})`;
    }

    private compileTupleValue(tuple: TupleValue, ctx: ValueCtx): string
    {
        // Tuples in value position default to Thickness — the spec's
        // most common case (Padding, Margin, BorderThickness,
        // CornerRadius). WPF fill-in semantics:
        //   (a)          → Thickness(a)
        //   (a, b)       → Thickness(a, b, a, b)
        //   (a, b, c, d) → Thickness(a, b, c, d)
        //
        // Token cells need sync resolution because Thickness's ctor
        // wants raw numbers (a Binding stored per field would just sit
        // there as an opaque object and `Padding.Top + Padding.Bottom`
        // would yield NaN). Two emit shapes:
        //
        //   * Direct attribute (ctx.targetExpr present) — emit
        //     `_target.TryFindResource("…")` per cell. Resolution
        //     happens at factory time when the visual is being
        //     constructed; resource chain falls back through
        //     Application so even an unattached template root finds
        //     bundled tokens. Trade-off: tokens lose theme-reactivity,
        //     acceptable for spacing scales that don't scheme-swap.
        //
        //   * Trigger setter (no ctx.targetExpr) — wrap the whole
        //     Thickness construction in `new SetterFactory((_t) =>
        //     new Thickness(_t.TryFindResource(…), …))`. The trigger
        //     apply path invokes the factory at apply time with the
        //     specific target, so each fire builds a fresh Thickness
        //     from the target's resolved tokens. Without the wrapper
        //     the Thickness would close over cell-level Bindings
        //     (per the direct-attribute path) but there's no target
        //     yet to resolve them against; the SetterFactory shape is
        //     the framework's standard "defer to apply time" pattern.
        // CornerRadius is a tuple value-type too — same per-corner
        // shape as Thickness but a distinct ctor. The compiler picks
        // CornerRadius when the LHS property name is one the runtime
        // declares as a CornerRadius DP (Border.CornerRadius is the
        // canonical case). Falls through to Thickness for everything
        // else so the existing emit shape stays stable.
        const isCornerRadiusTarget = ctx.propertyName === 'CornerRadius';
        const ctor = isCornerRadiusTarget ? 'CornerRadius' : 'Thickness';
        this.ensureImport(ctor);
        // Detect whether any cell is a token reference. Pure-literal
        // tuples ((12, 6, 12, 6)) compile to a plain `new Thickness(…)`
        // — both for direct attributes and for Setter values — so
        // snapshot tests and the existing emit shape stay stable. Only
        // tuples that actually contain `@Token` cells need the
        // resource-resolution shapes below.
        const hasToken = tuple.values.some(v =>
            v.kind === 'static-resource' || v.kind === 'dynamic-resource');
        const cellCtx: ValueCtx = {
            targetExpr:  ctx.targetExpr ?? '_t',
            insideTuple: hasToken,
        };
        const exprs = tuple.values.map(v => this.compileValue(v, cellCtx));
        let body: string;
        if (exprs.length === 1)
        {
            body = `new ${ctor}(${exprs[0]})`;
        }
        else if (exprs.length === 2)
        {
            body = `new ${ctor}(${exprs[0]}, ${exprs[1]}, ${exprs[0]}, ${exprs[1]})`;
        }
        else if (exprs.length === 4)
        {
            body = `new ${ctor}(${exprs[0]}, ${exprs[1]}, ${exprs[2]}, ${exprs[3]})`;
        }
        else
        {
            throw new EmitError(
                `tuple of ${exprs.length} values has no ${ctor} shape (1, 2, or 4 expected)`,
                tuple.span);
        }
        // Only wrap in SetterFactory when (a) there are token cells
        // that need a deferred lookup AND (b) the caller didn't supply
        // a target expression (i.e. we're in a Style / trigger setter,
        // not a direct attribute). Pure-literal tuples and direct
        // attributes emit the bare Thickness construction.
        if (!hasToken || ctx.targetExpr !== undefined) return body;
        this.ensureImport('SetterFactory');
        return `new SetterFactory((_t) => ${body})`;
    }

    // Element node in value position — `Ident [Prop = val, …]`. Emits a
    // self-invoking arrow expression that constructs the instance,
    // applies each property assignment, and returns the instance:
    //
    //     ((_e) => { _e.Prop = val; return _e; })(new Ident())
    //
    // Authored as a Scheme token value (e.g. `@Elevation1 =
    // MaterialElevationEffect [Level = 1]`) or anywhere else a value
    // is expected. The class name is registered with the symbol-table
    // import so the file-level ES imports include it.
    //
    // Constraints (vs. body-position element parsing):
    //   * No x:attrs — keys / root markers only make sense as body items.
    //   * No `{ ... }` body — that would require parseStructuredBody to
    //     accept property-setter shapes (`Prop = val;`) which it
    //     doesn't, and the attribute-list form covers the common case.
    //   * No nested element values inside attrs (compileValue recurses
    //     through compileAttribute, so the structure is recursive — but
    //     each level still needs `[attrs]` shape).
    private compileElementValue(elem: ElementNode): string
    {
        if (elem.xAttrs.length > 0)
        {
            throw new EmitError(
                `element value '${elem.name}': x:attrs are not allowed in value position`,
                elem.span);
        }
        if (elem.body !== null)
        {
            throw new EmitError(
                `element value '${elem.name}': '{ ... }' body is not allowed in value position — use '[Prop = val]' instead`,
                elem.span);
        }
        this.ensureImport(elem.name);
        if (elem.attrs.length === 0)
        {
            return `new ${elem.name}()`;
        }
        // Each named attr becomes `_e.Prop = val` inside the IIFE.
        // Positional attrs (`new Foo(1, 2)`) aren't supported here —
        // they'd require knowing the ctor signature, which the
        // compiler doesn't carry. Authors use named DPs in value
        // position.
        const sets: string[] = [];
        for (const attr of elem.attrs)
        {
            if (attr.kind !== 'named-attr')
            {
                throw new EmitError(
                    `element value '${elem.name}': positional attributes are not supported — use 'Name = value' form`,
                    attr.span);
            }
            const propName = attr.path.parts.join('.');
            // `_e` is a concrete construction target, so `@resource` /
            // `$binding` values install directly onto it (DynamicResource(_e,…),
            // DataContextBinding(_e,…)) rather than emitting an un-applied
            // SetterFactory that nothing ever resolves. Without this, an
            // element-value attr like `DiagramTool [ Icon = @alignLeft ]`
            // assigned the raw SetterFactory to _e.Icon — the consumer then
            // read a factory object where a Geometry was expected. `_e` being
            // a plain MuralBase (not a Visual) is fine: DynamicResource falls back
            // to Application-level resolution for non-visual hosts.
            const valExpr = this.compileValue(attr.value, { propertyName: propName, targetExpr: '_e' });
            sets.push(`_e.${propName} = ${valExpr};`);
        }
        return `((_e) => { ${sets.join(' ')} return _e; })(new ${elem.name}())`;
    }

    // `{{ … }}` lowering. Constant body folds to a literal; reactive
    // body lowers to MultiBinding. In a Style setter context where the
    // target instance isn't yet known, the reactive form wraps in a
    // SetterFactory so each Style application gets its own per-target
    // binding (same pattern as the binding / dynamic-resource cases).
    private compileInlineExpr(val: InlineExprValue, ctx: ValueCtx): string
    {
        let result;
        try { result = lowerInlineExpr(val.raw, val.span); }
        catch (e)
        {
            if (e instanceof InlineExprError)
            {
                throw new EmitError(e.message, val.span);
            }
            throw e;
        }
        if (result.kind === 'constant')
        {
            return formatJsLiteral(result.value, val.span);
        }
        this.ensureImport('MultiBinding');
        const paths = JSON.stringify(result.paths);
        const params = result.paths.map((_, i) => `_p${i}`).join(', ');
        const converter = `(${params}) => (${result.body})`;
        if (ctx.targetExpr !== undefined)
        {
            return `MultiBinding(${ctx.targetExpr}, ${paths}, ${converter})`;
        }
        this.ensureImport('SetterFactory');
        return `new SetterFactory((_t) => MultiBinding(_t, ${paths}, ${converter}))`;
    }

    // Lower a text-mode body that contains at least one `{{ … }}` chunk.
    // All text chunks become string literals; constant-foldable
    // expression chunks become their folded value coerced to a string;
    // reactive expression chunks contribute their binding paths to a
    // shared map, and the merged converter body interleaves text +
    // expression results. Returns the emitter-ready value expression
    // (a plain string literal when everything folds, otherwise a
    // MultiBinding / SetterFactory call).
    private compileMixedTextBody(body: StringBody, ctx: ValueCtx): string
    {
        const sharedPaths = new Map<string, string>();
        const parts:        string[] = [];          // JS source fragments to concat
        const constantParts: string[] = [];          // for the all-constant fast path
        let allConstant = true;
        for (const chunk of body.chunks)
        {
            if (chunk.kind === 'text-chunk')
            {
                parts.push(JSON.stringify(chunk.text));
                constantParts.push(chunk.text);
                continue;
            }
            let result;
            try { result = lowerInlineExprWithPaths(chunk.raw, chunk.span, sharedPaths); }
            catch (e)
            {
                if (e instanceof InlineExprError)
                {
                    throw new EmitError(e.message, chunk.span);
                }
                throw e;
            }
            if (result.kind === 'constant')
            {
                const str = result.value === undefined || result.value === null
                    ? ''
                    : String(result.value);
                parts.push(JSON.stringify(str));
                constantParts.push(str);
                continue;
            }
            allConstant = false;
            // Coerce to string at conversion time so number / boolean /
            // null values join cleanly with the surrounding text.
            parts.push(`String(${result.body})`);
        }
        if (allConstant)
        {
            return JSON.stringify(constantParts.join(''));
        }
        this.ensureImport('MultiBinding');
        const paths = JSON.stringify([...sharedPaths.keys()]);
        const params = [...sharedPaths.values()].join(', ');
        const converter = `(${params}) => (${parts.join(' + ')})`;
        if (ctx.targetExpr !== undefined)
        {
            return `MultiBinding(${ctx.targetExpr}, ${paths}, ${converter})`;
        }
        this.ensureImport('SetterFactory');
        return `new SetterFactory((_t) => MultiBinding(_t, ${paths}, ${converter}))`;
    }

    // ── Helpers ────────────────────────────────────────────────────

    private requireTargetType(rf: ResourceForm): string
    {
        // Style/Template use 'TargetType'; DataTemplate (and
        // HierarchicalDataTemplate) use 'DataType'. PascalCase to
        // match the rest of the .mu attr surface.
        const name = (rf.keyword === 'DataTemplate'
                  || rf.keyword === 'HierarchicalDataTemplate')
            ? 'DataType'
            : 'TargetType';
        const m = rf.metaAttrs.find(
            a => a.path.parts.length === 1 && a.path.parts[0] === name);
        if (m === undefined)
        {
            throw new EmitError(
                `${rf.keyword}: missing required '${name}' meta-attr`, rf.span);
        }
        if (m.value.kind !== 'ident')
        {
            throw new EmitError(
                `${name} must be a type reference (PascalCase identifier)`,
                m.span);
        }
        return m.value.name;
    }

    // Read a named meta-attr by name from a resource form. Returns
    // undefined when the attr is absent. Used for optional meta-attrs
    // like HierarchicalDataTemplate's `itemsselector=PropertyName`.
    private findIdentMetaAttr(rf: ResourceForm, name: string): string | undefined
    {
        const m = rf.metaAttrs.find(
            a => a.path.parts.length === 1 && a.path.parts[0] === name);
        if (m === undefined) return undefined;
        if (m.value.kind !== 'ident')
        {
            throw new EmitError(
                `${name} must be an identifier (property name)`,
                m.span);
        }
        return m.value.name;
    }

    // Process the x:* attribute set on an element after construction:
    //   * x:root  — install a fresh NameScope on the element so x:name
    //                lookups from anywhere in the subtree resolve here.
    //                Also pins this variable as the active scope owner
    //                so descendants emit Register() calls against it.
    //   * x:name  — set the Visual's `Name` field and register it in
    //                the current scope owner's NameScope. Requires an
    //                enclosing x:root somewhere up the lexical tree.
    //
    // The resource-element wiring (x:key registration in a
    // ResourceDictionary, x:root assignment to `rd.Root`) is handled
    // separately by compileResourceElement; this method covers the
    // tree-walk-time concerns shared by every element.
    // Pre-walks a template body's element subtree and pre-allocates a
    // JS var name for every x:name'd element. Used by template-body
    // compilation to emit `let _border0, _btn1, …;` at the top of the
    // factory closure so x:name references later in the body can lexically
    // capture the var even when the named element is constructed AFTER
    // the binding installs (forward x:name ref). ElementNameBinding then
    // captures via thunk and re-tries on the next microtask if the var is
    // still undefined at install time.
    //
    // Recurses into structured bodies only (slot-assigns, resource-forms,
    // nested template forms are out of scope — they don't share the
    // surrounding name table). Expands macro invocations so x:names
    // declared inside macro bodies are reachable from the same scope.
    private collectTemplateXNames(elem: ElementNode): void
    {
        if (this.templateNameVars === undefined) return;

        const macro = this.macros.get(elem.name);
        if (macro !== undefined)
        {
            const expanded = this.expandMacro(elem, macro);
            this.collectTemplateXNames(expanded);
            return;
        }

        const xName = this.findXAttr(elem.xAttrs, 'name');
        if (xName !== null && xName.value !== null && xName.value.kind === 'string')
        {
            const nameStr = xName.value.value as string;
            if (!this.templateNameVars.has(nameStr))
            {
                const v = this.fresh(this.varHint(elem.name));
                this.templateNameVars.set(nameStr, v);
                if (this.templateNameOwners !== undefined) this.templateNameOwners.set(nameStr, elem.name);
                if (this.templateNameScope  !== undefined) this.templateNameScope.add(nameStr);
            }
        }

        if (elem.body !== null && elem.body.kind === 'structured-body')
        {
            for (const item of elem.body.items)
            {
                if (item.kind === 'element') this.collectTemplateXNames(item);
            }
        }
    }

    // Emit `let _v0, _v1, …;` at the current position for every var the
    // pre-walk reserved. Idempotent — emits nothing when no x:names were
    // collected.
    private emitPreallocatedXNameLets(): void
    {
        if (this.templateNameVars === undefined) return;
        const vars = [...this.templateNameVars.values()];
        if (vars.length === 0) return;
        this.line(`let ${vars.join(', ')};`);
    }

    private applyXAttrs(v: string, elem: ElementNode): void
    {
        const xRoot = this.findXAttr(elem.xAttrs, 'root');
        if (xRoot !== null)
        {
            this.ensureImport('NameScope');
            this.line(`${v}.SetNameScope(new NameScope());`);
            this.nameScopeOwnerVar = v;
        }

        const xName = this.findXAttr(elem.xAttrs, 'name');
        if (xName !== null)
        {
            if (xName.value === null || xName.value.kind !== 'string')
            {
                throw new EmitError(
                    'x:name requires a string literal value', xName.span);
            }
            const nameLit = JSON.stringify(xName.value.value);
            const nameStr = xName.value.value as string;
            this.line(`${v}.Name = ${nameLit};`);
            // Track inside the active DataTemplate's name scope so
            // setter LHS resolution in trigger blocks can route names
            // through TargetedSetter. Recorded BEFORE the inTemplateBody
            // early-out so DataTemplate bodies (which also set
            // inTemplateBody for the ControlTemplate case) capture the
            // entry. Note: ControlTemplate factories never carry a
            // templateNameScope (it's only set inside compileDataTemplateForm),
            // so this is a no-op for those.
            if (this.templateNameScope !== undefined)
            {
                this.templateNameScope.add(nameStr);
                this.templateNameOwners!.set(nameStr, elem.name);
                this.templateNameVars!.set(nameStr, v);
            }
            // Inside a template body, ControlTemplate.Apply walks the
            // freshly-built subtree and registers every named visual in
            // the template's NameScope — so the factory itself must NOT
            // emit a Register() call (no enclosing x:root exists; the
            // scope is created at Apply time, not at factory-emit time).
            if (this.inTemplateBody) return;
            if (this.nameScopeOwnerVar === undefined)
            {
                throw new EmitError(
                    'x:name requires an enclosing x:root element to provide a NameScope',
                    xName.span);
            }
            // The runtime exposes the per-instance NameScope through
            // the `nameScope` getter (no setter); SetNameScope above
            // guarantees it's non-undefined here.
            this.line(
                `${this.nameScopeOwnerVar}.nameScope.Register(${nameLit}, ${v});`);
        }
    }

    private findXAttr(xAttrs: XAttr[], name: string): XAttr | null
    {
        return xAttrs.find(x => x.name === name) ?? null;
    }

    private attrPathOwner(targetType: string, path: AttrPath): string
    {
        return (path.parts.length === 2) ? path.parts[0]! : targetType;
    }

    private attrPathProperty(path: AttrPath): string
    {
        return path.parts[path.parts.length - 1]!;
    }

    private ensureImport(symbol: string): void
    {
        const mod = this.symbols.get(symbol);
        if (mod === undefined)
        {
            throw new EmitError(
                `unknown symbol '${symbol}' — not in the compiler's symbol table`);
        }
        let s = this.imports.get(mod);
        if (s === undefined)
        {
            s = new Set();
            this.imports.set(mod, s);
        }
        s.add(symbol);
    }

    // Same as `ensureImport`, but the module path is given explicitly
    // (resolved at the source — `import Foo from "path"` inside a
    // `resources` block) rather than looked up in the symbol table.
    // Conflicts with an existing entry that maps `symbol` to a different
    // module are caught early so the same name can't refer to two
    // different things across blocks in the same file.
    private ensureExplicitImport(symbol: string, mod: string): void
    {
        for (const [existingMod, syms] of this.imports)
        {
            if (existingMod === mod) continue;
            if (syms.has(symbol))
            {
                throw new EmitError(
                    `import alias '${symbol}' conflicts: already imported ` +
                    `from '${existingMod}', cannot also import from '${mod}'`);
            }
        }
        let s = this.imports.get(mod);
        if (s === undefined)
        {
            s = new Set();
            this.imports.set(mod, s);
        }
        s.add(symbol);
    }

    private fresh(hint: string): string
    {
        return `_${hint}${this.varCounter++}`;
    }

    private varHint(className: string): string
    {
        return className[0]!.toLowerCase() + className.slice(1);
    }

    private line(s: string): void
    {
        this.lines.push(this.indent > 0 ? ' '.repeat(this.indent) + s : s);
    }

    private startsUppercase(name: string): boolean
    {
        const c = name.charCodeAt(0);
        return c >= 65 && c <= 90;
    }

    private isHexLiteral(raw: string): boolean
    {
        if (raw.length !== 3 && raw.length !== 4
            && raw.length !== 6 && raw.length !== 8)
        {
            return false;
        }
        return /^[0-9a-fA-F]+$/.test(raw);
    }
}

// Check whether a string is a safe JS identifier so we can emit it as
// a bare property name on the typed dictionary class. Resource keys
// with non-identifier characters (spaces, hyphens, leading digits)
// still live in the dictionary — they just don't get a class
// accessor; consumers reach them through `dict.Resolve("Some Key")`.
function isValidIdent(s: string): boolean
{
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

// The runtime class for each resource-form keyword — used by
// `gatherNamedResources` to fill the typed `.d.ts` accessor shape.
// `Template` is a special case: with `x:key` it stays as ControlTemplate;
// without it the emitter wraps it in a Style so the dictionary key
// space stays consistent with implicit-by-type Styles.
function resourceFormType(keyword: string, rf: ResourceForm): string
{
    if (keyword === 'Style')                    return 'Style';
    if (keyword === 'DataTemplate')             return 'DataTemplate';
    if (keyword === 'HierarchicalDataTemplate') return 'HierarchicalDataTemplate';
    if (keyword === 'ItemsPanelTemplate')       return 'ItemsPanelTemplate';
    if (keyword === 'Template')
    {
        // findXAttr is on the Compiler instance — replicate here via a
        // direct scan since this helper is module-scope (kept here so
        // the `.d.ts` emit can call it without instantiating a Compiler).
        for (const x of rf.xAttrs)
        {
            if (x.name === 'key') return 'ControlTemplate';
        }
        return 'Style';
    }
    return keyword;
}

