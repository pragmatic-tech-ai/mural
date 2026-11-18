// connectorCapOptions() — the standard cap dropdown list for a
// ShapeFormatControl, and the ShapeFormatControl cap DP contract the
// FormatMirror / demo wiring depends on.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, MuralBase } from '../../../runtime/index.js';
import { connectorCapOptions } from '../caps/connector-cap-options.js';
import { CapOption } from '../../formatting/cap-option.js';
import { ShapeFormatControl } from '../../formatting/shape-format-control.js';
import { Board } from '../board.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Border } from '../../../basic/border.js';

describe('connectorCapOptions', () => {
    test('builds None + the five catalog caps with the expected labels', () => {
        Application.current = null;
        new Application();
        const opts = connectorCapOptions();
        assert.deepEqual(opts.map(o => o.Label), [
            'None', 'Arrow', 'Filled Arrow', 'Open Circle', 'Filled Circle', 'Diamond',
        ]);
        assert.ok(opts.every(o => o instanceof CapOption));
    });

    test('None carries no template; every option carries a glyph', () => {
        Application.current = null;
        new Application();
        const opts = connectorCapOptions();
        const none = opts[0]!;
        assert.equal(none.Label, 'None');
        assert.equal(none.Template, undefined);
        assert.ok(opts.every(o => o.Glyph.length > 0));
    });

    test('filled caps carry GlyphFill, open caps carry GlyphStroke', () => {
        Application.current = null;
        new Application();
        const byLabel = new Map(connectorCapOptions().map(o => [o.Label, o]));
        assert.ok(byLabel.get('Filled Arrow')!.GlyphFill   !== undefined);
        assert.equal(byLabel.get('Filled Arrow')!.GlyphStroke, undefined);
        assert.ok(byLabel.get('Arrow')!.GlyphStroke        !== undefined);
        assert.equal(byLabel.get('Arrow')!.GlyphFill, undefined);
    });

    test('without a registered cap catalog the templates resolve to undefined (no throw)', () => {
        Application.current = null;
        new Application();   // bare app — no framework theme merged
        const opts = connectorCapOptions();
        // Arrow's @ArrowCap isn't resolvable, so Template is undefined, but
        // the option still exists so the dropdown renders.
        assert.equal(opts[1]!.Template, undefined);
    });
});

describe('Board.ConnectorCapOptions — bindable DP', () => {
    test('is a registered property so $board.ConnectorCapOptions resolves', () => {
        // The markup binding (ElementName / DataContext) only walks
        // registered properties — a plain getter would resolve to
        // undefined and leave the dropdowns empty.
        assert.ok(MuralBase.HasProperty(Board, 'ConnectorCapOptions'));
    });

    test('is populated with the 6-row catalog from the ctor', () => {
        Application.current = null;
        new Application();
        const d = new Board();
        assert.equal(d.ConnectorCapOptions.length, 6);
        assert.equal(d.ConnectorCapOptions[0]!.Label, 'None');
    });
});

describe('ShapeFormatControl — cap DP contract', () => {
    test('new cap DPs default correctly and round-trip', () => {
        const c = new ShapeFormatControl();
        assert.equal(c.SourceCapTemplate, undefined);
        assert.equal(c.TargetCapTemplate, undefined);
        assert.equal(c.ShowCaps, false);
        assert.deepEqual([...c.CapOptions], []);

        const tpl = new DataTemplate(() => new Border());
        c.SourceCapTemplate = tpl;
        assert.equal(c.SourceCapTemplate, tpl);
        c.ShowCaps = true;
        assert.equal(c.ShowCaps, true);
        const opts = [new CapOption({ Label: 'None' })];
        c.CapOptions = opts;
        assert.equal(c.CapOptions, opts);
    });
});
