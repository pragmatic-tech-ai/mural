import type { ICommand } from '../../../runtime/index.js';
import type { CommandContext } from './command-context.js';

// Resolves a command id (in some CommandContext) to the ICommand that executes
// it, already bound to that context. Replaces ICommandTarget: Execute + CanExecute
// + change-notification all travel on the returned command, and there is one
// mechanism for every surface (toolbar, main menu, hierarchy node menus).
export interface ICommandDispatcher
{
    Resolve(commandId: string, context: CommandContext): ICommand | undefined;
}
