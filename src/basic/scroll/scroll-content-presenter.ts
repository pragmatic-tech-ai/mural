import {
    AdornerLayer,
    Rect,
    Size,
    Visual,
    isScrollInfo,
    type IScrollInfo,
} from '../../runtime/index.js';
import { RectangleGeometry } from '../../visual-engine/index.js';
import { ContentPresenter } from '../templates/content-presenter.js';
import { ItemsControl } from '../../framework/base/items-control.js';
import { ItemsPresenter } from '../templates/items-presenter.js';
import type { ScrollViewer } from '../../framework/surfaces/scroll-viewer.js';
import { VirtualizingPanel } from '../panels/virtualisation/virtualizing-panel.js';

// Reserved cross-axis space for an active scrollbar. Must match the value
// ScrollViewer.ArrangeTemplateParts reserves (its own SCROLLBAR_GUTTER) and
// the ScrollBar control's SCROLLBAR_THICKNESS — kept locally here, as both of
// those are, to avoid an import cycle. Measure subtracts the same lane arrange
// will, so width-sensitive content measures at the width it is arranged into.
const SCROLLBAR_GUTTER = 10;

// The presentation surface a ScrollViewer's default template wraps its
// consumer Content in — WPF parity with ScrollContentPresenter. Lives
// inside the ScrollViewer's ControlTemplate as PART_ContentSite and is
// auto-discovered by ControlTemplate.Apply's first-ContentPresenter walk,
// so the consumer's Content lands here without explicit wiring on the
// ScrollViewer side.
//
// Two scrolling modes (same shape the ScrollViewer used to implement
// inline before the split):
//
//   * Delegate mode — slotted child implements IScrollInfo
//     (today: VirtualizingStackPanel). The presenter drives its
//     Viewport (offset + size) from the host ScrollViewer's offset DPs
//     and reads ExtentWidth / ExtentHeight back. No clip / translate is
//     installed — the panel only emits items intersecting the viewport.
//
//   * Clip-and-translate mode — anything else. The presenter measures
//     the child with +Infinity on each scroll-enabled axis (so it
//     reports its natural extent), arranges it offset by
//     (-HorizontalOffset, -VerticalOffset), and installs a
//     RectangleGeometry clip on the child in its OWN local coordinate
//     space so the off-viewport portion stays invisible.
//
// In both modes the presenter exposes ExtentWidth / ExtentHeight (full
// content size) and ViewportWidth / ViewportHeight (visible area) as
// plain getters. The host ScrollViewer reads these to publish the
// matching DPs on its public surface.
//
// `host` is the back-pointer to the owning ScrollViewer, written by
// ScrollViewer after Apply (same pattern ScrollBar/ScrollBarLayout use).
// When `host` is undefined (a presenter constructed standalone, in tests
// or for diagnostic markup), the presenter degrades to a non-scrolling
// ContentPresenter — Extent matches Viewport, no clip, no translate.
export class ScrollContentPresenter extends ContentPresenter
{
    // Set by ScrollViewer's constructor immediately after fishing the
    // presenter out of the template via GetTemplateChild. The presenter
    // reads `host.HorizontalOffset`/`VerticalOffset`/`HorizontalScrollEnabled`/
    // etc. each layout pass — without the back-pointer it can't know
    // which axis to feed +Infinity to during measure.
    public host: ScrollViewer | undefined;

    // Populated by MeasureOverride; read by the host's public Extent /
    // Viewport getters and by ArrangeOverride for the clip rect.
    private _extentWidth:    number = 0;
    private _extentHeight:   number = 0;
    private _viewportWidth:  number = 0;
    private _viewportHeight: number = 0;

    // Inner AdornerLayer painted ON TOP of the consumer's content,
    // sharing the SCP's scroll arrangement so adorners track their
    // adorned elements as the viewport moves. WPF parity — WPF's
    // ScrollContentPresenter carries an internal AdornerLayer for the
    // same reason. Discovered via AdornerLayer.GetAdornerLayer's
    // duck-typing walk (`cur.AdornerLayer instanceof AdornerLayer`).
    //
    // We deliberately DON'T host the consumer content via an internal
    // AdornerDecorator: AdornerDecorator's Child slot does logical-
    // tree attach, but ContentControl already owns the consumer
    // content logically. Bypassing that with a sibling-layer setup
    // keeps the logical tree clean while still giving adorners the
    // scrolled frame.
    private readonly _adornerLayer: AdornerLayer = new AdornerLayer();

