import { resolveKey } from '../runtime/model-internals.js';
import { Binding } from '../runtime/binding/binding.js';
import { DataContextBinding } from '../runtime/binding/data-context-binding.js';
import {
    PropertyTrigger,
    MultiTrigger,
    DataTrigger,
    MultiDataTrigger,
    triggerConditionMet,
} from '../runtime/style.js';
import type { EventTrigger } from '../runtime/event-trigger.js';
import { KNOWN_ROUTED_EVENTS } from './visual.js';
import type { Element } from './element.js';

// Click-specific duck-typing surface for the Button family. Button
// (in `framework/button.ts`) exposes its OWN Click protocol because
// the routed-event walker doesn't pass through `Click` — it's a
// post-press-edge synthesis on Button. Detected at install time so
// an EventTrigger declared with `RoutedEvent='Click'` on a non-Button
// Visual silently no-ops rather than throwing.
interface ClickEventSource
{
    AddClickHandler?:    (h: (args: unknown) => void) => void;
    RemoveClickHandler?: (h: (args: unknown) => void) => void;
}

// The trigger install / uninstall contract — five Install* + two
// Uninstall* methods that own a trigger's subscription lifetime on
// some target. Implemented by `TriggerHost` (the actual machinery)
// and by `Element` (which forwards to a lazily-allocated host so an
// Element that never opts into Style / Triggers pays zero
// allocation). `StyleApplicator.RefreshActiveStyle` calls into this
// surface during a Style swap to diff-install / -uninstall triggers
// — accepting `ITriggerHost` rather than the concrete `Element` lets
// the applicator stay structural about who hosts the triggers.
export interface ITriggerHost
{
    InstallTrigger(trigger: PropertyTrigger): void;
    InstallMultiTrigger(trigger: MultiTrigger): void;
    InstallDataTrigger(trigger: DataTrigger): void;
    InstallMultiDataTrigger(trigger: MultiDataTrigger): void;
    InstallEventTrigger(trigger: EventTrigger): void;
    UninstallTrigger(trigger: PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger): void;
    UninstallEventTrigger(trigger: EventTrigger): void;
}

// TriggerHost — § 1.8. The per-Element collaborator that owns the
// trigger installation, evaluation, and teardown machinery. Pulls
// the five `install_*` / two `uninstall_*` methods out of Visual,
// the `apply_trigger_transition` primitive from § 1.3, and the
// three per-trigger collections (`_activeTriggers`,
// `_triggerSubscriptions`, `_eventTriggerSubscriptions`).
//
// One instance per Element, created lazily on first trigger install.
// Visuals that never opt into Style / Triggers still pay zero
// allocation — the host is `undefined` on the receiver until needed.
//
// Pairs with `StyleApplicator` (§ 1.7) — that collaborator handles
// trigger-tier setter writes via the target's public
// `ApplyTriggerSetter` / `ClearTriggerSetter` hooks, which trampoline
// back through the applicator. The two collaborators share the
// trigger-setter surface but otherwise don't know about each other.
export class TriggerHost implements ITriggerHost
{
    // Currently-matched triggers. A trigger is added on its watched
    // property matching the trigger's value; removed when the value
    // diverges. Trigger setters are applied / cleared in lock-step.
    private _activeTriggers: Set<PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger> | undefined;

    // Per-trigger unsubscribe callback, set at InstallXxxTrigger,
    // invoked at UninstallTrigger. Keyed by the trigger instance.
    private _triggerSubscriptions: Map<PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger, () => void> | undefined;

    // Per-EventTrigger unsubscribe callback. Different map from
    // `_triggerSubscriptions` because EventTriggers don't watch a
    // property value — they hook a routed event source whose detach
    // shape is event-specific (Button.RemoveClickHandler for Click,
    // …). Separating the two also keeps the keying clean: an
    // EventTrigger and a PropertyTrigger with the same instance
    // identity wouldn't collide here.
    private _eventTriggerSubscriptions: Map<EventTrigger, () => void> | undefined;

    constructor(private readonly _target: Element) {}

    /** Subscribe to the trigger's watched property and run an initial
     *  evaluation so an already-matching trigger activates
     *  immediately. */
    public InstallTrigger(trigger: PropertyTrigger): void
    {
        const target = this._target;
        const key = resolveKey(target, trigger.propertyOwner, trigger.propertyName);
        const evaluate = (isInitial: boolean): void => {
            const matched = triggerConditionMet(target.get_property_value(key), trigger.value);
            this.applyTransition(trigger, matched, isInitial);
        };
        const onChange = (): void => { evaluate(false); };
        const sub = target.PropertyChanged(key).subscribe(onChange);
        (this._triggerSubscriptions ??= new Map()).set(trigger, () => {
            sub.dispose();
        });
        evaluate(true);
    }

