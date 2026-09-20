import {
    DragEventArgs,
    FocusEventArgs,
    KeyEventArgs,
    NoModifiers,
    PointerButton,
    PointerEventArgs,
    QueryCursorEventArgs,
    TextInputEventArgs,
    WheelEventArgs,
    type DragEventInit,
    type KeyEventInit,
    type PointerEventInit,
    type TextInputEventInit,
    type WheelEventInit,
    buildRoute,
    dispatchDrag,
    dispatchFocus,
    dispatchKeyboardFocus,
    dispatchKey,
    dispatchQueryCursor,
    dispatchPointer,
    dispatchPointerDirect,
    dispatchTextInput,
} from '../visual-engine/routed-event.js';
import { DragDrop, DragDropEffects, DragSession, type DragDropOptions } from '../visual-engine/drag-drop.js';
import type { Element } from '../visual-engine/element.js';
import { Mouse } from '../visual-engine/input/mouse.js';
import { Stylus } from '../visual-engine/input/stylus.js';
import { Touch } from '../visual-engine/input/touch.js';
import { ManipulationCoordinator } from '../visual-engine/input/manipulation.js';
import { Keyboard } from '../visual-engine/input/keyboard.js';
import { FocusManager } from '../visual-engine/input/focus-manager.js';
import { CaptureMode, FocusNavigationDirection } from '../visual-engine/input/input-enums.js';
import { Key } from '../visual-engine/input/key.js';
import { hasModifier, ModifierKeys } from '../visual-engine/routed-event.js';
import { KeyboardNavigation, TraversalRequest } from '../visual-engine/input/keyboard-navigation.js';
import { CommandManager } from './commands/command-manager.js';

// Owns the per-target pointer state and turns raw pointer hits into
// routed-event dispatches. One InputManager per PresentationTarget;
// each target's host adapter (HtmlTarget for browser, future native
// targets) instantiates one and forwards normalised PointerEventInit
// records into the public Inject* methods.
//
// Responsibilities:
//
//   * Hover-chain diffing — when the pointer moves over a new Visual,
//     compute the route from the new leaf up to the root, diff it
//     against the previous route, and raise PointerLeave on visuals
//     dropped from the chain plus PointerEnter on visuals added. The
//     hover diff is what keeps `IsMouseOver` correct on containers as
//     the pointer crosses sibling boundaries.
//
//   * IsMouseOver maintenance — the dispatcher itself doesn't touch
//     DPs; the InputManager sets `IsMouseOver` on every Visual in the
//     new chain to `true` and on every Visual leaving the chain to
//     `false`. Triggers see the DP change and re-evaluate via the
//     existing PropertyTrigger plumbing.
//
//   * IsPressed maintenance — PointerDown sets IsPressed on the Source
//     visual; PointerUp clears it. WPF clears IsPressed even when the
//     up happens outside the visual's bounds, so the manager tracks
//     the down-Source separately from the current hover chain.
//
//   * PointerMove dispatch — fired after the hover diff so handlers
//     see a stable chain.

export class InputManager
{
    // Most-recent hover route (leaf-first), or empty when the pointer
    // is outside the target. Used to diff against the new route on
    // every move.
    private hoverRoute: Element[] = [];

    // Visual on which the active primary-button press began. Tracked
    // so PointerUp can clear IsPressed regardless of where the pointer
    // ends up — matches WPF Button behaviour where pressing inside a
    // button then dragging outside still clears IsPressed on Up.
    //
    // Keyed off pointer ID so multi-touch presses on different visuals
    // can coexist; for v1 every browser pointer event with the same
    // pointerId shares a press target.
    private pressTargets: Map<number, Element> = new Map();

    // Drag-time global cursor override. Set via CapturePointer's
    // optional cursor argument (or the standalone Lock/Unlock helpers
    // below). Auto-released alongside the capture — on
    // ReleasePointerCapture and on the matching PointerUp's auto-release
    // branch — so consumers can't strand a locked cursor by forgetting
    // to clear it. WPF parity for the common case (Mouse.OverrideCursor
    // wrapped in try/finally around a captured drag); the bridge to the
    // host's actual cursor surface (the host element's inline cursor
    // style on HtmlTarget — beats any CSS rule on the host or its
    // ancestors, including the common `#app { cursor: default }`
    // pattern) is symmetric with _captureBridge.
    private _lockedCursor: string | undefined;
    private _cursorBridge: ((cursor: string | undefined) => void) | undefined;

