import type { SourceSpan } from './tokens.js';

// AST for µ-mural. Pure data — no methods, no behaviour. Built by
// `parser.ts` and consumed by `bind.ts` / `emit.ts` in later phases.
//
// Discriminated union conventions:
//   * Every node has a `kind: '<tag>'` field.
//   * Every node has a `span: SourceSpan` for diagnostics. (Internal
//     nodes get the span covering their full extent; atomic value
//     nodes carry the span of their literal token.)
//   * Lists of children are arrays, never linked lists.

// ── Top-level document ─────────────────────────────────────────────

export interface Document
{
    kind: 'document';
    forms: TopForm[];
    span:  SourceSpan;
}

export type TopForm =
    | ImportForm
    | DefForm
    | ElementNode
    | ResourceForm
    | ResourcesBlock
    | ThemeBlock
    | SchemeBlock
    | ModuleForm;

// ── `module Identifier [attrs] { Capability … }` ─────────────────────
//
// Top-level form defining a named ShellModule (a shell capability
// provider). Compiles to `export const Identifier = (() => { … return
// _shellModule; })()`. The body is a ShellModule element with an implicit
// type — bracket attrs set ShellModule properties (e.g. Name), children are
// its Capabilities. A module file declares exactly one; apps list the
// imported names in a `.modules:` block on the Application.
export interface ModuleForm
{
    kind:       'module-form';
    exportName: string;       // identifier after `module` — the export const name
    root:       ElementNode;  // synthetic ShellModule element (name === 'ShellModule')
    span:       SourceSpan;
}

export interface ImportForm
{
    kind:   'import';
    name:   string;            // identifier after `import`
    source: string | null;     // `from "path"` literal, or null when omitted
    span:   SourceSpan;
}

// ── `resources Identifier { import …; …entries… }` ──────────────────
//
// Top-level form that defines a NAMED, typed ResourceDictionary subclass.
// Compiles to `export class Identifier extends ResourceDictionary` with:
//   * private constructor
//   * static `Clone()` factory that produces a fresh, mutable instance
//   * static `_imports` array of import factories merged into the
//     instance at Clone time
//   * typed getter/setter pairs for every `x:name`'d resource declared
//     in the body
//
// Multiple `resources` blocks may appear in a single file — each
// compiles to its own class export. Imports declared inside a block
// scope to THAT block only (they propagate into the class's `_imports`
// array and into the file-level ES `import` header).
export interface ResourcesBlock
{
    kind:    'resources-block';
    name:    string;            // identifier after `resources` — the class name
    imports: ResourcesImport[]; // `import Alias from "..."` clauses inside the block
    body:    StructuredBody;    // same shape as the old `ResourceDictionary { ... }` body
    span:    SourceSpan;
}

// `import Alias from "module-specifier"` — appears as the FIRST items
// inside a ResourcesBlock body. The alias must match a class exported
// by the target module (an Identifier extends ResourceDictionary).
export interface ResourcesImport
{
    kind:   'resources-import';
    alias:  string;
    source: string;
    span:   SourceSpan;
}

