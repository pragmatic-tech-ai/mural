// Pure z-order math for a set of siblings. Injects a ZAccess so the module
// stays free of Panel / Figure (the board wraps it with Panel.Get/SetZIndex).
//
// All four modes are one operation: take siblings in current effective order
// (stable sort by z, insertion index breaking ties), rearrange the selected
// items within that array, then renumber every sibling 0..n-1 by new position.
// Renumbering (vs swapping) is correct even when siblings share the default z 0.

export enum ZOrderMode
{
    Front    = 'front',
    Back     = 'back',
    Forward  = 'forward',
    Backward = 'backward',
}

export interface ZAccess<T>
{
    get(item: T): number;
    set(item: T, z: number): void;
}

export function reorderZ<T>(
    mode: ZOrderMode,
    selected: readonly T[],
    siblings: readonly T[],
    z: ZAccess<T>,
): void
{
    if (selected.length === 0 || siblings.length === 0) return;
    const sel = new Set<T>(selected);

    // Current effective order (low->high). `siblings` is insertion order and
    // Array.prototype.sort is stable, so equal-z items keep insertion order.
    const order = [...siblings].sort((a, b) => z.get(a) - z.get(b));

    let next: T[];
    switch (mode)
    {
        case ZOrderMode.Front:
            next = [...order.filter(x => !sel.has(x)), ...order.filter(x => sel.has(x))];
            break;
        case ZOrderMode.Back:
            next = [...order.filter(x => sel.has(x)), ...order.filter(x => !sel.has(x))];
            break;
        case ZOrderMode.Forward:
            next = shiftUp(order, sel);
            break;
        case ZOrderMode.Backward:
            next = shiftDown(order, sel);
            break;
    }

    // Renumber by new position: distinct, compact, reflects the new order.
    next.forEach((item, i) => z.set(item, i));
}

// Move each selected item up (toward the top / higher index) past the nearest
// non-selected neighbor. Iterate top-down so a contiguous selected block moves
// as a unit without members leapfrogging each other.
function shiftUp<T>(order: readonly T[], sel: ReadonlySet<T>): T[]
{
    const a = [...order];
    for (let i = a.length - 2; i >= 0; i--)
    {
        if (sel.has(a[i]!) && !sel.has(a[i + 1]!))
        {
            const tmp = a[i]!; a[i] = a[i + 1]!; a[i + 1] = tmp;
        }
    }
    return a;
}

// Mirror of shiftUp toward the bottom / index 0.
function shiftDown<T>(order: readonly T[], sel: ReadonlySet<T>): T[]
{
    const a = [...order];
    for (let i = 1; i < a.length; i++)
    {
        if (sel.has(a[i]!) && !sel.has(a[i - 1]!))
        {
            const tmp = a[i]!; a[i] = a[i - 1]!; a[i - 1] = tmp;
        }
    }
    return a;
}
