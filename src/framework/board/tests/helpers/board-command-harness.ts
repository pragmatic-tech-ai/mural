import { BoardDocument } from '../../board-document.js';
import { Board } from '../../board.js';

// A BoardDocument published against a bare Board view — real enough that
// BoardDocument.Resolve's dispatch plumbing (ActiveView lookup, the command
// getter/active maps) runs unmodified, but without building any actual canvas
// selection or bold text run. `options.bold` sets the view's SelectionBold DP
// directly — the same DP board-dispatcher.test.ts's toggle predicate reads —
// so the test can flip it without round-tripping through real text editing.
export interface BoardCommandHarnessOptions
{
    bold?: boolean;
}

export function makeBoardDocumentWithSelection(options?: BoardCommandHarnessOptions): BoardDocument
{
    const doc  = new BoardDocument();
    const view = new Board();
    view.SelectionBold = options?.bold ?? false;
    doc.ActiveView = view;
    return doc;
}
