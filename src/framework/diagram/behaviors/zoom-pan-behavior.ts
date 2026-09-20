import { Diagram } from '../diagram.js';
import { Point } from '../../../visual-engine/primitives.js';
import { hasModifier, ModifierKeys, WheelDeltaMode } from '../../../runtime/index.js';
import { zoomAtPoint } from '../camera.js';

// Wheel zoom sensitivity: multiplicative factor per normalized delta pixel.
const ZOOM_PER_PX = 1.0015;

// Normalize a wheel delta to pixels so line/page-mode wheels behave like pixel
// wheels (mirrors ScrollViewer's line-step of 16).
function scaleFor(mode: WheelDeltaMode): number
{
    return mode === WheelDeltaMode.Line ? 16 : mode === WheelDeltaMode.Page ? 400 : 1;
}

// The cursor as a VIEWPORT point: HostX/HostY minus the ScrollViewer's own
// arranged origin. Sum ArrangedRect from PART_Scroll (NOT PART_Camera) up to the
// root — the scroll offset lives inside the ScrollViewer on PART_Camera, so it
// must be excluded from the pivot (zoomAtPoint folds the offset in itself).
function viewportPivot(diagram: Diagram, hostX: number, hostY: number): Point
{
    let ox = 0, oy = 0;
    let cur = diagram.GetTemplateChild('PART_Scroll');
    while (cur !== undefined) { ox += cur.ArrangedRect.X; oy += cur.ArrangedRect.Y; cur = cur.GetVisualParent(); }
    return new Point(hostX - ox, hostY - oy);
}

// Installs camera gesture handling on a Diagram: Ctrl/⌘+wheel (and pinch, which
// platforms deliver as ctrl+wheel) zooms about the cursor. Plain / Shift wheel is
// left unhandled so the ScrollViewer scrolls it natively; scrollbars and
// drag-to-edge auto-scroll are the ScrollViewer's own. Returns a detach thunk.
// (Keyboard zoom is a host concern: the host binds Ctrl +/−/0 to the diagram's
// zoom command DPs.)
export function attachZoomPan(diagram: Diagram): () => void
{
    diagram._setCameraHandlers({
        OnWheel(args)
        {
            if (!hasModifier(args.Modifiers, ModifierKeys.Control)) return;   // bubble → ScrollViewer scrolls
            const dy = args.DeltaY * scaleFor(args.DeltaMode);
            const factor = Math.pow(ZOOM_PER_PX, -dy);   // wheel up (negative) = zoom in
            diagram.SetCamera(zoomAtPoint(diagram.Camera, viewportPivot(diagram, args.HostX, args.HostY), factor));
            args.Handled = true;
        },
    });

    return (): void => diagram._setCameraHandlers(undefined);
}
