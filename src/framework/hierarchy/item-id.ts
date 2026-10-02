// A transient, within-tree item handle. CanonicalName (string) is the durable
// cross-session identity; ItemId only identifies an item inside one live tree.
export type ItemId = number;

// The reserved "no item" handle. The allocator never mints it.
export const NoneId: ItemId = 0;

// Per-Hierarchy monotonic id source. Mints from 1 so NoneId (0) is always free.
export class ItemIdAllocator
{
    private next: ItemId = 1;

    public Mint(): ItemId
    {
        const id = this.next;
        this.next += 1;
        return id;
    }
}
