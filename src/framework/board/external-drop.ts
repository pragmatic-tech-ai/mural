import type { Point } from '../../runtime/index.js';
import type { ContainerFigure } from './container-figure.js';

// Well-known drag formats mural's html-target places on the DataObject for OS
// drops. `Files` carries a FileList; `text/uri-list` carries newline-separated
// URIs (RFC 2483 — lines beginning with '#' are comments). These mirror the
// synthetic keys osDataObjectFrom() writes at the DOM boundary.
export enum MuralDataFormat
{
    Files   = 'Files',
    UriList = 'text/uri-list',
}

// Fired when the user drops OS content (files dragged from the file manager, a
// link dragged from a browser) onto the board — as opposed to an internal
// toolbox item. The framework doesn't interpret the payload; the consumer's
// listener turns Files/Uris into nodes.
export interface ExternalDroppedArgs
{
    readonly Files:            readonly File[];
    readonly Uris:             readonly string[];
    readonly Position:         Point;
    // The innermost container under the drop point (undefined over empty canvas).
    readonly TargetContainer?: ContainerFigure;
}

export type ExternalDroppedListener = (args: ExternalDroppedArgs) => void;

// Parse an RFC 2483 text/uri-list payload: split on newlines, trim, and drop
// comment lines ('#') and blanks.
export function parseUriList(text: string): string[]
{
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}
