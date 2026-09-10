import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Rect, Size } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ItemsPanelTemplate } from '../../../basic/panels/items-panel-template.js';
import { Canvas } from '../../../basic/panels/canvas.js';
import { Diagram } from '../diagram.js';
import { DiagramDocument } from '../diagram-document.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';

// The node Figures ARE the Diagram's containers (Diagram.GetContainerForItemOverride
// returns the item itself). So a document's Nodes are shared Visuals. If a Diagram
// is discarded WITHOUT tearing down its containers (what a tab swap does — the
// ContentPresenter just detaches the whole Diagram), its Figures stay pinned to
// the discarded panel. Realizing the same Nodes in a fresh Diagram then hits
// AddVisualChild's single-parent guard: "Visual already has a visual parent".
// This is the reported tab-switch crash, isolated to two Diagrams over one doc.

function layout(d: Diagram): void
{
    d.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    d.Measure(new Size(400, 400));
    d.Arrange(new Rect(0, 0, 400, 400));
}

describe('Diagram — a document shown in a second Diagram after the first is discarded', () => {
    beforeEach(() => { initTestApp(); });

    test('realizing a doc\'s shared node Figures in a fresh Diagram does not throw', () => {
        const doc = new DiagramDocument();
        doc.CreateNode('rectangle', 40, 40);
        doc.CreateNode('ellipse', 160, 80);

        const first = new Diagram();
        (first as unknown as { ItemsSource: unknown }).ItemsSource = doc.Nodes;
        layout(first);

        // Discard `first` the way a tab swap does: drop the reference without a
        // container teardown. Its Figures are still visually parented to first's
        // Canvas panel.
        // (No detach call — that's exactly the bug scenario.)

        const second = new Diagram();
        assert.doesNotThrow(() =>
        {
            (second as unknown as { ItemsSource: unknown }).ItemsSource = doc.Nodes;
            layout(second);
        }, 're-showing a document\'s nodes in a new Diagram must reclaim the shared Figures');
    });

    // Connectors take a SEPARATE mount path (DiagramConnectorsMaterializer), so
    // the same shared-Visual pinning bites there too: a Connector item IS its
    // Visual, owned by the document, and a discarded Diagram leaves it (plus its
    // caps/label) pinned to the old canvas.
    test('re-showing a document with a connector does not throw on the connector mount', () => {
        const doc = new DiagramDocument();
        const a = doc.CreateNode('rectangle', 40, 40);
        const b = doc.CreateNode('ellipse', 160, 80);
        assert.ok(a !== null && b !== null);
        doc.CreateConnector(new ConnectorEndpoint({ Node: a! }), new ConnectorEndpoint({ Node: b! }));

        // Connectors mount only once ItemsPanelInstance exists (the materializer
        // bails while the panel is absent, and nothing re-drives it), so the
        // faithful order is: set ItemsSource, lay out to materialize the panel,
        // THEN bind Connectors — matching how the template's `Connectors=$Connectors`
        // resolves after the canvas panel is up.
        const show = (d: Diagram): void =>
        {
            (d as unknown as { ItemsSource: unknown }).ItemsSource = doc.Nodes;
            layout(d);
            (d as unknown as { Connectors: unknown }).Connectors = doc.Connectors;
            d.Measure(new Size(400, 400));
            d.Arrange(new Rect(0, 0, 400, 400));
        };

        const first = new Diagram();
        show(first);   // mounts the connector into first's canvas

        // Discard `first` without teardown (the tab-swap scenario).

        const second = new Diagram();
        assert.doesNotThrow(() => show(second),
            're-showing a document\'s connectors in a new Diagram must reclaim the shared connector Visuals');
    });
});
