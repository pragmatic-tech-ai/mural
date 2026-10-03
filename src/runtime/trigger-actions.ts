import type { Storyboard } from '../visual-engine/animation/storyboard.js';
import type { Visual } from '../visual-engine/visual.js';
import type { Behavior } from '../visual-engine/behavior.js';

// Friend-interface for the Behaviors surface on Element. Behaviors
// live on Element after Phase B but `Visual` (the type-erased target
// in TriggerAction.Invoke) is what gets passed in by the trigger
// machinery — every shipped control extends Element so the cast
// resolves in practice. Per CLAUDE.md cross-class internals pattern.
interface ElementWithBehaviors
{
    AddBehavior:    (behavior: Behavior) => void;
    RemoveBehavior: (behavior: Behavior) => void;
}

// Imperative side of declarative trigger actions. A TriggerAction is the
// thing an EventTrigger fires when its routed event lands; the most
// common (and only ship-supported v1) action is BeginStoryboardAction
// which materialises a fresh Storyboard and starts it.
//
// Why factory-based: a Style typically declares ONE EventTrigger and
// many Visuals share it. Sharing a Storyboard instance across all
// Buttons that pick up the style would mean every click on any button
// stops every other button's running animation (Storyboard.Begin is
// idempotent on a Running storyboard, and target lists are fixed at
// Begin). Each invocation calling the factory produces a fresh
// Storyboard whose Children are bound to the firing Visual.
//
// The factory receives the firing Visual ("target") so emitted code can
// write `sb.Add(target, 'Width', ...)` without baking a specific Visual
// instance into the closure at template-load time.
export abstract class TriggerAction
{
    /** Run the action against the Visual the firing EventTrigger is
     *  registered on. `args` is the routed-event args of the firing
     *  event (PointerEventArgs, KeyEventArgs, DragEventArgs, …) — the
     *  install_event_trigger wiring in Visual passes it through.
     *  Actions that don't need the args (BeginStoryboard et al.) can
     *  ignore the parameter; InvokeCommandAction forwards it as the
     *  ICommand's Execute parameter so commands can read the args. */
    public abstract Invoke(target: Visual, args?: unknown): void;
}

// Build + Begin a fresh Storyboard each time the parent EventTrigger
// fires. Mirrors WPF's BeginStoryboard Action (sans the SoundPlayer /
// PauseStoryboard / StopStoryboard siblings).
//
// Authoring shape in `.mu`:
//
//   on Click {
//       BeginStoryboard {
//           DoubleAnimation[TargetProperty=Width, From=80, To=240, Duration=400]
//       }
//   }
//
// The compiler emits a factory closure whose body does:
//   const sb = new Storyboard();
//   sb.Add(target, 'Width', new DoubleAnimation({...}));
//   return sb;
// — i.e., the target binding is deferred to invocation, and ALL
// animations declared inside the BeginStoryboard block get bundled
// into the same Storyboard so their FillBehavior / completion semantics
// run as one unit.
export class BeginStoryboardAction extends TriggerAction
{
    public readonly Factory: (target: Visual) => Storyboard;
    /** Optional handle that lets StopStoryboardAction / PauseStoryboardAction /
     *  ResumeStoryboardAction reference this Storyboard later. When set,
     *  each Invoke registers the freshly-built Storyboard on the target
     *  Visual under this name, overwriting any prior registration. The
     *  name lives on the FIRING Visual, not globally — so two Buttons
     *  with the same trigger have independent "fade" storyboards. */
    public readonly Name:    string | undefined;

    public constructor(
        factory: (target: Visual) => Storyboard,
        name?:   string,
    )
    {
        super();
        this.Factory = factory;
        this.Name    = name;
    }

    public override Invoke(target: Visual): void
    {
        const sb = this.Factory(target);
        if (this.Name !== undefined)
        {
            target.RegisterNamedStoryboard(this.Name, sb);
        }
        sb.Begin();
    }
}

// Stop the named Storyboard previously begun on this Visual. WPF
// `StopStoryboard BeginStoryboardName="..."` analogue.
//
// Looks up the latest Storyboard registered under `Name` on the
// invoking Visual; calls .Stop() to release its animation slots.
// Silently no-ops when the name doesn't resolve — matches WPF
// behaviour, prevents a typo in markup from crashing the page.
export class StopStoryboardAction extends TriggerAction
{
    public constructor(public readonly Name: string)
    {
        super();
    }

    public override Invoke(target: Visual): void
    {
        target.GetNamedStoryboard(this.Name)?.Stop();
    }
}

// Suspend the named Storyboard without releasing its animation slots.
// The pinned animated values stay visible; subsequent ResumeStoryboard
// picks up where Pause left off.
export class PauseStoryboardAction extends TriggerAction
{
    public constructor(public readonly Name: string)
    {
        super();
    }

