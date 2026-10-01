import type { ICommand, ServiceToken } from '../../../runtime/index.js';
import type { CommandContext } from './command-context.js';

// Resolves a command id (in some CommandContext) to the ICommand that executes
// it, already bound to that context. Replaces the old ICommandTarget: Execute +
// CanExecute + change-notification all travel on the returned command, and
// there is one mechanism for every surface (toolbar, main menu, hierarchy node
// menus).
export interface ICommandDispatcher
{
    Resolve(commandId: string, context: CommandContext): ICommand | undefined;
}

// Duck-type guard — mirrors isCommandContextSource below. An active document is
// a command dispatcher when it exposes a Resolve method.
export function isCommandDispatcher(value: unknown): value is ICommandDispatcher
{
    return typeof (value as Partial<ICommandDispatcher>)?.Resolve === 'function';
}

// The active document's command-visibility surface: the live contexts the
// toolbar filters commands by. Split from ICommandDispatcher (which runs
// commands) — a document may expose one, both, or neither.
export interface ICommandContextSource
{
    readonly CommandContexts: readonly ServiceToken<unknown>[];
}

export function isCommandContextSource(value: unknown): value is ICommandContextSource
{
    return typeof value === 'object' && value !== null
        && (value as Partial<ICommandContextSource>).CommandContexts !== undefined;
}