// ── `theme Identifier { tokens { … } imports… body… }` ──────────────
//
// Top-level form that defines a Theme bundle — a ResourceDictionary
// subclass enriched with an explicit token catalog. Compiles to:
//   * `export class Identifier extends ResourceDictionary` (same shape
//     as ResourcesBlock — templates, default styles, DataTemplates ride
//     in the body)
//   * `export const IdentifierCatalog: TokenCatalog` — the catalog Map
//     built from the `tokens { … }` declarations
//
// At runtime the consumer's TS code wraps these into a Theme via
// defineTheme({ name, templates: [Identifier.Clone()], catalog:
// IdentifierCatalog, schemes, defaultScheme }).
export interface ThemeBlock
{
    kind:    'theme-block';
    name:    string;
    imports: ResourcesImport[];   // same shape as ResourcesBlock imports
    /** `schemes: [Ident, Ident, …]` header. Each ident must match a
     *  Scheme class imported at the top of the file. The compiler
     *  weaves `<ident>.instance` into the Theme's schemes array. */
    schemes:        string[];
    /** `defaultScheme: Ident` header. Ident must appear in `schemes`.
     *  Compiler emits the matching string name into `defaultScheme`. */
    defaultScheme:  string | undefined;
    /** `dictionaries: [Ident, Ident, …]` header. Each ident must match
     *  a ResourceDictionary class imported at the top of the file
     *  (typically `MuralBasic`, `MuralFramework`, or any user-authored
     *  bundle). The compiler emits `<ident>.Clone()` into the Theme's
     *  dictionaries array, followed by the theme's own body dict.
     *  Empty when no `dictionaries:` header is authored. */
    dictionaries:   string[];
    tokens:  TokenCatalogEntry[]; // empty when no `tokens { … }` was authored
    body:    StructuredBody;      // same shape as ResourcesBlock body
    span:    SourceSpan;
}

// One entry inside a Theme's `tokens { … }` block.
//
//   @Primary  : Brush "Primary brand color"
//   @Space1..@Space8 : number "M3 spacing scale"
//
// A range form expands to N entries during emit (`@Foo1`..`@Foo3` →
// three separate catalog entries with the same type + description).
export interface TokenCatalogEntry
{
    kind:        'token-catalog-entry';
    /** Name(s) the entry expands to. Always one or more identifiers.
     *  Single-token form yields `[ 'Primary' ]`; range form like
     *  `@Space1..@Space8` yields `[ 'Space1', 'Space2', ..., 'Space8' ]`. */
    names:       string[];
    /** Type name as written — `Brush`, `CornerRadius`, `number`,
     *  `Typography`, `Effect`, … plus union types like `number |
     *  CornerRadius`. Verbatim text for now; the runtime catalog
     *  stores the same string. */
    typeText:    string;
    description: string | undefined;
    span:        SourceSpan;
}

// ── `scheme Identifier against ThemeName [basedOn Other] { @x=v … }` ──
//
// Top-level form that defines a Scheme — a pure token-value dictionary
// declared against a specific Theme. Compiles to:
//   * `export const Identifier = defineScheme({ name, theme, basedOn?,
//     tokens })` — a Scheme value object ready for ThemeManager.RegisterTheme.
//
// The body is restricted to `@Name = value` resource entries (no
// element declarations, no styles, no triggers); the parser uses the
// same StructuredBody grammar and the bind pass enforces the "pure
// values" rule.
export interface SchemeBlock
{
    kind:     'scheme-block';
    name:     string;            // identifier after `scheme` — the export name
    theme:    string;            // identifier after `against` — the target Theme
    basedOn:  string | undefined; // `<theme>.<scheme>` after `basedOn`, when present
    imports:  ResourcesImport[];
    body:     StructuredBody;
    span:     SourceSpan;
}

// ── Element ────────────────────────────────────────────────────────

export interface ElementNode
{
    kind:   'element';
    name:   string;            // Border, TextBlock, Application, …
    /** Scope-extension attributes (`x:key="…"`, `x:root`, …) — written
     *  BEFORE the `[ … ]` block, between the element name and the
     *  attribute list. Kept in a dedicated field so the syntactic
     *  split between extensions and properties is preserved in the
     *  AST and downstream consumers don't have to filter `attrs` to
     *  find them. */
    xAttrs: XAttr[];
    /** Named + positional property assignments from the `[ … ]` block.
     *  XAttrs are NOT included here — the parser rejects `x:foo` in
     *  bracket position. */
    attrs:  Attribute[];
    body:   BodyNode | null;
    span:   SourceSpan;
}

export type Attribute = NamedAttr | PositionalAttr;

export interface NamedAttr
{
    kind:  'named-attr';
    path:  AttrPath;
    value: ValueNode;
    span:  SourceSpan;
}

