// ribbon demo bootstrap — a tabbed Ribbon over the framework Board's
// command palette.
//
// The demo seeds a RibbonDemoDoc (a thin BoardDocument subclass) with a few
// labelled shapes and returns it as the demo root; the platform Views it
// through the `[DataType = RibbonDemoDoc]` template in ribbon.mu, which puts a
// Ribbon over a live Board (x:name="canvas"). Every ribbon button binds to
// the Board's own RelayCommand DPs by ElementName ($canvas.*Command), so the
// commands (Align / Combine / Group / text-format) act on the canvas selection
// with no VM proxy — the same wiring the Boardmer demo's toolbars use.
//
// Commands are selection-gated: Align / Combine need two or more selected
// shapes, the Text tab needs a labelled shape selected, so most buttons open
// disabled and light up as you select on the canvas.

import { Application } from '@pragmatic-tech-ai/mural/runtime';
import { BoardStorageKey } from '@pragmatic-tech-ai/mural/framework';
import { RibbonDemoDoc } from './ribbon-vm.mjs';

let docInstance;

export default {
    id:       'ribbon',
    title:    'Ribbon',
    subtitle: 'A tabbed Ribbon over the board command palette — Large / Medium / Small buttons plus split & dropdown buttons. Select shapes on the canvas to enable the commands.',
    factory: () => {
        if (docInstance === undefined) {
            docInstance = new RibbonDemoDoc(Application.current?.Services.get(BoardStorageKey));
            // Seed a few labelled shapes so Align / Combine (2+ selection) and
            // the Text tab (a labelled leaf) have something to act on.
            const a = docInstance.CreateNode('rectangle',  80,  80);
            const b = docInstance.CreateNode('ellipse',   260,  80);
            const c = docInstance.CreateNode('rectangle',  80, 220);
            const d = docInstance.CreateNode('ellipse',   260, 220);
            a.LabelText = 'One';
            b.LabelText = 'Two';
            c.LabelText = 'Three';
            d.LabelText = 'Four';
            docInstance.Status = 'Marquee or Ctrl-click two shapes to enable Align / Combine; select one to format its label.';
        }
        return docInstance;
    },
};
