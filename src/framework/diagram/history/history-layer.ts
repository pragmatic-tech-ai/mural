// Identifies a registered snapshot layer. Real enum (repo rule: no string unions).
export enum HistoryLayerId
{
    Diagram = 'diagram',
    Model   = 'model',
}

// A pluggable snapshot layer. Snapshots are opaque to the engine; the layer
// captures, compares, restores, and (optionally) reconciles after a restore.
export interface IHistoryLayer
{
    readonly Id: HistoryLayerId;
    Capture(): unknown;
    Equals(a: unknown, b: unknown): boolean;
    Restore(snapshot: unknown): void;
    // Optional post-restore reconciliation, run once after all layers of an entry
    // have been restored (e.g. the model layer fires one rescan + save here).
    Reconcile?(): void;
}
