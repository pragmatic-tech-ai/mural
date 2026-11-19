// Integration: with the real Material theme active (so the cap catalog
// resolves), verify connectorCapOptions() yields working templates and a
// materialized ShapeFormatControl's cap combobox actually drives the
// connector through the Board cap channel.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, MuralBase, Size, ElementNameBinding, type Visual } from '../../../runtime/index.js';
import { Border, PaginatedCanvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Point } from '../../../visual-engine/index.js';
import { ComboBox } from '../../list/combo-box.js';
import { SliderSpinEdit } from '../../../basic/slider-spin-edit.js';
import { ShapeFormatControl } from '../../formatting/shape-format-control.js';
import { CapOption } from '../../formatting/cap-option.js';
import { connectorCapOptions } from '../caps/connector-cap-options.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

describe('connectorCapOptions — resolves real catalog templates under the theme', () => {
    test('every non-None option resolves a DataTemplate from the active resources', () => {
        initTestApp();
        const opts = connectorCapOptions();
        assert.equal(opts[0]!.Label, 'None');
        assert.equal(opts[0]!.Template, undefined);
        // Arrow / Filled Arrow / Open Circle / Filled Circle / Diamond.
        for (let i = 1; i < opts.length; i++)
        {
            assert.ok(opts[i]!.Template !== undefined,
                `${opts[i]!.Label} should resolve a template`);
        }
    });
});

describe('Connector default Style — applies @FilledArrowCap at 0.8×', () => {
    test('a freshly-constructed connector gets the catalog Filled Arrow as its target cap', () => {
        initTestApp();
        const c = new Connector();
        assert.ok(c.TargetCapTemplate !== undefined, 'default target cap applied via Style');
        const filled = connectorCapOptions().find(o => o.Label === 'Filled Arrow');
        assert.equal(c.TargetCapTemplate, filled!.Template, 'default cap IS the catalog Filled Arrow');
        assert.equal(c.SourceCapTemplate, undefined, 'source end stays bare by default');
    });

    test('default end size is 0.8× on both ends', () => {
        initTestApp();
        const c = new Connector();
        assert.equal(c.SourceCapScale, 0.8);
        assert.equal(c.TargetCapScale, 0.8);
    });
});

