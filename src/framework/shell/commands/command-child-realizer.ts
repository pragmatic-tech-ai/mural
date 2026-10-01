import type { CommandViewModel } from './command-view-model.js';

// Strategy that populates a CommandViewModel's Children on first expand. A real
// interface (not a lambda seam): CommandMenuBuilder implements it so the VM can
// stay a dumb view-model while deferring child construction to the builder that
// owns the dispatcher + provider. Resolved at most once per VM (see
// CommandViewModel.EnsureExpanded).
export interface ICommandChildRealizer
{
    RealizeChildren(parent: CommandViewModel): void;
}
