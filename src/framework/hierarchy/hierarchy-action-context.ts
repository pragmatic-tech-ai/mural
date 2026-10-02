import { CommandContext } from '../shell/commands/command-context.js';
import type { HierarchyItem } from './hierarchy-item.js';

// The CommandContext a hierarchy node dispatches its commands against: the
// right-clicked item plus the current tree selection.
export class HierarchyActionContext extends CommandContext
{
    constructor(
        public readonly Anchor: HierarchyItem,
        public readonly Selection: readonly HierarchyItem[],
    )
    {
        super();
    }
}
