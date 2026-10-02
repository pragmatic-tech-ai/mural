import type { ItemId } from './item-id.js';
import type { DropData } from './hierarchy-provider.js';

// The one drop kind P3 introduces: a move of hierarchy items. Encodes the dragged item
// ids in DropData.Payload under a fixed Kind so a provider's CanAccept can decode them.
export class HierarchyItemsDrop
{
    public static readonly Kind = 'hierarchy:items';

    public static For(items: readonly ItemId[]): DropData
    {
        return { Kind: HierarchyItemsDrop.Kind, Payload: items };
    }

    public static ItemsOf(drop: DropData): readonly ItemId[] | undefined
    {
        return drop.Kind === HierarchyItemsDrop.Kind ? (drop.Payload as readonly ItemId[]) : undefined;
    }
}
