import {
    ApplicationService,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { ProjectFactoryDefinition } from './project-factory-definition.js';

// The app's project-factory registry: aggregates every composed module's
// declared ProjectFactoryDefinitions into one queryable set.
//
// Definitions flow module → service exactly as DocumentDefinitions flow into
// DocumentTypeRegistry: resolve the ApplicationService, iterate its Modules, and
// up-cast each IShellModule to the concrete ShellModule to read its
// `ProjectFactories` (ProjectFactoryDefinition is above the runtime IShellModule
// contract, so it is read through the documented up-cast seam).
//
// One lookup index backs the consumer (a project-explorer service): by Type — an
// Open flow reads a folder's manifest `type`, resolves the matching definition's
// Factory, and delegates open / create / save. `Definitions` is a DP-backed
// ObservableCollection so a "New Project" gallery binds `ItemsSource =
// $Definitions`. Auto-registered by EditorShell (like DocumentTypeRegistry).
export class ProjectFactoryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectFactoryRegistry>('ProjectFactoryRegistry');

    private readonly _definitions = new ObservableCollection<ProjectFactoryDefinition>();

    private readonly _byType = new Map<string, ProjectFactoryDefinition>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    public get Definitions(): ObservableCollection<ProjectFactoryDefinition>
    {
        return this._definitions;
    }

    // Aggregate every module's declared project types. One-shot: modules are
    // fully composed by the time a shell resolves this service (same contract as
    // DocumentTypeRegistry.PopulateFromModules). Idempotent — a definition whose
    // Type is already present is skipped.
    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        for (const module of app.Modules)
        {
            for (const definition of (module as ShellModule).ProjectFactories)
            {
                this.addDefinition(definition);
            }
        }
    }

    // The definition for a project type id, or undefined when unknown.
    public GetByType(type: string): ProjectFactoryDefinition | undefined
    {
        return this._byType.get(type);
    }

    private addDefinition(definition: ProjectFactoryDefinition): void
    {
        // Dedupe by Type — first module to declare a type wins. Type-less
        // definitions are still surfaced in Definitions (for a picker) but not
        // indexed for routing.
        if (definition.Type !== '')
        {
            if (this._byType.has(definition.Type)) return;
            this._byType.set(definition.Type, definition);
        }
        this.Definitions.Add(definition);
    }
}
