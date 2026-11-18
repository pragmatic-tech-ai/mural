import type { Visual } from '../../visual-engine/visual.js';
import type { ICommand } from '../../runtime/command.js';
import { Control } from '../base/control.js';
import type { RoutedCommand } from './routed-command.js';
import { KeyBinding, type InputBinding } from './input-binding.js';
import {
    CommandBinding,
    CanExecuteRoutedEventArgs,
    ExecutedRoutedEventArgs,
} from './command-binding.js';

// CommandManager — static façade for the routed-command subsystem.
//
// Responsibilities:
//
//   * Route RoutedCommand invocations through the visual tree from a
//     target Visual upward, consulting per-instance CommandBindings
//     (`Visual.CommandBindings`) first, then per-class CommandBindings
//     registered via RegisterClassCommandBinding.
//
//   * Maintain the class-level CommandBinding + InputBinding
//     registries. WPF's TextBoxBase pre-registers `EditingCommands.Copy`
//     etc. this way so every TextBox in the app handles Ctrl+C without
//     each instance wiring it up.
//
//   * Drive RequerySuggested — the centralized pulse that informs
//     ICommandSource-bound chrome to re-evaluate CanExecute. Fires
//     on focus changes (forwarded by InputManager.SetFocus) and on
//     explicit InvalidateRequerySuggested() calls.
//
//   * Publish the currently-focused Visual so RoutedCommand's
//     ICommand-shaped Execute/CanExecute (which take only `parameter`)
//     can resolve a dispatch target. Multi-InputManager apps push
//     focus updates here; single-target apps just track whichever
//     InputManager was most recent.
//
// Why static rather than an injected service: the .mu authoring shape
// (`Command = ApplicationCommands.Save`) references commands as static
// singletons, and command bookkeeping (class-level bindings, requery)
// is intrinsically global. WPF also uses a static CommandManager. The
// per-target state (focus, capture) lives on InputManager; the
// CommandManager static state is genuinely process-global.

type RequerySuggestedListener = () => void;

export class CommandManager
{
    private static _classCommandBindings: Map<Function, CommandBinding[]> = new Map();
    private static _classInputBindings:   Map<Function, InputBinding[]>   = new Map();

    private static _requerySuggestedListeners: Set<RequerySuggestedListener> = new Set();

    // Most recently published focused Visual. Updated by
    // InputManager.SetFocus via PublishFocusedVisual. Used as the
    // implicit dispatch target for RoutedCommand.Execute / CanExecute
    // when invoked through the bare ICommand surface.
    private static _focusedVisualForRouting: Visual | undefined;

    // ── Class-level binding registry ──────────────────────────────────

    /** Register a CommandBinding that fires for every instance of `type`
     *  (and its subclasses). Per-class bindings are consulted AFTER
     *  per-instance Visual.CommandBindings — instance bindings can
     *  shadow class-level handlers. Used by base controls (TextBoxBase
     *  registers Copy/Cut/Paste here once) so every subclass gets the
     *  behaviour without re-wiring. */
    public static RegisterClassCommandBinding(type: Function, binding: CommandBinding): void
    {
        let arr = CommandManager._classCommandBindings.get(type);
        if (arr === undefined)
        {
            arr = [];
            CommandManager._classCommandBindings.set(type, arr);
        }
        arr.push(binding);
    }

    /** Register an InputBinding (KeyBinding / MouseBinding) that fires
     *  for every instance of `type`. Same precedence rules as
     *  RegisterClassCommandBinding — instance bindings shadow class
     *  bindings. Matches WPF's CommandManager.RegisterClassInputBinding. */
    public static RegisterClassInputBinding(type: Function, binding: InputBinding): void
    {
        let arr = CommandManager._classInputBindings.get(type);
        if (arr === undefined)
        {
            arr = [];
            CommandManager._classInputBindings.set(type, arr);
        }
        arr.push(binding);
    }