    // Per-pointer capture. While captured, Move / Up events route to
    // the captured Visual regardless of what's actually under the
    // pointer — the same contract as WPF's Mouse.Capture / the DOM's
    // setPointerCapture. Used by drag-tracking controls (e.g. a
    // ScrollBar thumb) so the drag survives a pointer that wanders
    // outside the source visual.
    //
    // Hover state (IsMouseOver / Enter / Leave) is NOT redirected —
    // hover follows the actual hit so visual feedback stays accurate
    // even during a capture.
    private pointerCaptures: Map<number, Element> = new Map();

    // Currently-focused Visual — the keyboard event source. At most one
    // per target. Set by SetFocus (from Visual.Focus() / args.SetFocus()
    // / host-side click-to-focus) and cleared by SetFocus(undefined).
    // Maintained in lock-step with the IsFocused DP on each Visual so
    // Style triggers / read-back via tb.IsFocused stay coherent.
    private focusedVisual: Element | undefined;

    // Active drag session, or null when no drag is in flight. Mutates
    // the InjectPointerMove / InjectPointerUp paths: while non-null,
    // raw pointer events bypass the normal route walker and feed the
    // drag cursor-sampling loop instead.
    private _dragSession: DragSession | null = null;
    private _dragOptions: DragDropOptions   = {};
    // Last receiver that handled DragEnter/Over for the current session.
    // null means the cursor isn't currently over any AllowDrop ancestor.
    private _currentDragReceiver: Element | null = null;
    // Last Effect returned by the current receiver's DragOver. Read on
    // PointerUp to decide whether Drop fires.
    private _currentDragEffect: DragDropEffects = DragDropEffects.None;

    // Touch-manipulation state machine (pan / pinch / rotate + inertia).
    // Fed by driveManipulation from the touch-contact lifecycle.
    private readonly _manipulation = new ManipulationCoordinator();

    // ── Public entry points ────────────────────────────────────────

    // Pointer moved to a new (or null) Visual at the given host
    // coords. `hit === null` means the pointer left the host element
    // entirely.
    public InjectPointerMove(hit: Element | null, init: PointerEventInit): void
    {
        this.syncMouseDevice(hit, init);
        // Drag session intercepts pointer moves — the route walker
        // routes through dispatchDrag against the AllowDrop ancestor
        // chain instead of the normal pointer pipeline. Hover is also
        // suppressed: while dragging, IsMouseOver / Enter / Leave
        // should not fire on receiver chains (the IsDragOver flag is
        // the drag-specific equivalent).
        if (this._dragSession !== null) { this.DriveDragMove(hit, init); return; }

        this.updateHoverChain(hit, init);

        // Capture overrides hit-test for dispatch — a thumb being
        // dragged keeps receiving Move events even when the cursor
        // crosses outside its bounds.
        const captured = this.pointerCaptures.get(init.PointerId);
        const dispatchTarget = captured ?? hit;
        if (dispatchTarget === null || dispatchTarget === undefined) return;

        dispatchPointer(new PointerEventArgs('PointerMove', dispatchTarget, init, this, this));
        this.raiseStylusTouch(dispatchTarget, init, 'Move');

        // QueryCursor — let handlers under the pointer pick the cursor.
        // Suppressed while a capture has locked a drag cursor (that
        // override wins for the drag's duration).
        if (this._lockedCursor === undefined && hit !== null)
        {
            const cursor = dispatchQueryCursor(new QueryCursorEventArgs(hit, init));
            this._cursorBridge?.(cursor);
        }

        // A PointerMove handler may have called DragDrop.DoDragDrop —
        // the declarative IsDraggable latch does exactly this once the
        // pointer crosses the threshold. Pick up the pending session
        // so the very next move drives the drag loop instead of
        // dispatching another PointerMove.
        this.PickUpPendingDragSession();
    }

    public InjectPointerLeave(init: PointerEventInit): void
    {
        this.syncMouseDevice(null, init);
        // Pointer left the host entirely — collapse the chain.
        this.updateHoverChain(null, init);
    }

    public InjectPointerDown(hit: Element, init: PointerEventInit): void
    {
        this.syncMouseDevice(hit, init);
        // Make sure hover state is current before the down event —
        // a fast tap can race ahead of a move event.
        this.updateHoverChain(hit, init);

        this.pressTargets.set(init.PointerId, hit);
        setIsPressed(hit, true);
        dispatchPointer(new PointerEventArgs('PointerDown', hit, init, this, this));
        this.raiseButtonSpecific(hit, init, true);
        this.raiseStylusTouch(hit, init, 'Down');

        // A handler may have called DragDrop.DoDragDrop synchronously —
        // pick up the pending session so subsequent moves drive the
        // drag loop instead of the normal pointer dispatch.
        this.PickUpPendingDragSession();
    }

