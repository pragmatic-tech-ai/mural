// Path catalog for the text-on-path demo.
//
// Each entry exposes a `Key`, `Label`, and a builder for a
// `PathGeometry` sized to fit roughly inside a 700 × 400 canvas.
// All paths share the same world coordinate system (origin at
// top-left, +Y down) so the surface renderer can paint them in
// place. Builders return a fresh PathGeometry — callers cache.

import { Point, Size } from '@pragmatic-tech-ai/mural/runtime';
import {
    ArcSegment,
    LineSegment,
    pathGeometryFromSvgD,
    PathFigure,
    PathGeometry,
    SweepDirection,
} from '@pragmatic-tech-ai/mural/visual-engine';

// ── 1. Sine wave (three peaks) ───────────────────────────────────────
//
// Pure quadratic-Bezier cosine approximation: alternate quads above
// and below the midline. SVG `T` shorthand reflects the previous
// control around the join, so a single `Q` followed by `T`'s gives
// us a smooth sinusoidal chain without manually computing each control.
function buildWave(): PathGeometry
{
    return pathGeometryFromSvgD(
        'M 60 200  ' +
        'Q 130 60 200 200  ' +
        'T 340 200  ' +
        'T 480 200  ' +
        'T 620 200',
    );
}

// ── 2. Closed circle ─────────────────────────────────────────────────
//
// Two half-arcs lifted via the §19.1.1 ArcSegment lowering — gives us
// a real curve, not a polyline approximation. Built by direct
// construction to exercise `ArcSegment.SweepDirection`.
function buildCircle(): PathGeometry
{
    const center = new Point(350, 220);
    const r = 150;
    const start = new Point(center.X + r, center.Y);
    return new PathGeometry([new PathFigure(
        start,
        [
            new ArcSegment(
                new Point(center.X - r, center.Y),
                new Size(r, r),
                0, false, SweepDirection.Clockwise,
            ),
            new ArcSegment(
                start,
                new Size(r, r),
                0, false, SweepDirection.Clockwise,
            ),
        ],
        true,
    )]);
}

// ── 3. Archimedean spiral ────────────────────────────────────────────
//
// r(t) = a + b·t. We sample N points along t ∈ [0, 6π] (three turns),
// connect with short line segments. The text-on-path arclength
// sampler will pick up tangents from the polyline directly, which is
// good enough at this scale.
function buildSpiral(): PathGeometry
{
    const cx = 350, cy = 220;
    const turns = 3;
    const a = 4;
    const b = 12;
    const steps = 360;
    const points: Point[] = [];
    for (let i = 0; i <= steps; i++)
    {
        const t = (i / steps) * (2 * Math.PI * turns);
        const r = a + b * t;
        points.push(new Point(cx + r * Math.cos(t), cy + r * Math.sin(t)));
    }
    const segs: LineSegment[] = [];
    for (let i = 1; i < points.length; i++) segs.push(new LineSegment(points[i]));
    return new PathGeometry([new PathFigure(points[0], segs, false)]);
}

// ── 4. Heart curve ───────────────────────────────────────────────────
//
// Two cubic Beziers joined at the bottom point. Authored by eye in
// SVG d-form; baseline ≈ y = 360, peak ≈ y = 100. Pointy bottom at
// (350, 360).
function buildHeart(): PathGeometry
{
    return pathGeometryFromSvgD(
        'M 350 360 ' +
        'C 200 240 100 100 350 180 ' +
        'C 600 100 500 240 350 360 ' +
        'Z',
    );
}

