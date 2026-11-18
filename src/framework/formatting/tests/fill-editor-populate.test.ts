// Regression: the FillEditor's body controls must reflect the CURRENT fill —
// both when a fill first arrives and when a different one replaces it (the
// Format Shape pane re-seeding as the board selection changes). The solid
// ColorPicker was wired one-way (imperative seed at body-apply time + a
// picker→editor listener only), so a reselect left the swatch stale even
// though FillEditor.SolidColor tracked the new colour correctly.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush, Color } from '../../../visual-engine/index.js';
import { FillEditor } from '../fill-editor.js';
import { ColorPicker } from '../color-picker.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

function solidPicker(fe: FillEditor): ColorPicker | undefined
{
    // PART_SolidColor lives in the swappable body template's NameScope, not the
    // FillEditor's own template — reach it through the applied body root.
    return (fe as unknown as { _bodyRoot?: { FindName(n: string): unknown } })
        ._bodyRoot?.FindName('PART_SolidColor') as ColorPicker | undefined;
}

describe('FillEditor populates its body from the current fill', () => {
    beforeEach(() => { initTestApp(); });

    test('the solid ColorPicker reflects the fill, and refreshes on reselect', () => {
        const fe = new FillEditor();
        fe.Fill = new SolidColorBrush(Color.FromHex('#123456'));

        const picker = solidPicker(fe);
        assert.ok(picker instanceof ColorPicker, 'solid body has a ColorPicker');
        assert.equal(picker!.Color.ToHex(), '#123456', 'picker seeded from the fill');

        // Selecting a different shape hands the editor a new Fill — the swatch
        // must follow (this is the bug: it used to stay at the first colour).
        fe.Fill = new SolidColorBrush(Color.FromHex('#bfdbfe'));
        assert.equal(picker!.Color.ToHex(), '#bfdbfe', 'picker refreshed on reselect');
    });
});