    public InjectPointerUp(hit: Element | null, init: PointerEventInit): void
    {
        this.syncMouseDevice(hit, init);
        // Drag session intercepts: PointerUp ends the drag, fires Drop
        // (if Effect != None) and resolves the session.
        if (this._dragSession !== null) { this.DriveDragUp(hit, init); return; }

        const pressTarget = this.pressTargets.get(init.PointerId);
        if (pressTarget !== undefined)
        {
            setIsPressed(pressTarget, false);
            this.pressTargets.delete(init.PointerId);
        }

        // Dispatch Up to the captured visual first (drag-end belongs to
        // the dragger), then the hit, then the press target as a final
        // fallback so a click outside the visual still notifies it.
        const captured = this.pointerCaptures.get(init.PointerId);
        const dispatchTarget = captured ?? hit ?? pressTarget;
        if (dispatchTarget !== undefined)
        {
            dispatchPointer(new PointerEventArgs('PointerUp', dispatchTarget, init, this, this));
            this.raiseButtonSpecific(dispatchTarget, init, false);
            this.raiseStylusTouch(dispatchTarget, init, 'Up');
        }

        // Capture auto-releases on PointerUp — matches DOM
        // pointercancel / pointerup behaviour for setPointerCapture.
        // Same auto-release for any locked cursor: a drag that exits via
        // PointerUp should never leave a stuck OS cursor behind.
        if (captured !== undefined)
        {
            this.pointerCaptures.delete(init.PointerId);
            this._captureBridge?.(undefined, init.PointerId);
            Mouse.PrimaryDevice._setCaptured(undefined, CaptureMode.None);
            this.setLockedCursor(undefined);
            this.raiseCaptureEvent(captured, init.PointerId, false);
        }

        if (hit !== null) this.updateHoverChain(hit, init);
    }

    public InjectPointerWheel(hit: Element | null, init: WheelEventInit): void
    {
        Mouse.PrimaryDevice._attach(this);
        if (hit !== null) Mouse.PrimaryDevice._setDirectlyOver(hit);
        if (hit === null) return;
        dispatchPointer(new WheelEventArgs(hit, init, this, this));
    }

    // ── Pointer capture ────────────────────────────────────────────

    // Optional host-side bridge so the InputManager can ask the
    // concrete host (HtmlTarget) to acquire OS / browser pointer
    // capture too. Without this bridge, mural's internal capture map
    // still redirects events that DO arrive — but the browser only
    // delivers pointermove while the cursor stays within the host
    // element. A drag that wanders into chrome / outside the host
    // would stop receiving Move events. The bridge lets HtmlTarget
    // call `host.setPointerCapture(pointerId)` so the browser keeps
    // delivering events to the host element regardless of cursor
    // position — symmetric for release.
    private _captureBridge: ((target: Element | undefined, pointerId: number) => void) | undefined;

    public SetCaptureBridge(
        bridge: ((target: Element | undefined, pointerId: number) => void) | undefined,
    ): void
    {
        this._captureBridge = bridge;
    }

    // Begin capturing every subsequent Move / Up for `pointerId` to
    // `visual`. Capture stays until ReleasePointerCapture is called
    // or until the matching PointerUp arrives (auto-release). Calling
    // CapturePointer again with the same id swaps the captured visual.
    //
    // Optional `cursor`: a CSS cursor keyword that should display
    // globally for the capture's duration — drag-style resize handles
    // and splitter thumbs pass their direction-appropriate cursor here
    // so the OS cursor stays correct even when the pointer wanders off
    // the source visual's bounds (the most common case is the moment
    // the user actually clicks: browsers fall back to the default
    // cursor unless something at host level overrides it). Auto-cleared
    // by ReleasePointerCapture and by the PointerUp auto-release path.
    public CapturePointer(visual: Element, pointerId: number = 0, cursor?: string): void
    {
        const prev = this.pointerCaptures.get(pointerId);
        this.pointerCaptures.set(pointerId, visual);
        this._captureBridge?.(visual, pointerId);
        Mouse.PrimaryDevice._setCaptured(visual, CaptureMode.Element);
        if (cursor !== undefined) this.setLockedCursor(cursor);
        if (prev !== undefined && prev !== visual) this.raiseCaptureEvent(prev, pointerId, false);
        if (prev !== visual) this.raiseCaptureEvent(visual, pointerId, true);
    }

