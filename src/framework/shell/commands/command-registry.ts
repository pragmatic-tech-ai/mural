import {
    ApplicationService,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { CommandDefinition } from './command-definition.js';

// The app's command registry: aggregates every composed module's declared
// CommandDefinitions into one queryable set.
//
// Definitions flow module → service exactly as SettingDefinitions flow into
// ApplicationSettings and DocumentDefinitions into DocumentTypeRegistry: resolve
// the ApplicationService, iterate its Modules, and up-cast each IShellModule to
// the concrete ShellModule to read its `Commands`.
//
// A single flat set — the ToolbarService filters it per active document (by
// Context) and orders the survivors by Group/Order. `Commands` is a DP-backed
// ObservableCollection; `_byId` gives O(1) GetById. Auto-registered by
// EditorShell, so any shell app gets it for free.
export class CommandRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<CommandRegistry>('CommandRegistry');

    private readonly _commands = new ObservableCollection<CommandDefinition>();

    private readonly _byId = new Map<string, CommandDefinition>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    public get Commands(): ObservableCollection<CommandDefinition>
    {
        return this._commands;
    }

    // Aggregate every module's declared commands. One-shot: modules are fully
    // composed by the time a shell resolves this service (same contract as
    // ApplicationSettings / DocumentTypeRegistry). Idempotent — a definition
    // whose Id is already present is skipped, so a re-call after a late module
    // add only picks up the new ones.
    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        for (const module of app.Modules)
        {
            for (const definition of (module as ShellModule).Commands)
            {
                this.addDefinition(definition);
            }
        }
    }

    // The definition for a command id, or undefined when unknown.
    public GetById(id: string): CommandDefinition | undefined
    {
        return this._byId.get(id);
    }

    private addDefinition(definition: CommandDefinition): void
    {
        // Dedupe by Id (first module to declare an id wins). Id-less definitions
        // are dropped — a command with no id can't be dispatched.
        if (definition.Id === '' || this._byId.has(definition.Id)) return;
        this._byId.set(definition.Id, definition);
        this.Commands.Add(definition);
    }
}
