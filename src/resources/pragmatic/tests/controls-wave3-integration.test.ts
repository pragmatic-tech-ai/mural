import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Card } from '../../../framework/surfaces/card.js';
import { Dialog } from '../../../framework/surfaces/dialog.js';
import { Drawer } from '../../../framework/surfaces/drawer.js';
import { BottomSheet } from '../../../framework/surfaces/bottom-sheet.js';
import { SideSheet } from '../../../framework/surfaces/side-sheet.js';
import { Tooltip } from '../../../framework/tooltips/tooltip.js';
import { ProgressIndicator } from '../../../framework/notifications/progress-indicator.js';
import { LoadingIndicator } from '../../../framework/notifications/loading-indicator.js';
import { Banner } from '../../../framework/notifications/banner.js';
import { Snackbar } from '../../../framework/notifications/snackbar.js';
import { MenuItem, MenuStrip, MenuButton } from '../../../framework/menu/menu-strip.js';
import { ContextMenu } from '../../../framework/menu/context-menu.js';
import { SplitButton } from '../../../framework/button-groups/split-button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// Every control the Wave-3 overlay/surface forks cover. Wrapped as static
// factory members (OOP house rule — no module-level array of free
// constructors).
class Wave3Controls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'Card', Make: () => new Card() },
        { Name: 'Dialog', Make: () => new Dialog() },
        { Name: 'Drawer', Make: () => new Drawer() },
        { Name: 'BottomSheet', Make: () => new BottomSheet() },
        { Name: 'SideSheet', Make: () => new SideSheet() },
        { Name: 'Tooltip', Make: () => new Tooltip() },
        { Name: 'ProgressIndicator', Make: () => new ProgressIndicator() },
        { Name: 'LoadingIndicator', Make: () => new LoadingIndicator() },
        { Name: 'Banner', Make: () => new Banner() },
        { Name: 'Snackbar', Make: () => new Snackbar() },
        { Name: 'MenuItem', Make: () => new MenuItem() },
        { Name: 'MenuStrip', Make: () => new MenuStrip() },
        { Name: 'MenuButton', Make: () => new MenuButton() },
        { Name: 'ContextMenu', Make: () => new ContextMenu() },
        { Name: 'SplitButton', Make: () => new SplitButton() },
    ];
}

describe('Wave 3 integration — every overlay/surface fork resolves', () =>
{
    for (const entry of Wave3Controls.All)
    {
        test(`${entry.Name}: Pragmatic (light + dark)`, () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under light`);
            ControlHarness.Reset();

            ControlHarness.Activate(PragmaticDark);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under dark`);
            ControlHarness.Reset();
        });
    }
});