    public ReleasePointerCapture(pointerId: number = 0): void
    {
        const prev = this.pointerCaptures.get(pointerId);
        this.pointerCaptures.delete(pointerId);
        this._captureBridge?.(undefined, pointerId);
        Mouse.PrimaryDevice._setCaptured(undefined, CaptureMode.None);
        this.setLockedCursor(undefined);
        if (prev !== undefined) this.raiseCaptureEvent(prev, pointerId, false);
    }

    public GetCapturedVisual(pointerId: number = 0): Element | undefined
    {
        return this.pointerCaptures.get(pointerId);
    }

    // Install the host's cursor surface. HtmlTarget wires this to the
    // host element's inline cursor style; native targets would route
    // to the OS cursor API. Same shape as SetCaptureBridge —
    // InputManager tracks the state, bridge translates to host-side
    // mechanics.
    public SetCursorBridge(
        bridge: ((cursor: string | undefined) => void) | undefined,
    ): void
    {
        this._cursorBridge = bridge;
    }

    public GetLockedCursor(): string | undefined { return this._lockedCursor; }

    private setLockedCursor(cursor: string | undefined): void
    {
        if (this._lockedCursor === cursor) return;
        this._lockedCursor = cursor;
        this._cursorBridge?.(cursor);
    }

    // ── Focus ──────────────────────────────────────────────────────

    public GetFocusedVisual(): Element | undefined
    {
        return this.focusedVisual;
    }

    // Move focus to `visual` (or clear focus when undefined). Refuses
    // to focus a Visual whose `Focusable` is false — the call is a
    // silent no-op in that case (matches WPF Keyboard.Focus on a non-
    // focusable element). When the target is unchanged, nothing fires.
    //
    // Sequence on a real focus change:
    //   1. Clear IsFocused on the old focused Visual (if any).
    //   2. Dispatch LostFocus on the old Visual (bubble pass).
    //   3. Set IsFocused on the new focused Visual.
    //   4. Dispatch GotFocus on the new Visual (bubble pass).
    // DP writes BEFORE dispatch so handlers see the post-change state.
    public SetFocus(visual: Element | undefined): void
    {
        if (visual === this.focusedVisual) return;
        if (visual !== undefined && !isFocusable(visual)) return;

        const old = this.focusedVisual;
        this.focusedVisual = visual;
        Keyboard.PrimaryDevice._setFocused(visual);
        FocusManager._recordLogicalFocus(visual);

        // IsKeyboardFocusWithin: clear the old focus chain, then set the new one
        // (shared ancestors resolve true because the set runs after the clear).
        setKeyboardFocusWithinChain(old, false);
        setKeyboardFocusWithinChain(visual, true);

        if (old !== undefined)
        {
            setIsFocused(old, false);
            dispatchFocus(new FocusEventArgs('LostFocus', old));
            dispatchKeyboardFocus(new FocusEventArgs('LostKeyboardFocus', old));
        }
        if (visual !== undefined)
        {
            setIsFocused(visual, true);
            dispatchFocus(new FocusEventArgs('GotFocus', visual));
            dispatchKeyboardFocus(new FocusEventArgs('GotKeyboardFocus', visual));
        }

        // Publish to CommandManager so RoutedCommand.Execute (the bare
        // ICommand surface) can resolve a target, and so RequerySuggested
        // subscribers re-evaluate. Focus changes commonly affect which
        // CommandBinding catches a routed command — every menu/toolbar
        // listening for ApplicationCommands.Copy needs to refresh when
        // focus moves between a TextBox (handles Copy) and a non-text
        // element (doesn't).
        CommandManager.PublishFocusedVisual(visual);
    }

    // ── Keyboard ───────────────────────────────────────────────────

