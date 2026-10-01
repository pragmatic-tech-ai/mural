import { MuralBase } from './model.js';
import { MetaData } from './metadata.js';

// ICommand — the MVVM command contract that WPF popularised. Mural's
// shape mirrors System.Windows.Input.ICommand:
//
//   * Execute(parameter)         — perform the action.
//   * CanExecute(parameter)      — whether Execute is currently allowed.
//                                    Consumers (Buttons, MenuItems, …)
//                                    query this to gate user interaction.
//   * CanExecuteChanged listeners — notified when the command's
//                                    executability may have changed, so
//                                    consumers can re-query CanExecute
//                                    and update their UI state.
//
// The intent is the canonical Command pattern: the command encapsulates
// both the *what* (Execute) and the *when* (CanExecute), letting view
// models expose a single object that drives a control's enabled state
// and click action in lock-step.
//
// `parameter` is intentionally typed `unknown` so view models can pass
// any payload (an item to delete, a record id, …) without forcing every
// command implementation to declare a generic. Implementations narrow
// internally — this mirrors WPF's `object`-typed parameter.

export interface ICommand
{
    /**
     * Perform the command's action. Callers are responsible for
     * checking CanExecute first; the command itself is not required
     * to be idempotent or to internally re-check executability.
     */
    Execute(parameter?: unknown): void;

    /**
     * Whether Execute is allowed for the given parameter. Pure query
     * — implementations should not mutate state here.
     */
    CanExecute(parameter?: unknown): boolean;

    /**
     * Register a listener for CanExecuteChanged. The callback fires
     * whenever the command's executability may have transitioned;
     * consumers should re-query CanExecute in response.
     */
    AddCanExecuteChangedListener(listener: () => void): void;

    /** Reverse of AddCanExecuteChangedListener. Idempotent — removing
     *  an unregistered listener is a no-op. */
    RemoveCanExecuteChangedListener(listener: () => void): void;
}

// A command that also carries a checked/active state (toolbar toggles, checkable
// menu items). The state is read off the command itself — it replaces
// ICommandTarget.IsActive(def). Change is signalled through the same
// CanExecuteChanged channel (consumers re-read IsChecked on that pulse).
export interface ICheckableCommand extends ICommand
{
    readonly IsChecked: boolean;
}

export function isCheckableCommand(command: ICommand): command is ICheckableCommand
{
    return typeof (command as Partial<ICheckableCommand>).IsChecked === 'boolean';
}

// Initialisation bag for `CommandBase` subclasses. All optional — the
// command works without any of them set, but consumers (tooltips,
// menus, toolbars) read these to render display chrome.
export interface CommandMetadataInit
{
    /** Primary display name — "Save", "Copy". The default Tooltip
     *  DataTemplate's first line. */
    Text?:        string;
    /** Secondary description — "Save the current document". The
     *  default Tooltip's second line. Empty by default. */
    Description?: string;
    /** Optional icon — anything ContentPresenter can paint (Visual /
     *  MuralBase VM / string). Used by toolbars and rich tooltips. */
    Icon?:        unknown;
}

// CommandBase — abstract MuralBase that every shipped command (RelayCommand,
// RoutedCommand, and consumer subclasses) extends. Carries the bindable
// display metadata used by tooltips, menus, and toolbars. Implements
// ICommand so it slots into any ICommandSource consumer.
//
// Crucially, CommandBase does NOT carry input-gesture / shortcut data.
// Gestures belong on the binding that maps them to the command
// (KeyBinding lives in `Visual.InputBindings`); the tooltip's lookup
// helper resolves "what shortcut is bound to THIS command in the
// anchor's tree?" at render time. Commands stay portable across hosts
// without dragging a hardcoded "Ctrl+S" along — and the same command
// can carry different shortcuts in different windows / platforms /
// keymaps.
export abstract class CommandBase extends MuralBase implements ICommand
{
    public static readonly TextKey        = MuralBase.RegisterProperty<string>(
        CommandBase, 'Text',        '',        MetaData.None);
    public static readonly DescriptionKey = MuralBase.RegisterProperty<string>(
        CommandBase, 'Description', '',        MetaData.None);
    public static readonly IconKey        = MuralBase.RegisterProperty<unknown>(
        CommandBase, 'Icon',        undefined, MetaData.None);