    /** Internal — class-level CommandBindings declared for a Visual's
     *  class chain. Walks the prototype chain so a binding registered on
     *  a base class is visible to derived instances. Closer-derived
     *  classes come first in the returned array (matches override
     *  intuition: a Button-specific class binding shadows a
     *  ButtonBase-level one). */
    public static _getClassCommandBindingsFor(visual: Visual): CommandBinding[]
    {
        const out: CommandBinding[] = [];
        for (const ctor of CommandManager._walkClassChain(visual))
        {
            const arr = CommandManager._classCommandBindings.get(ctor);
            if (arr !== undefined) out.push(...arr);
        }
        return out;
    }

    /** Internal — same shape for InputBindings. */
    public static _getClassInputBindingsFor(visual: Visual): InputBinding[]
    {
        const out: InputBinding[] = [];
        for (const ctor of CommandManager._walkClassChain(visual))
        {
            const arr = CommandManager._classInputBindings.get(ctor);
            if (arr !== undefined) out.push(...arr);
        }
        return out;
    }

    // Look up the human-readable shortcut text for `command` as bound on
    // (or above) `anchor`. Walks the visual ancestor chain — at each
    // hop, scans the visual's instance InputBindings (when it's a
    // Control) AND the class-level InputBindings registered for its
    // class chain — and returns the first KeyBinding whose Command
    // matches. Returns undefined when no binding exists, so consumers
    // (tooltip templates, menu shortcut columns) can elide the
    // shortcut row gracefully.
    //
    // Why instance-first per visual then class: a per-Visual instance
    // binding represents an explicit per-scope override (e.g., a
    // dialog re-binds Ctrl+S to a different command). Class bindings
    // are the global default (Button → Space activation). Closer
    // visuals shadow ancestors; instance shadows class at the same
    // visual.
    //
    // Match policy: identity (===) on the command reference. Commands
    // are typically static singletons (`ApplicationCommands.Save`), so
    // identity is the right predicate; a deep-equal would let two
    // distinct commands with the same Name collapse together, which
    // would surprise consumers.
    public static FindShortcutForCommand(
        command: ICommand,
        anchor:  Visual,
    ): string | undefined
    {
        let cursor: Visual | undefined = anchor;
        while (cursor !== undefined)
        {
            if (cursor instanceof Control)
            {
                const instance = cursor._tryGetInputBindings();
                if (instance !== undefined)
                {
                    for (const b of instance)
                    {
                        if (b instanceof KeyBinding && b.Command === command)
                        {
                            return b.DisplayString;
                        }
                    }
                }
            }
            for (const b of CommandManager._getClassInputBindingsFor(cursor))
            {
                if (b instanceof KeyBinding && b.Command === command)
                {
                    return b.DisplayString;
                }
            }
            cursor = cursor.GetVisualParent();
        }
        return undefined;
    }

    private static * _walkClassChain(visual: Visual): IterableIterator<Function>
    {
        let proto: object | null = Object.getPrototypeOf(visual);
        while (proto !== null && proto !== Object.prototype)
        {
            const ctor = (proto as { constructor: Function }).constructor;
            if (ctor === Object) return;
            yield ctor;
            proto = Object.getPrototypeOf(proto);
        }
    }

    // ── RoutedCommand dispatch ────────────────────────────────────────

    /** Walk up from `target` looking for the first CommandBinding (per-
     *  instance, then per-class) whose Command matches and whose
     *  CanExecute callback returns true. Returns the (binding, host)
     *  pair that handled it, or undefined when no binding matched. */
    private static _findCanExecuteBinding(
        command: RoutedCommand,
        parameter: unknown,
        target: Visual,
    ): { binding: CommandBinding; host: Visual; canExecute: boolean } | undefined
    {
        let cursor: Visual | undefined = target;
        while (cursor !== undefined)
        {
            // Per-instance bindings — only Control instances carry
            // CommandBindings; plain Visuals are passed over.
            const bindings: CommandBinding[] | undefined = cursor instanceof Control
                ? cursor._tryGetCommandBindings()
                : undefined;
            if (bindings !== undefined)
            {
                for (const b of bindings)
                {
                    if (b.Command !== command) continue;
                    const args = new CanExecuteRoutedEventArgs(command, parameter, target);
                    if (b._invokeCanExecute(cursor, args))
                    {
                        if (args.ContinueRouting) continue;
                        return { binding: b, host: cursor, canExecute: args.CanExecute };
                    }
                }
            }
            // Per-class bindings.
            const classBindings = CommandManager._getClassCommandBindingsFor(cursor);
            for (const b of classBindings)
            {
                if (b.Command !== command) continue;
                const args = new CanExecuteRoutedEventArgs(command, parameter, target);
                if (b._invokeCanExecute(cursor, args))
                {
                    if (args.ContinueRouting) continue;
                    return { binding: b, host: cursor, canExecute: args.CanExecute };
                }
            }
            cursor = cursor.GetVisualParent();
        }
        return undefined;
    }

