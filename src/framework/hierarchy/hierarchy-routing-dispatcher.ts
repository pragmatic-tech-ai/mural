import type { ICommand } from '../../runtime/index.js';
import type { CommandContext } from '../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';

// A per-open dispatcher that routes a command id to the contributor that
// supplied it. BuildActions builds the id→contributor map (each action plus its
// descendant submenu ids) and hands this to one CommandMenuBuilder, so every
// resolved command dispatches through its own owner while CommandMenuBuilder is
// reused unchanged.
export class HierarchyRoutingDispatcher implements ICommandDispatcher
{
    constructor(private readonly routes: ReadonlyMap<string, ICommandDispatcher>)
    {
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        return this.routes.get(commandId)?.Resolve(commandId, context);
    }
}
