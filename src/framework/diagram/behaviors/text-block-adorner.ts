import {
    Color,
    ModifierKeys,
    Point,
    Rect,
    Size,
    Visual,
    type Disposable,
} from '../../../runtime/index.js';
import { Adorner, Pen, RotateTransform, SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/index.js';
import type { PointerEventArgs } from '../../../visual-engine/routed-event.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { ShapeText } from '../shape-text.js';
import { DiagramSettings } from '../diagram-settings.js';

// TextBlockAdorner — the on-canvas move / rotate chrome for a shape's text
// block (§ diagram-text Slice 3). Mirrors the Visio text-block handles: a
// thin outline around the block, a centre move grip, and a rotate grip on a
// short stem above it. Dragging the move grip writes ShapeText.Offset;
// dragging the rotate grip writes ShapeText.Angle — the block re-renders
// itself from those DPs, so the adorner is pure input translation, holding
// no domain state.
//
// Hosting mirrors SelectionBoundsAdorner: the AdornedElement is the items
// panel, so the adorner's local frame equals canvas-local coords (the same
// space Figure.Left / Top live in). Pointer positions arrive in HOST coords;
// the adorner uses only host-frame DELTAS (move) and a host-frame centre
// reconstructed at press (rotate), both correct under the diagram's
// translation-only canvas.
//
// Shows chrome only when EXACTLY ONE Figure is selected — a text block is a
// per-shape sub-object, so a multi-selection has no single block to adorn.
// Opt-in via Diagram.TextBlockAdornerEnabled (default off), matching the
// SelectionResize wiring.

// Accent = theme @Primary (resolved once per adorner instance below — the
// adorner is short-lived, re-created on selection change, so it adapts to the
// theme each time it appears). Fallback when no theme is reachable (tests).
const ACCENT_FALLBACK = Color.FromHex('#1976d2');
const HIDE_OFF    = -10000;

// Grip / stem sizing, read live from settings (defaults 9 / 1 / 18) so a
// change re-sizes the chrome the next time the adorner arranges.
const handleSize = (): number => DiagramSettings.TextHandleSize();   // move / rotate grip square, DIPs
const stemWidth  = (): number => DiagramSettings.TextStemWidth();
const rotateGap  = (): number => DiagramSettings.TextRotateGap();    // block top edge → rotate grip

enum DragMode { None = 'none', Move = 'move', Rotate = 'rotate' }

// Rotate a vector by `rad` (canvas frame → same, no translation component).
function rotVec(x: number, y: number, rad: number): { x: number; y: number }
{
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: x * c - y * s, y: x * s + y * c };
}

export class TextBlockAdorner extends Adorner
{
    private readonly _diagram: Diagram;

    // Chrome. Outline + stem rotate with the block (RenderTransform); the two
    // grips are placed at their already-rotated positions, so they stay
    // axis-aligned squares (rotating a small square is a no-op visually).
    private readonly _outline:      Border;
    private readonly _stem:         Border;
    private readonly _moveHandle:   Border;
    private readonly _rotateHandle: Border;
    private readonly _outlineRotate = new RotateTransform();
    private readonly _stemRotate    = new RotateTransform();

    // Selection tracking — the single adorned Figure + its ShapeText DP
    // unsubscribes (re-armed when the target changes).
    private _figure: Figure | undefined;
    private _textUnsubs: Disposable[] = [];
    private _diagramSubs: Disposable[] = [];
    private readonly _onChange = (): void => { this._retarget(); this.InvalidateArrange(); };

    // Drag state.
    private _mode: DragMode = DragMode.None;
    private _pressHostX = 0;
    private _pressHostY = 0;
    private _pressOffset = new Point(0, 0);
    private _pressAngleRad = 0;
    private _rotCenterHostX = 0;
    private _rotCenterHostY = 0;

    private readonly _accent: SolidColorBrush;