// `Fill` → parts=['Fill']
// `Canvas.Left` → parts=['Canvas', 'Left']  (attached property)
// Always 1 or 2 parts; deeper paths are a static error at bind time.
export interface AttrPath
{
    kind:  'attr-path';
    parts: string[];
    span:  SourceSpan;
}

export interface PositionalAttr
{
    kind:  'positional-attr';
    value: ValueNode;
    span:  SourceSpan;
}

// `x:foo = value` (or `x:foo` flag-style with no value).
export interface XAttr
{
    kind:  'x-attr';
    name:  string;             // extension name after `x:`
    value: ValueNode | null;   // null for flag-style (`x:root`)
    span:  SourceSpan;
}

// ── Body content ───────────────────────────────────────────────────

export type BodyNode = StringBody | StructuredBody;

// Text-mode body — only for string-typed slots (e.g. TextBlock.Text).
// `chunks` is a mixed sequence of literal text runs and inline-expression
// holes (`{{ … }}`). When every chunk is text the compiler lowers to a
// plain string; when an `InlineExprValue` chunk is present the slot
// becomes a computed binding (constant-folded if the expression has no
// reactive references, MultiBinding otherwise).
export interface StringBody
{
    kind:   'string-body';
    chunks: StringBodyChunk[];
    span:   SourceSpan;
}

export type StringBodyChunk = TextChunk | InlineExprValue;

export interface TextChunk
{
    kind: 'text-chunk';
    text: string;
}

// Structured body — element list + optional slot assignments + optional
// resource entries (when this is a ResourceDictionary body).
export interface StructuredBody
{
    kind:  'structured-body';
    items: BodyItem[];
    span:  SourceSpan;
}

export type BodyItem =
    | ElementNode
    | SlotAssign
    | MemberBlock
    | ServicesBlock
    | ModulesBlock
    | KeyValueResource
    | ResourceForm
    | DefForm
    | IncludeForm
    | MergeForm
    | GlyphsForm
    | FontsForm
    | MacroHoleBodyItem
    | TextChunkBodyItem;

// A quoted string sitting among element children — WPF-style mixed inline
// content: `TextBlock { "Hello " Bold { "World" } }`. The compiler lowers
// each chunk to `new Run("…")` appended to the parent's Inlines. Only
// inline hosts (Inlines default slot) accept it; the emitter errors
// elsewhere. Bare identifiers in these bodies are nested inline elements —
// text MUST be quoted, which is how mural disambiguates text from elements
// (in place of XAML's `<>` tags).
export interface TextChunkBodyItem
{
    kind:  'text-chunk-body-item';
    value: string;
    span:  SourceSpan;
}

// `.Member: { … }` — a dotted member-block that fills a complex aggregate
// property of the surrounding element. The general form's body is a list
// of element entries appended to `target.<name>` (an ObservableCollection
// DP). Named members carry bespoke lowering — `services` reads its body
// as DI registrations against `Application.Services` (see the parser's
// service-entry grammar) rather than as plain elements. The leading dot
// distinguishes a member-block from a scalar slot-assign (`name:`) and
// from a child element.
export interface MemberBlock
{
    kind:    'member-block';
    name:    string;
    // Generic member-blocks carry an element list. (The `services` member
    // is the named exception — it parses to a `ServicesBlock`, not here.)
    body:    StructuredBody;
    span:    SourceSpan;
}

// `.services: { … }` — the named member-block with bespoke DI lowering.
// Each entry registers an implementation against a token in the
// surrounding scope's `Services` provider. Entry grammar:
//   [lifetime] Impl [ { prop: value … } ] [ -> Token ]
// where `lifetime` ∈ { singleton, scoped, transient } (absent ⇒
// singleton), and `-> Token` registers `Impl` under a token different from
// itself (absent ⇒ token derived from `Impl` via `ServiceProvider.tokenFor`).
// Every entry lowers to a lazy factory `(p) => new Impl(p)`: the service
// ctor receives the provider (the IServiceProvider contract) and resolves
// its own dependencies — there is no constructor-dependency list in markup.
//
// The optional `{ … }` inline-config block seeds the freshly-constructed
// instance: each `prop: value` assigns through the service's JS setter. A
// value is either a literal (string / number / colour / tuple …) — seeding
// non-default state without a subclass — or `$service(Token)`, EAGERLY
// resolved from the factory's provider (explicit property injection, since
// mural has no reflection/auto-wiring).
export interface ServiceConfigEntry
{
    name:  string;               // service property (assigned via its setter)
    value: ValueNode;            // literal, or a `$service(Token)` binding
    span:  SourceSpan;
}

