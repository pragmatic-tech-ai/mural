import { MuralBase } from '../../../runtime/index.js';
import { findDescriptor, resolveKey } from '../../../runtime/model-internals.js';
import type { Board } from '../board.js';

// Mirror Board.SelectedItems onto a per-item `IsSelected` DP — the
// data-side selection convention shared by Visio / drawio-style demos.
// Opt-in via `Board.ReflectSelectionToItems = true`; default off so
// Selector consumers that don't carry `IsSelected` on their items
// (plain ListBox-style consumers) pay nothing.
//
// "Elevation" rule: clicking ANY entity walks the Parent chain to the
// outermost ancestor, and only that ancestor receives IsSelected=true.
// Members of a selected group stay IsSelected=false so the group's own
// chrome (typically a bbox border) is the single selection visualization
// the user sees.
//
// IsSelected presence is duck-typed via findDescriptor — items without
// the DP are skipped silently. Items that DO have it are written through
// resolveKey + set_property_value_with_key, the same pattern
// SelectionBoundsTracker / BoardSelectionSource use for the geometry
// quartet.
export class SelectionReflector
{
    private readonly _board: Board;
    // Items currently marked IsSelected=true by this reflector. Tracked
    // so a SelectionChanged that drops an item lets us flip its
    // IsSelected back to false without iterating the entire ItemsSource.
    private _reflected: Set<MuralBase> = new Set();

    constructor(board: Board)
    {
        this._board = board;
        board.AddSelectionChangedListener(() => this._reflect());
    }

    // Invoked on every SelectionChanged. Read the DP at fire time so
    // toggling ReflectSelectionToItems false picks up on the very next
    // selection change (no need for a separate DP listener).
    private _reflect(): void
    {
        if (!this._board.ReflectSelectionToItems)
        {
            this._clearAll();
            return;
        }

        // Next selection — elevate every selected entity to its outermost
        // ancestor via the Parent chain. Deduped through Set so multiple
        // members of the same group collapse to one entry.
        const next: Set<MuralBase> = new Set();
        for (const item of this._board.SelectedItems)
        {
            if (item instanceof MuralBase) next.add(topLevelOf(item));
        }

        // Clear items that left the reflected set.
        for (const m of this._reflected)
        {
            if (!next.has(m)) this._setIsSelected(m, false);
        }
        // Set items that entered.
        for (const m of next)
        {
            if (!this._reflected.has(m)) this._setIsSelected(m, true);
        }
        this._reflected = next;
    }

    private _clearAll(): void
    {
        if (this._reflected.size === 0) return;
        for (const m of this._reflected) this._setIsSelected(m, false);
        this._reflected = new Set();
    }

    private _setIsSelected(item: MuralBase, value: boolean): void
    {
        // Duck-type — items without an IsSelected DP (plain data rows
        // not designed for this convention) are silently skipped.
        const desc = findDescriptor(item.constructor as Function, 'IsSelected');
        if (desc === undefined) return;
        const key = resolveKey(item, undefined, 'IsSelected');
        item.set_property_value_with_key(key, value);
    }
}

// Walk Parent links up to the outermost ancestor. Returns the entity
// itself when Parent is absent (already top-level). Item-shape is
// duck-typed — anything with a `Parent` property participates;
// consumers don't have to subclass a framework type to opt in.
function topLevelOf(entity: MuralBase): MuralBase
{
    let cur: { Parent?: unknown } = entity as unknown as { Parent?: unknown };
    while (cur.Parent !== undefined && cur.Parent !== null)
    {
        cur = cur.Parent as { Parent?: unknown };
    }
    return cur as unknown as MuralBase;
}