    /** Multi-property AND-trigger install. Subscribes to every
     *  condition's (owner, name) pair so any change re-evaluates the
     *  conjunction. Activation is all-or-nothing: setters apply only
     *  when every watched value === its expected; they deactivate as
     *  soon as one stops matching. */
    public InstallMultiTrigger(trigger: MultiTrigger): void
    {
        const target = this._target;
        const keys = trigger.conditions.map(cond =>
            resolveKey(target, cond.propertyOwner, cond.propertyName));
        const evaluate = (isInitial: boolean): void => {
            const matched = trigger.conditions.every((cond, i) =>
                triggerConditionMet(target.get_property_value(keys[i]!), cond.value));
            this.applyTransition(trigger, matched, isInitial);
        };
        const onChange = (): void => { evaluate(false); };
        const unsubs: Array<() => void> = [];
        for (const key of keys)
        {
            const sub = target.PropertyChanged(key).subscribe(onChange);
            unsubs.push(() => { sub.dispose(); });
        }
        (this._triggerSubscriptions ??= new Map()).set(trigger, () => { for (const u of unsubs) u(); });
        evaluate(true);
    }

    /** Data-driven trigger install. Watches `target.DataContext` via a
     *  `DataContextBinding` for `trigger.path`; whenever the bound
     *  value changes (DataContext swap OR a property mutation on the
     *  first segment), re-evaluates against `trigger.value` and flips
     *  setter state accordingly. Symmetric with `InstallTrigger`. */
    public InstallDataTrigger(trigger: DataTrigger): void
    {
        const target = this._target;
        const binding: Binding = trigger.path !== undefined
            ? DataContextBinding(target, trigger.path)
            : trigger.bindingFactory!(target);
        const evaluate = (isInitial: boolean): void => {
            const matched = triggerConditionMet(binding.get_value(), trigger.value);
            this.applyTransition(trigger, matched, isInitial);
        };
        binding.setOnValueChanged(() => { evaluate(false); });
        (this._triggerSubscriptions ??= new Map()).set(trigger, () => { binding.dispose(); });
        evaluate(true);
    }

    /** Multi-binding AND-trigger install. Allocates one
     *  `DataContextBinding` per condition; any condition's bound
     *  value change re-evaluates the conjunction. All-or-nothing
     *  activation, symmetric with `InstallMultiTrigger`. */
    public InstallMultiDataTrigger(trigger: MultiDataTrigger): void
    {
        const target = this._target;
        const bindings = trigger.conditions.map(cond =>
            cond.path !== undefined
                ? DataContextBinding(target, cond.path)
                : cond.bindingFactory!(target));
        const evaluate = (isInitial: boolean): void => {
            const matched = trigger.conditions.every(
                (cond, i) => triggerConditionMet(bindings[i]!.get_value(), cond.value),
            );
            this.applyTransition(trigger, matched, isInitial);
        };
        const onChange = (): void => { evaluate(false); };
        for (const b of bindings) b.setOnValueChanged(onChange);
        (this._triggerSubscriptions ??= new Map()).set(trigger, () => {
            for (const b of bindings) b.dispose();
        });
        evaluate(true);
    }

    /** Tear down any subscription installed by the four `InstallXxx`
     *  paths above, then unapply the trigger's setters if it's still
     *  active. Called from `StyleApplicator.RefreshActiveStyle` on
     *  Style swap (a trigger present in the previous Style but not
     *  the next). */
    public UninstallTrigger(trigger: PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger): void
    {
        this._triggerSubscriptions?.get(trigger)?.();
        this._triggerSubscriptions?.delete(trigger);
        if (this._activeTriggers?.has(trigger) === true)
        {
            const target = this._target;
            for (const setter of trigger.setters)
            {
                target.ClearTriggerSetter(setter);
            }
            this._activeTriggers.delete(trigger);
        }
    }

