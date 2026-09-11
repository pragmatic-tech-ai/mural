import {
    MetaData,
    MuralBase,
    Panel,
    PropertyTransition,
    Rect,
    Size,
    Element, Visual,
    WheelDeltaMode,
    hasModifier,
    ModifierKeys,
    type DragEventArgs,
    type DragSession,
    type EasingFunction,
    type PropertyDescriptor,
    type WheelEventArgs,
} from '../../runtime/index.js';
import { Easings } from '../../visual-engine/animation/easing.js';
import { ContentControl } from '../base/content-control.js';
import { ScrollBar } from '../../basic/scroll/scroll-bar.js';
import { ScrollContentPresenter } from '../../basic/scroll/scroll-content-presenter.js';
import { Orientation } from '../../basic/panels/orientation.js';

// Reserved cross-axis space for an active scrollbar. Mirrors the
// ScrollBar control's own SCROLLBAR_THICKNESS constant — kept locally
// here to avoid an import cycle.
const SCROLLBAR_GUTTER = 10;

// Internal Panel that hosts ScrollViewer's template parts (the
// ScrollContentPresenter + the two ScrollBars) and delegates the
// gutter / placement math back to the owning ScrollViewer. Same role
// the ScrollBarLayout plays for ScrollBar: a template root that exists
// only because the .mu factory needs a single rooted subtree, with the
// actual control-specific layout still on the owning control where
// the DP-driven metrics live.
//
// Exported for the compiled-`.mu` ScrollViewer template (not public API).
export class ScrollViewerLayout extends Panel
{
    public host: ScrollViewer | undefined;

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        // Mirror the OLD ScrollViewer.MeasureOverride contract: report
        // min(available, extent) so an unbounded parent axis (vertical
        // StackPanel hosting our default-template TreeView is the
        // canonical case) doesn't propagate Infinity up the tree — the
        // outer arrange would otherwise hand us an Infinity-tall slot
        // and the SCP's clip rect / content translate land at
        // height="Infinity" / translate(_, NaN) in the SVG output.
        // The SCP owns the extent numbers (it ran them in its
        // MeasureOverride above); read them through the host.
        const extentW = this.host?.ExtentWidth  ?? 0;
        const extentH = this.host?.ExtentHeight ?? 0;
        const w = Math.min(availableSize.Width,  extentW);
        const h = Math.min(availableSize.Height, extentH);
        return new Size(
            Number.isFinite(w) ? w : 0,
            Number.isFinite(h) ? h : 0,
        );
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        return this.host?.ArrangeTemplateParts(finalSize) ?? finalSize;
    }
}

// A scrollable viewport that shows a portion of its Content. Templated
// since the §11 refactor — the scroll-presentation surface
// (ScrollContentPresenter) and the two ScrollBars live in the default
// ControlTemplate as PART_ContentSite / PART_VerticalScrollBar /
// PART_HorizontalScrollBar, inside a ScrollViewerLayout root that
// arranges them via this control.
//
// ScrollViewer owns the PUBLIC scrolling surface (offset DPs, extent /
// viewport readbacks, OnPointerWheel input, the §8.4 auto-scroll, and
// ScrollIntoView). The mechanics — clip-and-translate vs IScrollInfo
// delegation — live inside ScrollContentPresenter. Two scrolling modes
// flow naturally from the SCP's internal split:
//
//   * Delegate mode — Content implements IScrollInfo (today: a
//     VirtualizingPanel). SCP drives the panel's Viewport; the panel
//     decides which items to realize. No clip / translate.
//
//   * Clip-and-translate mode — Content is anything else. SCP measures
//     it with +Infinity (natural extent), arranges at
//     (-HorizontalOffset, -VerticalOffset), and installs a viewport-
//     sized clip on the content's own local coords.
//
// Offsets are NOT clamped on assignment — the raw value stays queryable
// so binding sources see what they wrote. The effective offset used
// during Arrange is the clamped value, computed by
// effectiveHorizontalOffset / effectiveVerticalOffset (read by SCP
// each layout pass).
export class ScrollViewer extends ContentControl
{
    // Offsets are Measure | Arrange: SCP's MeasureOverride uses them to
    // drive the IScrollInfo provider's viewport (delegate mode), so a
    // re-measure must run when they change. ArrangeOverride also depends
    // on them (clip-and-translate mode's content translation), so flag
    // both.
    public static readonly HorizontalOffsetKey = MuralBase.RegisterProperty<number>(
        ScrollViewer, 'HorizontalOffset', 0, MetaData.Measure | MetaData.Arrange);
    public static readonly VerticalOffsetKey   = MuralBase.RegisterProperty<number>(
        ScrollViewer, 'VerticalOffset',   0, MetaData.Measure | MetaData.Arrange);
    // Per-axis scroll opt-out. When false, the matching axis is measured
    // with the bounded available size instead of +Infinity, so a soft-
    // wrapping child (TextBox in Wrap mode) sees a real width budget to
    // wrap against. The matching scrollbar also stays hidden on a
    // disabled axis even when extent > viewport (the bar would dangle
    // uselessly). Defaults are true so the existing TreeView / ListBox
    // templates behave as before.
    public static readonly HorizontalScrollEnabledKey = MuralBase.RegisterProperty<boolean>(
        ScrollViewer, 'HorizontalScrollEnabled', true, MetaData.Measure | MetaData.Arrange);
    public static readonly VerticalScrollEnabledKey   = MuralBase.RegisterProperty<boolean>(
        ScrollViewer, 'VerticalScrollEnabled',   true, MetaData.Measure | MetaData.Arrange);
    // Forwarded to the inner ScrollBars' IsAutoHide DPs in the
    // constructor + via the listener below. Lets a consumer set
    // ScrollViewer.IsAutoHideScrollBars=true and get the macOS /
    // Slack-style overlay behaviour without reaching for the bars.
    // Default false to match the discoverable always-visible bar shape
    // that TreeView / ListBox lean on.
    public static readonly IsAutoHideScrollBarsKey = MuralBase.RegisterProperty<boolean>(
        ScrollViewer, 'IsAutoHideScrollBars', false, MetaData.None);

