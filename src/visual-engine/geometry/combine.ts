// §19.7 — declarative boolean ops over Geometry.
//
// Bridges the model-layer Geometry tree (RectangleGeometry, EllipseGeometry,
// PathGeometry, GeometryGroup, …) to the Skia-derived pathops kernel and
// reads the result back as a PathGeometry. Two consumer surfaces:
//
//   * `combine(a, b, mode)` — imperative helper. One call, returns a fresh
//     PathGeometry. Suitable for behaviors / one-shot board operations.
//   * `CombinedGeometry` — MuralBase class. Carries Geometry1 / Geometry2 /
//     GeometryCombineMode DPs and memoizes the flattened result; the
//     memo invalidates when any input's Render-flagged DP changes. The
//     declarative form lives in [geometry.ts](./geometry.ts) to stay
//     alongside its sibling Geometry subclasses; this file holds the
//     bridge + helper.

import { Matrix, Point, Rect } from '../primitives.js';
import { MetaData } from '../../runtime/metadata.js';
import { MuralBase } from '../../runtime/model.js';
import {
    Geometry,
    RectangleGeometry,
    EllipseGeometry,
    LineGeometry,
    PathGeometry,
    PathFigure,
    LineSegment,
    QuadraticBezierSegment,
    CubicBezierSegment,
    ArcSegment,
    SweepDirection,
    GeometryGroup,
    FillRule,
} from './geometry.js';
import { OpPath, OpFillType } from './pathops/op-path.js';
import { Op } from './pathops/op-path-ops-op.js';
import { SkPathOp } from './pathops/op-segment.js';
import { OpVerb } from './pathops/op-fwd.js';
import { refitOpPath } from './pathops/refit.js';
import { Point as DPoint } from './pathops/point.js';
import { arcToCubics } from './pathops/arc-to-cubic.js';

// WPF parity — same value names, same semantics. Maps to Skia ops via
// COMBINE_MODE_TO_SKIA_OP below. Note: WPF's `Exclude` is
// `Geometry1 - Geometry2` (asymmetric); maps to Skia's `kDifference`.
export enum GeometryCombineMode
{
    Union     = 0,
    Intersect = 1,
    Xor       = 2,
    Exclude   = 3,
}

const COMBINE_MODE_TO_SKIA_OP: ReadonlyArray<SkPathOp> = [
    SkPathOp.kUnion,
    SkPathOp.kIntersect,
    SkPathOp.kXOR_SkPathOp,
    SkPathOp.kDifference,
];

// ── Geometry → OpPath ────────────────────────────────────────────

// Append `g` (after applying its Transform composed with `parentMatrix`)
// to `out` as a sequence of move / line / quad / cubic / close commands.
// Primitive shapes lower to known Bezier compositions; PathGeometry is a
// direct walk; GeometryGroup / CombinedGeometry recurse.
function appendGeometryToOpPath(g: Geometry, out: OpPath, parentMatrix: Matrix): void
{
    const m = parentMatrix.Multiply(g.Transform.Matrix);
    if (g instanceof PathGeometry)
    {
        appendPathFiguresToOpPath(g.Figures, out, m);
        return;
    }
    if (g instanceof RectangleGeometry)
    {
        appendRectangleToOpPath(g, out, m);
        return;
    }
    if (g instanceof EllipseGeometry)
    {
        appendEllipseToOpPath(g, out, m);
        return;
    }
    if (g instanceof LineGeometry)
    {
        // No fill — boolean ops on a no-fill geometry contribute no area.
        return;
    }
    if (g instanceof GeometryGroup)
    {
        for (const child of g.Children)
        {
            appendGeometryToOpPath(child, out, m);
        }
        return;
    }
    if (g instanceof CombinedGeometry)
    {
        // Resolve nested combines first, then append the flattened figures.
        const flat = g.toPathGeometry();
        appendPathFiguresToOpPath(flat.Figures, out, m);
        return;
    }
    // Unknown subclass — caller should have caught at type-check time.
    // Silent no-op rather than a throw so a future Geometry subclass
    // doesn't crash existing combine() callers.
}

function tx(m: Matrix, p: Point): DPoint
{
    const t = m.Transform(p);
    return new DPoint(t.X, t.Y);
}

