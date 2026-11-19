import type { Connector } from '../connector.js';

// Board.CopyRequested — fired on Ctrl+C / Ctrl+X (and the Copy / Cut
// commands) with a non-empty selection. Same event-based contract as
// Delete: the framework knows WHAT the user wants to copy (the selection
// snapshot), but not where the data lives; the consumer's listener writes
// it to the clipboard. Cut is a CopyRequested followed by DeleteRequested,
// so this event carries no "also delete" flag.
//
// `Items` / `Connectors` are the SelectedItems / SelectedConnectors
// snapshots at keypress time — stable, like DeleteRequestedArgs.
export interface CopyRequestedArgs
{
    readonly Items:      readonly unknown[];
    readonly Connectors: readonly Connector[];
}

export type CopyRequestedListener = (args: CopyRequestedArgs) => void;

// Board.PasteRequested — fired on Ctrl+V (and the Paste command). The
// consumer reads the clipboard and materializes its contents. Carries no
// payload today; a future revision may add a target position.
export interface PasteRequestedArgs
{
}

export type PasteRequestedListener = (args: PasteRequestedArgs) => void;