    // Opt-in "keep the latest content visible". When true, an arrange pass whose
    // content grew snaps VerticalOffset to the bottom — but only while the
    // viewport was already parked at the bottom (sticky). Scrolling up releases
    // it; scrolling back to the bottom resumes it. Default false → no effect on
    // existing ScrollViewers. MetaData.Arrange so toggling it re-arranges.
    public static readonly AutoScrollToEndKey = MuralBase.RegisterProperty<boolean>(
        ScrollViewer, 'AutoScrollToEnd', false, MetaData.Arrange);

    // Edge-gutter width (in viewport-local px) that triggers auto-scroll
    // while a drag is hovering over the ScrollViewer (8.4). Setting `0`
    // disables auto-scroll. Default 24 — matches the Visio / Figma / drawio
    // gutter where dragged items pull the viewport along.
    public static readonly AutoScrollGutterKey = MuralBase.RegisterProperty<number>(
        ScrollViewer, 'AutoScrollGutter', 24, MetaData.None);

    // Smooth-scroll (§ 10.5). When true, an installed PropertyTransition
    // tweens every HorizontalOffset / VerticalOffset write over
    // SmoothScrollDuration with SmoothScrollEasing. Wheel events,
    // programmatic offset writes, and ScrollIntoView calls all tween;
    // thumb drags also tween, which can feel laggy during a continuous
    // drag (every Value notification fires a fresh tween) — consumers
    // who want crisp thumb drags + smooth wheel scrolls should flip
    // SmoothScroll off, listen for the wheel event themselves, and
    // start a one-shot Storyboard.
    //
    // Default false to preserve the existing direct-write behaviour.
    public static readonly SmoothScrollKey = MuralBase.RegisterProperty<boolean>(
        ScrollViewer, 'SmoothScroll', false, MetaData.None);
    public static readonly SmoothScrollDurationKey = MuralBase.RegisterProperty<number>(
        ScrollViewer, 'SmoothScrollDuration', 250, MetaData.None);
    public static readonly SmoothScrollEasingKey = MuralBase.RegisterProperty<EasingFunction>(
        ScrollViewer, 'SmoothScrollEasing', Easings.StandardDecelerate, MetaData.None);
    // Pixels per auto-scroll tick. 4px × 30 ticks/sec ≈ 120 px/sec —
    // brisk but controllable. The tick rate uses `setInterval(32)` so a
    // value of 4 yields 125 px/sec.
    public static readonly AutoScrollStepKey = MuralBase.RegisterProperty<number>(
        ScrollViewer, 'AutoScrollStep', 4, MetaData.None);