    constructor()
    {
        super();
        this.AttachVisual(this._adornerLayer);
    }

    public get AdornerLayer(): AdornerLayer { return this._adornerLayer; }

    // Append the inner AdornerLayer as a sibling of the content (after
    // it in z-order so adorners paint above). ContentPresenter's base
    // surface returns [_content]; we extend that with our layer so the
    // renderer walks both.
    public override get visualChildren(): readonly Visual[]
    {
        const base = super.visualChildren;
        return base.length === 0
            ? [this._adornerLayer]
            : [...base, this._adornerLayer];
    }

    public get ExtentWidth():    number { return this._extentWidth; }
    public get ExtentHeight():   number { return this._extentHeight; }
    public get ViewportWidth():  number { return this._viewportWidth; }
    public get ViewportHeight(): number { return this._viewportHeight; }

    protected override MeasureOverride(availableSize: Size): Size
    {
        // Viewport size = the slot our parent (the template's layout
        // panel) gave us. Always set so a pre-measure read returns
        // sensible defaults even when there's no content yet.
        this._viewportWidth  = availableSize.Width;
        this._viewportHeight = availableSize.Height;

        // ContentPresenter.visualChildren returns [_content] when set;
        // SCP's override appends the layer. Pull the consumer's content
        // off the base getter so the index doesn't collide with the
        // layer-attached case.
        const content = super.visualChildren[0];
        if (content === undefined)
        {
            this._extentWidth  = 0;
            this._extentHeight = 0;
            return Size.Zero;
        }

        const host = this.host;
        const scrollInfo = resolveScrollInfo(content);
        if (scrollInfo !== undefined)
        {
            // Delegate mode. Push the host's effective offset + the
            // viewport SIZE into any VirtualizingPanel before measuring
            // so its MeasureOverride sees the right viewport rect for
            // realization math. Both VirtualizingStackPanel and
            // VirtualizingWrapPanel store their viewport in the base-
            // class DP — the cast guards against future IScrollInfo
            // implementers that aren't VirtualizingPanels (e.g. a
            // hypothetical hand-written scroller).
            //
            // Read extent BEFORE measure so ScrollableWidth/Height
            // (= Extent - Viewport) is right when the host queries it
            // to compute effective offsets. Contract: IScrollInfo
            // implementations must compute Extent without requiring a
            // prior Measure — VSP/VWP do so from itemCount × cellSize.
            this._extentWidth  = scrollInfo.ExtentWidth;
            this._extentHeight = scrollInfo.ExtentHeight;

            if (scrollInfo instanceof VirtualizingPanel)
            {
                const offX = host !== undefined ? host['effectiveHorizontalOffset']() : 0;
                const offY = host !== undefined ? host['effectiveVerticalOffset']()   : 0;
                scrollInfo.Viewport = new Rect(
                    offX,
                    offY,
                    availableSize.Width,
                    availableSize.Height,
                );
            }
            content.Measure(availableSize);
            // Re-read extent in case the measure pass mutated it
            // (VirtualizingWrapPanel's ExtentWidth depends on the
            // columns the measure pass computed against the viewport).
            this._extentWidth  = scrollInfo.ExtentWidth;
            this._extentHeight = scrollInfo.ExtentHeight;
        }
        else
        {
            // Clip-and-translate mode. Measure with no upper bound on
            // axes the host enables for scrolling — content reports its
            // natural extent. On a host-disabled axis (TextBox in Wrap
            // mode opts out of horizontal scroll so the editor wraps to
            // width), pass the BOUNDED viewport size on that axis so
            // the child sees its real budget and shapes its content to
            // fit.
            const hEnabled = host?.HorizontalScrollEnabled ?? true;
            const vEnabled = host?.VerticalScrollEnabled   ?? true;
            const measureW = hEnabled ? Number.POSITIVE_INFINITY : availableSize.Width;
            const measureH = vEnabled ? Number.POSITIVE_INFINITY : availableSize.Height;
            content.Measure(new Size(measureW, measureH));
            this._extentWidth  = content.DesiredSize.Width;
            this._extentHeight = content.DesiredSize.Height;

            // Arrange (ScrollViewer.ArrangeTemplateParts) reserves a
            // SCROLLBAR_GUTTER lane for each active bar and shrinks the
            // content slot by it. On a scroll-DISABLED axis the content
            // FILLS that slot (it was measured at the bounded size above),
            // so a cross-axis bar steals from the size it will arrange into.
            // Width-sensitive content (a WrapPanel, a wrapping TextBlock)
            // measured at the full bounded size reports a height for that
            // width, then reflows TALLER when arranged into the gutter-
            // reduced slot — overflowing its own DesiredSize and painting
            // over whatever is stacked below (a toolbox accordion's next
            // section). Re-measure the disabled axis at the gutter-reduced
            // size so the reported extent matches the arrange. The viewport
            // bookkeeping above is left untouched — only the content's
            // measured extent changes. An ENABLED axis was measured at
            // Infinity (it overflows and scrolls; the gutter doesn't change
            // its reflow), so it is never re-measured here.
            const wantsVBar = vEnabled && this._extentHeight > availableSize.Height;
            const wantsHBar = hEnabled && this._extentWidth  > availableSize.Width;
            const reduceW = !hEnabled && wantsVBar;
            const reduceH = !vEnabled && wantsHBar;
            if (reduceW || reduceH)
            {
                content.Measure(new Size(
                    reduceW ? Math.max(0, availableSize.Width  - SCROLLBAR_GUTTER) : measureW,
                    reduceH ? Math.max(0, availableSize.Height - SCROLLBAR_GUTTER) : measureH,
                ));
                this._extentWidth  = content.DesiredSize.Width;
                this._extentHeight = content.DesiredSize.Height;
            }
        }

        // Inner AdornerLayer shares the scrolled frame with the
        // content — measure it against the content's rendered size so
        // adorners inside size against the same slot as the items
        // they decorate.
        this._adornerLayer.Measure(content.DesiredSize);

        // DesiredSize: fit-in-parent, never larger than extent. Same
        // shape the old ScrollViewer.MeasureOverride returned — returning
        // availableSize verbatim would propagate Infinity up the tree any
        // time we sit in an unbounded axis (vertical StackPanel hosting
        // a TreeView's default ScrollViewer template).
        return new Size(
            Math.min(availableSize.Width,  this._extentWidth),
            Math.min(availableSize.Height, this._extentHeight),
        );
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        // Re-publish viewport from the final slot we were arranged in
        // (the host's layout panel reduces this by the scrollbar gutter
        // when bars are non-overlay). Public ViewportWidth /
        // ViewportHeight now reflect the painted viewport.
        this._viewportWidth  = finalSize.Width;
        this._viewportHeight = finalSize.Height;

        // ContentPresenter.visualChildren returns [_content] when set;
        // SCP's override appends the layer. Pull the consumer's content
        // off the base getter so the index doesn't collide with the
        // layer-attached case.
        const content = super.visualChildren[0];
        if (content === undefined) return finalSize;

        const host = this.host;
        const scrollInfo = resolveScrollInfo(content);
        let contentRect: Rect;
        let adornerClipRect: Rect;
        if (scrollInfo !== undefined)
        {
            // Delegate mode: the panel only realizes containers whose
            // cells intersect the viewport. But intersecting cells
            // CAN extend past the viewport edges by a partial cell —
            // the topmost realized row, when the viewport offset
            // isn't a multiple of cell height, has a negative panel-
            // local Y; the last realized row, when the viewport's
            // bottom isn't on a cell boundary, runs past the panel's
            // arranged height. Without a clip those edges leak into
            // sibling panels above / below this SCP. Clip to the
            // arranged viewport rect (in the content's own local
            // space, which starts at (0, 0) here since we arrange the
            // content at (0, 0)).
            contentRect     = new Rect(0, 0, finalSize.Width, finalSize.Height);
            adornerClipRect = contentRect;
            content.Arrange(contentRect);
            content.Clip = new RectangleGeometry(contentRect);
        }
        else
        {
            // Clip-and-translate. Place the full-extent content at
            // negative offset so the visible portion lands at (0, 0);
            // clip the content in its own local space so only the
            // viewport-sized window paints. (offsetX, offsetY) is the
            // local rect's top-left because the content's outer carries
            // a translate of -(offset).
            const offX = host !== undefined ? host['effectiveHorizontalOffset']() : 0;
            const offY = host !== undefined ? host['effectiveVerticalOffset']()   : 0;
            // On a scroll-DISABLED axis the content is meant to FILL the
            // viewport, not overflow it — so arrange it to the (already
            // gutter-reduced) finalSize on that axis rather than to the
            // extent measured against the pre-gutter slot. Without this,
            // a fit-to-width child stays shaped one scrollbar-gutter too
            // wide and its trailing strip is clipped UNDER the cross-axis
            // bar, which reads as the bar overlapping the content. The
            // self-scrolling axis keeps the full extent (it's supposed to
            // overflow and scroll). offX/offY are already 0 on a disabled
            // axis (nothing to scroll), so the translate is unaffected.
            const hEnabled = host?.HorizontalScrollEnabled ?? true;
            const vEnabled = host?.VerticalScrollEnabled   ?? true;
            const contentW = hEnabled ? this._extentWidth  : finalSize.Width;
            const contentH = vEnabled ? this._extentHeight : finalSize.Height;
            contentRect     = new Rect(-offX, -offY, contentW, contentH);
            adornerClipRect = new Rect(offX, offY, finalSize.Width, finalSize.Height);
            content.Arrange(contentRect);
            content.Clip = new RectangleGeometry(adornerClipRect);
        }
        // Arrange the AdornerLayer at the same rect as the content so
        // adorners inside share its scroll-translate frame — host-coord
        // ancestor walks from any adorned element under the SCP land at
        // the same point whether they go through the content tree or
        // through the adorner-layer tree.
        //
        // Clip the AdornerLayer to the SAME viewport rect as the content.
        // Without this clip, adorners (e.g. selection-resize handles on
        // a shape near the canvas top edge) extend OUTSIDE the viewport
        // into surrounding chrome (the toolbar above the SCP, sibling
        // panels left / right of it). Their hit-pads stay live there —
        // a tiny handle landing on the bottom edge of a sibling toolbar
        // intercepts clicks meant for buttons in that toolbar.
        this._adornerLayer.Arrange(contentRect);
        this._adornerLayer.Clip = new RectangleGeometry(adornerClipRect);
        return finalSize;
    }
}