    // Dispatch KeyDown to the currently-focused Visual (and its
    // ancestors via tunnel + bubble). Returns true if any handler
    // marked the event Handled — the host adapter (HtmlTarget) uses
    // that to decide whether to preventDefault on the underlying DOM
    // event (suppress page scroll on Space, autorepeat on arrows, etc).
    // Returns false when nothing is focused, when focus is unattached
    // to a target, or when no handler claimed the key.
    public InjectKeyDown(init: KeyEventInit): boolean
    {
        Keyboard.PrimaryDevice._setModifiers(init.Modifiers);
        Keyboard.PrimaryDevice._setKeyState(init.Key, true);
        const target = this.focusedVisual;
        if (target === undefined)
        {
            // Tab with nothing focused still enters the surface (focuses
            // the first / last tab stop). Needs a root to traverse from;
            // skip when there's no focus AND no way to locate a root.
            return false;
        }
        const args = new KeyEventArgs('KeyDown', target, init, this);
        dispatchKey(args);
        if (args.Handled) return true;

        // Unhandled Tab → keyboard navigation (WPF parity). Shift+Tab
        // moves backward. Returns true so the host preventDefaults the
        // browser's own tab traversal.
        if (init.Key === Key.Tab)
        {
            const dir = hasModifier(init.Modifiers, ModifierKeys.Shift)
                ? FocusNavigationDirection.Previous
                : FocusNavigationDirection.Next;
            return KeyboardNavigation.MoveFocus(new TraversalRequest(dir), target);
        }
        return false;
    }

    public InjectKeyUp(init: KeyEventInit): boolean
    {
        Keyboard.PrimaryDevice._setModifiers(init.Modifiers);
        Keyboard.PrimaryDevice._setKeyState(init.Key, false);
        const target = this.focusedVisual;
        if (target === undefined) return false;
        const args = new KeyEventArgs('KeyUp', target, init, this);
        dispatchKey(args);
        return args.Handled;
    }

    // Dispatch TextInput to the currently-focused Visual. Separated
    // from KeyDown so handlers can subscribe only to "textual" content
    // (already composed by the IME / browser layer) without seeing
    // every arrow / function key. HtmlTarget synthesises this from
    // printable keydown events when no IME compose is in flight; the
    // browser's beforeinput / compositionend events feed it on real
    // text input.
    public InjectTextInput(init: TextInputEventInit): boolean
    {
        const target = this.focusedVisual;
        if (target === undefined) return false;
        const args = new TextInputEventArgs(target, init);
        dispatchTextInput(args);
        return args.Handled;
    }

    // ── Drag session API (called by the host adapter) ────────────────

    public get IsDragActive(): boolean { return this._dragSession !== null; }

    public get CurrentDragSession(): DragSession | null { return this._dragSession; }

    public get CurrentDragOptions(): DragDropOptions { return this._dragOptions; }

    public get CurrentDragReceiver(): Element | null { return this._currentDragReceiver; }

    public get CurrentDragEffect(): DragDropEffects { return this._currentDragEffect; }

    // Polled by the host adapter (HtmlTarget) right after every pointer
    // dispatch to detect a session newly started by a handler. Picks up
    // `DragDrop._pendingSession` if set, otherwise no-op.
    public PickUpPendingDragSession(): void
    {
        const pending = DragDrop._pendingSession;
        if (pending === null) return;
        this._dragSession        = pending;
        this._dragOptions        = DragDrop._pendingOptions;
        DragDrop._pendingSession = null;
        DragDrop._pendingOptions = {};
    }

    // Begin an OS-initiated drag session (8.1). Called by the host
    // adapter on the first `dragenter` from outside the app — the
    // browser already owns the drag image, so options.preview is
    // implicitly `null` (no framework ghost). The DataObject is
    // populated by the caller from `e.dataTransfer` (browser MIME
    // formats: text/plain, text/uri-list, Files). `Source` is
    // `undefined` — there is no in-tree origin.
    //
    // Idempotent — calling while a drag is already active is a no-op.
    // The host adapter's `dragenter` handler tracks its own re-entry
    // (a drag that crosses the boundary between two in-host elements
    // fires dragenter on each), but the safeguard here keeps two
    // adapters racing safe.
    public BeginOsDragSession(session: DragSession): void
    {
        if (this._dragSession !== null) return;
        this._dragSession = session;
        // OS-level drops don't get a framework ghost — the browser
        // already paints the drag image.
        this._dragOptions = { preview: null };
    }