export interface ServiceEntry
{
    lifetime?: 'singleton' | 'scoped' | 'transient';
    impl:      string;           // implementation class symbol
    config?:   readonly ServiceConfigEntry[];   // inline-config seed/inject
    token?:    string;           // explicit registration token symbol
    span:      SourceSpan;
}

export interface ServicesBlock
{
    kind:    'services-block';
    entries: readonly ServiceEntry[];
    span:    SourceSpan;
}

// `.modules: { DiagramModule … }` — the named member-block that composes
// modules onto the Application. Each entry is the identifier of an imported
// `module NAME { … }` const; every entry lowers to
// `app.Modules.Add(<entry>)`. Distinct from `.services:` (which registers
// factories) — modules are added instances.
export interface ModulesBlock
{
    kind:    'modules-block';
    entries: readonly string[];   // imported `module NAME` const identifiers
    span:    SourceSpan;
}

// `include "<path>" [as <key>]` — compile-time inclusion of an external
// file into the enclosing resource dictionary. The path resolves relative
// to the .mu file. A glob (`icons/*.svg`) pulls every match in, keyed by
// basename; a single file may carry an explicit `as <key>`. WHAT each
// file becomes (e.g. .svg → a Geometry resource) is decided by the
// compiler's injected include resolver, dispatching on extension — the
// parser only captures the directive.
export interface IncludeForm
{
    kind: 'include-form';
    /** The path / glob exactly as written, relative to the .mu file. */
    path: string;
    /** Explicit resource key from `as <key>` (single-file only); else the
     *  key is derived from each matched file's basename. */
    key?: string;
    /** `include colored "…"` → true: import as a colored IconDefinition
     *  rather than a monochrome Geometry. */
    colored: boolean;
    /** `include x:single "…"` → true: force this include's resource(s) to be
     *  module-scope singletons (shared across every Clone()). Raster images are
     *  singletons implicitly; this opts a vector/geometry include in too. */
    single: boolean;
    span: SourceSpan;
}

// `merge <Alias>` — fold every entry of a top-level-imported resource
// dictionary into the enclosing dictionary. `Alias` is a `resources NAME`
// dictionary pulled in by a file-level `import Alias from "…"` clause; the
// merge copies its keyed entries (at Clone() time) into the target — the same
// composition a named `resources` block's own `import` header performs, exposed
// as a body directive so an Application's `resources:` block (and any dictionary
// body) can merge a standalone dictionary. Sibling of IncludeForm / GlyphsForm.
export interface MergeForm
{
    kind:  'merge-form';
    /** Identifier of the imported dictionary to fold in. */
    alias: string;
    span:  SourceSpan;
}

// `glyphs "<font>" { home  bolt = "<cp>"  … }` — compile-time inclusion
// of font-glyph outlines into the enclosing resource dictionary, one
// PathGeometry resource per entry. Each entry's `key` ident is the
// resource key; absent `codepoint`, it doubles as the glyph NAME to
// look up (font `post` table); with `= "<cp>"` the glyph is taken from
// that string's first codepoint. HOW a font file becomes geometry is
// decided by the compiler's injected glyph resolver — the parser only
// captures the directive. Sibling of IncludeForm (.svg → geometry).
export interface GlyphsForm
{
    kind: 'glyphs-form';
    /** Font file path exactly as written, relative to the .mu file. Empty
     *  when the font is named by family via `fontFamily` (`glyphs @Inter`)
     *  — the compiler resolves the path from a preceding `fonts` block. */
    font: string;
    /** Family name from `glyphs @<family> { … }` — references a font
     *  registered by an earlier `fonts { … }` block in the same
     *  dictionary. Mutually exclusive with a non-empty `font` path. */
    fontFamily?: string;
    entries: GlyphEntry[];
    span: SourceSpan;
}