    constructor(adornedElement: Visual, diagram: Diagram)
    {
        super(adornedElement);
        this._diagram = diagram;
        // Resolve the selection accent (@Primary) live from the theme; fall back
        // to the Material seed blue when no theme is reachable (tests).
        const primary = (diagram as unknown as { TryFindResource(k: string): unknown }).TryFindResource('Primary');
        this._accent = primary instanceof SolidColorBrush ? primary : new SolidColorBrush(ACCENT_FALLBACK);
        // The adorner pad itself never catches pointer events — only the two
        // grips (re-enabled below) do, so clicks on the outline / interior
        // pass through to the shape beneath.
        this.IsHitTestVisible = false;

        this._outline = new Border();
        this._outline.Stroke            = new Pen(this._accent, 1);
        this._outline.IsHitTestVisible  = false;
        this._outline.RenderTransform       = this._outlineRotate;
        this._outline.RenderTransformOrigin = new Point(0.5, 0.5);
        this.AttachVisual(this._outline);

        this._stem = new Border();
        this._stem.Fill       = this._accent;
        this._stem.IsHitTestVisible = false;
        this._stem.RenderTransform       = this._stemRotate;
        this._stem.RenderTransformOrigin = new Point(0.5, 0.5);
        this.AttachVisual(this._stem);

        this._moveHandle = this.makeGrip(this._accent, 'move');
        this._rotateHandle = this.makeGrip(DiagramSettings.HandleFill(), 'grab');
        this.AttachVisual(this._moveHandle);
        this.AttachVisual(this._rotateHandle);

        this._wireMove();
        this._wireRotate();

        // Selection identity → retarget; selection bounds (figure move /
        // resize) → re-arrange over the new geometry.
        this._diagram.AddSelectionChangedListener(this._onChange);
        for (const k of [
            Diagram.SelectionLeftKey, Diagram.SelectionTopKey,
            Diagram.SelectionWidthKey, Diagram.SelectionHeightKey,
        ])
        {
            this._diagramSubs.push(this._diagram.PropertyChanged(k).subscribe(this._onChange));
        }
        this._retarget();
    }

    private makeGrip(fill: SolidColorBrush, cursor: string): Border
    {
        const b = new Border();
        b.Fill      = fill;
        b.Stroke          = new Pen(this._accent, 1);
        b.Width           = handleSize();
        b.Height          = handleSize();
        b.Cursor          = cursor;
        return b;
    }

    public override get visualChildren(): Visual[]
    {
        return [this._outline, this._stem, this._moveHandle, this._rotateHandle];
    }

    public override MeasureOverride(_available: Size): Size
    {
        const big = new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        for (const v of this.visualChildren) v.Measure(big);
        return Size.Zero;
    }

    public override ArrangeOverride(finalSize: Size): Size
    {
        const target = this._figure;
        const st = target?.Text;
        const br = st?.GetBlockRect();
        if (target === undefined || st === undefined || br === undefined
            || br.Width <= 0 || br.Height <= 0)
        {
            this.hideAll();
            return finalSize;
        }

        // Block rect + centre in canvas-local coords.
        const ox = target.Left + br.X;
        const oy = target.Top  + br.Y;
        const cx = ox + br.Width  / 2;
        const cy = oy + br.Height / 2;
        const rad = st.Angle * Math.PI / 180;

        // Outline: axis-aligned block rect, rotated about its own centre.
        this._outline.Arrange(new Rect(ox, oy, br.Width, br.Height));
        this._outlineRotate.Angle = st.Angle;

        // Rotate grip: rotateGap() above the block top edge (block frame),
        // rotated into canvas coords. The connecting stem is a thin bar
        // spanning that gap, centred on its midpoint and rotated to match.
        const grip = rotVec(0, -(br.Height / 2 + rotateGap()), rad);
        this.arrangeGrip(this._rotateHandle, cx + grip.x, cy + grip.y);
        this.arrangeGrip(this._moveHandle, cx, cy);
        const mid = rotVec(0, -(br.Height / 2 + rotateGap() / 2), rad);
        const smx = cx + mid.x, smy = cy + mid.y;
        this._stem.Arrange(new Rect(smx - stemWidth() / 2, smy - rotateGap() / 2, stemWidth(), rotateGap()));
        this._stemRotate.Angle = st.Angle;

        return finalSize;
    }

    private arrangeGrip(grip: Border, cx: number, cy: number): void
    {
        const half = handleSize() / 2;
        grip.Arrange(new Rect(cx - half, cy - half, handleSize(), handleSize()));
    }

    private hideAll(): void
    {
        this._outline.Arrange(new Rect(HIDE_OFF, HIDE_OFF, 0, 0));
        this._stem.Arrange(new Rect(HIDE_OFF, HIDE_OFF, 0, 0));
        this._moveHandle.Arrange(new Rect(HIDE_OFF, HIDE_OFF, handleSize(), handleSize()));
        this._rotateHandle.Arrange(new Rect(HIDE_OFF, HIDE_OFF, handleSize(), handleSize()));
    }

