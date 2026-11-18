import {
    CubicBezierSegment,
    PathFigure,
    PathGeometry,
    Point,
} from '../../../visual-engine/index.js';
import { PortSide, type ResolvedPortSide } from '../port.js';
import {
    ConnectorEnd,
    type IRouter,
    type ResolvedAnchor,
    type RouteSpec,
    RouterRegistry,
    RoutingMode,
} from './router.js';
import { BoardSettings } from '../board-settings.js';

// Smooth cubic-Bezier router. One cubic per knot-pair across
// [source, ...waypoints, target]:
//
//   * Source-end control offsets from source in the side's outward
//     direction by `0.5 × |next-knot.axis − source.axis|`, clamped at
//     BEZIER_MIN_CONTROL_OFFSET so endpoints aligned on the off-axis
//     still produce a non-degenerate curve.
//   * Target-end control offsets from target in the side's outward
//     direction by the symmetric formula against the previous knot.
//   * Interior-knot controls use Catmull-Rom-style tangents
//     (kᵢ ± (kᵢ₊₁ − kᵢ₋₁) / 6), giving C¹ continuity through every
//     waypoint.
//
// tangentAt() reads the curve's actual tangent at the endpoint:
//   * Source — direction P₀ → P₁ of the first cubic.
//   * Target — direction P₂ → P₃ of the last cubic.
// For a no-waypoint degenerate (source = target), the offset clamp
// keeps the source-side direction encoded in the tangent — distinct
// from the StraightRouter's "always 0" degenerate convention.
// Minimum control-point pull, read live from settings (default 20) so an edit
// re-curves existing connectors on the next route.
const bezierMinControlOffset = (): number => BoardSettings.ConnectorBezierMinOffset();

class BezierRouter implements IRouter
{
    public compute(spec: RouteSpec): PathGeometry
    {
        const cubics  = computeCubics(spec);
        const start   = new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
        const segments: CubicBezierSegment[] = [];
        for (const c of cubics) segments.push(new CubicBezierSegment(c.p1, c.p2, c.p3));
        return new PathGeometry([new PathFigure(start, segments, false)]);
    }

    public tangentAt(spec: RouteSpec, end: ConnectorEnd): number
    {
        const cubics = computeCubics(spec);
        if (cubics.length === 0) return 0;
        if (end === ConnectorEnd.Source)
        {
            // Tangent at t=0: direction from pen-position (source) to P₁.
            const s     = new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
            const first = cubics[0]!;
            return angleBetween(s.X, s.Y, first.p1.X, first.p1.Y);
        }
        // Tangent at t=1: direction from P₂ to P₃ (= target).
        const last = cubics[cubics.length - 1]!;
        return angleBetween(last.p2.X, last.p2.Y, last.p3.X, last.p3.Y);
    }
}

// p1 / p2 / p3 mirror CubicBezierSegment's Point1 / Point2 / Point3
// (the start "P₀" of each cubic is the previous segment's endpoint,
// which is what PathFigure already tracks).
interface Cubic { p1: Point; p2: Point; p3: Point; }

function computeCubics(spec: RouteSpec): Cubic[]
{
    const s = new Point(spec.sourceAnchor.x, spec.sourceAnchor.y);
    const t = new Point(spec.targetAnchor.x, spec.targetAnchor.y);
    // Full knot list, including source at index 0 and target at the
    // tail. Per-segment control derivation reads neighbors out of this
    // list; the endpoint branches read source/target sides.
    const knots: Point[] = [s, ...spec.waypoints, t];
    const out: Cubic[] = [];

    for (let i = 0; i < knots.length - 1; i++)
    {
        const k0 = knots[i]!;
        const k1 = knots[i + 1]!;

        let p1: Point;
        if (i === 0)
        {
            const dir    = sideOutwardDir(spec.sourceAnchor.side);
            const offset = controlOffset(spec.sourceAnchor, k1);
            p1 = new Point(s.X + dir.x * offset, s.Y + dir.y * offset);
        }
        else
        {
            // Catmull-Rom tangent at k0 (an interior knot): proportional
            // to (k1 − kᵢ₋₁). Control point ON the kᵢ→kᵢ₊₁ side.
            const km1 = knots[i - 1]!;
            p1 = new Point(k0.X + (k1.X - km1.X) / 6, k0.Y + (k1.Y - km1.Y) / 6);
        }

        let p2: Point;
        if (i === knots.length - 2)
        {
            const dir    = sideOutwardDir(spec.targetAnchor.side);
            const offset = controlOffset(spec.targetAnchor, k0);
            p2 = new Point(t.X + dir.x * offset, t.Y + dir.y * offset);
        }
        else
        {
            // Catmull-Rom tangent at k1 (an interior knot): proportional
            // to (kᵢ₊₂ − k0). Control point ON the k0→k1 side.
            const k2 = knots[i + 2]!;
            p2 = new Point(k1.X - (k2.X - k0.X) / 6, k1.Y - (k2.Y - k0.Y) / 6);
        }

        out.push({ p1, p2, p3: k1 });
    }
    return out;
}

// Offset magnitude for endpoint control points. Matches the doc's
// "0.5 × |target.x − source.x|" example for E-side anchors and
// generalizes: X-axis sides scale by the X-delta to the nearest
// neighbor knot, Y-axis sides scale by the Y-delta. Min clamp keeps
// off-axis-aligned endpoints from degenerating into a zero-length
// tangent.
function controlOffset(anchor: ResolvedAnchor, near: Point): number
{
    const onXAxis = anchor.side === PortSide.E || anchor.side === PortSide.W;
    const delta   = onXAxis
        ? Math.abs(near.X - anchor.x)
        : Math.abs(near.Y - anchor.y);
    return Math.max(0.5 * delta, bezierMinControlOffset());
}

function sideOutwardDir(side: ResolvedPortSide): { x: number; y: number }
{
    // Screen coordinates: +Y is downward. So N (north / up) maps to -Y,
    // S (south / down) to +Y.
    switch (side)
    {
        case PortSide.N: return { x:  0, y: -1 };
        case PortSide.S: return { x:  0, y:  1 };
        case PortSide.E: return { x:  1, y:  0 };
        case PortSide.W: return { x: -1, y:  0 };
    }
}

function angleBetween(x0: number, y0: number, x1: number, y1: number): number
{
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return 0;
    return Math.atan2(dy, dx);
}

RouterRegistry.register(RoutingMode.Bezier, new BezierRouter());
