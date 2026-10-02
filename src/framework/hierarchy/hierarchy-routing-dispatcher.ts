import type { ICommand } from '../../runtime/index.js';
import type { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';

// A per-open dispatcher that routes a command id to the contributor that
// supplied it. BuildActions builds the id→contributor map (each action plus its
// descendant submenu ids) and hands this to one CommandMenuBuilder, so every
// resolved command dispatches through its own owner while CommandMenuBuilder is
// reused unchanged. A map MISS falls back to the distinct contributors behind
// `routes` (see Resolve) — ids that only exist past the map, such as a
// lazily-realized ChildrenContributor submenu id, still resolve.
export class HierarchyRoutingDispatcher implements ICommandDispatcher
{
    private readonly fallbacks: readonly ICommandDispatcher[];

    constructor(private readonly routes: ReadonlyMap<string, ICommandDispatcher>)
    {
        this.fallbacks = [...new Set(routes.values())];
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        const direct = this.routes.get(commandId);
        if (direct !== undefined) return direct.Resolve(commandId, context);
        // Lazily-realized ChildrenContributor submenu ids aren't in `routes`
        // (they're produced at submenu-open, after BuildActions built the map);
        // route them to the first contributor that recognizes the id. A
        // contributor returns undefined for ids it doesn't own, so first
        // non-undefined wins — the owning contributor. (DR6 / Review Focus 1.)
        for (const dispatcher of this.fallbacks)
        {
            const command = dispatcher.Resolve(commandId, context);
            if (command !== undefined) return command;
        }
        return undefined;
    }
}