describe('ShapeFormatControl cap combobox — drives the connector end to end', () => {
    function connector(): Connector
    {
        const c = new Connector();
        c.RoutingMode = RoutingMode.Straight;
        c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
        c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
        return c;
    }

    function mountedBoard(): Board
    {
        const d = new Board();
        d.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        (surface as unknown as { Child: Visual }).Child = d;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return d;
    }

    test('picking a cap in PART_TargetCap updates the selected connector', () => {
        initTestApp();
        const d = mountedBoard();
        const c = connector();
        d.Connectors = new ObservableCollection<MuralBase>([c]);
        d.SelectConnector(c);

        // The ShapeFormatControl as the demo wires it: a real template
        // (so the combobox parts exist) + the TwoWay cap binding +
        // ShowCaps + CapOptions, all bound to the board.
        const sfc = new ShapeFormatControl();
        sfc.set_property_value(ShapeFormatControl.TargetCapTemplateKey,
            ElementNameBinding(d, 'SelectionFormatTargetCap'));
        sfc.set_property_value(ShapeFormatControl.ShowCapsKey,
            ElementNameBinding(d, 'SelectionIsConnector'));
        sfc.set_property_value(ShapeFormatControl.CapOptionsKey,
            ElementNameBinding(d, 'ConnectorCapOptions'));

        const combo = sfc.GetTemplateChild('PART_TargetCap') as ComboBox | undefined;
        assert.ok(combo !== undefined, 'PART_TargetCap exists in the template');
        const items = combo!.Items as readonly CapOption[] | undefined;
        assert.ok(items !== undefined && items.length === 6, 'combo is populated with the catalog');

        // Pick "Diamond" (last row) — what a user click does (SelectedIndex).
        const diamondIndex = items!.findIndex(o => o.Label === 'Diamond');
        assert.ok(diamondIndex > 0);
        combo!.SelectedIndex = diamondIndex;

        // It must flow combo → SFC.TargetCapTemplate → Board → connector.
        const diamondTpl = items![diamondIndex]!.Template;
        assert.equal(d.SelectionFormatTargetCap, diamondTpl, 'board cap DP updated');
        assert.equal(c.TargetCapTemplate, diamondTpl, 'connector cap updated');
        assert.ok(c.TargetCapInstance !== undefined, 'connector built the cap visual');
        // …and that cap visual is actually mounted in the panel (so it paints).
        const panel = d.ItemsPanelInstance as PaginatedCanvas;
        assert.notEqual(panel.Children.IndexOf(c.TargetCapInstance!), -1,
            'new cap visual is mounted in the connectors panel');
    });

    // Regression — the demo binds the cap DP with a FORWARD reference
    // (`$nodes.SelectionFormatTargetCap`, where the Board element is
    // constructed AFTER the format pane). At install time the binding's
    // source is unresolved, so a TwoWay writeback in that window returns
    // false and effective-value DISPOSES the binding. Setting CapOptions
    // populates combo.Items, which makes the ComboBox fire a spurious
    // SelectedItem change; if that change is written back during the
    // forward-ref window the binding dies and NO user pick ever reaches
    // the board again. populateCapCombos must guard the Items write so
    // the spurious change is suppressed and the binding survives.
    test('a spurious Items-population change during the forward-ref window does NOT kill the TwoWay cap binding', async () => {
        initTestApp();
        const d = mountedBoard();
        const c = connector();
        d.Connectors = new ObservableCollection<MuralBase>([c]);
        d.SelectConnector(c);

        const sfc = new ShapeFormatControl();
        // Forward reference: undefined until `resolved` flips — mirrors the
        // markup's `() => _board10` before the Board is constructed.
        let resolved = false;
        sfc.set_property_value(ShapeFormatControl.TargetCapTemplateKey,
            ElementNameBinding(() => (resolved ? d : undefined), 'SelectionFormatTargetCap'));

        // Spurious Items population WHILE the binding source is unresolved —
        // this is the write that used to dispose the binding.
        sfc.set_property_value(ShapeFormatControl.CapOptionsKey, connectorCapOptions());

        // Resolve the forward ref and let the binding's deferred activate()
        // microtask run (it re-attempts source resolution on the next tick).
        resolved = true;
        await Promise.resolve();
        await Promise.resolve();

        // Now a genuine user pick must still write back through the binding.
        const combo = sfc.GetTemplateChild('PART_TargetCap') as ComboBox | undefined;
        assert.ok(combo !== undefined);
        const items = combo!.Items as readonly CapOption[];
        const diamondIndex = items.findIndex(o => o.Label === 'Diamond');
        combo!.SelectedIndex = diamondIndex;

        assert.equal(d.SelectionFormatTargetCap, items[diamondIndex]!.Template,
            'binding survived the spurious population — user pick wrote back to the board');
        assert.equal(c.TargetCapTemplate, items[diamondIndex]!.Template,
            'broadcast reached the selected connector');
    });

    test('the PART_SourceCapScale SliderSpinEdit drives the connector cap size end to end', () => {
        initTestApp();
        const d = mountedBoard();
        const c = connector();
        c.SourceCapTemplate = connectorCapOptions().find(o => o.Label === 'Filled Arrow')!.Template;
        d.Connectors = new ObservableCollection<MuralBase>([c]);
        d.SelectConnector(c);

        const sfc = new ShapeFormatControl();
        sfc.set_property_value(ShapeFormatControl.SourceCapScaleKey,
            ElementNameBinding(d, 'SelectionFormatSourceCapScale'));
        sfc.set_property_value(ShapeFormatControl.ShowCapsKey,
            ElementNameBinding(d, 'SelectionIsConnector'));

        const edit = sfc.GetTemplateChild('PART_SourceCapScale') as SliderSpinEdit | undefined;
        assert.ok(edit !== undefined, 'PART_SourceCapScale exists in the template');
        // Seeded from the connector's default scale (0.8, from the Style).
        assert.equal(edit!.Value, 0.8);

        // A user drag/type to 1.5× must flow edit → SFC → Board → connector.
        edit!.Value = 1.5;
        assert.equal(d.SelectionFormatSourceCapScale, 1.5, 'board scale DP updated');
        assert.equal(c.SourceCapScale, 1.5, 'connector cap scale updated');
    });
});
