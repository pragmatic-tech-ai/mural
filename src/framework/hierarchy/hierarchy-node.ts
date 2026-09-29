// Opaque, provider-interned node handle. Concrete ids are minted by HierarchyModel
// (keyed nodes) or a provider (opaque branches); callers only compare identity. The
// two sentinels are universal: Root = the tree root anchor, Nil = "no such node".
export abstract class HierarchyItemId
{
    protected constructor() {}
    public static readonly Root: HierarchyItemId = new (class extends HierarchyItemId {})();
    public static readonly Nil:  HierarchyItemId = new (class extends HierarchyItemId {})();
    // A fresh, unique handle a provider mints for one of its opaque-branch nodes.
    // Identity is object identity — the provider caches and reuses the instance.
    public static Mint(): HierarchyItemId { return new (class extends HierarchyItemId {})(); }
}

export enum NodeSeverity { Ok, Warning, Error }

// A rendered node: its coarse family Key (NodeKey.*), the engine instance it stands
// for (ExtObject), display facts, and health that drives the error/warning decoration.
export interface HierarchyNode
{
    readonly Key: string;
    readonly Caption: string;
    readonly IconKey: string;
    readonly ExtObject: unknown;
    readonly Severity: NodeSeverity;
    readonly Error?: string;
    // Optional display fact: whether the row should offer an expand affordance before its
    // children are loaded. A keyed contributor sets it (a resolved member → true, a leaf →
    // false); when absent the model falls back to "has a contributor for this Key". Provider
    // nodes answer via the provider's GetProperty(IsExpandable) instead.
    readonly IsExpandable?: boolean;
}

// One channel for async initial load AND external edits.
export abstract class HierarchyChange {}

export class ChildAdded extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}

export class ChildRemoved extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId) { super(); }
}

export class ChildUpdated extends HierarchyChange
{
    // Carries fresh node data so a caption/icon refresh is an in-place swap (id unchanged).
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}

export enum HierarchyPropertyId { Caption, IconKey, IsExpandable, CanonicalName, ExtObject, Severity }

// Minimal drop payload; real drop validation is P3 — P0 ships the contract only.
export interface DropData
{
    readonly Kind: string;
    readonly Payload: unknown;
}

// Owns an opaque subtree: answers ObserveChildren (realize = subscribe), node
// properties, canonical names, and drop-target validation; interns its own handles.
export interface IHierarchyProvider
{
    readonly ProviderId: string;
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void;
    GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown;
    GetCanonicalName(id: HierarchyItemId): string;
    ParseCanonicalName(name: string): HierarchyItemId;   // Nil if not found
    CanAccept(target: HierarchyItemId, drop: DropData): boolean;
}

export abstract class HierarchyContribution {}

export class NodeContribution extends HierarchyContribution
{
    constructor(public readonly Nodes: readonly HierarchyNode[]) { super(); }
}

export class ProviderContribution extends HierarchyContribution
{
    constructor(public readonly Provider: IHierarchyProvider) { super(); }
}

// Registers for a SET of parent families; decides what to return from the actual node
// in the call (parent.Key / parent.ExtObject).
export interface IHierarchyContributor
{
    readonly ParentKeys: readonly string[];
    readonly Order: number;
    Contribute(parent: HierarchyNode): HierarchyContribution;
}
