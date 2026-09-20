import { Matrix, Point, Rect, Size } from '../../visual-engine/primitives.js';

// The diagram camera: content maps to the viewport as `viewport = content*zoom
// - offset`. Offset is the ScrollViewer scroll offset (>= 0), NOT a post-scale
// translate. Pure value + math — no mural-visual deps, fully unit-testable.
export interface Camera { readonly zoom: number; readonly offsetX: number; readonly offsetY: number; }

export const CAMERA_MIN = 0.1;         // interactive zoom-out floor (10%)
export const CAMERA_MAX = 4.0;         // interactive zoom-in ceiling (400%)
export const CAMERA_FIT_FLOOR = 0.02;  // Fit may go this low to frame huge diagrams

// Clamp an interactive zoom to [CAMERA_MIN, CAMERA_MAX].
export function clampZoom(z: number): number { return Math.max(CAMERA_MIN, Math.min(CAMERA_MAX, z)); }

// Content -> viewport affine. Scale applies first, then translate by -offset
// (the leftmost Multiply factor applies first to a row-vector point), so
// viewport = c*zoom - offset.
export function cameraMatrix(c: Camera): Matrix
{
    return Matrix.Scale(c.zoom, c.zoom).Multiply(Matrix.Translate(-c.offsetX, -c.offsetY));
}

// Zoom by `factor` about `pivot` (a VIEWPORT point), keeping the content point
// currently under the pivot fixed on screen. Zoom is clamped to the interactive
// range. The resulting offset may be negative; callers lower-clamp it when
// writing the scroll offset.
export function zoomAtPoint(c: Camera, pivot: Point, factor: number): Camera
{
    const zoom = clampZoom(c.zoom * factor);
    // content point currently under the pivot: (pivot + offset) / zoom
    const cx = (pivot.X + c.offsetX) / c.zoom;
    const cy = (pivot.Y + c.offsetY) / c.zoom;
    // choose offset so the same content point maps back to the pivot at the new zoom
    return { zoom, offsetX: cx * zoom - pivot.X, offsetY: cy * zoom - pivot.Y };
}

// Frame `content` (a content-space rect) top-left in `viewport` with `padding`
// pixels of inset. A scroll offset cannot push content right/down to center it,
// so framing is top-left, not centered. Zoom is clamped to [CAMERA_FIT_FLOOR,
// CAMERA_MAX] so Fit can go below the interactive floor to frame very large
// diagrams.
export function fitBounds(content: Rect, viewport: Size, padding: number): Camera
{
    const availW = Math.max(1, viewport.Width - padding * 2);
    const availH = Math.max(1, viewport.Height - padding * 2);
    const w = Math.max(1, content.Width);
    const h = Math.max(1, content.Height);
    const zoom = Math.max(CAMERA_FIT_FLOOR, Math.min(CAMERA_MAX, Math.min(availW / w, availH / h)));
    return {
        zoom,
        offsetX: Math.max(0, content.X * zoom - padding),
        offsetY: Math.max(0, content.Y * zoom - padding),
    };
}
