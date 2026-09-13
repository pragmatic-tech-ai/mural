import {
    ApplicationService,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { DocumentDefinition } from './document-definition.js';

// The app's document-type registry: aggregates every composed module's declared
// DocumentDefinitions into one queryable set.
//
// Definitions flow module → service exactly as SettingDefinitions flow into
// ApplicationSettings and Capabilities into NavigationService: resolve the
// ApplicationService, iterate its Modules, and up-cast each IShellModule to the
// concrete ShellModule to read its `Documents` (DocumentDefinition is above the
// runtime IShellModule contract, so it is read through the documented up-cast
// seam, not the runtime interface).
//
// Two lookup indexes back the future consumers:
//   • by Type      — a commands service maps the active document's type → its
//                    CommandContexts to drive toolbar visibility.
//   • by extension — a file-open flow matches a path's extension → the type's
//                    Factory to create the IDocument.
//
// `Definitions` is a DP-backed ObservableCollection so a "new document" gallery
// binds `ItemsSource = $Definitions`. Auto-registered by EditorShell (like
// ApplicationSettings), so any shell app gets it for free.
export class DocumentTypeRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<DocumentTypeRegistry>('DocumentTypeRegistry');

    private readonly _definitions = new ObservableCollection<DocumentDefinition>();

    private readonly _byType = new Map<string, DocumentDefinition>();
    private readonly _byExtension = new Map<string, DocumentDefinition>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    public get Definitions(): ObservableCollection<DocumentDefinition>
    {
        return this._definitions;
    }

    // Aggregate every module's declared document types. One-shot: modules are
    // fully composed by the time a shell resolves this service (same contract as
    // ApplicationSettings.PopulateFromModules). Idempotent — a definition whose
    // Type is already present is skipped, so a re-call after a late module add
    // only picks up the new ones.
    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        for (const module of app.Modules)
        {
            for (const definition of (module as ShellModule).Documents)
            {
                this.addDefinition(definition);
            }
        }
    }

    // The definition for a document type id, or undefined when unknown.
    public GetByType(type: string): DocumentDefinition | undefined
    {
        return this._byType.get(type);
    }

    // The definition that opens a given file extension (leading dot optional,
    // case-insensitive), or undefined when no type claims it.
    public GetByExtension(extension: string): DocumentDefinition | undefined
    {
        return this._byExtension.get(normalizeExtension(extension));
    }

    private addDefinition(definition: DocumentDefinition): void
    {
        // Dedupe by Type — a definition whose type is already registered is
        // skipped (first module to declare a type wins). Type-less definitions
        // (empty Type) are still indexed by their extensions.
        if (definition.Type !== '')
        {
            if (this._byType.has(definition.Type)) return;
            this._byType.set(definition.Type, definition);
        }
        for (const ext of definition.FileExtensions)
        {
            const key = normalizeExtension(ext);
            // First claim wins — don't let a later type steal an extension.
            if (!this._byExtension.has(key)) this._byExtension.set(key, definition);
        }
        this.Definitions.Add(definition);
    }
}

// Lowercase + ensure a single leading dot, so ".DGM", "dgm", and ".dgm" all key
// the same entry.
function normalizeExtension(extension: string): string
{
    const lower = extension.toLowerCase();
    return lower.startsWith('.') ? lower : '.' + lower;
}