    /** Walk up from `target` invoking the first matching CommandBinding's
     *  Executed handler. Returns true if something handled the call.
     *  Walks `Visual.CommandBindings` first on each level, then per-class
     *  bindings via the registry. */
    public static Execute(command: RoutedCommand, parameter: unknown, target: Visual): boolean
    {
        // Gate on CanExecute first — matches WPF behaviour where
        // RoutedCommand.Execute is a no-op when no binding claims the
        // command. Without this, a Button bound to a RoutedCommand with
        // no handler would silently appear to "click" while doing
        // nothing.
        const gate = CommandManager._findCanExecuteBinding(command, parameter, target);
        if (gate === undefined || !gate.canExecute) return false;

        // The CanExecute walk already pinpointed the binding that owns
        // this command at this target — fire its Executed directly so
        // we don't pay for a second tree walk.
        const args = new ExecutedRoutedEventArgs(command, parameter, target);
        return gate.binding._invokeExecuted(gate.host, args);
    }

    /** Probe whether the routed command can currently execute against
     *  the target. Same walk as Execute but doesn't fire. */
    public static CanExecute(command: RoutedCommand, parameter: unknown, target: Visual): boolean
    {
        const gate = CommandManager._findCanExecuteBinding(command, parameter, target);
        return gate?.canExecute === true;
    }

    // ── RequerySuggested ──────────────────────────────────────────────

    /** Subscribe to the "executability may have changed" pulse. Fired on
     *  focus changes (forwarded by InputManager) and on explicit
     *  InvalidateRequerySuggested calls. ICommandSource-bound chrome
     *  (Button, MenuItem) subscribes when a RoutedCommand is the active
     *  Command so the cached _canExecute stays current. */
    public static SubscribeRequerySuggested(listener: RequerySuggestedListener): void
    {
        CommandManager._requerySuggestedListeners.add(listener);
    }

    public static UnsubscribeRequerySuggested(listener: RequerySuggestedListener): void
    {
        CommandManager._requerySuggestedListeners.delete(listener);
    }

    /** Force every subscriber to re-evaluate. Call after a state change
     *  that could affect command executability when there's no per-
     *  command CanExecuteChanged signal — e.g. selection changes on a
     *  board, page-state edits that ungate Save / Undo. */
    public static InvalidateRequerySuggested(): void
    {
        const snap = [...CommandManager._requerySuggestedListeners];
        for (const cb of snap) cb();
    }

    // ── Focus-published target ────────────────────────────────────────

    /** Called by InputManager whenever focus changes. Used by
     *  RoutedCommand's ICommand-shaped Execute/CanExecute (which take
     *  only `parameter`) to resolve a dispatch target. Also fires
     *  RequerySuggested — focus changes routinely affect which
     *  CommandBindings can claim a command. */
    public static PublishFocusedVisual(visual: Visual | undefined): void
    {
        CommandManager._focusedVisualForRouting = visual;
        CommandManager.InvalidateRequerySuggested();
    }

    public static GetFocusedVisualForRouting(): Visual | undefined
    {
        return CommandManager._focusedVisualForRouting;
    }

    // ── Test surface ──────────────────────────────────────────────────

    /** Tests that exercise class-level binding registration need a way
     *  to start from a clean slate. Not part of the consumer surface. */
    public static _resetForTests(): void
    {
        CommandManager._classCommandBindings.clear();
        CommandManager._classInputBindings.clear();
        CommandManager._requerySuggestedListeners.clear();
        CommandManager._focusedVisualForRouting = undefined;
    }
}