    // Called by the host adapter once per `pointermove` while a drag is
    // active. `hit` is the deepest Visual under (hostX, hostY) — the host
    // hit-tested it via the existing PresentationTarget.HitTest path.
    // The drag dispatcher walks UP from `hit` looking for AllowDrop=true;
    // the first such ancestor becomes the current receiver.
    public DriveDragMove(hit: Element | null, init: PointerEventInit): void
    {
        const session = this._dragSession;
        if (session === null) return;

        // QueryContinueDrag (8.3) runs BEFORE any DragOver dispatch so
        // a cancelled drag doesn't fire phantom enter/over events.
        if (!session._pollContinue())
        {
            this.applyReceiverChange(null, init);
            session._complete(DragDropEffects.None);
            this._dragSession       = null;
            this._dragOptions       = {};
            this._currentDragEffect = DragDropEffects.None;
            return;
        }

        const receiver = hit === null ? null : findAllowDropAncestor(hit);
        this.applyReceiverChange(receiver, init);

        if (receiver !== null)
        {
            const args = new DragEventArgs('DragOver', receiver, dragInitFor(init, session));
            dispatchDrag(args);
            this._currentDragEffect = args.Effect;
        }
        else
        {
            this._currentDragEffect = DragDropEffects.None;
        }

        // GiveFeedback (8.3) fires AFTER the DragOver dispatch so the
        // effect reflects the receiver's choice for this sample. Dedup
        // lives inside _fireFeedback — handlers only see edges.
        session._fireFeedback(this._currentDragEffect);
        session._fireMove(init.HostX, init.HostY);
    }

    // Called by the host adapter on `pointerup` while a drag is active.
    // Fires Drop if the receiver's last DragOver set a non-None effect,
    // then resolves the session and clears state.
    public DriveDragUp(hit: Element | null, init: PointerEventInit): void
    {
        const session = this._dragSession;
        if (session === null) return;

        // Sample one more move so the receiver sees the final cursor
        // position and updates its Effect.
        this.DriveDragMove(hit, init);

        const receiver = this._currentDragReceiver;
        const effect   = this._currentDragEffect;

        if (receiver !== null && effect !== DragDropEffects.None)
        {
            const args = new DragEventArgs('Drop', receiver, dragInitFor(init, session));
            args.Effect = effect;
            dispatchDrag(args);
        }

        // Clear IsDragOver on the last receiver and resolve.
        this.applyReceiverChange(null, init);
        session._complete(receiver !== null ? effect : DragDropEffects.None);
        this._dragSession       = null;
        this._dragOptions       = {};
        this._currentDragEffect = DragDropEffects.None;
    }

    // Observe a session canceled outside the pointer-event pipeline
    // (author code calling session.Cancel(), ESC handler, blur listener).
    // The host adapter polls this; the InputManager checks the session's
    // IsSettled flag and runs the receiver-cleanup + state-reset on
    // the same path PointerUp uses.
    public ObserveSessionCancellation(): void
    {
        const session = this._dragSession;
        if (session === null) return;
        if (!session.IsSettled) return;
        this.applyReceiverChange(null, syntheticPointerInit());
        this._dragSession       = null;
        this._dragOptions       = {};
        this._currentDragEffect = DragDropEffects.None;
    }

    // ── Internals ──────────────────────────────────────────────────

    // Raise the WPF button-specific routed event (MouseLeftButtonDown /
    // Up, MouseRightButtonDown / Up) that corresponds to the changed
    // button on this PointerDown / PointerUp. Fired AFTER the generic
    // pointer event, with its own fresh tunnel + bubble passes. Middle /
    // X-buttons have no button-specific routed event in WPF — they go
    // through the generic PointerDown / Up only.
    private raiseButtonSpecific(target: Element, init: PointerEventInit, down: boolean): void
    {
        if (init.Button === PointerButton.Primary)
        {
            const kind = down ? 'MouseLeftButtonDown' : 'MouseLeftButtonUp';
            dispatchPointer(new PointerEventArgs(kind, target, init, this, this));
        }
        else if (init.Button === PointerButton.Secondary)
        {
            const kind = down ? 'MouseRightButtonDown' : 'MouseRightButtonUp';
            dispatchPointer(new PointerEventArgs(kind, target, init, this, this));
        }
    }