export interface GlyphEntry
{
    /** Resource key; also the glyph name when `codepoint` is absent. */
    key: string;
    /** Explicit codepoint string from `= "<cp>"`; else look up by `key`. */
    codepoint?: string;
    span: SourceSpan;
}

// `fonts { Inter from "<path>" [Weight=Bold, Style=Italic]  … }` — a
// resource-dictionary body item that registers font faces with the
// runtime FontManager (so they load for metrics AND embed for rendering)
// and, per family, publishes a `@<family>` FontFamily resource for
// `FontFamily=@Inter` references. Each entry is one face (one weight/
// style of a family) backed by a path fetched at runtime; no compile-time
// font reading is needed for registration (cf. `glyphs`, which bakes
// geometry and does read the file). A family declared here is also
// referenceable by `glyphs @<family> { … }`.
export interface FontsForm
{
    kind: 'fonts-form';
    entries: FontEntry[];
    span: SourceSpan;
}

export interface FontEntry
{
    /** Family name registered + published as `@<family>`. */
    family: string;
    /** Source path exactly as written, relative to the .mu file. */
    source: string;
    /** FontWeight member name (`Bold`, `Medium`, …); absent ⇒ Normal. */
    weight?: string;
    /** FontStyle member name (`Italic`); absent ⇒ Normal. */
    style?: string;
    span: SourceSpan;
}

// `#1` (or `#bg`, …) appearing as a body item — only meaningful inside
// a `def` body, where it's replaced at expansion time with the items
// the caller passed as the macro's content body. The parser emits this
// shape whenever a HashBody token shows up in body position; the bind
// pass errors if the macro hole is unbound or if the surrounding
// element isn't actually a macro expansion.
export interface MacroHoleBodyItem
{
    kind: 'macro-hole-body-item';
    name: string;
    span: SourceSpan;
}

export interface SlotAssign
{
    kind:  'slot-assign';
    name:  string;
    // `Name: <plain value>`        — primitive / ident / @key / binding-expr
    // `Name: { <body> }`           — structured (used for `resources: { … }`)
    // `Name: <template> { … }`     — inline template (Template / DataTemplate
    //                                / HierarchicalDataTemplate /
    //                                ItemsPanelTemplate). The compiler emits
    //                                an anonymous template construction at
    //                                the assignment site.
    value: ValueNode | StructuredBody | ResourceForm;
    span:  SourceSpan;
}

// `@primary = #4caf50` or `@key:primary = #4caf50` — primitive resource.
// `key` is what consumers look up by; `name` is the source identifier
// (defaults to the same when no override is given).
export interface KeyValueResource
{
    kind: 'key-value-resource';
    key:  string;
    name: string;
    value: ValueNode;
    span: SourceSpan;
}

// ── Resource forms (Style, Template, DataTemplate, HierarchicalDataTemplate,
//                    ItemsPanelTemplate) ───────────────────────────────────

export interface ResourceForm
{
    kind:      'resource-form';
    keyword:   'Style' | 'Template' | 'DataTemplate' | 'HierarchicalDataTemplate' | 'ItemsPanelTemplate' | 'TemplateSelector';
    metaAttrs: NamedAttr[];        // TargetType, DataType, itemsselector, basedon, …
    xAttrs:    XAttr[];            // x:key, future x:* meta
    body:      SetterList | ElementNode | DataTemplateBody | TemplateSelectorBody;
    span:      SourceSpan;
}

// Body of a DataTemplate / HierarchicalDataTemplate that carries
// triggers alongside its single root element. Triggers fire against
// the realized subtree at Apply time; their setters can target named
// descendants via `Name.Property = value` LHS.
export interface DataTemplateBody
{
    kind:          'data-template-body';
    root:          ElementNode;
    triggers:      TriggerGroup[];
    eventTriggers: EventTriggerGroup[];
    span:          SourceSpan;
}

