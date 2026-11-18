import type { Connector } from '../connector.js';

// Board.DeleteRequested — fired when the user presses Delete /
// Backspace with a non-empty selection. Same event-based mutation
// contract as Group / Ungroup / Combine: the framework knows what
// the user asked to remove, but not where the items live; the
// consumer's listener does the data-collection mutation.
//
// `Items` is the snapshot of SelectedItems at keypress time — the
// listener can rely on it being stable (the framework doesn't mutate
// it after fire), which matters when the consumer clears selection
// as part of the removal.
//
// `Connectors` is the parallel snapshot from Board.SelectedConnectors
// (see § 12 of [docs/connectors.md](../../../../docs/connectors.md)
// and the § 7.3 recommendation for a two-channel selection API). When
// a Delete fires with only connectors selected, `Items` is empty and
// `Connectors` carries the snapshot; mixed-kind selections deliver
// both.
export interface DeleteRequestedArgs
{
    readonly Items:      readonly unknown[];
    readonly Connectors: readonly Connector[];
    // Whether Shift was held — lets a consumer distinguish a plain delete
    // (remove from view) from Shift+Delete (a harder/destructive variant, e.g.
    // removing the underlying model entity). The standard mutator ignores it.
    readonly Shift:      boolean;
}

export type DeleteRequestedListener = (args: DeleteRequestedArgs) => void;
