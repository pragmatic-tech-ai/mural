import { type PointerEventArgs } from '../runtime/index.js';
import { Border } from './border.js';

// Border subclass that fires a click callback on PointerUp when the
// press originated locally and the pointer is still inside — the
// same release-mode semantics as Button. Used as the clickable surface
// inside a wide range of control templates (ComboBox selection / item
// rows, SpinEdit step buttons, FillEditor variant tabs, BrushPicker
// trigger, drawer scrim, …). Exported so the compiled-`.mu` templates
// can name it; not part of the public package surface.
//
// Drives the M3 IsPressed state-layer ladder for every consumer that
// hosts a ClickableBorder in its template without each having to
// re-implement the press tracking. IsPressed clears BEFORE the click
// callback fires so handlers reading it see the post-release state.
export class ClickableBorder extends Border
{
    public onClick: (() => void) | undefined;
    private _pressOriginatedHere = false;

    protected override OnPointerDown(_args: PointerEventArgs): void
    {
        this._pressOriginatedHere = true;
        this._setIsPressed(true);
    }

    protected override OnPointerUp(_args: PointerEventArgs): void
    {
        const fire = this._pressOriginatedHere && this.IsMouseOver;
        this._pressOriginatedHere = false;
        this._setIsPressed(false);
        if (fire) this.onActivate();
    }

    // The release-fire, as an overridable seam. Default is click-on-release
    // (onClick). Subclasses with different firing semantics override this —
    // RepeatButton fires on PRESS and repeats while held, so it makes this a
    // no-op (a held repeat is not a click).
    protected onActivate(): void
    {
        this.onClick?.();
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        this._setIsPressed(false);
    }

    protected override OnPointerEnter(_args: PointerEventArgs): void
    {
        if (this._pressOriginatedHere)
        {
            this._setIsPressed(true);
        }
    }
}