    public get Text():        string  { return this.get_property_value(CommandBase.TextKey); }
    public set Text(v:        string) { this.set_property_value(CommandBase.TextKey, v); }
    public get Description(): string  { return this.get_property_value(CommandBase.DescriptionKey); }
    public set Description(v: string) { this.set_property_value(CommandBase.DescriptionKey, v); }
    public get Icon():        unknown { return this.get_property_value(CommandBase.IconKey); }
    public set Icon(v:        unknown){ this.set_property_value(CommandBase.IconKey, v); }

    // CanExecute-changed subscribers. Renamed from `_listeners` to avoid
    // colliding with the private `_listeners` field on `Observable` (the
    // light property-change store) now that `CommandBase` descends from
    // it via `MuralBase`.
    private readonly _canExecuteListeners: Set<() => void> = new Set();

    constructor(meta?: CommandMetadataInit)
    {
        super();
        if (meta !== undefined)
        {
            if (meta.Text        !== undefined) this.Text        = meta.Text;
            if (meta.Description !== undefined) this.Description = meta.Description;
            if (meta.Icon        !== undefined) this.Icon        = meta.Icon;
        }
    }

    public abstract Execute(parameter?: unknown): void;
    public abstract CanExecute(parameter?: unknown): boolean;

    public AddCanExecuteChangedListener(listener: () => void): void
    {
        this._canExecuteListeners.add(listener);
    }

    public RemoveCanExecuteChangedListener(listener: () => void): void
    {
        this._canExecuteListeners.delete(listener);
    }

    // Subclass hook — current listener count. RoutedCommand consults
    // this when toggling its `CommandManager.RequerySuggested`
    // subscription so the global pulse isn't held open by a command
    // with zero subscribers.
    protected _listenerCount(): number
    {
        return this._canExecuteListeners.size;
    }

    // Notify subscribers that CanExecute may have transitioned. Snapshot
    // the listener set first so a subscriber that detaches itself from
    // within its callback doesn't perturb the iteration.
    public RaiseCanExecuteChanged(): void
    {
        const snap = [...this._canExecuteListeners];
        for (const cb of snap) cb();
    }
}

// ── RelayCommand ────────────────────────────────────────────────────

// A drop-in CommandBase backed by a pair of callbacks. Equivalent to
// WPF / MVVM Toolkit's `RelayCommand`: the view model supplies the
// action (and optionally a guard); the command class handles the
// listener bookkeeping. The optional `metadata` bag lets the VM declare
// Text / Description / Icon at construction so tooltips and menus
// render correctly without extra wiring.
//
// View models with imperative re-evaluation needs (e.g., "selection
// changed, recompute") call `RaiseCanExecuteChanged()` to notify
// subscribers — Buttons / MenuItems re-query CanExecute and refresh
// their enabled state.
export class RelayCommand extends CommandBase
{
    private readonly execute:    (parameter?: unknown) => void;
    private readonly canExecute: ((parameter?: unknown) => boolean) | undefined;

    constructor(
        execute:     (parameter?: unknown) => void,
        canExecute?: (parameter?: unknown) => boolean,
        metadata?:   CommandMetadataInit,
    )
    {
        super(metadata);
        this.execute    = execute;
        this.canExecute = canExecute;
    }

    public override Execute(parameter?: unknown): void
    {
        this.execute(parameter);
    }

    public override CanExecute(parameter?: unknown): boolean
    {
        return this.canExecute === undefined ? true : this.canExecute(parameter);
    }
}

// A RelayCommand that also reports a checked state via a pull predicate. IsChecked
// is re-read on demand; callers refresh on the CanExecuteChanged pulse (as the
// toolbar already does for toggle state).
export class CheckableRelayCommand extends RelayCommand implements ICheckableCommand
{
    private readonly isChecked: () => boolean;

    constructor(
        execute:    (parameter?: unknown) => void,
        canExecute: ((parameter?: unknown) => boolean) | undefined,
        isChecked:  () => boolean,
        metadata?:  CommandMetadataInit,
    )
    {
        super(execute, canExecute, metadata);
        this.isChecked = isChecked;
    }

    public get IsChecked(): boolean
    {
        return this.isChecked();
    }
}