// Resolve the IScrollInfo provider the SCP delegates to. Three shapes
// auto-delegate:
//
//   1. Direct hit — `content` itself implements IScrollInfo (a Panel
//      set as ScrollViewer.Content directly).
//   2. ItemsControl wrapping — `content` is an ItemsControl whose
//      ItemsPanel implements IScrollInfo (e.g. a plain ItemsControl
//      with ItemsPanel=VirtualizingStackPanel inside a ScrollViewer
//      authored in markup). The panel becomes the provider.
//   3. ItemsPresenter wrapping — `content` is an ItemsPresenter whose
//      panel implements IScrollInfo. This is the case when a control's
//      DEFAULT TEMPLATE wraps an ItemsPresenter in a ScrollViewer
//      (ListBox / TreeView / ComboBox today). The SCP lives inside
//      THAT inner ScrollViewer's template; its direct content is the
//      ItemsPresenter the template slotted in. Walk through to the
//      panel.
//
// The traversal stops at one level — deeper hierarchies (ItemsControl
// hosting another ItemsControl) aren't a shape any current control
// hits.
function resolveScrollInfo(content: Visual): IScrollInfo | undefined
{
    if (isScrollInfo(content)) return content;
    if (content instanceof ItemsControl)
    {
        const panel = content.ItemsPanelInstance;
        if (panel !== undefined && isScrollInfo(panel)) return panel;
    }
    if (content instanceof ItemsPresenter)
    {
        const panel = content.ItemsPanelInstance;
        if (panel !== undefined && isScrollInfo(panel)) return panel;
    }
    return undefined;
}