// ── 5. Lemniscate (figure-8) ─────────────────────────────────────────
//
// Two lobes joined at the center. Built as two closed loops sharing
// a vertex — under EvenOdd fill the crossing region cancels out,
// which makes the strokes cleanly visible at the meeting point.
function buildFigureEight(): PathGeometry
{
    const cx = 350, cy = 220;
    return pathGeometryFromSvgD(
        `M ${cx} ${cy} ` +
        // Right lobe — cubic out + cubic back.
        `C ${cx + 60} ${cy - 120}  ${cx + 240} ${cy - 120}  ${cx + 200} ${cy} ` +
        `C ${cx + 240} ${cy + 120}  ${cx + 60}  ${cy + 120}  ${cx} ${cy} ` +
        // Left lobe — mirror.
        `C ${cx - 60} ${cy - 120}  ${cx - 240} ${cy - 120}  ${cx - 200} ${cy} ` +
        `C ${cx - 240} ${cy + 120}  ${cx - 60}  ${cy + 120}  ${cx} ${cy} `,
    );
}

// ── 6. Wavy ribbon (double frequency) ────────────────────────────────
//
// Same shape as the sine wave but with a steeper amplitude on every
// second peak — looks like an audio waveform. Lays out demonstratively
// because the changing curvature stresses the rigid-glyph rotation
// in text-on-path.
function buildRibbon(): PathGeometry
{
    return pathGeometryFromSvgD(
        'M 60 220  ' +
        'Q 110 100 160 220  ' +
        'Q 210 320 260 220  ' +
        'Q 310 80  360 220  ' +
        'Q 410 340 460 220  ' +
        'Q 510 120 560 220  ' +
        'Q 610 280 660 220',
    );
}

// ── 7. Star-like polyline ────────────────────────────────────────────
//
// A 5-pointed star polyline — straight edges, sharp turns. Text-on-
// path drops one glyph at each corner, with no smoothing across the
// vertex; useful for visually inspecting the per-segment tangent
// handoff at sharp angles.
function buildStar(): PathGeometry
{
    const cx = 350, cy = 220;
    const rOuter = 160;
    const rInner = 65;
    const points: Point[] = [];
    for (let i = 0; i < 10; i++)
    {
        const r = (i & 1) === 0 ? rOuter : rInner;
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        points.push(new Point(cx + r * Math.cos(angle), cy + r * Math.sin(angle)));
    }
    const segs: LineSegment[] = [];
    for (let i = 1; i < points.length; i++) segs.push(new LineSegment(points[i]));
    return new PathGeometry([new PathFigure(points[0], segs, true)]);
}

// ── 8. Two-figure ribbon (independent runs) ──────────────────────────
//
// A figure-8 plus a circle, drawn as two SEPARATE figures in the
// same PathGeometry. Exercises the text-on-path multi-figure code
// path — text flows across both runs in document order.
function buildTwoLobes(): PathGeometry
{
    return pathGeometryFromSvgD(
        // Top oval.
        'M 80 130  C 80 70  280 70  280 130 C 280 190 80 190 80 130 Z ' +
        // Bottom oval.
        'M 420 290  C 420 230 620 230 620 290 C 620 350 420 350 420 290 Z ',
    );
}

export interface PathCatalogEntry
{
    key:   string;
    label: string;
    build: () => PathGeometry;
}

export const PATHS: PathCatalogEntry[] = [
    { key: 'wave',         label: 'Sine wave (3 peaks)',    build: buildWave },
    { key: 'circle',       label: 'Circle (closed)',         build: buildCircle },
    { key: 'spiral',       label: 'Archimedean spiral',      build: buildSpiral },
    { key: 'heart',        label: 'Heart',                   build: buildHeart },
    { key: 'figure-eight', label: 'Lemniscate (figure-8)',   build: buildFigureEight },
    { key: 'ribbon',       label: 'Wavy ribbon',             build: buildRibbon },
    { key: 'star',         label: '5-point star',            build: buildStar },
    { key: 'two-ovals',    label: 'Two ovals (multi-figure)', build: buildTwoLobes },
];

// Cache so repeated VM activations don't rebuild.
const _cache = new Map<string, PathGeometry>();

export function getPath(key: string): PathGeometry | undefined
{
    if (_cache.has(key)) return _cache.get(key);
    const entry = PATHS.find(p => p.key === key);
    if (entry === undefined) return undefined;
    const built = entry.build();
    _cache.set(key, built);
    return built;
}
