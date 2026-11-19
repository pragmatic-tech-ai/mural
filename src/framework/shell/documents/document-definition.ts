import {
    MetaData,
    MuralBase,
    type ServiceToken,
} from '../../../runtime/index.js';

// Shared frozen defaults — DP default values are shared across instances, so the
// empty lists must be immutable (markup replaces them with a fresh array).
const EMPTY_EXTENSIONS: readonly string[] = Object.freeze([]);
const EMPTY_CONTEXTS: readonly ServiceToken<unknown>[] = Object.freeze([]);

// A document TYPE's schema — what a module declares in its `.documents:` block.
// It says what a document type IS (id, display, the extensions it opens, the
// factory that creates it, the command contexts it activates); the live,
// per-instance document is an IDocument a factory builds (from a file or blank).
//
// A MuralBase so it is DP-backed, bindable, and declarable in markup — the same
// shape as SettingDefinition:
//
//     module BoardModule [ Name = "Board" ] {
//         .documents: {
//             DocumentDefinition
//                 [ Type            = "board",
//                   Title           = "Board",
//                   Description     = "A node-and-connector board.",
//                   FileExtensions  = [".board", ".dgm"],
//                   Factory         = BoardDocumentFactory,
//                   CommandContexts = [BoardEditingContext, BoardShapeContext] ]
//         }
//     }
//
// `.documents:` is a generic member-block: each entry lowers to
// `module.Documents.Add(def)` (the compiler remaps the lowercase section name to
// the PascalCase `Documents` collection, exactly as `.settings:` → `Settings`),
// so no bespoke grammar is needed — only the symbol-table registration of
// DocumentDefinition. DocumentTypeRegistry aggregates these across every
// composed module.
export class DocumentDefinition extends MuralBase
{
    // Stable id for the document type ("board", "settings"). The registry key,
    // and the correlation point a future commands service uses to map an active
    // document → its type → CommandContexts. Namespace by module.
    public static readonly TypeKey = MuralBase.RegisterProperty<string>(
        DocumentDefinition, 'Type', '', MetaData.None);

    // Display name — a new-document menu / tab title binds this.
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        DocumentDefinition, 'Title', '', MetaData.None);

    // Longer help text (a new-document gallery entry, a tooltip).
    public static readonly DescriptionKey = MuralBase.RegisterProperty<string>(
        DocumentDefinition, 'Description', '', MetaData.None);

    // File extensions this type opens (leading dot, matched case-insensitively:
    // ".board"). A file-open flow matches an extension here to pick the type
    // and its Factory. Authored as a markup list — `[".board", ".dgm"]`.
    public static readonly FileExtensionsKey = MuralBase.RegisterProperty<readonly string[]>(
        DocumentDefinition, 'FileExtensions', EMPTY_EXTENSIONS, MetaData.None);

    // The DI token of the factory that creates / opens documents of this type
    // (a future IDocumentFactory). A real reference in markup (`Factory =
    // SomeFactory`), resolved through the container like Capability.ServiceKey.
    public static readonly FactoryKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        DocumentDefinition, 'Factory', undefined, MetaData.None);

    // Command-context tokens this document type activates while it is the active
    // document. A future commands service shows toolbar commands tagged with any
    // active context and hides the rest — the tokens are opaque identity tags
    // (ServiceKeys used as keys), NOT services to resolve. Authored as a markup
    // list of real references — `[BoardEditingContext, BoardShapeContext]`.
    public static readonly CommandContextsKey = MuralBase.RegisterProperty<readonly ServiceToken<unknown>[]>(
        DocumentDefinition, 'CommandContexts', EMPTY_CONTEXTS, MetaData.None);

    public get Type(): string  { return this.get_property_value(DocumentDefinition.TypeKey); }
    public set Type(v: string) { this.set_property_value(DocumentDefinition.TypeKey, v); }

    public get Title(): string  { return this.get_property_value(DocumentDefinition.TitleKey); }
    public set Title(v: string) { this.set_property_value(DocumentDefinition.TitleKey, v); }

    public get Description(): string  { return this.get_property_value(DocumentDefinition.DescriptionKey); }
    public set Description(v: string) { this.set_property_value(DocumentDefinition.DescriptionKey, v); }

    public get FileExtensions(): readonly string[]  { return this.get_property_value(DocumentDefinition.FileExtensionsKey); }
    public set FileExtensions(v: readonly string[]) { this.set_property_value(DocumentDefinition.FileExtensionsKey, v); }

    public get Factory(): ServiceToken<unknown> | undefined  { return this.get_property_value(DocumentDefinition.FactoryKey); }
    public set Factory(v: ServiceToken<unknown> | undefined) { this.set_property_value(DocumentDefinition.FactoryKey, v); }

    public get CommandContexts(): readonly ServiceToken<unknown>[]  { return this.get_property_value(DocumentDefinition.CommandContextsKey); }
    public set CommandContexts(v: readonly ServiceToken<unknown>[]) { this.set_property_value(DocumentDefinition.CommandContextsKey, v); }
}
