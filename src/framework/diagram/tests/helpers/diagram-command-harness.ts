import { DiagramDocument } from '../../diagram-document.js';
import { Diagram } from '../../diagram.js';

// A DiagramDocument published against a bare Diagram view — real enough that
// DiagramDocument.Resolve's dispatch plumbing (ActiveView lookup, the command
// getter/active maps) runs unmodified, but without building any actual canvas
// selection or bold text run. `options.bold` sets the view's SelectionBold DP
// directly — the same DP diagram-dispatcher.test.ts's toggle predicate reads —
// so the test can flip it without round-tripping through real text editing.
export interface DiagramCommandHarnessOptions
{
    bold?: boolean;
}

export function makeDiagramDocumentWithSelection(options?: DiagramCommandHarnessOptions): DiagramDocument
{
    const doc  = new DiagramDocument();
    const view = new Diagram();
    view.SelectionBold = options?.bold ?? false;
    doc.ActiveView = view;
    return doc;
}
