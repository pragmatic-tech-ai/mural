import { MuralBase } from '../../../runtime/index.js';

// Group / Ungroup commands fire framework events on Board (consumer
// subscribes via Board.AddGroupRequestedListener / AddUngroupRequestedListener).
// The framework does NOT mutate the consumer's data collection — Board
// has no knowledge of where the items live or how to materialize a group.
//
// The consumer's listener typically:
//   * GroupRequested  → creates a new IGroup instance, re-parents Items
//                       to it, adds the new group to its collection
//   * UngroupRequested → re-parents each Group's Members back to their
//                       grandparent, removes the Group from its collection
//
// Pure helpers in this file: identify the top-level subset of a
// selection (used by CanExecute gating) and detect group-shape entities.

// Walk Parent links up to the root. Same algorithm as the demo's
// topLevelOf — returns the entity itself when Parent is absent.
// Used to elevate clicked leaves to their outermost containing group.
function topLevelOf(entity: MuralBase): MuralBase
{
    let cur: { Parent?: unknown } = entity as unknown as { Parent?: unknown };
    while (cur.Parent !== undefined)
    {
        cur = cur.Parent as { Parent?: unknown };
    }
    return cur as unknown as MuralBase;
}

// Reduce a selection (potentially mixing nested members + their group
// ancestors) to the SET of outermost ancestors. De-duplicated so
// selecting both a group and its members yields just the group once.
// Group / Ungroup operate on this set, never on nested members
// directly — matches Visio / PowerPoint semantics where selecting
// inside a group operates on the group as a unit.
export function selectedTopLevel(selectedItems: readonly unknown[]): MuralBase[]
{
    const out = new Set<MuralBase>();
    for (const item of selectedItems)
    {
        if (item instanceof MuralBase) out.add(topLevelOf(item));
    }
    return [...out];
}

// Filter the top-level set to entries that look like a group. The
// duck-type contract is `Members` present (any value — collection
// shape; Group has it via DataContext semantics, GroupVM has it
// directly as `_members`). Consumers' group VM classes are duck-
// typed; the framework does no `instanceof` check.
export function selectedTopLevelGroups(selectedItems: readonly unknown[]): MuralBase[]
{
    return selectedTopLevel(selectedItems).filter(isGroupShape);
}

export function isGroupShape(item: unknown): item is MuralBase
{
    if (!(item instanceof MuralBase)) return false;
    return 'Members' in (item as object);
}

// Recursively walk Members on every selected group-shaped item, returning
// the flat list of LEAF entries (anything not group-shaped). Used by
// FormatMirror to broadcast fill/stroke into every leaf transitively
// inside any selected group, without the consumer needing a separate
// "expand groups" pass.
//
// De-duped — a selection containing both a group and one of its members
// emits the member only once. Iteration over `Members` is duck-typed:
// supports both `ObservableCollection` (Count + Get) and plain
// `Iterable<unknown>`.
export function flattenToLeaves(selectedItems: readonly unknown[]): MuralBase[]
{
    const seen = new Set<MuralBase>();
    const out:  MuralBase[] = [];
    const visit = (entity: unknown): void => {
        if (!(entity instanceof MuralBase)) return;
        if (isGroupShape(entity))
        {
            const members = (entity as unknown as { Members: unknown }).Members;
            iterateMembers(members, visit);
            return;
        }
        if (!seen.has(entity)) { seen.add(entity); out.push(entity); }
    };
    for (const item of selectedItems) visit(item);
    return out;
}

function iterateMembers(members: unknown, fn: (m: unknown) => void): void
{
    const indexable = members as { Count?: number; Get?(i: number): unknown };
    if (typeof indexable.Count === 'number' && typeof indexable.Get === 'function')
    {
        for (let i = 0; i < indexable.Count; i++) fn(indexable.Get(i));
        return;
    }
    const iterable = members as Iterable<unknown>;
    if (typeof (iterable as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function')
    {
        for (const m of iterable) fn(m);
    }
}

// Event args for the Board's GroupRequested / UngroupRequested
// events. Plain readonly records — no class hierarchy needed.
//
// GroupRequested.Items: the top-level set the consumer should wrap
// in a new group. UngroupRequested.Groups: the top-level group set
// the consumer should dissolve.

export interface GroupRequestedArgs
{
    readonly Items: readonly MuralBase[];
}

export interface UngroupRequestedArgs
{
    readonly Groups: readonly MuralBase[];
}

export type GroupRequestedListener   = (args: GroupRequestedArgs)   => void;
export type UngroupRequestedListener = (args: UngroupRequestedArgs) => void;