    /** Wire the EventTrigger's RoutedEvent to a dispatch that invokes
     *  every Action on each fire. Cleanly dispatches by event NAME so
     *  a .mu author can write `on Click { … }` without the runtime
     *  knowing which concrete Visual subclass is in play.
     *
     *  Routing:
     *    * 'Click'                 — duck-typed via `AddClickHandler`
     *                                 (only Button + subclasses expose
     *                                 it). Non-Button targets silently
     *                                 no-op rather than throw so a
     *                                 Style declared once and applied
     *                                 to a heterogeneous set degrades
     *                                 gracefully.
     *    * 'Loaded' / 'Unloaded'   — symmetric with the public
     *                                 AddLoadedListener / AddUnloadedListener
     *                                 hooks on the target.
     *    * known routed events     — pointer / key / focus / drag,
     *                                 dispatched via
     *                                 AddRoutedEventListener.
     *    * anything else           — logged to the host's console as
     *                                 a misconfigured EventTrigger
     *                                 hint and no-op'd.
     */
    public InstallEventTrigger(trigger: EventTrigger): void
    {
        const target = this._target;
        const fire = (args: unknown): void => {
            for (const a of trigger.Actions) a.Invoke(target, args);
        };

        if (trigger.RoutedEvent === 'Click')
        {
            // Click via Button.AddClickHandler / RemoveClickHandler —
            // duck-typed so the runtime doesn't drag a Button import.
            const self = target as unknown as ClickEventSource;
            if (typeof self.AddClickHandler === 'function'
             && typeof self.RemoveClickHandler === 'function')
            {
                const handler = (args: unknown): void => fire(args);
                self.AddClickHandler(handler);
                (this._eventTriggerSubscriptions ??= new Map()).set(trigger, () => {
                    self.RemoveClickHandler!(handler);
                });
            }
            return;
        }

        if (trigger.RoutedEvent === 'Loaded')
        {
            // Loaded — fires once when this Element first attaches to a
            // target. Lifecycle listener API lives on Element after
            // Phase B; the target Visual was passed in by Visual's
            // _install_event_trigger trampoline whose receiver is
            // always an Element subclass in practice (every shipped
            // control extends Element). The cast pulls the typed
            // surface back without a friend-interface declaration.
            const elementTarget = target as Element;
            const handler = (): void => fire(undefined);
            elementTarget.AddLoadedListener(handler);
            (this._eventTriggerSubscriptions ??= new Map()).set(trigger, () => {
                elementTarget.RemoveLoadedListener(handler);
            });
            return;
        }

        if (trigger.RoutedEvent === 'Unloaded')
        {
            // Unloaded fires on EVERY detach edge (not one-shot).
            // Same Element-cast pattern as the Loaded branch.
            const elementTarget = target as Element;
            const handler = (): void => fire(undefined);
            elementTarget.AddUnloadedListener(handler);
            (this._eventTriggerSubscriptions ??= new Map()).set(trigger, () => {
                elementTarget.RemoveUnloadedListener(handler);
            });
            return;
        }

        if (KNOWN_ROUTED_EVENTS.has(trigger.RoutedEvent))
        {
            // Generic routed events — PointerDown / PointerUp /
            // PointerMove / PointerWheel / KeyDown / KeyUp / GotFocus
            // / LostFocus / drag events. The handler forwards the
            // routed-event args to each TriggerAction so
            // InvokeCommandAction can pass them to the bound
            // ICommand's Execute method.
            const handler = (args: unknown): void => fire(args);
            target.AddRoutedEventListener(trigger.RoutedEvent, handler);
            (this._eventTriggerSubscriptions ??= new Map()).set(trigger, () => {
                target.RemoveRoutedEventListener(trigger.RoutedEvent, handler);
            });
            return;
        }

        // Unknown event name — log once and move on. The author gets
        // a visible hint without their page crashing.
        const console = (globalThis as { console?: { warn?: (m: string) => void } }).console;
        console?.warn?.(`Visual.AddEventTrigger: routed event '${trigger.RoutedEvent}' is not yet supported.`);
    }

    /** Tear down the EventTrigger's subscription. */
    public UninstallEventTrigger(trigger: EventTrigger): void
    {
        this._eventTriggerSubscriptions?.get(trigger)?.();
        this._eventTriggerSubscriptions?.delete(trigger);
    }

    // Single trigger-transition primitive (§ 1.3). Given a trigger
    // and its current match status, flip the active state and apply
    // or unapply its setters via the target's public
    // `ApplyTriggerSetter` / `ClearTriggerSetter` hooks. Enter / Exit
    // actions fire only on actual transitions — initial evaluation
    // suppresses them so a Style apply that finds an already-matching
    // trigger doesn't double-fire entering actions.
    //
    // WPF edge semantics: enterActions / exitActions fire only on
    // false → true / true → false transitions, not on the initial
    // "already true" state at install time. Setters still apply
    // silently on the initial match so the resting visual is in the
    // matched chrome from the first frame. Enter actions fire AFTER
    // setters apply so any storyboard started by an action sees the
    // post-trigger property state as its baseline.
    private applyTransition(
        trigger: PropertyTrigger | MultiTrigger | DataTrigger | MultiDataTrigger,
        matched: boolean,
        isInitialEvaluation: boolean,
    ): void
    {
        const target = this._target;
        const wasActive = this._activeTriggers?.has(trigger) === true;
        if (matched && !wasActive)
        {
            for (const setter of trigger.setters)
            {
                target.ApplyTriggerSetter(setter);
            }
            (this._activeTriggers ??= new Set()).add(trigger);
            if (!isInitialEvaluation)
            {
                for (const action of trigger.enterActions) action.Invoke(target);
            }
        }
        else if (!matched && wasActive)
        {
            for (const setter of trigger.setters)
            {
                target.ClearTriggerSetter(setter);
            }
            this._activeTriggers?.delete(trigger);
            if (!isInitialEvaluation)
            {
                for (const action of trigger.exitActions) action.Invoke(target);
            }
        }
    }
}
