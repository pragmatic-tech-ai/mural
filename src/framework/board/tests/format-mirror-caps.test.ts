// Cap format channel on FormatMirror (§ shape-editor connector caps):
// SelectionFormatSourceCap/TargetCap seed from the first selected
// connector, SelectionIsConnector gates the editor's cap section, and
// edits to the cap DPs broadcast onto every selected connector.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ObservableCollection, MuralBase, Size, ElementNameBinding, type Visual } from '../../../runtime/index.js';
import { Border, PaginatedCanvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { ShapeFormatControl } from '../../formatting/shape-format-control.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Point } from '../../../visual-engine/index.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';

function newBoard(): Board
{
    Application.current = null;
    new Application();
    return new Board();
}

function capTemplate(): DataTemplate
{
    return new DataTemplate(() => new Border());
}

function connector(src?: DataTemplate, tgt?: DataTemplate): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    if (src !== undefined) c.SourceCapTemplate = src;
    if (tgt !== undefined) c.TargetCapTemplate = tgt;
    return c;
}

describe('FormatMirror — cap channel seeds from the selected connector', () => {
    test('selecting a connector seeds both cap DPs + SelectionIsConnector', () => {
        const d = newBoard();
        const src = capTemplate();
        const tgt = capTemplate();
        const c = connector(src, tgt);

        assert.equal(d.SelectionIsConnector, false);
        d.SelectConnector(c);

        assert.equal(d.SelectionIsConnector, true);
        assert.equal(d.SelectionFormatSourceCap, src);
        assert.equal(d.SelectionFormatTargetCap, tgt);
    });

    test('seeds from the FIRST selected connector', () => {
        const d = newBoard();
        const a = connector(capTemplate(), capTemplate());
        const b = connector(capTemplate(), capTemplate());
        d.SelectConnector(a);
        d.SelectConnector(b);
        assert.equal(d.SelectionFormatSourceCap, a.SourceCapTemplate);
        assert.equal(d.SelectionFormatTargetCap, a.TargetCapTemplate);
    });

    test('clearing the connector selection drops IsConnector + caps', () => {
        const d = newBoard();
        const c = connector(capTemplate(), capTemplate());
        d.SelectConnector(c);
        assert.equal(d.SelectionIsConnector, true);

        d.ClearConnectorSelection();
        assert.equal(d.SelectionIsConnector, false);
        assert.equal(d.SelectionFormatSourceCap, undefined);
        assert.equal(d.SelectionFormatTargetCap, undefined);
    });
});

describe('FormatMirror — cap edits broadcast onto selected connectors', () => {
    test('setting SelectionFormatTargetCap updates the selected connector', () => {
        const d = newBoard();
        const c = connector(undefined, capTemplate());
        d.SelectConnector(c);

        const newTgt = capTemplate();
        d.SelectionFormatTargetCap = newTgt;
        assert.equal(c.TargetCapTemplate, newTgt);
    });

    test('setting a cap to undefined (None) clears it on the connector', () => {
        const d = newBoard();
        const c = connector(undefined, capTemplate());
        d.SelectConnector(c);
        assert.notEqual(c.TargetCapTemplate, undefined);

        d.SelectionFormatTargetCap = undefined;
        assert.equal(c.TargetCapTemplate, undefined);
    });

    test('broadcast hits EVERY selected connector', () => {
        const d = newBoard();
        const a = connector();
        const b = connector();
        d.SelectConnector(a);
        d.SelectConnector(b);

        const src = capTemplate();
        d.SelectionFormatSourceCap = src;
        assert.equal(a.SourceCapTemplate, src);
        assert.equal(b.SourceCapTemplate, src);
    });

    test('seeding does NOT replay the first connector caps onto the others', () => {
        const d = newBoard();
        const aTgt = capTemplate();
        const a = connector(undefined, aTgt);
        const b = connector(undefined, capTemplate());
        const bTgt = b.TargetCapTemplate;
        // Selecting both seeds from `a`; the seed write must be gated so
        // `b` keeps its own target cap (no broadcast during seed).
        d.SelectConnector(a);
        d.SelectConnector(b);
        assert.equal(b.TargetCapTemplate, bTgt);
        assert.notEqual(b.TargetCapTemplate, aTgt);
    });
});