// Body of a `TemplateSelector` (spec Shape C): an ordered list of typed
// `DataTemplate [DataType=X] { … }` cases plus at most one bare `@key`
// default. Compiles to a runtime `TypeTemplateSelector` (Map<Function,
// DataTemplate> + optional fallback). No `when(...)` triggers inside.
export interface TemplateSelectorBody
{
    kind:    'template-selector-body';
    entries: (ResourceForm | StaticResourceValue)[];
    span:    SourceSpan;
}

export interface SetterList
{
    kind:  'setter-list';
    items: SetterItem[];
    span:  SourceSpan;
}

export type SetterItem = PropertySetter | TriggerGroup | EventTriggerGroup | BehaviorsBlock;

// Conditional behavior attach inside a `when()` trigger body. Each
// entry is a Behavior element — the compiler emits a paired
// AttachBehaviorAction (into the trigger's enterActions) and
// DetachBehaviorAction (into the trigger's exitActions) so the
// behavior is attached when the trigger activates and torn off when
// it deactivates. Mirrors WPF's Interaction.Triggers + InvokeBehavior
// pattern within the existing trigger machinery.
//
// Authoring shape:
//   when($IsBusy) {
//       Behaviors { ShakeBehavior[Amplitude=4] }
//   }
export interface BehaviorsBlock
{
    kind:    'behaviors-block';
    entries: ElementNode[];
    span:    SourceSpan;
}

// Routed-event trigger inside a style block. Lowered to runtime
// EventTrigger + TriggerAction wiring at emit. Body is a sequence of
// trigger-action declarations — currently `BeginStoryboard { … }` is
// the only supported shape.
//
// Authoring shape:
//   on Click { BeginStoryboard { DoubleAnimation[…] } }
export interface EventTriggerGroup
{
    kind:      'event-trigger';
    eventName: string;
    actions:   TriggerActionNode[];
    span:      SourceSpan;
}

// Discriminated union covering every trigger-action shape. BeginStoryboard
// builds + starts a fresh Storyboard each fire (optionally registering
// it under a Name); the Stop / Pause / Resume variants reference a
// previously-named storyboard.
export type TriggerActionNode =
    | BeginStoryboardNode
    | StopStoryboardNode
    | PauseStoryboardNode
    | ResumeStoryboardNode
    | InvokeCommandNode;

// `BeginStoryboard [Name="fade"] { Animation[…] Animation[…] }` — bundles
// the inner animations into a single runtime Storyboard. Each animation
// declares its TargetProperty inline; the target Visual is implicit
// (the firing Visual at trigger time). When `name` is set, the firing
// Visual stores the Storyboard under that name so Stop / Pause /
// ResumeStoryboard can reference it later.
export interface BeginStoryboardNode
{
    kind:       'begin-storyboard';
    name:       string | undefined;
    animations: AnimationDecl[];
    span:       SourceSpan;
}

// `StopStoryboard [Name="fade"]` — references a previously-named
// BeginStoryboardAction on the firing Visual. No body.
export interface StopStoryboardNode
{
    kind: 'stop-storyboard';
    name: string;
    span: SourceSpan;
}

export interface PauseStoryboardNode
{
    kind: 'pause-storyboard';
    name: string;
    span: SourceSpan;
}

export interface ResumeStoryboardNode
{
    kind: 'resume-storyboard';
    name: string;
    span: SourceSpan;
}

// `InvokeCommand [Command=$SaveCommand]` — fires an ICommand at trigger
// time, passing the routed-event args as the command parameter.
// Authoring shape:
//   on Click   { InvokeCommand[Command=$SaveCommand] }
//   on Drop    { InvokeCommand[Command=$DropCommand] }
//   on KeyDown { InvokeCommand[Command=$KeyCommand] }
// The `command` attribute is the only supported attr — it MUST be an
// inline-expression resolving to an ICommand on the firing Visual's
// DataContext (typically a RelayCommand DP on the VM).
export interface InvokeCommandNode
{
    kind:    'invoke-command';
    command: ValueNode;          // expected: inline-expr to an ICommand
    span:    SourceSpan;
}

