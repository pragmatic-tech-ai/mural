// diagram demo bootstrap — node-only scene with marquee multi-select.
//
// Every data class lives in the framework now: DiagramDocument owns
// the Nodes / Status / Save+Load + the structural mutation methods,
// Figure / Group are the canvas items themselves (visuals + data
// fused), and the toolbox palette lives in the framework
// ToolboxRepository (a Services singleton the Diagram first-inits with
// a built-in Shapes page). The demo just creates a Document, plugs in
// localStorage, seeds a few Figures, and returns it for the platform
// to mount.

import { Application } from '@pragmatic-tech-ai/mural/runtime';
import { ConnectorEndpoint, DiagramDocument, DiagramStorageKey, TextPlacement, TextAutoFit, TextNode, Callout, deserializeFlowDocument, documentWithFields, ensureToolboxDefaults } from '@pragmatic-tech-ai/mural/framework';

let docInstance;

export default {
    id:       'diagram',
    title:    'Diagrammer',
    subtitle: 'Drag shapes from the toolbox; drag a node to move; click / marquee to select; Delete to remove.',
    factory: () => {
        if (docInstance === undefined) {
            // Ensure the toolbox repository + built-in Shapes page exist so the
            // strip's $service(ToolboxRepository) binding resolves regardless of
            // when the Diagram control is constructed. Idempotent.
            ensureToolboxDefaults(Application.current?.Services);
            // Storage comes from the app's service provider (registered
            // at the platform composition root). Optional: if no backend
            // is registered the document just runs without persistence.
            docInstance = new DiagramDocument(Application.current?.Services.get(DiagramStorageKey));
            // Seed a few nodes so the demo doesn't open empty.
            const rect    = docInstance.CreateNode('rectangle',     60,  60);
            const ellipse = docInstance.CreateNode('ellipse',      220,  60);
            const squir   = docInstance.CreateNode('squircle',      60, 200);
            const flower  = docInstance.CreateNode('flower',       220, 200);
            const heart   = docInstance.CreateNode('heart',        380,  60);
            // Seed shape text (§ diagram-text Slice 1) — labels render
            // centred over each shape and persist across Save/Load.
            rect.LabelText    = 'Start';
            ellipse.LabelText = 'Process';
            squir.LabelText   = 'Decision';
            flower.LabelText  = 'Review';
            heart.LabelText   = 'Done';
            // Showcase the Slice 3 text-block transform: the heart's caption
            // is pinned to the bottom of the shape, the flower's is rotated.
            // Select a node and drag the block's move / rotate grips to adjust
            // (both persist across Save/Load).
            heart.Text.Placement   = TextPlacement.Bottom;
            heart.Text.BlockHeight = 20;
            flower.Text.Angle      = -15;
            // Slice 4: a rich caption (RichTextBlock display). Double-click any
            // node to edit in a RichTextBox — Ctrl+B/I/U formats, Esc / click
            // away commits. Rich runs persist across Save/Load.
            ellipse.Text.Document = deserializeFlowDocument([
                { runs: [{ t: 'Pro' }, { t: 'cess', b: true }] },
            ]);
            // Slice 6: live {field} tokens. The squircle shows its own
            // dimensions — resize it and the label updates; the first edge
            // (below) shows its route length. Field keys persist; values
            // recompute.
            squir.Text.Document = documentWithFields('Decision\n{Width}×{Height}');
            // Slice 7: auto-fit. ShrinkText scales the label to stay inside the
            // shape — grab the squircle's resize handles and shrink it; the
            // caption scales down instead of overflowing.
            squir.Text.AutoFit = TextAutoFit.ShrinkText;
            // Seed two connectors so users see something on first open:
            // rectangle → ellipse (anchored, framework auto-picks ports);
            // squircle → flower   (anchored, framework auto-picks ports).
            // Slice 5: a connector label rides the route midpoint. Double-
            // click a connector to caption it; drag the label to slide it
            // along the path. Label text + position persist across Save/Load.
            const edge = docInstance.CreateConnector(
                new ConnectorEndpoint({ Node: rect }),
                new ConnectorEndpoint({ Node: ellipse }));
            // Slice 6: the edge label combines literal text with a live
            // {Length} field that tracks the route as the nodes move.
            if (edge !== null) edge.Text.Document = documentWithFields('flows to · {Length}px');
            docInstance.CreateConnector(
                new ConnectorEndpoint({ Node: squir }),
                new ConnectorEndpoint({ Node: flower }));
            // Slice 8: text shapes. A free-floating annotation box (TextNode, a
            // self-painting Figure that auto-grows to its text) and a callout
            // (Callout — a TextNode with a leader) whose leader points at, and
            // follows, the heart node. Text is set via the Figure's Text document
            // (documentWithFields), the same seam used for the edge label above.
            const note = new TextNode();
            note.Id = 'note1';
            note.Left = 380; note.Top = 210;
            note.Text.Document = documentWithFields('Free-floating note — double-click to edit');
            docInstance.Nodes.Add(note);

            const callout = new Callout();
            callout.Id = 'call1';
            callout.Left = 40; callout.Top = 320;
            callout.Text.Document = documentWithFields('This one has a leader ↘');
            callout.LeaderTargetNode = heart;
            docInstance.Nodes.Add(callout);
            docInstance.Status = `Ready. ${docInstance.Nodes.Count} nodes, ${docInstance.Connectors.Count} connectors. Drag a shape from the toolbox →`;
        }
        return docInstance;
    },
};
