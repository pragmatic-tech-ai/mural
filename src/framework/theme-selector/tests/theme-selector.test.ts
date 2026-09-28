import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeSelector } from '../theme-selector.js';
import { ComboBox } from '../../list/combo-box.js';
import { ApplicationSettings, SettingsStoreKey, type ISettingsStore } from '../../shell/services/application-settings-service.js';
import { PragmaticLight } from '../../../resources/pragmatic/index.js';
import { ControlHarness } from '../../../resources/pragmatic/tests/control-harness.js';

// A settings store pre-seeded with a value left behind by an OLDER build that
// still had the Custom-seed flow: the scheme choice persisted as 'Custom' plus a
// 'theme.customSeed' hex. After the retirement the selector must ignore both and
// restore without crashing (spec §D3 / Review Focus 2).
class StaleCustomStore implements ISettingsStore
{
    public Load(): Record<string, unknown>
    {
        return { 'theme.scheme': 'Custom', 'theme.customSeed': '#123456' };
    }

    public Save(): void { /* no-op — the test only reads */ }
}

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

    test('restores without crashing when a stale "Custom" scheme is persisted', async () =>
    {
        const app = ControlHarness.Activate(PragmaticLight);
        app.Services.register(SettingsStoreKey, () => new StaleCustomStore());
        app.Services.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));

        // Construction runs restorePersistedOnce(); the stale 'Custom' must be a
        // no-op (not a registered scheme), never a throw, and must not stick.
        const selector = new ThemeSelector();
        assert.notEqual(selector.ActiveSchemeName, 'Custom', 'stale Custom does not become the active scheme');
        assert.equal(selector.ActiveSchemeName, 'PragmaticLight', 'the genuinely active built-in scheme stands');
        const combo = selector.GetTemplateChild('PART_SchemeCombo') as ComboBox;
        assert.ok(!((combo.Items ?? []) as readonly unknown[]).includes('Custom'), 'no orphan Custom row after restore');

        // Flush the ApplicationSettings availability microtask before Reset nulls
        // Application.current (Wave-4 gotcha), then tear down.
        await new Promise(resolve => setTimeout(resolve, 0));
        ControlHarness.Reset();
    });
});
