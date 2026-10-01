import type { CommandDefinition } from './command-definition.js';
import type { CommandContext } from './command-context.js';

// Supplies a command's dynamic children at build time, merged AFTER its statically
// declared Children. Named by a CommandDefinition.ChildrenContributor ServiceToken;
// resolved lazily (on submenu expand) and may recurse (a produced child may carry
// its own ChildrenContributor).
export interface ICommandContributor
{
    Contribute(parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[];
}
