import type { Visual } from '../../visual-engine/visual.js';
import type { ICommand } from '../../runtime/command.js';
import { RoutedCommand } from './routed-command.js';
import { CommandManager } from './command-manager.js';

// ICommandSource — the shared contract every command-invoking control
// satisfies. WPF parity:
//   * Command          — the bound ICommand (RelayCommand or RoutedCommand).
//   * CommandParameter — opaque payload passed to Execute / CanExecute.
//   * CommandTarget    — for RoutedCommand only: overrides the default
//                        dispatch target (the source Visual itself).
//                        For plain ICommand, this is ignored.
//
// Implementing controls (Button v1; MenuItem, ToggleButton, Hyperlink in
// follow-up work) hold their own DPs for the three fields — each
// control re-uses the MuralBase.RegisterProperty machinery so a Button's
// Command is structurally distinct from a MenuItem's Command but they
// share the contract shape.
//
// Behavioural plumbing (CanExecute caching + listener bookkeeping) is
// extracted into CommandSourceHelper. Each ICommandSource instance owns
// one helper and delegates `OnCommandChanged` / `OnParameterChanged` /
// `OnTargetChanged` to it from `OnPropertyChanged`. The helper handles
// the RoutedCommand-vs-plain-ICommand branching internally so the
// Button (etc.) doesn't repeat that logic.

export interface ICommandSource
{
    readonly Command:          ICommand | undefined;
    readonly CommandParameter: unknown;
    readonly CommandTarget:    Visual | undefined;
}

// CommandSourceHelper — per-instance bookkeeping for a control that
// implements ICommandSource. Owns:
//
//   * The cached `_canExecute` boolean (consulted at click / activation
//     time to gate dispatch and at chrome-render time to drive
//     IsEnabled-style styling).
//
//   * The CanExecuteChanged subscription on the currently-bound
//     Command — added on bind, removed on unbind / swap. For a
//     RoutedCommand the subscription effectively wires into
//     CommandManager.RequerySuggested via RoutedCommand's listener
//     chain.
//
//   * The on-change callback the owning control passes in — fired on
//     every _canExecute transition so the control can refresh chrome
//     (e.g. toggle the IsEnabled DP).
//
// Construction takes the owner Visual + the three property descriptors
// the owner uses for its Command / CommandParameter / CommandTarget
// DPs. The helper reads through the descriptors so it works
// uniformly regardless of which subclass declared the DPs.
export class CommandSourceHelper
{
    private readonly _owner: ICommandSource & Visual;
    private readonly _onChanged: (() => void) | undefined;

    private _canExecute: boolean = true;
    private _attachedCommand: ICommand | undefined;

    private readonly _refresh = (): void =>
    {
        const prev = this._canExecute;
        this._canExecute = this._computeCanExecute();
        if (prev !== this._canExecute) this._onChanged?.();
    };

    constructor(owner: ICommandSource & Visual, onChanged?: () => void)
    {
        this._owner     = owner;
        this._onChanged = onChanged;
    }

    public get CanExecute(): boolean { return this._canExecute; }

    /** Invoke the bound Command. Returns true if execution actually fired
     *  (i.e., CanExecute passed and the command did something). For
     *  RoutedCommand, routes via CommandManager against CommandTarget
     *  (or the owner if CommandTarget is unset). For plain ICommand,
     *  calls Execute directly with the parameter. */
    public Execute(): boolean
    {
        if (!this._canExecute) return false;
        const cmd = this._owner.Command;
        if (cmd === undefined) return false;
        const parameter = this._owner.CommandParameter;
        if (cmd instanceof RoutedCommand)
        {
            const target = this._owner.CommandTarget ?? this._owner;
            return CommandManager.Execute(cmd, parameter, target);
        }
        cmd.Execute(parameter);
        return true;
    }

    /** Owner must call this from `OnPropertyChanged` when the Command DP
     *  changes — handles listener bookkeeping AND the cached
     *  _canExecute refresh. */
    public OnCommandChanged(oldCmd: ICommand | undefined, newCmd: ICommand | undefined): void
    {
        if (oldCmd !== undefined)
        {
            oldCmd.RemoveCanExecuteChangedListener(this._refresh);
        }
        if (newCmd !== undefined)
        {
            newCmd.AddCanExecuteChangedListener(this._refresh);
        }
        this._attachedCommand = newCmd;
        this._refresh();
    }

    /** Owner must call this when CommandParameter OR CommandTarget
     *  changes — both alter the canExecute computation. */
    public OnParameterOrTargetChanged(): void
    {
        this._refresh();
    }

    /** Detach the listener — call from the control's teardown path if it
     *  has one. (Visual's existing lifetime model relies on dropping
     *  references; this is for symmetry / future-proofing.) */
    public dispose(): void
    {
        if (this._attachedCommand !== undefined)
        {
            this._attachedCommand.RemoveCanExecuteChangedListener(this._refresh);
            this._attachedCommand = undefined;
        }
    }

    private _computeCanExecute(): boolean
    {
        const cmd = this._owner.Command;
        if (cmd === undefined) return true;
        const parameter = this._owner.CommandParameter;
        if (cmd instanceof RoutedCommand)
        {
            const target = this._owner.CommandTarget ?? this._owner;
            return CommandManager.CanExecute(cmd, parameter, target);
        }
        return cmd.CanExecute(parameter);
    }
}
