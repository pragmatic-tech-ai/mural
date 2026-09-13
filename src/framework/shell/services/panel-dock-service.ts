import {
    type ICommand,
    type IServiceProvider,
    ObservableCollection,
    RelayCommand,
    ServiceBase,
    ServiceKey,
} from '../../../runtime/index.js';
import type { IDockPanel } from './dock-panel.js';

// Backs the shell's right-side tabbed dock: a HOST for multiple panels
// (agent chat, inspectors, …) shown as tabs. Anything in the app resolves this
// service and Add()s a panel; the region binds `Content = $service(PanelDockService)`
// and renders the Panels as a TabControl whose header strip lists the panels and
// whose body shows SelectedPanel through its own DataTemplate. Empty ⇒ the region
// collapses.
//
// Parallels InspectorService (the retired stack host) and
// DocumentsContentHostService (the editor group): a stable per-instance
// collection a view binds, plus Add/Close lifecycle. The difference from the old
// inspector stack is presentation (tabs, one SelectedPanel) instead of a
// simultaneous stack.
export class PanelDockService extends ServiceBase
{
    public static readonly Key = new ServiceKey<PanelDockService>('PanelDockService');

    // The hosted panel set — a stable per-instance collection the region's
    // TabControl binds (`ItemsSource = $Panels`); the reference never changes.
    private readonly _panels = new ObservableCollection<IDockPanel>();

    // The active tab — TwoWay-bound to TabControl.SelectedItem so clicking a tab
    // updates it and Add()/Close() re-select programmatically. (Two-way is
    // driven by the TabControl.SelectedItem target DP; the plain setter here
    // receives the write-back.)
    private _selectedPanel: IDockPanel | undefined = undefined;

    // True while at least one panel is hosted — the region binds its Visibility
    // (and its resize Splitter's) to this so an empty dock collapses out of layout.
    private _hasPanels = false;

    // Command a menu binds to open a panel (`Command = $service(PanelDockService)
    // .AddPanelCommand, CommandParameter = $Panel`). Non-IDockPanel params no-op.
    private readonly _addPanelCommand: ICommand;

    // Command a tab's close affordance binds (`CommandParameter = $Id`).
    private readonly _closePanelCommand: ICommand;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this._panels.Subscribe(() => this.refreshHasPanels());
        this._addPanelCommand = new RelayCommand((p) => { if (isDockPanel(p)) this.Add(p); }, undefined,
            { Text: 'Add Panel', Description: 'Show a panel in the dock.' });
        this._closePanelCommand = new RelayCommand((id) => this.CloseById(id as string), undefined,
            { Text: 'Close', Description: 'Close this dock panel.' });
    }

    public get Panels(): ObservableCollection<IDockPanel> { return this._panels; }
    public get SelectedPanel(): IDockPanel | undefined { return this._selectedPanel; }
    public set SelectedPanel(v: IDockPanel | undefined)
    {
        const old = this._selectedPanel;
        this._selectedPanel = v;
        this.RaisePropertyChanged('SelectedPanel', old, v);
    }
    public get HasPanels(): boolean { return this._hasPanels; }
    public get AddPanelCommand(): ICommand { return this._addPanelCommand; }
    public get ClosePanelCommand(): ICommand { return this._closePanelCommand; }

    private refreshHasPanels(): void
    {
        const old = this._hasPanels;
        this._hasPanels = this.Panels.Count > 0;
        if (old !== this._hasPanels) this.RaisePropertyChanged('HasPanels', old, this._hasPanels);
    }

    // Add a panel, deduping by Id. Existing Id → re-select the existing instance
    // and return it. Otherwise append. Either way SelectedPanel ends on the
    // added-or-existing panel so opening a panel surfaces its tab.
    public Add(panel: IDockPanel): IDockPanel
    {
        const existing = this.find(panel.Id);
        if (existing !== undefined) { this.SelectedPanel = existing; return existing; }
        this.Panels.Add(panel);
        this.SelectedPanel = panel;
        return panel;
    }

    // Remove a hosted panel. When it was the selection, fall back to an adjacent
    // survivor (or undefined when none remain).
    public Remove(panel: IDockPanel): void
    {
        const index = this.Panels.IndexOf(panel);
        if (index < 0) return;
        const wasSelected = this.SelectedPanel === panel;
        this.Panels.RemoveAt(index);
        if (wasSelected)
        {
            const next = this.Panels.Count === 0
                ? undefined
                : this.Panels.Get(Math.min(index, this.Panels.Count - 1));
            this.SelectedPanel = next;
        }
    }

    public CloseById(id: string): void
    {
        if (typeof id !== 'string') return;
        const panel = this.find(id);
        if (panel !== undefined) this.Remove(panel);
    }

    public Clear(): void
    {
        this.Panels.Clear();
        this.SelectedPanel = undefined;
    }

    private find(id: string): IDockPanel | undefined
    {
        for (let i = 0; i < this.Panels.Count; i++)
        {
            const p = this.Panels.Get(i);
            if (p?.Id === id) return p;
        }
        return undefined;
    }
}

function isDockPanel(value: unknown): value is IDockPanel
{
    return value !== null
        && typeof value === 'object'
        && typeof (value as IDockPanel).Id === 'string'
        && typeof (value as IDockPanel).Title === 'string';
}