    public override Invoke(target: Visual): void
    {
        target.GetNamedStoryboard(this.Name)?.Pause();
    }
}

// Counterpart to PauseStoryboardAction. A no-op when the target named
// Storyboard isn't paused (or doesn't resolve).
export class ResumeStoryboardAction extends TriggerAction
{
    public constructor(public readonly Name: string)
    {
        super();
    }

    public override Invoke(target: Visual): void
    {
        target.GetNamedStoryboard(this.Name)?.Resume();
    }
}

// EventTrigger + InvokeCommandAction (the routed-event / ICommand bridge)
// moved to `./input/event-trigger.js` — they're the input side of the
// trigger system. TriggerAction stays here so the storyboard and behavior
// actions below can extend it.

// Triggered-behavior attach. The trigger's enter edge wires a fresh
// Behavior instance onto the firing Visual; the matching
// DetachBehaviorAction (placed in the trigger's exitActions) tears it
// back off on the trigger's deactivation edge.
//
// Factory-based so two Visuals sharing the same Style + DataTrigger
// each get an independent Behavior instance (sharing a single Behavior
// across multiple Visuals would have them stomp on each other's
// per-instance properties at the second OnAttached).
//
// Authoring shape in `.mu`:
//
//   Style[TargetType=Border] {
//       DataTrigger { when($IsBusy) {
//           Behaviors { ShakeBehavior[Amplitude=4] }
//       }}
//   }
//
// Compiler emission:
//   const _a = new AttachBehaviorAction((_target) => {
//       const _b = new ShakeBehavior(); _b.Amplitude = 4; return _b;
//   });
//   const _d = new DetachBehaviorAction(_a);
//   // enterActions: [_a]; exitActions: [_d]
//
// The factory receives the firing Visual as its one argument — same
// shape as BeginStoryboardAction's Factory — so a Behavior attribute
// binding authored inside the Behaviors block (e.g. `ShakeBehavior[
// Hierarchy = $Hierarchy]`) can resolve against the HOST Visual's
// DataContext (the compiler wires this via behaviorHostVar; see
// compileTriggeredBehavior), matching how the plain .Behaviors:/
// Behaviors{} path resolves a Behavior's own attribute bindings.
//
// Re-entry safety: invoking Attach on a target that's already holding
// the attached behavior (e.g., the trigger flickers active→active
// without an intervening exit) detaches the prior instance before
// attaching a fresh one — keeps the per-target reference unique.
export class AttachBehaviorAction extends TriggerAction
{
    public readonly Factory: (target: Visual) => Behavior;
    /** Per-target attached behavior. WeakMap so a target Visual dropping
     *  out of use lets its behavior ref be GC'd; the DetachBehaviorAction
     *  paired with this Attach reads back through the same WeakMap. */
    private readonly attached: WeakMap<Visual, Behavior> = new WeakMap();

    public constructor(factory: (target: Visual) => Behavior)
    {
        super();
        this.Factory = factory;
    }

    public override Invoke(target: Visual): void
    {
        // Behaviors live on Element after Phase B; AttachBehaviorAction
        // is only meaningful on an Element subclass (every shipped
        // control extends Element). Cast pulls the typed surface back
        // at the boundary.
        const elementTarget = target as unknown as ElementWithBehaviors;
        const existing = this.attached.get(target);
        if (existing !== undefined)
        {
            // Re-entry without an intervening exit — drop the old
            // attachment cleanly before installing the new one.
            elementTarget.RemoveBehavior(existing);
        }
        const beh = this.Factory(target);
        elementTarget.AddBehavior(beh);
        this.attached.set(target, beh);
    }

    /** Internal — called by the paired DetachBehaviorAction. Looks up
     *  the most-recently-attached behavior for `target` and removes
     *  it; no-op when nothing is currently attached (e.g., the trigger
     *  exit fires before any enter, or after a forced Visual unload). */
    public DetachFrom(target: Visual): void
    {
        const beh = this.attached.get(target);
        if (beh === undefined) return;
        (target as unknown as ElementWithBehaviors).RemoveBehavior(beh);
        this.attached.delete(target);
    }
}

// Pairs with `AttachBehaviorAction`. Placed in a trigger's exitActions
// so the behavior installed on the enter edge is torn back off when
// the trigger deactivates. References the AttachBehaviorAction instance
// directly so the per-target attachment map is shared — no separate
// state to keep in sync.
export class DetachBehaviorAction extends TriggerAction
{
    public readonly Attach: AttachBehaviorAction;

    public constructor(attach: AttachBehaviorAction)
    {
        super();
        this.Attach = attach;
    }

    public override Invoke(target: Visual): void
    {
        this.Attach.DetachFrom(target);
    }
}