    // Promote a pointer event to its stylus / touch counterpart when the
    // PointerType identifies a pen / touch contact, updating the matching
    // device. Fired after the generic pointer event with its own tunnel +
    // bubble passes (WPF promotes Stylus → Mouse; mural raises both).
    private raiseStylusTouch(target: Element, init: PointerEventInit, kind: 'Down' | 'Up' | 'Move'): void
    {
        if (init.PointerType === 'pen')
        {
            const inContact = kind === 'Down' || (kind === 'Move' && init.Buttons !== 0);
            Stylus.PrimaryDevice._attach(this);
            Stylus.PrimaryDevice._updateFromPointer(init, inContact);
            Stylus.PrimaryDevice._setDirectlyOver(target);
            const name = kind === 'Down' ? 'StylusDown' : kind === 'Up' ? 'StylusUp' : 'StylusMove';
            dispatchPointer(new PointerEventArgs(name, target, init, this, this));
        }
        else if (init.PointerType === 'touch')
        {
            Touch.PrimaryDevice._attach(this);
            Touch.PrimaryDevice._updateFromPointer(init);
            Touch.PrimaryDevice._setDirectlyOver(target);
            const name = kind === 'Down' ? 'TouchDown' : kind === 'Up' ? 'TouchUp' : 'TouchMove';
            dispatchPointer(new PointerEventArgs(name, target, init, this, this));
            this.driveManipulation(target, init, kind);
        }
    }

    // Feed a touch contact's lifecycle into the ManipulationCoordinator.
    // The manipulation container is the nearest ancestor (incl. target)
    // with IsManipulationEnabled=true; nothing happens without one.
    private driveManipulation(target: Element, init: PointerEventInit, kind: 'Down' | 'Up' | 'Move'): void
    {
        if (kind === 'Down')
        {
            const container = findManipulationContainer(target);
            if (container === undefined) return;
            this._manipulation.contactDown(container, init.PointerId, init.HostX, init.HostY);
        }
        else if (kind === 'Move')
        {
            this._manipulation.contactMove(init.PointerId, init.HostX, init.HostY);
        }
        else
        {
            this._manipulation.contactUp(init.PointerId);
        }
    }

    // Raise GotMouseCapture / LostMouseCapture on `target`. Reuses the
    // pointer tunnel+bubble walk with a synthetic init sampled from the
    // current MouseDevice position (capture changes aren't tied to a
    // specific pointer-move event).
    private raiseCaptureEvent(target: Element, pointerId: number, got: boolean): void
    {
        const p = Mouse.PrimaryDevice.GetPosition();
        const init: PointerEventInit = {
            HostX: p.X, HostY: p.Y,
            Button: PointerButton.None, Buttons: 0,
            Modifiers: Mouse.PrimaryDevice.Modifiers,
            PointerId: pointerId, Pressure: 0,
            PointerType: 'mouse',
        };
        dispatchPointer(new PointerEventArgs(got ? 'GotMouseCapture' : 'LostMouseCapture', target, init, this, this));
    }

    // Refresh the global MouseDevice from a raw pointer event: register
    // this manager as the capture sink, update position / modifiers /
    // button states, and record the element directly under the cursor.
    private syncMouseDevice(hit: Element | null, init: PointerEventInit): void
    {
        Mouse.PrimaryDevice._attach(this);
        Mouse.PrimaryDevice._updateFromPointer(init);
        Mouse.PrimaryDevice._setDirectlyOver(hit ?? undefined);
    }

    // Swap the current drag receiver. Fires DragLeave on the old one,
    // DragEnter on the new one, and writes IsDragOver in lock-step.
    // No-op when nothing changes.
    private applyReceiverChange(next: Element | null, init: PointerEventInit): void
    {
        const session = this._dragSession;
        if (session === null) return;
        const prev = this._currentDragReceiver;
        if (prev === next) return;

        if (prev !== null)
        {
            setIsDragOver(prev, false);
            const args = new DragEventArgs('DragLeave', prev, dragInitFor(init, session));
            dispatchDrag(args);
        }
        if (next !== null)
        {
            setIsDragOver(next, true);
            const args = new DragEventArgs('DragEnter', next, dragInitFor(init, session));
            dispatchDrag(args);
        }
        this._currentDragReceiver = next;
    }

    // Diff the prior hover route against the new one, fire Leave on
    // visuals dropped and Enter on visuals added, and update
    // IsMouseOver in lock-step. Visuals that stay in the route (the
    // common-ancestor prefix shared between old and new routes) are
    // left untouched — no DP write, no Enter/Leave fire.
    private updateHoverChain(hit: Element | null, init: PointerEventInit): void
    {
        const newRoute = hit === null ? [] : buildRoute(hit);
        const oldSet   = new Set(this.hoverRoute);
        const newSet   = new Set(newRoute);

        // Leave: in old but not new. Walk leaf-first so child sees
        // Leave before its parent (matches WPF firing order).
        for (const v of this.hoverRoute)
        {
            if (newSet.has(v)) continue;
            setIsMouseOver(v, false);
            dispatchPointerDirect(new PointerEventArgs('PointerLeave', v, init));
        }

        // Enter: in new but not old. Walk leaf-first so the deepest
        // newly-entered visual fires Enter first; tunnel pass on each
        // dispatch still walks root → target as usual.
        for (const v of newRoute)
        {
            if (oldSet.has(v)) continue;
            setIsMouseOver(v, true);
            dispatchPointerDirect(new PointerEventArgs('PointerEnter', v, init));
        }

        this.hoverRoute = newRoute;
    }
}

