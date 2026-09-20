import { MuralBase } from '../../../runtime/index.js';
import { GeometryCombineMode } from '../../../visual-engine/geometry/combine.js';

// Re-export so consumers binding to `Diagram.CombineUnionCommand` etc.
// can pick up the mode enum from the same import surface as the
// command DPs / event APIs.
export { GeometryCombineMode };

// Combine commands fire a single CombineRequested event on Diagram
// with the Mode discriminator. Symmetric with the Group / Ungroup
// surface from Phase F — framework does not mutate the consumer's
// data collection (combine produces a new shape and typically
// removes the inputs, both of which require knowledge of where
// shapes live).
//
// Consumers' listener typically:
//   * Walks Items, extracts each one's Geometry
//   * Calls the framework's `combine(a, b, mode)` helper to fold-merge
//   * Constructs a new shape VM with the merged geometry
//   * Removes the input shapes from their collection
//   * Adds the new shape
//
// The pure helper `combineGeometries` below does the fold-merge so
// consumers don't have to repeat it. Input items must duck-type to
// `IGeometricItem` (a `Geometry` property exposing the §19-compatible
// Geometry value). Items without that property are skipped.
//
// CanExecute gate (installed by DiagramCommands): ≥ 2 selected items
// that satisfy IGeometricItem.

export interface IGeometricItem
{
    // The §19 `combine` op accepts any `Geometry` subclass — declared
    // as `unknown` here to avoid the framework depending on a specific
    // PathGeometry shape that consumers might not implement (they may
    // use catalog-shape Geometry, custom PathGeometry, etc.).
    readonly Geometry: unknown;
}

export function isGeometricItem(item: unknown): item is MuralBase & IGeometricItem
{
    if (!(item instanceof MuralBase)) return false;
    const g = (item as unknown as { Geometry?: unknown }).Geometry;
    return g !== undefined && g !== null;
}

export interface CombineRequestedArgs
{
    readonly Items: readonly (MuralBase & IGeometricItem)[];
    readonly Mode:  GeometryCombineMode;
}

export type CombineRequestedListener = (args: CombineRequestedArgs) => void;
