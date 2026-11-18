import type { ObservableCollection } from '../../../runtime/index.js';

// Mutate `collection` in place so it equals `desired` by key: keep and reuse
// existing instances for matched keys (optionally updating them), remove keys
// no longer desired, insert new ones, and move to match `desired` order. Never
// clears — the ItemsControl then regenerates only the changed containers.
export function reconcile<T>(
    collection: ObservableCollection<T>,
    desired: readonly T[],
    keyOf: (t: T) => string,
    update?: (live: T, next: T) => void,
): void
{
    const desiredKeys = new Set(desired.map(keyOf));
    // 1. Remove live items whose key is no longer desired (back-to-front so
    //    indices stay valid as we splice).
    for (let i = collection.Count - 1; i >= 0; i--)
    {
        if (!desiredKeys.has(keyOf(collection.Get(i)!))) collection.RemoveAt(i);
    }
    // 2. Walk desired order; ensure each key is present at the right index.
    for (let target = 0; target < desired.length; target++)
    {
        const next = desired[target]!;
        const k = keyOf(next);
        let live = -1;
        for (let i = 0; i < collection.Count; i++)
        {
            if (keyOf(collection.Get(i)!) === k) { live = i; break; }
        }
        if (live === -1)
        {
            collection.Insert(target, next);
        }
        else
        {
            if (update !== undefined) update(collection.Get(live)!, next);
            if (live !== target) collection.Move(live, target);
        }
    }
}