// ── DP write helpers ───────────────────────────────────────────────

// IsMouseOver / IsPressed / IsFocused / IsDragOver are read-only DPs on
// Element (§ Phase B / input); InputManager writes through the typed
// `_setIsXxx` @internal methods, which route through the privileged
// `set_property_value_with_key` path. Focusable / AllowDrop are normal
// public accessors InputManager only reads. Thin wrappers kept for the
// readable call sites in the dispatch body.
//
// Every `v` reaching these helpers is an Element: the hit-test resolves a
// raw-Visual pick to its nearest Element (HtmlTarget.HitTest), and the
// hover / dispatch route is built from Elements only (buildRoute skips
// raw Visuals) — so no `instanceof` guard is needed here.
function setIsMouseOver(v: Element, value: boolean): void
{
    v._setIsMouseOver(value);
}

function setIsPressed(v: Element, value: boolean): void
{
    v._setIsPressed(value);
}

function setIsFocused(v: Element, value: boolean): void
{
    v._setIsFocused(value);
}

// A node on a focused element's visual-parent chain. Every real ancestor is an
// Element (Controls / Panels), but the chain can end at a plain-Visual root, so
// the setter is optional-guarded.
interface FocusWithinNode
{
    _setIsKeyboardFocusWithin?(value: boolean): void;
    GetVisualParent(): FocusWithinNode | undefined;
}

// Flip IsKeyboardFocusWithin along the whole visual-parent chain of `from`.
// SetFocus clears the old focus chain then sets the new one; shared ancestors
// end up correctly true (set runs after clear).
function setKeyboardFocusWithinChain(from: Element | undefined, value: boolean): void
{
    let cur: FocusWithinNode | undefined = from as unknown as FocusWithinNode | undefined;
    while (cur !== undefined)
    {
        cur._setIsKeyboardFocusWithin?.(value);
        cur = cur.GetVisualParent();
    }
}

function isFocusable(v: Element): boolean
{
    return v.Focusable === true;
}

// IsDragOver is the drag-specific mirror of IsMouseOver; same DP-write
// shape, framework-only write surface.
function setIsDragOver(v: Element, value: boolean): void
{
    v._setIsDragOver(value);
}

// Walk up the visual parent chain from `start` looking for the nearest
// ancestor (including `start` itself) with AllowDrop=true. Returns null
// if no ancestor qualifies. Mirrors WPF's receiver hit-test gate.
// GetVisualParent returns `Visual | undefined`; every concrete node is
// an Element, so the cast is sound.
// Nearest ancestor (including `start`) with IsManipulationEnabled=true,
// or undefined. The manipulation container that touch contacts drive.
function findManipulationContainer(start: Element): Element | undefined
{
    let cur: Element | undefined = start;
    while (cur !== undefined)
    {
        if (cur.IsManipulationEnabled === true) return cur;
        cur = cur.GetVisualParent() as Element | undefined;
    }
    return undefined;
}

function findAllowDropAncestor(start: Element): Element | null
{
    let cur: Element | undefined = start;
    while (cur !== undefined)
    {
        if (cur.AllowDrop === true) return cur;
        cur = cur.GetVisualParent() as Element | undefined;
    }
    return null;
}

function dragInitFor(init: PointerEventInit, session: DragSession): DragEventInit
{
    return {
        HostX:          init.HostX,
        HostY:          init.HostY,
        Modifiers:      init.Modifiers,
        Data:           session.Data,
        AllowedEffects: session.AllowedEffects,
        Session:        session,
    };
}

// Used by ObserveSessionCancellation when there's no real pointer event
// to drive the receiver-leave with. The init.HostX/Y don't matter here —
// the only consumer is the synthetic DragLeave that fires when the
// session was canceled mid-drag, and HostX/Y are ignored at that point.
function syntheticPointerInit(): PointerEventInit
{
    return {
        HostX: 0, HostY: 0,
        Button: PointerButton.None, Buttons: 0,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
    };
}
