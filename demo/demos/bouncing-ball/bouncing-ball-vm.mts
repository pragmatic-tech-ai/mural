// Bouncing-ball VM. A single ball flies in a fixed-size box, reflecting
// velocity off each wall. Pure simulation state lives here; the
// per-tick integration runs from the bootstrap subscribing to the
// animation clock (Rule 5: VMs don't touch host globals — the clock is
// the framework's injectable service, the bootstrap does the wiring).

import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime';

// Fixed playfield, in CSS pixels. The view's Border is sized to match;
// the VM's collision logic is the source of truth.
const BOUNDS_W = 640;
const BOUNDS_H = 360;

// Ball diameter, also in pixels. Plain constant — the view binds the
// Ellipse's Width / Height to the Diameter DP, but the value never
// changes after construction so a DP is overkill.
const DIAMETER = 36;

export const PLAYFIELD_W = BOUNDS_W;
export const PLAYFIELD_H = BOUNDS_H;

export class BouncingBallVM extends MuralBase
{
    // X / Y are the top-left of the ball's bounding box, in
    // playfield-local pixel coordinates. The view binds Ellipse's
    // Canvas.Left / Canvas.Top straight to them, so a single Step
    // call moves the ball on screen via the binding.
    static XKey        = MuralBase.RegisterProperty<number>(BouncingBallVM, 'X',        0,        MetaData.None);
    static YKey        = MuralBase.RegisterProperty<number>(BouncingBallVM, 'Y',        0,        MetaData.None);
    static DiameterKey = MuralBase.RegisterProperty<number>(BouncingBallVM, 'Diameter', DIAMETER, MetaData.None);

    // Velocity (px / ms). Plain fields — the view never binds them, so
    // keeping them off the DP system avoids change-notification spam.
    private _vx: number;
    private _vy: number;

    constructor()
    {
        super();
        // Plain fields for the simulation — velocity (px / ms) and the
        // playfield bounds. None of these are bound by the view; keeping
        // them off the DP system avoids change-notification spam from
        // the per-tick integration and saves a few allocations per ms.
        this._vx = 0.28;
        this._vy = 0.19;

        // Seed the ball roughly centred so the first frame doesn't draw
        // it clipped against the corner.
        this.set_property_value(BouncingBallVM.XKey, (BOUNDS_W - DIAMETER) / 2);
        this.set_property_value(BouncingBallVM.YKey, (BOUNDS_H - DIAMETER) / 3);
    }

    get X():        number { return this.get_property_value(BouncingBallVM.XKey); }
    set X(v:        number) { this.set_property_value(BouncingBallVM.XKey, v); }
    get Y():        number { return this.get_property_value(BouncingBallVM.YKey); }
    set Y(v:        number) { this.set_property_value(BouncingBallVM.YKey, v); }
    get Diameter(): number { return this.get_property_value(BouncingBallVM.DiameterKey); }
    set Diameter(v: number) { this.set_property_value(BouncingBallVM.DiameterKey, v); }

    // Integrate position by velocity * dt, then reflect off any wall
    // the ball has crossed. Reflection uses the "mirror back" trick —
    // if the ball overshot the right wall by `over`, set the new x to
    // `(right - over)` so the trajectory looks continuous instead of
    // clamping flat against the edge for a frame.
    Step(dtMs: number): void
    {
        if (dtMs <= 0 || dtMs > 100) return; // skip pause-resume gaps
        const d  = this.Diameter;
        let nx = this.X + this._vx * dtMs;
        let ny = this.Y + this._vy * dtMs;
        const right  = BOUNDS_W - d;
        const bottom = BOUNDS_H - d;

        if (nx < 0)         { nx = -nx;                 this._vx = -this._vx; }
        else if (nx > right){ nx = 2 * right - nx;      this._vx = -this._vx; }
        if (ny < 0)         { ny = -ny;                 this._vy = -this._vy; }
        else if (ny > bottom){ ny = 2 * bottom - ny;    this._vy = -this._vy; }

        this.set_property_value(BouncingBallVM.XKey, nx);
        this.set_property_value(BouncingBallVM.YKey, ny);
    }
}