    // Read-only signal that the viewport has scrolled away from the
    // origin (either axis). False when both HorizontalOffset and
    // VerticalOffset are 0; flips true the moment either drifts off
    // zero. The signal is maintained in OnPropertyChanged below — there
    // is no scrollbar / wheel binding step involved, every offset write
    // path lands here.
    //
    // Primary consumer: M3 TopAppBar, which binds its scroll-tint to a
    // ScrollViewer's IsScrolled signal so the bar's container colour
    // switches from @Surface to @SurfaceContainer the moment any
    // content scrolls under it (the M3 "scrolled" container colour
    // rule). Any other control with a "this surface is now scrolled-
    // under" cue can subscribe to the same DP.
    private static readonly _IsScrolledPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        ScrollViewer, 'IsScrolled', false, MetaData.None);
    public static readonly IsScrolledKey = ScrollViewer._IsScrolledPriv;

    static {
        MuralBase.OverrideMetadata(ScrollViewer, Element.DefaultStyleKeyKey, { default_value: ScrollViewer });
    }

    // ── Template parts ──────────────────────────────────────────────
    // Populated in the constructor after the default template applies.
    // The presenter holds the SCP-side scrolling mechanics; the bars
    // are the default scrollbars (consumers can re-template to swap
    // them out — the GetTemplateChild lookup still finds the named
    // parts in any conforming template).
    private _scp:        ScrollContentPresenter | undefined;
    private _vScrollBar: ScrollBar | undefined;
    private _hScrollBar: ScrollBar | undefined;
    private _suppressOffsetSync = false;

    constructor()
    {
        super();
        // Template flows from the default Style — DefaultStyleKey on
        // this class names ScrollViewer itself, so the bundled controls
        // theme entry under that key applies via applyDefaultStyle().
        // PART_* lookups follow, fishing the SCP / scrollbars out of
        // the freshly-applied template so the rest of the ctor can wire
        // host back-refs and event listeners against real instances.
        this.applyDefaultStyle();

        this._scp        = this.GetTemplateChild('PART_ContentSite')        as ScrollContentPresenter | undefined;
        this._vScrollBar = this.GetTemplateChild('PART_VerticalScrollBar')  as ScrollBar | undefined;
        this._hScrollBar = this.GetTemplateChild('PART_HorizontalScrollBar') as ScrollBar | undefined;

        // SCP needs the back-ref so its MeasureOverride / ArrangeOverride
        // can read offsets and enable flags from here. Without it the SCP
        // degrades to a non-scrolling ContentPresenter — see its host
        // === undefined branches.
        if (this._scp !== undefined) this._scp.host = this;
        // Layout panel uses the host back-ref to defer arrange to
        // ArrangeTemplateParts (where the gutter math lives).
        const layout = this['_templateInstance']?.root;
        if (layout instanceof ScrollViewerLayout) layout.host = this;

        // Wire the default scrollbars. Each writes its Value back into
        // the matching offset DP; the OnPropertyChanged hook below
        // pushes external offset changes (wheel, programmatic) the other
        // way. _suppressOffsetSync guards the obvious feedback loop —
        // the EffectiveValueDescriptor short-circuits equal writes, but
        // the guard is explicit.
        this._vScrollBar?.AddValueChangedListener((v) => {
            if (this._suppressOffsetSync) return;
            this.VerticalOffset = v;
        });
        this._hScrollBar?.AddValueChangedListener((v) => {
            if (this._suppressOffsetSync) return;
            this.HorizontalOffset = v;
        });
        // Set Orientation on the bars (the default template emits them
        // un-oriented; the consumer's re-template can pre-set the right
        // value).
        if (this._vScrollBar !== undefined) this._vScrollBar.Orientation = Orientation.Vertical;
        if (this._hScrollBar !== undefined) this._hScrollBar.Orientation = Orientation.Horizontal;

        // Propagate IsAutoHideScrollBars down to both bars. Setting here
        // covers the initial value; the listener catches runtime toggles
        // so a consumer flipping the DP at any point still takes effect.
        const applyAutoHide = (): void => {
            const v = this.IsAutoHideScrollBars;
            if (this._vScrollBar !== undefined) this._vScrollBar.IsAutoHide = v;
            if (this._hScrollBar !== undefined) this._hScrollBar.IsAutoHide = v;
        };
        applyAutoHide();
        this.PropertyChanged(ScrollViewer.IsAutoHideScrollBarsKey).subscribe(applyAutoHide);

        // VSCode hover-to-show: while the pointer is anywhere over the scroll
        // region (IsMouseOver is true for the viewer when a descendant is
        // hovered), reveal the auto-hidden bars and keep them up; on leave they
        // fade. Value-change activity still reveals them independently.
        const forwardRegionHover = (): void => {
            const hovered = this.IsMouseOver;
            this._vScrollBar?.SetRegionActive(hovered);
            this._hScrollBar?.SetRegionActive(hovered);
        };
        this.PropertyChanged(Element.IsMouseOverKey).subscribe(forwardRegionHover);
    }

    public get IsAutoHideScrollBars(): boolean { return this.get_property_value(ScrollViewer.IsAutoHideScrollBarsKey); }
    public set IsAutoHideScrollBars(v: boolean) { this.set_property_value(ScrollViewer.IsAutoHideScrollBarsKey, v); }

    public get HorizontalOffset(): number { return this.get_property_value(ScrollViewer.HorizontalOffsetKey); }
    public set HorizontalOffset(value: number) { this.set_property_value(ScrollViewer.HorizontalOffsetKey, value); }

    public get VerticalOffset(): number { return this.get_property_value(ScrollViewer.VerticalOffsetKey); }
    public set VerticalOffset(value: number) { this.set_property_value(ScrollViewer.VerticalOffsetKey, value); }

    public get AutoScrollToEnd(): boolean { return this.get_property_value(ScrollViewer.AutoScrollToEndKey); }
    public set AutoScrollToEnd(v: boolean) { this.set_property_value(ScrollViewer.AutoScrollToEndKey, v); }

    // Sticky auto-scroll state (only read/written when AutoScrollToEnd is true).
    // _wasAtEnd starts true so the first content load lands at the bottom.
    private _lastAutoScrollExtent = 0;
    private _wasAtEnd            = true;

    public get IsScrolled(): boolean { return this.get_property_value(ScrollViewer.IsScrolledKey); }

    public get HorizontalScrollEnabled(): boolean { return this.get_property_value(ScrollViewer.HorizontalScrollEnabledKey); }
    public set HorizontalScrollEnabled(v: boolean) { this.set_property_value(ScrollViewer.HorizontalScrollEnabledKey, v); }

    public get VerticalScrollEnabled(): boolean { return this.get_property_value(ScrollViewer.VerticalScrollEnabledKey); }
    public set VerticalScrollEnabled(v: boolean) { this.set_property_value(ScrollViewer.VerticalScrollEnabledKey, v); }

    public get AutoScrollGutter(): number { return this.get_property_value(ScrollViewer.AutoScrollGutterKey); }
    public set AutoScrollGutter(v: number) { this.set_property_value(ScrollViewer.AutoScrollGutterKey, v); }

    public get AutoScrollStep(): number { return this.get_property_value(ScrollViewer.AutoScrollStepKey); }
    public set AutoScrollStep(v: number) { this.set_property_value(ScrollViewer.AutoScrollStepKey, v); }

    public get SmoothScroll(): boolean { return this.get_property_value(ScrollViewer.SmoothScrollKey); }
    public set SmoothScroll(v: boolean) { this.set_property_value(ScrollViewer.SmoothScrollKey, v); }

    public get SmoothScrollDuration(): number { return this.get_property_value(ScrollViewer.SmoothScrollDurationKey); }
    public set SmoothScrollDuration(v: number) { this.set_property_value(ScrollViewer.SmoothScrollDurationKey, v); }

    public get SmoothScrollEasing(): EasingFunction { return this.get_property_value(ScrollViewer.SmoothScrollEasingKey); }
    public set SmoothScrollEasing(v: EasingFunction) { this.set_property_value(ScrollViewer.SmoothScrollEasingKey, v); }

    // Read-through to the SCP — the presenter owns the extent / viewport
    // numbers because it's the one that runs the measure / arrange
    // mechanics. Returning 0 before a template is applied keeps callers
    // who construct a ScrollViewer in tests and inspect these getters
    // before a layout pass from crashing.
    public get ExtentWidth():    number { return this._scp?.ExtentWidth    ?? 0; }
    public get ExtentHeight():   number { return this._scp?.ExtentHeight   ?? 0; }
    public get ViewportWidth():  number { return this._scp?.ViewportWidth  ?? 0; }
    public get ViewportHeight(): number { return this._scp?.ViewportHeight ?? 0; }

    // Maximum useful offset values: any larger gets clamped at Arrange
    // time. Clamped to >= 0 so an extent smaller than the viewport
    // doesn't yield a negative scrollable area.
    public get ScrollableWidth():  number { return Math.max(0, this.ExtentWidth  - this.ViewportWidth); }
    public get ScrollableHeight(): number { return Math.max(0, this.ExtentHeight - this.ViewportHeight); }

    // Public read-only handles to the default-template parts. Useful
    // for consumers that want to wire behavior (e.g., an inner adorner)
    // against the actual content surface. Returns undefined when a
    // consumer-supplied Template doesn't include the matching PART.
    public get ContentPresenter(): ScrollContentPresenter | undefined { return this._scp; }
    public get VerticalScrollBar():   ScrollBar | undefined { return this._vScrollBar; }
    public get HorizontalScrollBar(): ScrollBar | undefined { return this._hScrollBar; }

    // Convenience scroll methods — mirror WPF's ScrollViewer surface.
    // Each just sets the offset; the clamping happens at Arrange.
    public ScrollToTop():    void { this.VerticalOffset   = 0; }
    public ScrollToBottom(): void { this.VerticalOffset   = this.ScrollableHeight; }
    public ScrollToLeft():   void { this.HorizontalOffset = 0; }
    public ScrollToRight():  void { this.HorizontalOffset = this.ScrollableWidth; }

    // Pan the viewport so `rect` (in CONTENT-LOCAL coordinates — the
    // same space the Content visual's children are arranged in) is
    // visible. If `rect` is already fully inside the current viewport,
    // nothing changes. Otherwise the offset shifts by the minimum
    // distance that brings the nearest non-visible edge into view,
    // plus a small `padding` so the rect doesn't sit flush against
    // the viewport edge.
    //
    // Used by TextBox to keep the caret rect on-screen after every
    // typed character / arrow press. Independent on each axis: a rect
    // outside vertically AND horizontally adjusts both offsets in one
    // call.
    public ScrollIntoView(rect: Rect, padding: number = 4): void
    {
        const left   = rect.X;
        const right  = rect.X + rect.Width;
        const top    = rect.Y;
        const bottom = rect.Y + rect.Height;

        const hOff = this.HorizontalOffset;
        const vOff = this.VerticalOffset;
        const vw   = this.ViewportWidth;
        const vh   = this.ViewportHeight;

        // When the rect is TALLER (or WIDER) than the viewport, the
        // "show the top edge" and "show the bottom edge" branches both
        // think they should fire — and they pull in opposite directions.
        // Caller hits this any time the rect can't fit at all (e.g. a
        // single-line TextBox whose chrome is shorter than the font's
        // line height — caret rect is `lineHeight` tall, viewport is
        // shorter, so caret-into-view oscillates the offset between 0
        // and the scrollable max on every keystroke / value step).
        //
        // Resolution: skip the "scroll toward the far edge" branch when
        // the rect doesn't fit. Showing the top / left edge is the
        // conventional default for text and is what every editor does.
        let newH = hOff;
        if (left < hOff)
        {
            newH = Math.max(0, left - padding);
        }
        else if (right > hOff + vw && rect.Width <= vw)
        {
            newH = Math.min(this.ScrollableWidth,  right + padding - vw);
        }

        let newV = vOff;
        if (top < vOff)
        {
            newV = Math.max(0, top - padding);
        }
        else if (bottom > vOff + vh && rect.Height <= vh)
        {
            newV = Math.min(this.ScrollableHeight, bottom + padding - vh);
        }

        if (newH !== hOff) this.HorizontalOffset = newH;
        if (newV !== vOff) this.VerticalOffset   = newV;
    }

    // Called by ScrollViewerLayout.ArrangeOverride. Owns the gutter math
    // (show/hide each bar based on overflow), arranges the SCP into the
    // remaining slot, then arranges each bar into its trailing-edge
    // rectangle (or to a zero-size rect when hidden). Sync'd the
    // scrollbar metrics here too — they're computed from the now-final
    // viewport size which we only know after the gutter decision.
    public ArrangeTemplateParts(finalSize: Size): Size
    {
        // Decide which bars are active for THIS arrange pass. The
        // measure step has already populated ExtentWidth/Height on the
        // SCP; per-axis-disabled scroll also forces the bar off
        // regardless of extent (consumer doesn't want that axis).
        const wantsV = this.VerticalScrollEnabled   && this.ExtentHeight > finalSize.Height;
        const wantsH = this.HorizontalScrollEnabled && this.ExtentWidth  > finalSize.Width;
        // Auto-hide bars overlay the content (macOS / Slack pattern):
        // no reserved gutter, the bar floats on top of the content's
        // trailing edge. Without this branch a single-line TextBox sized
        // to font height + padding would have its content clipped by the
        // 10-DIP gutter even though the (invisible) bar reserved that
        // space. Always-visible bars (TreeView, ListBox defaults)
        // continue to reserve gutter so content + bar don't fight for
        // pixels.
        const overlay  = this.IsAutoHideScrollBars;
        const vGutter = (wantsV && !overlay) ? SCROLLBAR_GUTTER : 0;
        const hGutter = (wantsH && !overlay) ? SCROLLBAR_GUTTER : 0;

        // Adjust the SCP slot once we know what each bar is reserving.
        const contentW = Math.max(0, finalSize.Width  - vGutter);
        const contentH = Math.max(0, finalSize.Height - hGutter);

        // Arrange the SCP into the reduced slot. SCP.ArrangeOverride
        // republishes its viewport from this finalSize and installs the
        // child's clip/translate using the host's clamped offsets (which
        // are valid now because ExtentWidth/Height are populated). On a
        // scroll-DISABLED axis the SCP also arranges its content to this
        // slot width/height (not the pre-gutter extent), so a fit-to-
        // width child ends up beside the cross-axis bar rather than
        // clipped under it — see ScrollContentPresenter.ArrangeOverride.
        this._scp?.Arrange(new Rect(0, 0, contentW, contentH));

        // Sticky auto-scroll: after the SCP arrange, ExtentHeight /
        // ScrollableHeight are current. Snap to the bottom only when the content
        // grew and the viewport was already at the end; re-arrange the SCP so the
        // offset lands this frame. Then remember whether we're at the end for the
        // next pass — a user scroll-up re-runs this with no growth and clears the
        // flag, releasing the stickiness until they scroll back down.
        if (this.AutoScrollToEnd)
        {
            const AUTO_SCROLL_EPS = 1;
            const extent = this.ExtentHeight;
            if (extent > this._lastAutoScrollExtent && this._wasAtEnd)
            {
                this.VerticalOffset = this.ScrollableHeight;
                this._scp?.Arrange(new Rect(0, 0, contentW, contentH));
            }
            this._lastAutoScrollExtent = extent;
            this._wasAtEnd = this.VerticalOffset >= this.ScrollableHeight - AUTO_SCROLL_EPS;
        }

        // Sync scrollbar DPs to the now-final viewport sizes BEFORE
        // arranging the bars so each thumb lands at the correct length /
        // offset. _suppressOffsetSync guards the ValueChanged loop —
        // we're writing scroll position into the bar, not the other
        // way around.
        this._suppressOffsetSync = true;
        if (this._vScrollBar !== undefined)
        {
            this._vScrollBar.Minimum      = 0;
            this._vScrollBar.Maximum      = this.ScrollableHeight;
            this._vScrollBar.ViewportSize = this.ViewportHeight;
            this._vScrollBar.Value        = this.effectiveVerticalOffset();
        }
        if (this._hScrollBar !== undefined)
        {
            this._hScrollBar.Minimum      = 0;
            this._hScrollBar.Maximum      = this.ScrollableWidth;
            this._hScrollBar.ViewportSize = this.ViewportWidth;
            this._hScrollBar.Value        = this.effectiveHorizontalOffset();
        }
        this._suppressOffsetSync = false;

        // Position the bars: vertical on the right edge of the viewport,
        // horizontal on the bottom. In non-overlay mode the gutter has
        // already been subtracted from contentW/contentH so the bar
        // sits just past the content's trailing edge. In overlay mode
        // (auto-hide), the bar OVERLAYS the trailing edge of the
        // content — same screen position, just no gutter was reserved.
        // A hidden bar arranges to a zero-size rect so the renderer
        // paints nothing and pointer events miss.
        const barWidth = SCROLLBAR_GUTTER;
        if (this._vScrollBar !== undefined)
        {
            if (wantsV)
            {
                const vX = overlay ? contentW - barWidth : contentW;
                this._vScrollBar.Arrange(new Rect(vX, 0, barWidth, contentH));
            }
            else
            {
                this._vScrollBar.Arrange(new Rect(0, 0, 0, 0));
            }
        }
        if (this._hScrollBar !== undefined)
        {
            if (wantsH)
            {
                const hY = overlay ? contentH - barWidth : contentH;
                this._hScrollBar.Arrange(new Rect(0, hY, contentW, barWidth));
            }
            else
            {
                this._hScrollBar.Arrange(new Rect(0, 0, 0, 0));
            }
        }

        return finalSize;
    }

    // Mouse / trackpad scrolling. Default WPF behaviour: the wheel
    // adjusts VerticalOffset (Shift+wheel routes to HorizontalOffset,
    // matching most browsers). DeltaMode scales pixel-mode events
    // directly, line-mode through a 16 DIP heuristic, and page-mode
    // through the viewport height.
    //
    // The event is marked Handled only when the offset actually moves
    // — at the top/bottom edge the wheel falls through to an outer
    // ScrollViewer (if any), matching browser nested-scroll semantics.
    protected override OnPointerWheel(args: WheelEventArgs): void
    {
        const scale = args.DeltaMode === WheelDeltaMode.Line ? 16
                    : args.DeltaMode === WheelDeltaMode.Page ? this.ViewportHeight
                    : 1;
        const dy = args.DeltaY * scale;
        const dx = args.DeltaX * scale;

        const horizontal = hasModifier(args.Modifiers, ModifierKeys.Shift) && dy !== 0 && dx === 0;
        if (horizontal)
        {
            const nextX = clamp(this.HorizontalOffset + dy, 0, this.ScrollableWidth);
            if (nextX !== this.HorizontalOffset)
            {
                this.HorizontalOffset = nextX;
                args.Handled = true;
            }
            return;
        }

        if (dy !== 0)
        {
            const nextY = clamp(this.VerticalOffset + dy, 0, this.ScrollableHeight);
            if (nextY !== this.VerticalOffset)
            {
                this.VerticalOffset = nextY;
                args.Handled = true;
            }
        }
        if (dx !== 0)
        {
            const nextX = clamp(this.HorizontalOffset + dx, 0, this.ScrollableWidth);
            if (nextX !== this.HorizontalOffset)
            {
                this.HorizontalOffset = nextX;
                args.Handled = true;
            }
        }
    }

    // Clamped offsets for the SCP / scrollbar metrics. Public reads
    // (`HorizontalOffset` / `VerticalOffset`) still return the raw user-
    // written value so binding sources see what they wrote. SCP reads
    // these by name — kept on the prototype rather than private fields
    // so bracket access from the presenter resolves.
    public effectiveHorizontalOffset(): number
    {
        return Math.max(0, Math.min(this.HorizontalOffset, this.ScrollableWidth));
    }

    public effectiveVerticalOffset(): number
    {
        return Math.max(0, Math.min(this.VerticalOffset, this.ScrollableHeight));
    }

    // ── Auto-scroll near edges during drag (8.4) ───────────────────────
    //
    // While a drag session is hovering inside this ScrollViewer's
    // viewport, a cursor within `AutoScrollGutter` px of any edge
    // schedules a recurring nudge of the offset toward that edge. This
    // mirrors the Visio / Figma / drawio UX where dragging an item
    // near the boundary pulls the canvas along.
    //
    // Lifecycle: the OnPreviewDragEnter handler attaches an OnMove
    // listener on the drag session the first time a drag involves this
    // ScrollViewer's subtree. The listener computes the cursor's
    // host-relative position vs. this ScrollViewer's host rect and
    // starts / cancels the auto-scroll timer accordingly. Session
    // completion (resolve via the PromiseLike interface) tears
    // everything down.
    private _autoScrollSession: DragSession | undefined;
    private _autoScrollOnMoveUnsub: (() => void) | undefined;
    private _autoScrollTimer: ReturnType<typeof setInterval> | undefined;
    private _autoScrollVelocity: { x: number; y: number } = { x: 0, y: 0 };

    protected override OnPreviewDragEnter(args: DragEventArgs): void
    {
        if (this.AutoScrollGutter <= 0) return;
        const session = args.Session;
        if (session === undefined) return;       // synthesized event with no session
        if (this._autoScrollSession === session) return;
        this._tearDownAutoScroll();

        this._autoScrollSession = session;
        this._autoScrollOnMoveUnsub = session.OnMove(
            // DragSession path: stop scrolling when the cursor moves off
            // this ScrollViewer's viewport — a session can span multiple
            // SVs and only the SV under the cursor should drive the
            // auto-scroll.
            (hostX: number, hostY: number) => this._evaluateAutoScroll(hostX, hostY, /* stopOutside */ true),
        );
        // Auto-clean on drag end (resolve / cancel).
        session.then(() => this._tearDownAutoScroll());
    }

    private _evaluateAutoScroll(hostX: number, hostY: number, stopOutside: boolean): void
    {
        // Translate host coords to viewport-local. The viewport's
        // origin in host space is the sum of ArrangedRect.X/Y up the
        // parent chain.
        let ox = 0;
        let oy = 0;
        let cur: Visual | undefined = this;
        while (cur !== undefined)
        {
            ox += cur.ArrangedRect.X;
            oy += cur.ArrangedRect.Y;
            cur = cur.GetVisualParent();
        }
        const lx = hostX - ox;
        const ly = hostY - oy;
        const vw = this.ViewportWidth;
        const vh = this.ViewportHeight;

        // `stopOutside` is the DragSession path's contract — a multi-SV
        // session expects auto-scroll on this SV to stop the moment the
        // cursor moves onto a different SV. Non-session callers (a node
        // drag, a marquee) want the opposite: keep scrolling even when
        // the cursor wanders far past the viewport edge, because the
        // user's clearly asking for more content in that direction. In
        // the loose mode (stopOutside=false), a cursor past an edge is
        // treated the same as a cursor right at the edge — the velocity
        // direction is set, the timer keeps ticking.
        if (stopOutside && (lx < 0 || ly < 0 || lx > vw || ly > vh))
        {
            this._stopAutoScrollTick();
            return;
        }

        const gutter = this.AutoScrollGutter;
        let dx = 0;
        let dy = 0;
        // `lx < gutter` covers both "near left edge" (0 ≤ lx < gutter)
        // AND "past left edge" (lx < 0). Same for the right / top /
        // bottom comparisons — `lx > vw - gutter` includes `lx > vw`.
        if (lx < gutter      && this.HorizontalScrollEnabled) dx = -1;
        else if (lx > vw - gutter && this.HorizontalScrollEnabled) dx =  1;
        if (ly < gutter      && this.VerticalScrollEnabled)   dy = -1;
        else if (ly > vh - gutter && this.VerticalScrollEnabled) dy =  1;

        if (dx === 0 && dy === 0)
        {
            this._stopAutoScrollTick();
            return;
        }
        this._autoScrollVelocity = { x: dx, y: dy };
        this._startAutoScrollTick();
    }

    private _startAutoScrollTick(): void
    {
        if (this._autoScrollTimer !== undefined) return;
        const tick = (): void =>
        {
            const step = this.AutoScrollStep;
            const { x, y } = this._autoScrollVelocity;
            if (x !== 0)
            {
                const nextX = clamp(this.HorizontalOffset + x * step, 0, this.ScrollableWidth);
                if (nextX !== this.HorizontalOffset) this.HorizontalOffset = nextX;
            }
            if (y !== 0)
            {
                const nextY = clamp(this.VerticalOffset + y * step, 0, this.ScrollableHeight);
                if (nextY !== this.VerticalOffset) this.VerticalOffset = nextY;
            }
        };
        // First tick now so the offset starts moving immediately,
        // not after a 32ms delay.
        tick();
        this._autoScrollTimer = setInterval(tick, 32);
    }

    private _stopAutoScrollTick(): void
    {
        if (this._autoScrollTimer !== undefined)
        {
            clearInterval(this._autoScrollTimer);
            this._autoScrollTimer = undefined;
        }
    }

    private _tearDownAutoScroll(): void
    {
        this._stopAutoScrollTick();
        this._autoScrollOnMoveUnsub?.();
        this._autoScrollOnMoveUnsub = undefined;
        this._autoScrollSession = undefined;
    }

    // Public edge-autoscroll entry for non-drag gestures (§ 10.7
    // marquee autoscroll today; future band-select / lasso shapes can
    // ride the same hook). Wraps the drag-driven `_evaluateAutoScroll`
    // gutter math without requiring a DragSession — callers just feed
    // the latest host-relative pointer position. Idempotent: repeated
    // calls with the same cursor position re-evaluate cheaply and only
    // toggle the timer on/off when the velocity actually changes.
    //
    // `stopOutside=false` — non-session gestures (node drag, marquee)
    // keep scrolling even when the cursor wanders far past the viewport
    // edge. The DragSession path uses the strict mode internally; this
    // public API never needs it because the caller owns Start / Stop
    // explicitly.
    public EvaluateEdgeAutoScroll(hostX: number, hostY: number): void
    {
        this._evaluateAutoScroll(hostX, hostY, /* stopOutside */ false);
    }

    /** Stop any auto-scroll started by EvaluateEdgeAutoScroll. Safe to
     *  call when no auto-scroll is active. Call this when the gesture
     *  driving the auto-scroll ends (PointerUp on a marquee, etc.). */
    public StopEdgeAutoScroll(): void
    {
        this._stopAutoScrollTick();
        this._autoScrollVelocity = { x: 0, y: 0 };
    }

    // OnPropertyChanged hook: an offset DP changing must invalidate the
    // SCP's measure AND arrange — MetaData.Measure|Arrange on the
    // offset DPs flags those on the ScrollViewer itself, but the
    // template root's iterative re-walk only re-asks SCP for measure /
    // arrange if SCP's own cache flags are stale. SCP reads offsets in
    // both phases (push into IScrollInfo.Viewport during Measure,
    // translate during Arrange), so we have to push both.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'HorizontalOffset' || descriptor.Name === 'VerticalOffset'
         || descriptor.Name === 'HorizontalScrollEnabled' || descriptor.Name === 'VerticalScrollEnabled')
        {
            // SCP reads these in its own MeasureOverride / ArrangeOverride
            // — without nudging its caches the template-root re-walk will
            // short-circuit and the new ScrollEnabled / offset never
            // reaches the slotted content.
            this._scp?.InvalidateMeasure();
            this._scp?.InvalidateArrange();
        }
        if (descriptor.Name === 'HorizontalOffset' || descriptor.Name === 'VerticalOffset')
        {
            // IsScrolled is a derived read-only DP: true when EITHER
            // offset is non-zero. We push the new value through
            // `set_property_value_with_key` (the read-only DP's privileged
            // setter) so any subscriber — Style triggers, TopAppBar's
            // scroll-tint listener — sees the flip immediately.
            const next = this.HorizontalOffset !== 0 || this.VerticalOffset !== 0;
            if (next !== this.IsScrolled)
            {
                this.set_property_value_with_key(ScrollViewer._IsScrolledPriv, next);
            }
        }
        // SmoothScroll-related DP changes → re-sync the installed
        // PropertyTransitions. Each kind of change has the same fix
        // (rebuild the matching transitions); the OR-set keeps this
        // simple.
        if (descriptor.Owner === ScrollViewer
            && (descriptor.Name === 'SmoothScroll'
             || descriptor.Name === 'SmoothScrollDuration'
             || descriptor.Name === 'SmoothScrollEasing'))
        {
            this.syncSmoothScrollTransitions();
        }
    }

    // Install or remove the implicit PropertyTransitions on the two
    // offset DPs to match the current SmoothScroll / Duration / Easing
    // state. Idempotent — calling repeatedly with the same state is a
    // no-op. The marker on each transition (_smoothScrollManaged) lets
    // us identify the ones we own so a re-sync clears our own without
    // disturbing transitions a consumer may have added themselves.
    private syncSmoothScrollTransitions(): void
    {
        // Avoid materialising an empty Transitions collection just to
        // disable smooth-scroll — the public Transitions getter lazy-
        // allocates on first access (see Visual.Transitions). If
        // SmoothScroll is off AND no Transitions collection exists yet,
        // there's nothing to clean up and nothing to install.
        if (!this.SmoothScroll
            && this.get_property_value(Visual.TransitionsKey) === undefined)
        {
            return;
        }

        const list = this.EnsureTransitions();
        // Drop any previously-managed entries before re-installing —
        // covers the disable path AND the duration / easing changes.
        for (let i = list.Count - 1; i >= 0; i--)
        {
            const t = list.Get(i);
            if (t !== undefined && (t as { _smoothScrollManaged?: boolean })._smoothScrollManaged === true)
            {
                list.RemoveAt(i);
            }
        }
        if (!this.SmoothScroll) return;

        const tH = new PropertyTransition();
        tH.Property = 'HorizontalOffset';
        tH.Duration = this.SmoothScrollDuration;
        tH.Easing   = this.SmoothScrollEasing;
        (tH as { _smoothScrollManaged?: boolean })._smoothScrollManaged = true;
        list.Add(tH);

        const tV = new PropertyTransition();
        tV.Property = 'VerticalOffset';
        tV.Duration = this.SmoothScrollDuration;
        tV.Easing   = this.SmoothScrollEasing;
        (tV as { _smoothScrollManaged?: boolean })._smoothScrollManaged = true;
        list.Add(tV);
    }
}

function clamp(value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