function appendPathFiguresToOpPath(figures: readonly PathFigure[], out: OpPath, m: Matrix): void
{
    for (const figure of figures)
    {
        let pen = figure.StartPoint;
        out.moveTo(tx(m, pen));
        for (const seg of figure.Segments)
        {
            if (seg instanceof LineSegment)
            {
                out.lineTo(tx(m, seg.Point));
                pen = seg.Point;
            }
            else if (seg instanceof QuadraticBezierSegment)
            {
                out.quadTo(tx(m, seg.Point1), tx(m, seg.Point2));
                pen = seg.Point2;
            }
            else if (seg instanceof CubicBezierSegment)
            {
                out.cubicTo(tx(m, seg.Point1), tx(m, seg.Point2), tx(m, seg.Point3));
                pen = seg.Point3;
            }
            else if (seg instanceof ArcSegment)
            {
                const cubics = arcToCubics(
                    pen.X, pen.Y, seg.Point.X, seg.Point.Y,
                    seg.Size.Width, seg.Size.Height,
                    seg.RotationAngle, seg.IsLargeArc,
                    seg.SweepDirection === SweepDirection.Clockwise);
                if (cubics.length === 0)
                {
                    out.lineTo(tx(m, seg.Point));
                }
                else
                {
                    for (const c of cubics)
                    {
                        // c.fPts are in pathops-Point form (fX/fY); pen
                        // and the matrix expect runtime Points (X/Y).
                        // Transform each cubic control point through m
                        // by reconstructing as runtime Points first.
                        const p1 = new Point(c.fPts[1]!.fX, c.fPts[1]!.fY);
                        const p2 = new Point(c.fPts[2]!.fX, c.fPts[2]!.fY);
                        const p3 = new Point(c.fPts[3]!.fX, c.fPts[3]!.fY);
                        out.cubicTo(tx(m, p1), tx(m, p2), tx(m, p3));
                    }
                }
                pen = seg.Point;
            }
        }
        if (figure.IsClosed) out.close();
    }
}

function appendRectangleToOpPath(g: RectangleGeometry, out: OpPath, m: Matrix): void
{
    const r  = g.Rect;
    const rx = Math.max(0, Math.min(g.RadiusX, r.Width / 2));
    const ry = Math.max(0, Math.min(g.RadiusY, r.Height / 2));
    if (r.Width <= 0 || r.Height <= 0) return;
    if (rx === 0 || ry === 0)
    {
        out.moveTo(tx(m, new Point(r.Left,  r.Top)));
        out.lineTo(tx(m, new Point(r.Right, r.Top)));
        out.lineTo(tx(m, new Point(r.Right, r.Bottom)));
        out.lineTo(tx(m, new Point(r.Left,  r.Bottom)));
        out.close();
        return;
    }
    // Rounded rect — 4 straight edges + 4 corner arcs. Walk
    // clockwise from the top edge after the top-left corner.
    //
    //      (L+rx, T) -- (R-rx, T)
    //     /                       \
    // (L, T+ry)                (R, T+ry)
    //     |                       |
    // (L, B-ry)                (R, B-ry)
    //     \                       /
    //      (L+rx, B) -- (R-rx, B)
    const L = r.Left, T = r.Top, R = r.Right, B = r.Bottom;
    out.moveTo(tx(m, new Point(L + rx, T)));
    out.lineTo(tx(m, new Point(R - rx, T)));
    appendArcToOpPath(out, m, R - rx, T, R, T + ry, rx, ry);
    out.lineTo(tx(m, new Point(R, B - ry)));
    appendArcToOpPath(out, m, R, B - ry, R - rx, B, rx, ry);
    out.lineTo(tx(m, new Point(L + rx, B)));
    appendArcToOpPath(out, m, L + rx, B, L, B - ry, rx, ry);
    out.lineTo(tx(m, new Point(L, T + ry)));
    appendArcToOpPath(out, m, L, T + ry, L + rx, T, rx, ry);
    out.close();
}

// Helper: emit a quarter-ellipse arc from (sx, sy) to (ex, ey) with
// the given (rx, ry) using a clockwise sweep (in user space). The
// caller is responsible for ensuring (sx, sy) was already issued via
// moveTo or a preceding line — appendArcToOpPath only emits the cubic.
function appendArcToOpPath(out: OpPath, m: Matrix,
                            sx: number, sy: number,
                            ex: number, ey: number,
                            rx: number, ry: number): void
{
    const cubics = arcToCubics(sx, sy, ex, ey, rx, ry, 0, false, true);
    for (const c of cubics)
    {
        const p1 = new Point(c.fPts[1]!.fX, c.fPts[1]!.fY);
        const p2 = new Point(c.fPts[2]!.fX, c.fPts[2]!.fY);
        const p3 = new Point(c.fPts[3]!.fX, c.fPts[3]!.fY);
        out.cubicTo(tx(m, p1), tx(m, p2), tx(m, p3));
    }
}

