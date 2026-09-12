import { type PointerEventArgs } from '../runtime/index.js';
import { ClickableBorder } from './clickable-border.js';

// A ClickableBorder that fires on PRESS and keeps firing while the pointer is
// held down over it — the WPF RepeatButton analog. Used for the SpinEdit ▴/▾
// step buttons so a held press auto-repeats the increment/decrement instead of
// requiring one click per step. Exported so compiled-`.mu` templates can name
// it; not part of the public package surface.
//
// Cadence: one immediate fire on press, then a longer initial delay before the
// first repeat, after which the gap accelerates (shrinks) toward a floor while
// the button stays held. Dragging off the button pauses the repeat (rides
// ClickableBorder's IsPressed, which clears on leave); dragging back on resumes
// it. Release stops it — and unlike the base, does NOT fire a click (the press
// already fired; a held repeat is not a click).
export class RepeatButton extends ClickableBorder
{
    // Called on the initial press and on every repeat tick. The consumer wires
    // this instead of onClick (which never fires for a RepeatButton).
    public onRepeat: (() => void) | undefined;

    // Gap before the FIRST repeat after the immediate press-fire (ms). Long
    // enough that a normal single click (press+release) never triggers a repeat.
    private static readonly INITIAL_DELAY_MS = 400;
    // First repeat gap after the initial delay, then it accelerates down by
    // ACCEL_STEP_MS per tick toward MIN_INTERVAL_MS.
    private static readonly START_INTERVAL_MS = 120;
    private static readonly MIN_INTERVAL_MS   = 30;
    private static readonly ACCEL_STEP_MS     = 20;

    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _interval = 0;

    // A held repeat is not a click — suppress the base's click-on-release.
    protected override onActivate(): void { /* no-op */ }

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        super.OnPointerDown(args);   // sets _pressOriginatedHere + IsPressed
        this.beginRepeat();
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        this.stopRepeat();
        super.OnPointerUp(args);     // clears press state; onActivate() is our no-op
    }

    protected override OnPointerLeave(args: PointerEventArgs): void
    {
        this.stopRepeat();           // pause while the pointer is off the button
        super.OnPointerLeave(args);  // clears IsPressed
    }

    protected override OnPointerEnter(args: PointerEventArgs): void
    {
        super.OnPointerEnter(args);  // restores IsPressed iff the press still holds
        if (this.IsPressed) this.beginRepeat();   // resume
    }

    private beginRepeat(): void
    {
        this.stopRepeat();
        this.onRepeat?.();                             // immediate fire
        this._interval = RepeatButton.START_INTERVAL_MS;
        this._timer = setTimeout(() => this.tickRepeat(), RepeatButton.INITIAL_DELAY_MS);
    }

    private tickRepeat(): void
    {
        this.onRepeat?.();
        // Schedule the next tick at the current gap, THEN accelerate (shrink)
        // the gap for the tick after that — down to the floor.
        this._timer = setTimeout(() => this.tickRepeat(), this._interval);
        this._interval = Math.max(RepeatButton.MIN_INTERVAL_MS, this._interval - RepeatButton.ACCEL_STEP_MS);
    }

    private stopRepeat(): void
    {
        if (this._timer !== undefined)
        {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }
}
