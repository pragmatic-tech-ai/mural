import type { HierarchyItemId, DropData } from './hierarchy-node.js';

// The one drop kind P3 introduces: a move of hierarchy items. Encodes the dragged item
// ids in DropData.Payload under a fixed Kind so a provider's CanAccept can decode them.
export class HierarchyItemsDrop
{
    public static readonly Kind = 'hierarchy:items';

    public static For(items: readonly HierarchyItemId[]): DropData
    {
        return { Kind: HierarchyItemsDrop.Kind, Payload: items };
    }

    public static ItemsOf(drop: DropData): readonly HierarchyItemId[] | undefined
    {
        return drop.Kind === HierarchyItemsDrop.Kind ? (drop.Payload as readonly HierarchyItemId[]) : undefined;
    }
}
