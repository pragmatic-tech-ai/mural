import {
    Element, MuralBase, MetaData, Point, Rect, Size, PropertyDescriptor,
    AlignmentAxis, chooseTickInterval, ticksInRange, guideCursorFor,
} from '../../../runtime/index.js';
import { Orientation } from '../../../basic/index.js';
import type { DrawingContext } from '../../../visual-engine/index.js';
import { FormattedText } from '../../../visual-engine/index.js';
import { BoardSettings } from '../board-settings.js';

// A measured ruler strip along one viewport edge. The Board owns it (grabs it
// via GetTemplateChild and pushes Zoom / Offset / Extent as the camera changes);
// the ruler paints tick marks + numeric labels in RenderOverride, projecting each
// content coordinate to host space as `c * Zoom - Offset`. Drag-out of a new guide
// is handled by the persistent-guides behavior at the Board level (it detects a
// pointer-down whose Source is inside a RulerBar), so this control is display-only.
//
// Extends Element (like Shape / TextBlock), not Control: it paints itself in
// RenderOverride and needs no template / default Style.
const LABEL_FONT = 'sans-serif';
const LABEL_SIZE = 9;

export class RulerBar extends Element
{
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(
        RulerBar, 'Orientation', Orientation.Horizontal, MetaData.Render);
    public static readonly ZoomKey = MuralBase.RegisterProperty<number>(
        RulerBar, 'Zoom', 1, MetaData.Render);
    public static readonly OffsetKey = MuralBase.RegisterProperty<number>(
        RulerBar, 'Offset', 0, MetaData.Render);
    public static readonly ExtentKey = MuralBase.RegisterProperty<number>(
        RulerBar, 'Extent', 0, MetaData.Render);

    public get Orientation(): Orientation { return this.get_property_value(RulerBar.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(RulerBar.OrientationKey, v); }
    public get Zoom(): number { return this.get_property_value(RulerBar.ZoomKey); }
    public set Zoom(v: number) { this.set_property_value(RulerBar.ZoomKey, v); }
    public get Offset(): number { return this.get_property_value(RulerBar.OffsetKey); }
    public set Offset(v: number) { this.set_property_value(RulerBar.OffsetKey, v); }
    public get Extent(): number { return this.get_property_value(RulerBar.ExtentKey); }
    public set Extent(v: number) { this.set_property_value(RulerBar.ExtentKey, v); }

    constructor()
    {
        super();
        this.refreshCursor();
    }

    // The ruler is a live drag-out zone for a new guide, so it advertises the
    // matching resize cursor: a top (horizontal) ruler pulls out a horizontal
    // guide (Y) that moves vertically → ns-resize; a left ruler → ew-resize.
    private refreshCursor(): void
    {
        this.Cursor = guideCursorFor(this.horizontal ? AlignmentAxis.Y : AlignmentAxis.X);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        // Markup writes bypass the TS setter; catch Orientation here too.
        if (descriptor.Name === 'Orientation') this.refreshCursor();
        // IsMouseOver is a MetaData.None flag (no auto-repaint) — drive the hover
        // wash off it explicitly.
        if (descriptor.Name === 'Orientation' || descriptor.Name === 'IsMouseOver')
            this.InvalidateVisual();
    }

    private get horizontal(): boolean { return this.Orientation === Orientation.Horizontal; }

    protected override MeasureOverride(_available: Size): Size
    {
        // Fixed cross-axis thickness; the Grid cell (a `*` track) stretches the
        // main axis, and the `Auto` cross-axis track sizes to this thickness.
        const t = BoardSettings.RulerThickness();
        return this.horizontal ? new Size(0, t) : new Size(t, 0);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        return finalSize;
    }

    protected override RenderOverride(dc: DrawingContext): void
    {
        const s = this.RenderSize;
        if (s.Width <= 0 || s.Height <= 0) return;

        dc.DrawRectangle(BoardSettings.RulerFill(), undefined, new Rect(0, 0, s.Width, s.Height));
        // Hover affordance: accent wash under the ticks while the pointer is over
        // the strip, signalling "drag out of here to place a guide".
        if (this.IsMouseOver)
            dc.DrawRectangle(BoardSettings.RulerHoverFill(), undefined, new Rect(0, 0, s.Width, s.Height));

        const zoom = this.Zoom || 1;
        const offset = this.Offset;
        const extent = this.horizontal ? s.Width : s.Height;
        const contentMin = offset / zoom;
        const contentMax = (offset + extent) / zoom;
        const interval = chooseTickInterval(zoom, BoardSettings.RulerTickMinSpacing());
        const ticks = ticksInRange(interval, contentMin, contentMax);

        const tickBrush = BoardSettings.RulerTickColor();
        for (const c of ticks)
        {
            const host = c * zoom - offset;
            const label = new FormattedText(String(Math.round(c)), LABEL_FONT, LABEL_SIZE, tickBrush);
            if (this.horizontal)
            {
                const len = Math.max(4, s.Height * 0.4);
                dc.DrawRectangle(tickBrush, undefined, new Rect(host, s.Height - len, 1, len));
                dc.DrawText(label, new Point(host + 2, 1));
            }
            else
            {
                const len = Math.max(4, s.Width * 0.4);
                dc.DrawRectangle(tickBrush, undefined, new Rect(s.Width - len, host, len, 1));
                dc.DrawText(label, new Point(1, host + 2));
            }
        }
    }
}
