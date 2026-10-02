import type { IDisposable } from '../../runtime/index.js';
import type { HierarchyItem, HierarchyItemInit } from './hierarchy-item.js';
import type { NodeContribution } from './hierarchy-contribution.js';

// A drag payload offered to a provider's CanAccept.
export interface DropData
{
    readonly Kind: string;
    readonly Payload: unknown;
}

// The Order-scoped child sink a provider receives in Realize. InsertChild /
// RemoveChild operate on the parent's own observable Children, placing children
// inside this provider's Order segment (see DR3). NewItem mints a child item
// bound to the owning Hierarchy (id allocation + owner wiring).
export interface IRealizeContext
{
    NewItem(key: string, init?: HierarchyItemInit): HierarchyItem;
    InsertChild(child: HierarchyItem): void;
    RemoveChild(child: HierarchyItem): void;
}

// A provider owns a sub-branch: it populates and maintains item.Children via the
// realize context and returns an IDisposable that tears its watches down.
export interface IHierarchyProvider
{
    readonly ProviderId: string;
    Realize(item: HierarchyItem, context: IRealizeContext): IDisposable;
    Integrate(item: HierarchyItem, contributions: readonly NodeContribution[]): void;
    GetCanonicalName(item: HierarchyItem): string;
    ParseCanonicalName(name: string): HierarchyItem | undefined;   // undefined if not found
    CanAccept(target: HierarchyItem, drop: DropData): boolean;
}
