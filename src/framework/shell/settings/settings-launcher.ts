import {
    type ICommand,
    type IServiceProvider,
    MuralBase,
    RelayCommand,
    ServiceBase,
    ServiceKey,
} from '../../../runtime/index.js';
import { DialogService } from '../services/dialog-service.js';
import type { IDocument } from '../services/documents-content-host-service.js';
import type { Geometry } from '../../../visual-engine/index.js';

// ISettingsContribution — the app-supplied half of the settings feature.
//
// Under the "launcher → framework, page → app" split, the framework owns the
// gear + the launch mechanism but NOT the settings page (which is view code an
// app styles to taste). It also can't supply the rail icon — the framework
// ships no icons. So an app opts into settings by registering an
// ISettingsContribution under SettingsContributionKey, providing:
//   * Icon    — the rail glyph for the footer gear (from the app's icon dict).
//   * Tooltip — optional hover label.
//   * CreateView() — builds the settings view VM (a page grouping
//     ApplicationSettings.Settings). The launcher shows it in a modal dialog, so
//     its rendered body comes from its `DataTemplate`. It stays typed as IDocument
//     (a MuralBase at runtime) for back-compat with hosts that still tab it.
//
// EditorShell detects the contribution and wires a footer RailAction; this
// launcher's OpenCommand opens CreateView()'s result in a modal DialogService
// dialog. No contribution ⇒ no gear (the demo platform, which registers none,
// stays gear-free).
export interface ISettingsContribution
{
    readonly Icon: Geometry | undefined;
    readonly Tooltip?: string;
    CreateView(): IDocument;
}

export const SettingsContributionKey = new ServiceKey<ISettingsContribution>('SettingsContribution');

// Backs the activity-bar settings gear: OpenCommand shows the app's settings view
// (from the registered ISettingsContribution) in a modal DialogService dialog.
// Auto-registered by EditorShell when a contribution is present.
export class SettingsLauncherService extends ServiceBase
{
    public static readonly Key = new ServiceKey<SettingsLauncherService>('SettingsLauncherService');

    private readonly _openCommand: ICommand;

    // Built once — the view's editors bind live to the same Setting DPs, so the
    // one VM stays current across reopens (each open re-renders it from its
    // DataTemplate into a fresh dialog body).
    private _view: IDocument | undefined;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this._openCommand = new RelayCommand(() => this.Open());
    }

    public get OpenCommand(): ICommand { return this._openCommand; }

    // Show the settings view in a modal dialog. The DialogService renders the view
    // VM through its DataTemplate as the dialog body; Escape / scrim-click closes
    // it. A fixed width + max height keep a large settings page bounded (its own
    // ScrollViewer scrolls within). No dialog service ⇒ no-op.
    public Open(): void
    {
        const dialogs      = this.Provider.get(DialogService.Key);
        const contribution = this.Provider.get(SettingsContributionKey);
        if (dialogs === undefined || contribution === undefined) return;
        this._view ??= contribution.CreateView();
        void dialogs.Show({
            Title:     this._view.Title,
            Content:   this._view as unknown as MuralBase,
            Width:     720,
            MaxHeight: 640,
        });
    }
}