function appendEllipseToOpPath(g: EllipseGeometry, out: OpPath, m: Matrix): void
{
    const cx = g.Center.X;
    const cy = g.Center.Y;
    const rx = g.RadiusX;
    const ry = g.RadiusY;
    if (rx <= 0 || ry <= 0) return;
    // Start at the right pole, sweep clockwise through bottom-left-top.
    out.moveTo(tx(m, new Point(cx + rx, cy)));
    // Two half-circle arcs via large-arc=true sweep=true.
    const half1 = arcToCubics(cx + rx, cy, cx - rx, cy, rx, ry, 0, true, true);
    const half2 = arcToCubics(cx - rx, cy, cx + rx, cy, rx, ry, 0, true, true);
    for (const c of [...half1, ...half2])
    {
        const p1 = new Point(c.fPts[1]!.fX, c.fPts[1]!.fY);
        const p2 = new Point(c.fPts[2]!.fX, c.fPts[2]!.fY);
        const p3 = new Point(c.fPts[3]!.fX, c.fPts[3]!.fY);
        out.cubicTo(tx(m, p1), tx(m, p2), tx(m, p3));
    }
    out.close();
}

// ── OpPath → PathGeometry ────────────────────────────────────────

// Exported for use by the §19.8 corpus verifier — it builds OpPath
// inputs by parsing path strings, then lifts both inputs AND Op()'s
// output to PathGeometry to drive Contains() probe checks.
export function opPathToPathGeometry(p: OpPath): PathGeometry
{
    const figures: PathFigure[] = [];
    let figureStart: Point | undefined = undefined;
    let segs: Array<LineSegment | QuadraticBezierSegment | CubicBezierSegment> = [];
    const flush = (closed: boolean): void => {
        if (figureStart !== undefined && segs.length > 0)
        {
            figures.push(new PathFigure(figureStart, segs, closed));
        }
        segs = [];
        figureStart = undefined;
    };
    for (const cmd of p.fCommands)
    {
        switch (cmd.verb)
        {
            case OpVerb.kMove:
                flush(false);
                figureStart = new Point(cmd.pts[0]!.fX, cmd.pts[0]!.fY);
                break;
            case OpVerb.kLine:
                segs.push(new LineSegment(new Point(cmd.pts[0]!.fX, cmd.pts[0]!.fY)));
                break;
            case OpVerb.kQuad:
                segs.push(new QuadraticBezierSegment(
                    new Point(cmd.pts[0]!.fX, cmd.pts[0]!.fY),
                    new Point(cmd.pts[1]!.fX, cmd.pts[1]!.fY),
                ));
                break;
            case OpVerb.kCubic:
                segs.push(new CubicBezierSegment(
                    new Point(cmd.pts[0]!.fX, cmd.pts[0]!.fY),
                    new Point(cmd.pts[1]!.fX, cmd.pts[1]!.fY),
                    new Point(cmd.pts[2]!.fX, cmd.pts[2]!.fY),
                ));
                break;
            case OpVerb.kClose:
                flush(true);
                break;
        }
    }
    flush(false);
    const out = new PathGeometry(figures);
    // OpFillType.kEvenOdd (= 1) → FillRule.EvenOdd. Else Nonzero.
    out.FillRule = (p.fFillType === OpFillType.kEvenOdd) ? FillRule.EvenOdd : FillRule.Nonzero;
    return out;
}

// ── Public surface ───────────────────────────────────────────────

// Exact intersection check — `combine(a, b, Intersect)` produces a
// non-empty figure iff the two geometries overlap by more than a
// shared edge. Fast bbox reject first so non-overlapping inputs avoid
// the kernel altogether. v1 left `Geometry.Intersects` as bbox-only;
// callers that need the exact answer (hit-testing through shaped
// containers, selection marquee against curves, etc.) reach for this
// helper directly.
export function intersectsExact(a: Geometry, b: Geometry): boolean
{
    if (a.GetBounds().Intersect(b.GetBounds()) === undefined) return false;
    return combine(a, b, GeometryCombineMode.Intersect).Figures.length > 0;
}

// Runtime imperative helper. Convert both operands to OpPath, run the
// boolean op, lift the result back to PathGeometry. Returns an empty
// PathGeometry if the engine fails (matches Skia's robustness
// contract — the host never has to crash on an adversarial input).
export function combine(a: Geometry, b: Geometry, mode: GeometryCombineMode): PathGeometry
{
    const opA = new OpPath();
    opA.setFillType(OpFillType.kWinding);
    appendGeometryToOpPath(a, opA, Matrix.Identity);

    const opB = new OpPath();
    opB.setFillType(OpFillType.kWinding);
    appendGeometryToOpPath(b, opB, Matrix.Identity);

    const result = new OpPath();
    const skiaOp = COMBINE_MODE_TO_SKIA_OP[mode]!;
    const ok = Op(opA, opB, skiaOp, result);
    if (!ok) return new PathGeometry([]);
    // §19-deferred #2 — collapse collinear-line chains + coalesce
    // adjacent sub-spans of the same input curve before lifting back to
    // PathGeometry. Cosmetic — does not change the result's covered area.
    return opPathToPathGeometry(refitOpPath(result));
}