// `Ident [attr=value, …]` for animation timeline construction. The
// attribute list is identical to ElementNode.attrs in shape; the emitter
// special-cases TargetProperty (extracted as the Storyboard.Add propName,
// NOT passed to the animation constructor).
export interface AnimationDecl
{
    kind:      'animation-decl';
    className: string;            // 'DoubleAnimation' / 'ColorAnimation' / …
    attrs:     Attribute[];
    span:      SourceSpan;
}

export interface PropertySetter
{
    kind:  'property-setter';
    path:  AttrPath;
    value: ValueNode;
    span:  SourceSpan;
}

export interface TriggerGroup
{
    kind:      'trigger-group';
    condition: TriggerExpr;
    setters:   SetterList;
    span:      SourceSpan;
}

export type TriggerExpr =
    | TriggerTerm
    | TriggerAnd
    | TriggerOr;

// Presence predicate for a trigger term — `when ( P is unset )` /
// `when ( P is set )`. Mutually exclusive with `value` (the `= v` form).
export enum TriggerPresence
{
    Unset = 'unset',
    Set   = 'set',
}

export interface TriggerTerm
{
    kind:     'trigger-term';
    negated:  boolean;
    // Property name on the styled target (PropertyTrigger form,
    // `when( IsMouseOver )`). Mutually exclusive with `path`.
    property: string | undefined;
    // Named source visual (PART) whose `property` to watch. When
    // undefined the trigger watches the templated parent (or the
    // template root for DataTemplates) — the historic shape. When
    // set, the parser saw `when( PART_Row.IsMouseOver )` and the
    // compiler lowers it to `TemplatePropertyTrigger.sourceName`,
    // so the trigger subscribes to the named visual's property
    // change instead of the templated parent's. Only valid in
    // `property`-form terms; `$path` (DataTrigger) terms always
    // resolve through DataContext and have no source-name slot.
    sourceName: string | undefined;
    // DataContext-relative dotted path (DataTrigger form,
    // `when( $IsSelected )` / `when( $foo.bar )`). Mutually exclusive
    // with `property`.
    path:     string | undefined;
    value:    ValueNode | null;     // null means implicit `= true`
    // `is unset` / `is set` predicate. When set, `value` is null and the
    // term matches on the property being nullish / non-nullish instead of
    // by equality.
    presence: TriggerPresence | undefined;
    span:     SourceSpan;
}

export interface TriggerAnd
{
    kind: 'trigger-and';
    left: TriggerExpr;
    right: TriggerExpr;
    span: SourceSpan;
}

export interface TriggerOr
{
    kind: 'trigger-or';
    left: TriggerExpr;
    right: TriggerExpr;
    span: SourceSpan;
}

// ── Macros ─────────────────────────────────────────────────────────

export interface DefForm
{
    kind:   'def';
    name:   string;
    params: MacroParam[];
    body:   ElementNode;
    span:   SourceSpan;
}

export interface MacroParam
{
    kind:        'macro-param';
    holeName:    string;          // for #1 → "1"; for #bg → "bg"
    positional:  boolean;
    typeRef:     string | null;
    defaultValue: ValueNode | null;
    span:        SourceSpan;
}

// ── Values ─────────────────────────────────────────────────────────

export type ValueNode =
    | NumberValue
    | StringValue
    | IdentValue
    | ColorValue
    | TupleValue
    | SizeValue
    | ListValue
    | BindingValue
    | TemplateBindingValue
    | StaticResourceValue
    | DynamicResourceValue
    | MacroHoleValue
    | InlineExprValue
    | FlagValue
    | ModifiedValue
    | ComposedValue
    | ElementNode;

