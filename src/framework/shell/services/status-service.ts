import {
    type IServiceProvider,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
} from '../../../runtime/index.js';

// Backs the shell's Status region. A message line plus a busy flag the
// status bar binds to. Long-running work flips IsBusy (gating a spinner
// via a trigger) and sets Text; anything in the app can resolve this
// service to post a status message without reaching the status bar
// control.
export class StatusService extends ServiceBase {
    public static readonly Key = new ServiceKey<StatusService>('StatusService');

    private _text = '';
    private _isBusy = false;

    // Status cells the shell's StatusBar binds to (ItemsSource = $Items).
    // Arbitrary app models — the StatusBar wraps each in a StatusBarItem.
    private readonly _items = new ObservableCollection<unknown>();

    constructor(provider: IServiceProvider) {
        super(provider);
    }

    public get Items(): ObservableCollection<unknown> { return this._items; }

    public get Text(): string { return this._text; }
    public set Text(v: string) { const old = this._text; this._text = v; this.RaisePropertyChanged('Text', old, v); }

    public get IsBusy(): boolean { return this._isBusy; }
    public set IsBusy(v: boolean) { const old = this._isBusy; this._isBusy = v; this.RaisePropertyChanged('IsBusy', old, v); }
}