// ── CombinedGeometry MuralBase class ─────────────────────────────────

// Declarative form. Carries Geometry1 / Geometry2 / GeometryCombineMode
// DPs and memoizes the flattened PathGeometry. The memo invalidates
// when any input's Render-flagged DP changes, via the same render-
// invalidator pattern TransformGroup uses.
//
// Inherits the standard Geometry.Transform DP — the Transform applies
// to the combined result, not to the operands (consumers should set
// per-operand transforms on the operands themselves).
//
// Renderer integration: lowers to the memoized PathGeometry's
// figures. The renderer is unchanged — CombinedGeometry just stands
// in as a Geometry-typed value that, when asked for bounds / contains
// / hit-test, defers to the memo.
//
// Imports go direct to the runtime source files (not via
// `runtime/index.js`) — the barrel transitively pulls in this very
// module through visual-engine/index → geometry/index, which would
// TDZ-trap the `CombinedGeometry extends Geometry` declaration.

export class CombinedGeometry extends Geometry
{
    public static readonly Geometry1Key          = MuralBase.RegisterProperty<Geometry | undefined>(CombinedGeometry, 'Geometry1',          undefined,                 MetaData.Render);
    public static readonly Geometry2Key          = MuralBase.RegisterProperty<Geometry | undefined>(CombinedGeometry, 'Geometry2',          undefined,                 MetaData.Render);
    public static readonly GeometryCombineModeKey = MuralBase.RegisterProperty<GeometryCombineMode>(CombinedGeometry, 'GeometryCombineMode', GeometryCombineMode.Union, MetaData.Render);

    constructor(geometry1?: Geometry, geometry2?: Geometry, mode?: GeometryCombineMode)
    {
        super();
        if (geometry1 !== undefined) this.Geometry1 = geometry1;
        if (geometry2 !== undefined) this.Geometry2 = geometry2;
        if (mode      !== undefined) this.GeometryCombineMode = mode;
    }

    public get Geometry1():           Geometry | undefined { return this.get_property_value(CombinedGeometry.Geometry1Key); }
    public set Geometry1(value:       Geometry | undefined) { this.set_property_value(CombinedGeometry.Geometry1Key, value); }
    public get Geometry2():           Geometry | undefined { return this.get_property_value(CombinedGeometry.Geometry2Key); }
    public set Geometry2(value:       Geometry | undefined) { this.set_property_value(CombinedGeometry.Geometry2Key, value); }
    public get GeometryCombineMode(): GeometryCombineMode { return this.get_property_value(CombinedGeometry.GeometryCombineModeKey); }
    public set GeometryCombineMode(value: GeometryCombineMode) { this.set_property_value(CombinedGeometry.GeometryCombineModeKey, value); }

    // ── Memoized flattened form ──────────────────────────────────
    private _flat: PathGeometry | undefined = undefined;

    // Public for the boolean-op walker — when a CombinedGeometry is
    // an operand of another CombinedGeometry, the outer call needs
    // the flattened figures to recurse into.
    public toPathGeometry(): PathGeometry
    {
        if (this._flat !== undefined) return this._flat;
        const a = this.Geometry1;
        const b = this.Geometry2;
        if (a === undefined && b === undefined) { this._flat = new PathGeometry([]); return this._flat; }
        if (a === undefined) { this._flat = combine(new PathGeometry([]), b!, this.GeometryCombineMode); return this._flat; }
        if (b === undefined) { this._flat = combine(a, new PathGeometry([]), this.GeometryCombineMode); return this._flat; }
        this._flat = combine(a, b, this.GeometryCombineMode);
        return this._flat;
    }

    protected override OnPropertyChanged(descriptor: import('../../runtime/index.js').PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Any Render-flagged change on Geometry1 / Geometry2 / mode
        // invalidates the flattened cache. The render pipeline
        // re-asks for bounds / Contains via the base virtuals which
        // route through toPathGeometry(), so the memo just lazily
        // rebuilds on next read.
        this._flat = undefined;
    }

    protected override getLocalBounds(): Rect
    {
        return this.toPathGeometry().GetBounds();
    }

    protected override localContains(point: Point): boolean
    {
        return this.toPathGeometry().Contains(point);
    }
}
