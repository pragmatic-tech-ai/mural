import { Application, type ValueConverter } from '../../runtime/index.js';
import type { Geometry } from '../../visual-engine/index.js';

// DR10 — `HierarchyItem.IconKey` is a plain STRING and the repo has no
// existing string-key -> visual resolver. This converter is the smallest
// bridge from that per-item string into the resource system: it treats the
// bound key as a RESOURCE KEY and resolves it through
// `Application.ResolveDefaultResource` — the same application-level tier
// `DynamicResource` itself falls back to for a non-Visual host (see
// runtime/binding/dynamic-resource.ts's `refresh()`). An empty or
// unresolved key converts to `undefined`, which `Shape.Geometry` documents
// as "renders nothing" (basic/shapes/shape.ts) — so the icon slot stays
// present but visually empty.
//
// Deliberately NOT a full `DynamicResource` binding: that machinery
// re-resolves reactively against an ANCESTOR ResourceDictionary chain for a
// FIXED key known at compile time (`@Foo`). Here the key itself is a
// per-item BINDING value (`$IconKey`), which only a converter sitting in
// the binding pipeline (`$IconKey << HierarchyIconKeyToGeometry`) can
// observe — the converter re-runs whenever the DataContextBinding
// re-evaluates (IconKey's own PropertyChanged). That covers the expected
// case — an icon set registered once on `Application.Resources` by the
// active theme/module — without the added ancestor-chain reactivity a full
// DynamicResource would need for a dynamic key. If a hierarchy consumer
// ever needs icons resolved from a LOCAL (non-Application) dictionary
// instead, that's a job for Task 12's theme wiring, not this converter.
export class HierarchyIconKeyConverter implements ValueConverter
{
    public convert(value: unknown): Geometry | undefined
    {
        if (typeof value !== 'string' || value.length === 0) return undefined;
        return Application.ResolveDefaultResource<Geometry>(value);
    }
}

// Bare converter instance — referenced from markup without a call,
// `$IconKey << HierarchyIconKeyToGeometry`, matching the existing bare
// converter convention (e.g. `runtime/binding/value-converters.ts`'s
// `ToVisibility`).
export const HierarchyIconKeyToGeometry: ValueConverter = new HierarchyIconKeyConverter();