export interface NumberValue { kind: 'number';  raw: string;        span: SourceSpan; }
export interface StringValue { kind: 'string';  value: string;       span: SourceSpan; }
// Bare identifier in a value position — enum value (Vertical, Bold,
// left), type reference (Button as TargetType), named flag. The bind
// pass interprets by context (slot type, surrounding form).
export interface IdentValue  { kind: 'ident';   name: string;        span: SourceSpan; }
// `#blue` → raw='blue'; `#0d47a1` → raw='0d47a1'. The bind pass
// distinguishes by inspecting the body.
export interface ColorValue  { kind: 'color';   raw: string;         span: SourceSpan; }
export interface TupleValue  { kind: 'tuple';   values: ValueNode[]; span: SourceSpan; }
export interface SizeValue   { kind: 'size';    width: ValueNode;
                                                height: ValueNode;   span: SourceSpan; }
export interface ListValue   { kind: 'list';    values: ValueNode[]; span: SourceSpan; }
// `$path` or `$node.path`, optionally piped through one or more
// converters: `$path << conv1 << conv2`. `converters` lists the imported
// ValueConverter symbol names in left-to-right application order (compose
// as `convN(... conv1(value))`); empty/absent → a plain binding.
// `$path` / `$node.path` (DataContext / ElementName), or the relative
// source `$Self.(Owner.Prop)` which binds to the TARGET element's own
// property — typically an inherited attached property like
// `TextBlock.Foreground`. For the self form `source` is 'self', `attached`
// names the owner type + property, and `path` is empty.
export interface BindingValue          { kind: 'binding';            path: string[];   source?: 'self' | 'service'; serviceToken?: string; attached?: { owner: string; property: string }; converters?: ConverterRef[]; span: SourceSpan; }
// One link in a `<< conv` chain. A bare converter (`<< Foo`) has no args;
// a parameterized one (`<< Lighten(0.5)`) carries its argument values. The
// emitter renders `Foo` vs `Lighten(0.5)` accordingly. `name` resolves to
// an imported ValueConverter (bare) or a converter-FACTORY (when args are
// present — e.g. a color modifier).
export interface ConverterRef          { name: string; args: ValueNode[]; span: SourceSpan; }
// A value piped through a converter chain in a NON-binding position:
// `#0d47a1 << Lighten(0.5)`, `@PrimaryColor << Darken(0.2)`. Bindings
// carry their own `converters` inline (threaded into the binding factory
// so they stay reactive); this wrapper covers the static bases (color
// literal, static resource, static member ref), which the emitter folds
// to a constant by applying the chain once at instantiation.
export interface ModifiedValue         { kind: 'modified'; base: ValueNode; converters: ConverterRef[]; span: SourceSpan; }
// `@a + @b [+ @c …]` — style composition. Each `part` is a value (in
// practice a `@resource` reference to a Style); the emitter lowers the
// whole node to `Style.Combine(part0, part1, …)`. Left-to-right order is
// preserved — the runtime resolves rightmost-wins on setter conflicts.
export interface ComposedValue         { kind: 'composed'; parts: ValueNode[]; span: SourceSpan; }
export interface TemplateBindingValue  { kind: 'template-binding';   name: string;     span: SourceSpan; }
// `@Key` → key='Key', dynamic=false.  `@@Key` → dynamic=true.
export interface StaticResourceValue   { kind: 'static-resource';    key: string;      span: SourceSpan; }
export interface DynamicResourceValue  { kind: 'dynamic-resource';   key: string;      span: SourceSpan; }
// `#1` (positional) or `#bg` (named) inside a macro body.
export interface MacroHoleValue        { kind: 'macro-hole';         name: string;     span: SourceSpan; }
// `$( … )$` — raw expression text; parsing deferred to a later phase.
export interface InlineExprValue       { kind: 'inline-expr';        raw: string;      span: SourceSpan; }
// `x:root` with no value — placeholder for "set this flag."
export interface FlagValue             { kind: 'flag';                                  span: SourceSpan; }