    // Re-point at the single selected Figure (or none), re-arming the
    // per-block DP subscriptions so an Offset / Angle / Placement / size
    // change repaints the chrome.
    private _retarget(): void
    {
        let next: Figure | undefined;
        let count = 0;
        for (const it of this._diagram.SelectedItems)
        {
            if (it instanceof Figure) { next = it; count++; }
        }
        const target = count === 1 ? next : undefined;
        if (target === this._figure) return;

        for (const s of this._textUnsubs) s.dispose();
        this._textUnsubs = [];
        this._figure = target;
        if (target !== undefined)
        {
            const st = target.Text;
            const keys = [
                ShapeText.OffsetKey, ShapeText.AngleKey, ShapeText.PlacementKey,
                ShapeText.BlockWidthKey, ShapeText.BlockHeightKey,
            ];
            for (const k of keys)
            {
                this._textUnsubs.push(st.PropertyChanged(k).subscribe(this._onChange));
            }
        }
    }

    private _wireMove(): void
    {
        this._moveHandle.AddRoutedEventListener('PointerDown', ((args: PointerEventArgs) => {
            const t = this._figure;
            if (t === undefined) return;
            this._mode         = DragMode.Move;
            this._pressHostX   = args.HostX;
            this._pressHostY   = args.HostY;
            this._pressOffset  = t.Text.Offset;
            this._pressAngleRad = t.Text.Angle * Math.PI / 180;
            args.CapturePointer(this._moveHandle, 'move');
            args.Handled = true;
        }) as (a: unknown) => void);
        this._moveHandle.AddRoutedEventListener('PointerMove', ((args: PointerEventArgs) => {
            if (this._mode !== DragMode.Move) return;
            const t = this._figure;
            if (t === undefined) return;
            const dx = args.HostX - this._pressHostX;
            const dy = args.HostY - this._pressHostY;
            // Screen delta → block (pre-rotation) frame: rotate by -angle so
            // dragging feels natural even on a rotated block.
            const c = Math.cos(this._pressAngleRad), s = Math.sin(this._pressAngleRad);
            const ldx =  dx * c + dy * s;
            const ldy = -dx * s + dy * c;
            t.Text.Offset = new Point(this._pressOffset.X + ldx, this._pressOffset.Y + ldy);
            args.Handled = true;
        }) as (a: unknown) => void);
        this._moveHandle.AddRoutedEventListener('PointerUp', ((args: PointerEventArgs) => {
            if (this._mode !== DragMode.Move) return;
            this._mode = DragMode.None;
            args.ReleasePointerCapture();
            args.Handled = true;
        }) as (a: unknown) => void);
    }

    private _wireRotate(): void
    {
        this._rotateHandle.AddRoutedEventListener('PointerDown', ((args: PointerEventArgs) => {
            const t = this._figure;
            if (t === undefined) return;
            this._mode = DragMode.Rotate;
            // Reconstruct the block centre in HOST coords from the grip the
            // cursor is on: centre = cursor − (centre→grip vector). Vectors
            // survive the canvas→host translation unchanged.
            const st = t.Text;
            const br = st.GetBlockRect();
            const g = rotVec(0, -(br.Height / 2 + rotateGap()), st.Angle * Math.PI / 180);
            this._rotCenterHostX = args.HostX - g.x;
            this._rotCenterHostY = args.HostY - g.y;
            args.CapturePointer(this._rotateHandle, 'grabbing');
            args.Handled = true;
        }) as (a: unknown) => void);
        this._rotateHandle.AddRoutedEventListener('PointerMove', ((args: PointerEventArgs) => {
            if (this._mode !== DragMode.Rotate) return;
            const t = this._figure;
            if (t === undefined) return;
            const dx = args.HostX - this._rotCenterHostX;
            const dy = args.HostY - this._rotCenterHostY;
            // Grip points "up" (−Y) at angle 0, so add 90° to the cursor bearing.
            let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            deg = ((deg % 360) + 360) % 360;
            // Shift snaps to 15° increments (Visio / PowerPoint convention).
            deg = (args.Modifiers & ModifierKeys.Shift) !== 0
                ? Math.round(deg / 15) * 15
                : Math.round(deg);
            t.Text.Angle = deg % 360;
            args.Handled = true;
        }) as (a: unknown) => void);
        this._rotateHandle.AddRoutedEventListener('PointerUp', ((args: PointerEventArgs) => {
            if (this._mode !== DragMode.Rotate) return;
            this._mode = DragMode.None;
            args.ReleasePointerCapture();
            args.Handled = true;
        }) as (a: unknown) => void);
    }

    public Dispose(): void
    {
        this._diagram.RemoveSelectionChangedListener(this._onChange);
        for (const s of this._diagramSubs) s.dispose();
        this._diagramSubs = [];
        for (const s of this._textUnsubs) s.dispose();
        this._textUnsubs = [];
        this._figure = undefined;
    }
}