// End-to-end: the demo's PaginatedCanvas panel + full materialization.
// Mirrors the real wiring — a cap chosen in the editor writes
// Board.SelectionFormatTargetCap, FormatMirror broadcasts onto the
// selected connector, and the materializer must swap the MOUNTED cap
// visual so the connector actually repaints.
describe('FormatMirror — cap edit re-mounts the connector cap visual (PaginatedCanvas)', () => {
    function mountedBoard(): Board
    {
        Application.current = null;
        new Application();
        const d = new Board();
        d.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        (surface as unknown as { Child: Visual }).Child = d;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return d;
    }

    test('setting SelectionFormatTargetCap swaps the cap mounted in the panel', () => {
        const d = mountedBoard();
        const c = connector(undefined, capTemplate());
        d.Connectors = new ObservableCollection<MuralBase>([c]);
        d.SelectConnector(c);

        const panel = d.ItemsPanelInstance as PaginatedCanvas;
        const firstCap = c.TargetCapInstance!;
        assert.notEqual(panel.Children.IndexOf(firstCap), -1, 'initial cap is mounted');

        // Simulate the editor's TwoWay writeback.
        const newTgt = capTemplate();
        d.SelectionFormatTargetCap = newTgt;

        assert.equal(c.TargetCapTemplate, newTgt, 'broadcast set the connector cap');
        const secondCap = c.TargetCapInstance!;
        assert.notEqual(secondCap, firstCap, 'connector built a new cap visual');
        assert.equal(panel.Children.IndexOf(firstCap), -1, 'old cap unmounted');
        assert.notEqual(panel.Children.IndexOf(secondCap), -1, 'new cap mounted');
    });
});

// The editor side: a ShapeFormatControl TwoWay-bound to the Board's
// cap DPs (the demo's `TargetCapTemplate=$nodes.SelectionFormatTargetCap`
// shape). Setting the control's cap DP — what the combobox handler does —
// must write back through the binding to the Board and broadcast.
describe('ShapeFormatControl cap DP — TwoWay writeback to Board + broadcast', () => {
    test('setting SFC.TargetCapTemplate writes Board.SelectionFormatTargetCap and updates the connector', () => {
        const d = newBoard();
        const c = connector(undefined, capTemplate());
        d.SelectConnector(c);

        const sfc = new ShapeFormatControl();
        // Mirror the markup: TwoWay ElementName binding control → board.
        sfc.set_property_value(
            ShapeFormatControl.TargetCapTemplateKey,
            ElementNameBinding(d, 'SelectionFormatTargetCap'));

        // The combobox handler effectively does exactly this:
        const newTgt = capTemplate();
        sfc.TargetCapTemplate = newTgt;

        // Writeback reached the board…
        assert.equal(d.SelectionFormatTargetCap, newTgt, 'writeback set the board DP');
        // …and FormatMirror broadcast it onto the selected connector.
        assert.equal(c.TargetCapTemplate, newTgt, 'broadcast set the connector cap');
    });
});

describe('FormatMirror — cap-size channel seeds + broadcasts', () => {
    test('selecting a connector seeds both scale DPs from it', () => {
        const d = newBoard();
        const c = connector(capTemplate(), capTemplate());
        c.SourceCapScale = 0.5;
        c.TargetCapScale = 1.5;
        d.SelectConnector(c);
        assert.equal(d.SelectionFormatSourceCapScale, 0.5);
        assert.equal(d.SelectionFormatTargetCapScale, 1.5);
    });

    test('a connector with default scale seeds 1', () => {
        const d = newBoard();
        d.SelectConnector(connector());
        assert.equal(d.SelectionFormatSourceCapScale, 1);
        assert.equal(d.SelectionFormatTargetCapScale, 1);
    });

    test('setting a scale DP broadcasts onto every selected connector', () => {
        const d = newBoard();
        const a = connector();
        const b = connector();
        d.SelectConnector(a);
        d.SelectConnector(b);

        d.SelectionFormatTargetCapScale = 1.3;
        assert.equal(a.TargetCapScale, 1.3);
        assert.equal(b.TargetCapScale, 1.3);
    });

    test('seeding does NOT replay the first connector scale onto the others', () => {
        const d = newBoard();
        const a = connector();
        a.SourceCapScale = 0.5;
        const b = connector();
        b.SourceCapScale = 1.2;
        d.SelectConnector(a);
        d.SelectConnector(b);
        // seed picks `a` (0.5) but must not overwrite `b`'s own 1.2.
        assert.equal(b.SourceCapScale, 1.2);
    });
});

// Sanity: a figure-only selection must NOT light up the cap section.
describe('FormatMirror — non-connector selection leaves caps off', () => {
    test('SelectionIsConnector stays false with no connector selected', () => {
        const d = newBoard();
        d.Connectors = new ObservableCollection<MuralBase>([]);
        assert.equal(d.SelectionIsConnector, false);
        assert.equal(d.SelectionFormatSourceCap, undefined);
    });
});
