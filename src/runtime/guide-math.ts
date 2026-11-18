import { Rect } from '../visual-engine/primitives.js';
import { AlignmentAxis, EdgeKind } from './alignment-math.js';

// Persistent (Visio-style) guide model + the pure snap/tick math that drives
// placement, node snapping, glue, and ruler tick layout. No Visual / DP deps —
// the board behavior and adorner are the consumers. Sibling of alignment-math.ts.

export interface GuideGlue
{
    // The stable BoardDocument node id (Figure.Id / NodeViewModel.Id) glued
    // to the guide, and which of the node's edges is stuck.
    readonly nodeId: string;
    readonly edge:   EdgeKind;
}

export interface PersistentGuide
{
    // X = vertical line at `position` (a content x); Y = horizontal line (a content y).
    readonly axis:     AlignmentAxis;
    readonly position: number;
    readonly glued:    readonly GuideGlue[];
}

// A transient placement hint: where a guide WOULD land if the user dragged out
// right now (the hover preview line). Just an axis + content position — no glue.
export interface GuidePreview
{
    readonly axis:     AlignmentAxis;
    readonly position: number;
}

// The CSS cursor that advertises "drag here to move a guide of this axis". A
// vertical guide (X) slides horizontally → ew-resize; a horizontal guide (Y)
// slides vertically → ns-resize. Shared by the ruler strips and the in-canvas
// create-band hover so both agree. Freeform CSS string (like Splitter's cursor),
// not an enum — Visual.Cursor is an open CSS value.
export function guideCursorFor(axis: AlignmentAxis): string
{
    return axis === AlignmentAxis.X ? 'ew-resize' : 'ns-resize';
}

const DEFAULT_TOLERANCE = 5;
const EDGES: readonly EdgeKind[] = [EdgeKind.Min, EdgeKind.Mid, EdgeKind.Max];

// A rectangle's edge coordinate on one axis — mirrors alignment-math's private helper.
function edgeCoord(rect: Rect, axis: AlignmentAxis, edge: EdgeKind): number
{
    if (axis === AlignmentAxis.X)
    {
        if (edge === EdgeKind.Min) return rect.X;
        if (edge === EdgeKind.Max) return rect.X + rect.Width;
        return rect.X + rect.Width / 2;
    }
    if (edge === EdgeKind.Min) return rect.Y;
    if (edge === EdgeKind.Max) return rect.Y + rect.Height;
    return rect.Y + rect.Height / 2;
}

// Snap a guide being placed/moved onto the nearest node edge (any of min/mid/max)
// on its own axis, within tolerance. Returns the snapped coordinate (or the input
// unchanged when nothing is close). Closest edge wins.
export function snapGuidePosition(
    axis: AlignmentAxis, position: number,
    rects: readonly Rect[], tolerance: number = DEFAULT_TOLERANCE): number
{
    let best: number | undefined;
    let bestDelta = Infinity;
    for (const rect of rects)
    {
        for (const e of EDGES)
        {
            const c = edgeCoord(rect, axis, e);
            const d = Math.abs(c - position);
            if (d <= tolerance && d < bestDelta) { best = c; bestDelta = d; }
        }
    }
    return best ?? position;
}

export interface GuideAxisSnap { readonly edge: EdgeKind; readonly guide: number }
export interface GuideSnap
{
    readonly snapped: Rect;
    readonly x?: GuideAxisSnap;   // which moving edge glued to which x-guide (index into guides)
    readonly y?: GuideAxisSnap;
}

// Snap a moving node rect so its nearest edge lands on a guide, per axis
// independently. Reports the glued edge + guide index per axis so the caller can
// record glue on drop. Closest edge/guide pairing wins per axis.
export function snapRectToGuides(
    rect: Rect, guides: readonly PersistentGuide[],
    tolerance: number = DEFAULT_TOLERANCE): GuideSnap
{
    let x: GuideAxisSnap | undefined; let bestDx = Infinity; let dx = 0;
    let y: GuideAxisSnap | undefined; let bestDy = Infinity; let dy = 0;
    for (let gi = 0; gi < guides.length; gi++)
    {
        const g = guides[gi]!;
        for (const e of EDGES)
        {
            const c = edgeCoord(rect, g.axis, e);
            const delta = g.position - c;
            const ad = Math.abs(delta);
            if (ad > tolerance) continue;
            if (g.axis === AlignmentAxis.X)
            {
                if (ad < bestDx) { bestDx = ad; dx = delta; x = { edge: e, guide: gi }; }
            }
            else
            {
                if (ad < bestDy) { bestDy = ad; dy = delta; y = { edge: e, guide: gi }; }
            }
        }
    }
    const snapped = new Rect(
        rect.X + (x !== undefined ? dx : 0),
        rect.Y + (y !== undefined ? dy : 0),
        rect.Width, rect.Height);
    return { snapped, x, y };
}

// The 1/2/5 × 10ⁿ ladder value: smallest interval whose on-screen spacing
// (interval × zoom) is at least minPx. Keeps ruler tick labels legible at any zoom.
export function chooseTickInterval(zoom: number, minPx: number): number
{
    const z = zoom > 0 ? zoom : 1;
    const need = minPx / z;                    // required content-space interval
    const pow = Math.floor(Math.log10(Math.max(need, 1e-6)));
    let mag = Math.pow(10, pow);
    for (let p = pow; p < pow + 4; p++)
    {
        mag = Math.pow(10, p);
        for (const m of [1, 2, 5])
        {
            const candidate = m * mag;
            if (candidate >= need) return candidate;
        }
    }
    return 10 * mag;
}

// Every multiple of `interval` within [contentMin, contentMax], inclusive.
// Normalizes -0 to 0.
export function ticksInRange(interval: number, contentMin: number, contentMax: number): number[]
{
    if (!(interval > 0) || !(contentMax >= contentMin)) return [];
    const out: number[] = [];
    const start = Math.ceil(contentMin / interval);
    const end   = Math.floor(contentMax / interval);
    for (let k = start; k <= end; k++) out.push(k * interval + 0);
    return out;
}
