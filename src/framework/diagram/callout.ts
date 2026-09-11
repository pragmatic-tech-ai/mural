import { MetaData, MuralBase, type PropertyDescriptor, type Disposable } from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { pathGeometryFromSvgD, type PathGeometry, Point } from '../../visual-engine/index.js';
import { Figure, registerFigureKind } from './figure.js';
import { TextNode } from './text-node.js';

// Default box for a freshly-dropped callout — a touch larger than a plain
// TextNode so it reads as a labelled bubble.
const CALLOUT_DEFAULT_W = 140;
const CALLOUT_DEFAULT_H = 64;

// ── Target-side geometry a callout leader tracks ────────────────────────
// The leader endpoint is computed from Left/Top/Width/Height; every node type
// (Figure shapes, TextNode, and still-geometric content VMs) exposes those as
// DPs, so we subscribe by name.
const TARGET_TRACK: readonly string[] = ['Left', 'Top', 'Width', 'Height'];

// Duck-typed interface: any object that can serve as a leader target.
export interface ILeaderTarget extends MuralBase
{
    readonly Id?: string;
    Left:   number;
    Top:    number;
    Width:  number;
    Height: number;
}

// ─── boxEdgeToward ──────────────────────────────────────────────────────
// Returns the point on the edge of the rect (x, y, w, h) that lies on the
// ray from the rect's centre toward `target`. Ported VERBATIM from
// text-shape.ts (§ boxEdgeToward).
function boxEdgeToward(x: number, y: number, w: number, h: number, target: Point): Point
{
    const cx = x + w / 2, cy = y + h / 2;
    const dx = target.X - cx, dy = target.Y - cy;
    if (dx === 0 && dy === 0) return new Point(cx, cy);
    let t = Number.POSITIVE_INFINITY;
    if (dx > 0) t = Math.min(t, (x + w - cx) / dx);
    if (dx < 0) t = Math.min(t, (x - cx) / dx);
    if (dy > 0) t = Math.min(t, (y + h - cy) / dy);
    if (dy < 0) t = Math.min(t, (y - cy) / dy);
    return new Point(cx + t * dx, cy + t * dy);
}

// ── Callout ───────────────────────────────────────────────────────────────
//
// A TextNode (hence a Figure) with a leader line pointing at a target node.
// The box + label come from TextNode; the leader Shape is added by
// Style[TargetType=Callout], bound to LeaderGeometry.
//
// LeaderTargetNode  — the live target reference (ILeaderTarget | undefined).
// LeaderGeometry    — read-only computed PathGeometry (undefined when no target).
// LeaderTargetId    — convenience getter returning target.Id; what serializes.
//
// Coordinate system: the leader Shape lives in the Callout's template Canvas, so
// the geometry is in callout-LOCAL coords: start = boxEdge - (this.Left, this.Top),
// end = targetCentre - (this.Left, this.Top).
export class Callout extends TextNode
{
    public static readonly LeaderTargetNodeKey = MuralBase.RegisterProperty<ILeaderTarget | undefined>(
        Callout, 'LeaderTargetNode', undefined, MetaData.None);

    public static readonly LeaderGeometryKey = MuralBase.RegisterProperty<PathGeometry | undefined>(
        Callout, 'LeaderGeometry', undefined, MetaData.None);

    private _trackedTarget: ILeaderTarget | undefined = undefined;
    private _targetSubs: Disposable[] = [];
    private readonly _onTargetMoved = (): void => { this._updateLeader(); };

    public get LeaderTargetNode(): ILeaderTarget | undefined
    {
        return this.get_property_value(Callout.LeaderTargetNodeKey);
    }
    public set LeaderTargetNode(v: ILeaderTarget | undefined)
    {
        this.set_property_value(Callout.LeaderTargetNodeKey, v);
    }

    /** The id of the current target, or undefined. Serialized as leaderTargetId. */
    public get LeaderTargetId(): string | undefined
    {
        return this.get_property_value(Callout.LeaderTargetNodeKey)?.Id;
    }

    /** Computed leader geometry, or undefined when untargeted. */
    public get LeaderGeometry(): PathGeometry | undefined
    {
        return this.get_property_value(Callout.LeaderGeometryKey);
    }

    /** Release the target-geometry subscription (the document calls this when
     *  the callout is deleted so it stops tracking a node it no longer draws).
     *  Named DetachLeader, not Detach, to avoid Element's protected visual-tree
     *  Detach(child). */
    public DetachLeader(): void
    {
        if (this._trackedTarget !== undefined)
        {
            for (const sub of this._targetSubs) sub.dispose();
            this._targetSubs = [];
            this._trackedTarget = undefined;
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);

        if (descriptor === Callout.LeaderTargetNodeKey.descriptor)
        {
            this._retrackTarget();
            this._updateLeader();
        }
        // Own bounds changed → redraw leader from the new box position.
        else if (
            descriptor === Figure.LeftKey.descriptor ||
            descriptor === Figure.TopKey.descriptor  ||
            descriptor.Name === 'Width'              ||
            descriptor.Name === 'Height'
        )
        {
            this._updateLeader();
        }
    }

    /** (Re)subscribe to the target's geometry DPs so the leader follows it. */
    private _retrackTarget(): void
    {
        if (this._trackedTarget !== undefined)
        {
            for (const sub of this._targetSubs) sub.dispose();
            this._targetSubs = [];
        }

        const t = this.get_property_value(Callout.LeaderTargetNodeKey);
        this._trackedTarget = t;
        if (t !== undefined)
        {
            for (const name of TARGET_TRACK)
            {
                const key = resolveKey(t, undefined, name);
                this._targetSubs.push(t.PropertyChanged(key).subscribe(this._onTargetMoved));
            }
        }
    }

    /** Recompute the leader geometry in callout-local coordinates. */
    private _updateLeader(): void
    {
        const t = this.get_property_value(Callout.LeaderTargetNodeKey);

        if (t === undefined)
        {
            this.set_property_value(Callout.LeaderGeometryKey, undefined);
            return;
        }

        // Target centre in diagram (canvas) coordinates.
        const tc = new Point(t.Left + t.Width / 2, t.Top + t.Height / 2);

        // Start: point on this callout's box edge toward the target centre.
        const start = boxEdgeToward(this.Left, this.Top, this.Width, this.Height, tc);

        // Convert to callout-local coords (leader Shape is at callout origin).
        const sx = start.X - this.Left, sy = start.Y - this.Top;
        const ex = tc.X    - this.Left, ey = tc.Y    - this.Top;

        this.set_property_value(
            Callout.LeaderGeometryKey,
            pathGeometryFromSvgD(`M ${sx} ${sy} L ${ex} ${ey}`),
        );
    }
}

// Register 'callout' so Figure.fromKind('callout', …) (toolbox drop / tile
// preview) mints a leaderless Callout — the leader is attached later by
// targeting a node. Runs on module load; importing Callout wires the kind.
registerFigureKind('callout', (left, top, options) =>
{
    const c = new Callout();
    c.Left   = left;
    c.Top    = top;
    c.Width  = options?.width  ?? CALLOUT_DEFAULT_W;
    c.Height = options?.height ?? CALLOUT_DEFAULT_H;
    c.BaseWidth  = c.Width;
    c.BaseHeight = c.Height;
    return c;
});
