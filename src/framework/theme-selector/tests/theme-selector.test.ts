import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeSelector } from '../theme-selector.js';
import { ComboBox } from '../../list/combo-box.js';
import { PragmaticLight } from '../../../resources/pragmatic/index.js';
import { ControlHarness } from '../../../resources/pragmatic/tests/control-harness.js';

// Wave-5 headless-render caveats apply: the scheme combo is populated in the
// constructor's syncFromThemeManager against the active theme, so activating a
// theme before construction is enough to inspect PART_SchemeCombo.Items.
describe('ThemeSelector — scheme combo after Custom retirement', () =>
{
    test('offers the active theme’s built-in schemes and no Custom row', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const selector = new ThemeSelector();
        const combo = selector.GetTemplateChild('PART_SchemeCombo') as ComboBox;
        const items = (combo.Items ?? []) as readonly unknown[];
        assert.ok(items.includes('PragmaticLight'), 'offers PragmaticLight');
        assert.ok(items.includes('PragmaticDark'), 'offers PragmaticDark');
        assert.ok(!items.includes('Custom…'), 'no "Custom…" action row');
        assert.ok(!items.includes('Custom'), 'no live "Custom" row');
        ControlHarness.Reset();
    });
});
