import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TopAppBar } from '../../../framework/top-app-bar/top-app-bar.js';
import { BottomAppBar } from '../../../framework/bottom-app-bar/bottom-app-bar.js';
import { StatusBar, StatusBarItem, StatusBarSeparator } from '../../../framework/status-bar/status-bar.js';
import { SearchBar } from '../../../framework/search-bar/search-bar.js';
import { ToolBar } from '../../../framework/tool-bar/tool-bar.js';
import { ToolBarButton, ToolBarToggleButton, ToolBarSeparator } from '../../../framework/tool-bar/tool-bar-items.js';
import { ToolBarSplitButton } from '../../../framework/tool-bar/tool-bar-split-button.js';
import
{
    NavigationItem, NavigationRail, NavigationBar,
    EditorShell, ViewerShell, ShellSideContentPane, PanelButton,
} from '../../../framework/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Every control the Wave-4 shell/app-frame forks cover. Wrapped as static
// factory members (OOP house rule — no module-level array of free
// constructors). All 18 construct bare under an active Application per
// their own per-control Wave-4 tests (controls-topappbar/-bottomappbar/
// -statusbar/-searchbar/-navigation/-toolbar/-shell.test.ts) — none needs
// to be skipped. EditorShell/ViewerShell/ShellSideContentPane are the one
// wrinkle: EditorShell's ctor registers ApplicationSettings, whose ctor
// unconditionally schedules a queueMicrotask (scheduleAvailabilityNotify)
// that fires after ControlHarness.Reset() nulls Application.current unless
// flushed first — same shape controls-shell.test.ts hits. RULING: the sweep
// loop below awaits two microtask ticks after every Make() (harmless for
// the other 17 controls) before calling Reset(), mirroring the shell
// suite's `await Promise.resolve(); await Promise.resolve();` pattern
// instead of special-casing just the shell family.
class Wave4Controls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'TopAppBar', Make: () => new TopAppBar() },
        { Name: 'BottomAppBar', Make: () => new BottomAppBar() },
        { Name: 'StatusBar', Make: () => new StatusBar() },
        { Name: 'StatusBarItem', Make: () => new StatusBarItem() },
        { Name: 'StatusBarSeparator', Make: () => new StatusBarSeparator() },
        { Name: 'SearchBar', Make: () => new SearchBar() },
        { Name: 'NavigationItem', Make: () => new NavigationItem() },
        { Name: 'NavigationRail', Make: () => new NavigationRail() },
        { Name: 'NavigationBar', Make: () => new NavigationBar() },
        { Name: 'ToolBar', Make: () => new ToolBar() },
        { Name: 'ToolBarButton', Make: () => new ToolBarButton() },
        { Name: 'ToolBarToggleButton', Make: () => new ToolBarToggleButton() },
        { Name: 'ToolBarSplitButton', Make: () => new ToolBarSplitButton() },
        { Name: 'ToolBarSeparator', Make: () => new ToolBarSeparator() },
        { Name: 'EditorShell', Make: () => new EditorShell() },
        { Name: 'ViewerShell', Make: () => new ViewerShell() },
        { Name: 'ShellSideContentPane', Make: () => new ShellSideContentPane() },
        { Name: 'PanelButton', Make: () => new PanelButton() },
    ];

    // Flushes the ApplicationSettings availability microtask (see the
    // class comment above) before ControlHarness.Reset() tears down the
    // active Application. A no-op wait for the other 17 controls.
    public static async FlushPendingMicrotasks(): Promise<void>
    {
        await Promise.resolve();
        await Promise.resolve();
    }
}

describe('Wave 4 integration — every shell/app-frame fork resolves, Material byte-identical', () =>
{
    for (const entry of Wave4Controls.All)
    {
        test(`${entry.Name}: Pragmatic (light + dark) yes, Material no`, async () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under light`);
            await Wave4Controls.FlushPendingMicrotasks();
            ControlHarness.Reset();

            ControlHarness.Activate(PragmaticDark);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under dark`);
            await Wave4Controls.FlushPendingMicrotasks();
            ControlHarness.Reset();

            ControlHarness.Activate(MaterialLight);
            assert.ok(!ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} keeps the Material style under Material`);
            await Wave4Controls.FlushPendingMicrotasks();
            ControlHarness.Reset();
        });
    }
});
