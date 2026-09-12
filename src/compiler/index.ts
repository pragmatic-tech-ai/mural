// Compiler barrel. Public entry points are `compile` (source → JS
// module string) and `instantiate` (source → live Application).
// `Compiler` and lower-level pieces are exported for tooling / tests.

export { compile, instantiate, EmitError, type CompileResult } from './compile.js';
export { format, type FormatOptions } from './format.js';
export { Compiler, type CompilerOptions, type CompilerOutput } from './compiler.js';
export type { IncludeResolver, IncludeResolution } from './compiler.js';
export { svgToGeometryJs, svgToIconJs, type GeometryResourceJs, type DrawingResourceJs } from '../tooling/svg-geometry.js';
export { Lexer } from './lexer.js';
export { Parser, ParseError } from './parser.js';
export {
    TokenKind,
    type Comment,
    type Token,
    type SourceLocation,
    type SourceSpan,
    KEYWORDS,
} from './tokens.js';
export {
    DEFAULT_SYMBOLS,
    ENUM_MEMBERS,
    TYPE_REF_META_ATTRS,
    DEFAULT_SLOT_INFO,
    type SymbolMap,
    type SlotInfo,
} from './symbol-table.js';
export type {
    Attribute,
    AttrPath,
    BindingValue,
    BodyItem,
    BodyNode,
    ColorValue,
    Document,
    DefForm,
    DynamicResourceValue,
    ElementNode,
    FlagValue,
    IdentValue,
    ImportForm,
    InlineExprValue,
    KeyValueResource,
    ListValue,
    MacroHoleValue,
    MacroParam,
    NamedAttr,
    NumberValue,
    PositionalAttr,
    PropertySetter,
    ResourceForm,
    ResourcesBlock,
    SchemeBlock,
    SetterItem,
    SetterList,
    SizeValue,
    SlotAssign,
    StaticResourceValue,
    StringBody,
    StringBodyChunk,
    StringValue,
    StructuredBody,
    TemplateBindingValue,
    TemplateSelectorBody,
    TextChunk,
    ThemeBlock,
    TopForm,
    TriggerAnd,
    TriggerExpr,
    TriggerGroup,
    TriggerOr,
    TriggerTerm,
    TupleValue,
    ValueNode,
    XAttr,
} from './ast.js';
