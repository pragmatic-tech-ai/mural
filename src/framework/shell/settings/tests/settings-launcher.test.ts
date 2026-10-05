import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, type IServiceProvider } from '../../../../runtime/index.js';
import { DialogService, type DialogOptions } from '../../services/dialog-service.js';
import { ButtonVariant } from '../../../buttons/button.js';
import type { IDocument } from '../../services/documents-content-host-service.js';
import {
    SettingsLauncherService,
    SettingsContributionKey,
    type ISettingsContribution,
} from '../settings-launcher.js';

// Captures the DialogOptions handed to Show() and records a Close() — so the
// test can inspect the action row the launcher builds without a live overlay.
class CapturingDialogService extends DialogService
{
    public Captured: DialogOptions | undefined;
    public Closed = false;

    public override Show<T = unknown>(options: DialogOptions): Promise<T | undefined>
    {
        this.Captured = options;
        return Promise.resolve(undefined);
    }

    public override Close(_result?: unknown): void
    {
        this.Closed = true;
    }
}

function contribution(): ISettingsContribution
{
    return {
        Icon: undefined,
        CreateView: () => ({ Title: 'Settings' } as unknown as IDocument),
    };
}

describe('SettingsLauncherService.Open', () => {
    function launch(): { dialogs: CapturingDialogService; launcher: SettingsLauncherService }
    {
        const app = new Application();
        const dialogs = new CapturingDialogService(app.Services as unknown as IServiceProvider);
        app.Services.registerInstance(DialogService.Key, dialogs);
        app.Services.registerInstance(SettingsContributionKey, contribution());
        app.Services.register(SettingsLauncherService.Key, p => new SettingsLauncherService(p));
        const launcher = app.Services.getRequired(SettingsLauncherService.Key);
        return { dialogs, launcher };
    }

    test('opens the settings dialog with a single primary "Done" action', () => {
        const { dialogs, launcher } = launch();
        launcher.Open();

        const actions = dialogs.Captured?.Actions;
        assert.ok(actions, 'an Actions row is supplied');
        assert.equal(actions!.length, 1, 'exactly one action — Done');
        assert.equal(actions![0]!.Label, 'Done');
        assert.equal(actions![0]!.Variant, ButtonVariant.Filled, 'Done is the primary (Filled) affordance');
    });

    test('the Done action closes the dialog', () => {
        const { dialogs, launcher } = launch();
        launcher.Open();

        assert.equal(dialogs.Closed, false, 'not closed until Done runs');
        dialogs.Captured!.Actions![0]!.Command.Execute(undefined);
        assert.equal(dialogs.Closed, true, 'Done invokes DialogService.Close');
    });
});
