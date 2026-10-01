// DemoCommandDispatcher — the ICommandDispatcher the menu / context-menu /
// commands demos hand to CommandMenuBuilder / CommandContextMenu once they
// move their markup onto the command-driven menu machinery.
//
// Each demo VM builds a catalogue of live RelayCommand / CheckableRelayCommand
// instances — one per leaf CommandDefinition Id — as it constructs its
// CommandDefinition trees, and hands the resulting id → ICommand map to this
// dispatcher. Resolving a command Id to one of THOSE instances (rather than
// minting a fresh command per resolve) is what keeps a migrated demo's
// behaviour identical: clicking the command-driven row runs the exact method
// the pre-migration row ran, through the exact same command, so CanExecute /
// status narration / checkable state keep working unchanged.
//
// A plain id → ICommand map, built once by the demo VM's constructor and
// handed to the dispatcher — no document / selection context is consulted
// (`Resolve`'s `context` parameter is unused; these demos have no notion of
// an "active document" the way the shell's ToolbarService / MainMenuService
// do).
import type { CommandContext, ICommandDispatcher } from '@pragmatic-tech-ai/mural/framework';
import type { ICommand } from '@pragmatic-tech-ai/mural/runtime';

export class DemoCommandDispatcher implements ICommandDispatcher
{
    constructor(private readonly commandsById: ReadonlyMap<string, ICommand>)
    {
    }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        return this.commandsById.get(commandId);
    }
}
