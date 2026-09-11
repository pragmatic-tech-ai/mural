import {
    MetaData,
    MuralBase,
    Rect,
    Size,
    Visual,
    type IScrollInfo,
} from '../../../runtime/index.js';
import { Orientation } from '../orientation.js';
import { VirtualizingPanel, isNestedViewportHost } from './virtualizing-panel.js';

// Stack panel that realizes containers only for items intersecting the
// Viewport rect. Items are assumed to have uniform extent along the
// primary axis (ItemHeight when Orientation=Vertical, ItemWidth when
// Orientation=Horizontal) — the simplification that makes the
// realization math O(1) per measure pass.
//
// Orientation:
//   * Vertical (default) — items stack top-to-bottom, scroll vertically.
//   * Horizontal         — items stack left-to-right, scroll horizontally.
//
// Sizing:
//   * Primary axis     — total extent = Σ per-item size, where a realized
//                        (measured) item contributes its cached size and an
//                        un-measured item the ItemHeight/ItemWidth estimate
//                        (totalPrimaryExtent). This is what both the panel's
//                        DesiredSize AND its IScrollInfo Extent report, so an
//                        expanded child (a tall realized row) grows the scroll
//                        extent and the host ScrollViewer's scrollbar with it.
//   * Cross axis       — taken from availableSize (filled). Containers
//                        measure against the available cross-axis size.
//
// Realization protocol:
//   * MeasureOverride computes first / last item indices intersecting
//     the viewport along the primary axis, recycles realized
//     containers outside that range, and realizes (via
//     ItemsControl.Generator) any in-range item not already realized.
//   * ArrangeOverride positions each realized container along the
//     primary axis based on its index × per-item size.
//
// Realized containers also become logical children of the
// ItemsControl (via AttachContainer), so DataContext / inheritable
// properties on the ItemsControl flow through to them — same
// invariant as non-virtualizing ItemsControl.
//
// What's not in this cut: variable item sizes (would need a per-item
// size cache and a coarser viewport calculation), explicit scroll
// viewport (consumers set Viewport manually).
export class VirtualizingStackPanel extends VirtualizingPanel implements IScrollInfo
{
    // Viewport DP lives on VirtualizingPanel base — see virtualizing-panel.ts.
    public static readonly ItemHeightKey  = MuralBase.RegisterProperty<number>(     VirtualizingStackPanel, 'ItemHeight',  20,                   MetaData.Measure);
    public static readonly ItemWidthKey   = MuralBase.RegisterProperty<number>(     VirtualizingStackPanel, 'ItemWidth',   20,                   MetaData.Measure);
    public static readonly OrientationKey = MuralBase.RegisterProperty<Orientation>(VirtualizingStackPanel, 'Orientation', Orientation.Vertical, MetaData.Measure);

    // Sparse map from item index → realized container Visual.
    private realized: Map<number, Visual> = new Map();
    // Measured primary-axis size per item index. Populated after a
    // container measures during MeasureOverride; un-measured items
    // fall back to the ItemHeight / ItemWidth estimate. The map is
    // sparse — only realized items populate; further items use the
    // estimate during viewport math.
    private sizeCache: Map<number, number> = new Map();
    // Max cross-axis desired size across realized containers, captured
    // during the latest MeasureOverride. Surfaced through
    // ExtentWidth/Height on the non-scrolling axis so a ScrollViewer
    // sizing itself to its content's cross-axis (no explicit Width on
    // the host) collapses to its tile width instead of stretching to
    // fill the parent slot.
    private measuredCross: number = 0;

    // ── Nested (per-level) virtualization state ─────────────────────────
    // A NESTED panel (an expanded TreeViewItem's child panel) shares the
    // outer ScrollViewer's viewport rather than owning it. `_originOffset` is
    // this panel's item[0] absolute position in the shared scroll-extent
    // space; the viewport hit-test subtracts it so the panel realizes the
    // children whose ABSOLUTE band meets the shared window. `_nested` also
    // suppresses the scroll translation in ArrangeOverride — the root panel
    // (plus ScrollViewer) already applied it, so a nested panel arranges its
    // children at true local offsets. `_collapsed` short-circuits a
    // collapsed TreeViewItem: measure to zero, realize nothing.
    private _originOffset = 0;
    private _nested = false;
    private _collapsed = false;

    public get OriginOffset(): number { return this._originOffset; }
    public get IsCollapsed(): boolean { return this._collapsed; }

    // Called by an INestedViewportHost (TreeViewItem) to configure this panel
    // as a nested level sharing the outer viewport. Idempotent; invalidates
    // measure only when something actually changed.
    public SetNestedViewport(originOffset: number, viewport: Rect): void
    {
        let dirty = !this._nested;
        this._nested = true;
        if (this._originOffset !== originOffset) { this._originOffset = originOffset; dirty = true; }
        if (!this.Viewport.Equals(viewport)) { this.Viewport = viewport; dirty = true; }  // Viewport DP is Measure-dirty on its own
        if (dirty) this.InvalidateMeasure();
    }

    // Collapse gate — set by a TreeViewItem from its IsExpanded state. A
    // collapsed panel recycles its realized containers and measures to zero.
    public SetCollapsed(collapsed: boolean): void
    {
        if (this._collapsed === collapsed) return;
        this._collapsed = collapsed;
        if (collapsed) this.RecycleAll();
        this.InvalidateMeasure();
    }

    public get ItemHeight(): number { return this.get_property_value(VirtualizingStackPanel.ItemHeightKey); }
    public set ItemHeight(v: number) { this.set_property_value(VirtualizingStackPanel.ItemHeightKey, v); }

    public get ItemWidth(): number { return this.get_property_value(VirtualizingStackPanel.ItemWidthKey); }
    public set ItemWidth(v: number) { this.set_property_value(VirtualizingStackPanel.ItemWidthKey, v); }

    public get Orientation(): Orientation { return this.get_property_value(VirtualizingStackPanel.OrientationKey); }
    public set Orientation(v: Orientation) { this.set_property_value(VirtualizingStackPanel.OrientationKey, v); }

    private get isHorizontal(): boolean { return this.Orientation === Orientation.Horizontal; }
    // Per-item extent along the primary (scrolling) axis.
    private get itemExtent(): number
    {
        return this.isHorizontal ? this.ItemWidth : this.ItemHeight;
    }

    // Read-only view of currently-realized item indices — useful for
    // tests and tooling that need to know what's "live."
    public get RealizedIndices(): readonly number[]
    {
        return [...this.realized.keys()].sort((a, b) => a - b);
    }

    // ----- IScrollInfo -----
    // ScrollViewer talks through these when this panel is its
    // (eventual) Content's IScrollInfo provider. Extent reflects the
    // total content size; viewport mirrors the Viewport rect (set
    // either by the consumer directly or by ScrollViewer via the
    // SetHorizontal/VerticalOffset hooks).

    public get ExtentWidth(): number
    {
        return this.isHorizontal
            ? this.totalPrimaryExtent(this.itemCount())
            : this.measuredCross;
    }

    public get ExtentHeight(): number
    {
        return this.isHorizontal
            ? this.measuredCross
            : this.totalPrimaryExtent(this.itemCount());
    }

    public get ViewportWidth(): number  { return this.Viewport.Width; }
    public get ViewportHeight(): number { return this.Viewport.Height; }

    public get HorizontalOffset(): number { return this.Viewport.X; }
    public get VerticalOffset(): number   { return this.Viewport.Y; }

    public SetHorizontalOffset(value: number): void
    {
        const vp = this.Viewport;
        if (vp.X === value) return;
        this.Viewport = new Rect(value, vp.Y, vp.Width, vp.Height);
    }

    public SetVerticalOffset(value: number): void
    {
        const vp = this.Viewport;
        if (vp.Y === value) return;
        this.Viewport = new Rect(vp.X, value, vp.Width, vp.Height);
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        const owner = this.itemsOwner;
        if (owner === undefined) return Size.Zero;
        // Collapsed nested panel (an unexpanded TreeViewItem): realize nothing,
        // occupy no space. RecycleAll already ran in SetCollapsed; guard here
        // covers a collapse set before the panel had an owner.
        if (this._collapsed) { this.RecycleAll(); return Size.Zero; }
        const count = this.itemCount();
        const horizontal = this.isHorizontal;
        const vp  = this.Viewport;

        if (count === 0)
        {
            return horizontal
                ? new Size(0, availableSize.Height)
                : new Size(availableSize.Width, 0);
        }

        // Variable-size viewport hit-test: walk cumulative offsets
        // (cached size for measured items, ItemHeight/ItemWidth estimate
        // for un-measured ones) until the band crosses the viewport.
        // Shift the shared viewport into this panel's LOCAL item space by
        // subtracting the panel's absolute origin (0 for the root panel, the
        // parent-row's absolute bottom-of-header for a nested panel). Item
        // offsets below are all local (0-based), so the comparison is uniform.
        const vpStart = (horizontal ? vp.X : vp.Y) - this._originOffset;
        const vpEnd   = vpStart + (horizontal ? vp.Width : vp.Height);
        const vpLen   = horizontal ? vp.Width : vp.Height;
        let first = 0;
        let last  = -1;
        if (vpLen > 0)
        {
            const range = this.indicesIntersecting(vpStart, vpEnd, count);
            first = range.first;
            last  = range.last;
        }

        this.realizeRange(first, last);

        // Measure each realized container with the cross-axis size
        // filled and the primary axis Infinity (so the container can
        // report its natural height). The result feeds back into
        // sizeCache for the next pass's viewport math.
        const crossExtent = horizontal ? availableSize.Height : availableSize.Width;
        const childSize = horizontal
            ? new Size(Number.POSITIVE_INFINITY, crossExtent)
            : new Size(crossExtent, Number.POSITIVE_INFINITY);
        let maxCross = 0;
        for (const [index, container] of this.realized)
        {
            container.Measure(childSize);
            const desired = horizontal
                ? container.DesiredSize.Width
                : container.DesiredSize.Height;
            // Cache the measured primary-axis extent so subsequent
            // passes account for variable sizes. Skip when the
            // container reported Infinity (defensive — shouldn't
            // happen from a real Visual).
            if (Number.isFinite(desired))
            {
                this.sizeCache.set(index, desired);
            }
            const cross = horizontal
                ? container.DesiredSize.Height
                : container.DesiredSize.Width;
            if (Number.isFinite(cross)) maxCross = Math.max(maxCross, cross);
        }
        this.measuredCross = maxCross;

        // Total extent = sum of cached sizes + estimate for the rest.
        // Cross-axis = max of realized children's desired cross size
        // (WPF StackPanel convention) — lets the panel collapse to its
        // content width when the parent slot is unbounded. With
        // virtualization the max is only over realized containers; a
        // wider unrealized container outside the viewport would not
        // contribute, but in practice items in a virtualized list are
        // uniform-width and the first realized container is
        // representative.
        const totalPrimary = this.totalPrimaryExtent(count);
        return horizontal
            ? new Size(totalPrimary, maxCross)
            : new Size(maxCross, totalPrimary);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        if (this._collapsed) return Size.Zero;
        const horizontal = this.isHorizontal;
        // Pre-compute prefix sums so each container arranges at the
        // right offset given variable sizes. Cheap O(maxIndex) work.
        const maxIdx = Math.max(0, ...this.realized.keys());
        const offsets: number[] = [];
        let cursor = 0;
        for (let i = 0; i <= maxIdx; i++)
        {
            offsets.push(cursor);
            cursor += this.sizeOf(i);
        }
        // Viewport-local arrange. In delegate-mode the SCP arranges the ROOT
        // panel into a viewport-sized slot at (0, 0); items at full-extent
        // offsets (1000+ px down) would land outside the slot and never paint,
        // so the root subtracts the scroll offset to bring the first visible
        // item to panel-local 0. A NESTED panel is already inside a container
        // the root translated, so it arranges children at true local offsets
        // (scrollOff = 0) — subtracting again would double-translate.
        const vp = this.Viewport;
        const scrollOff = this._nested ? 0 : (horizontal ? vp.X : vp.Y);
        // Cross-axis (perpendicular to stacking) scroll. In delegate mode the SCP
        // applies NO translation — the panel owns both axes — so the primary axis
        // alone isn't enough: a row wider than the viewport (a long label, deep
        // indent) must arrange at its full cross extent and shift by the cross
        // offset, or the horizontal scrollbar moves but nothing pans. Nested
        // panels inherit the root's cross translate through their ancestor
        // container, so they use 0 (same rule as scrollOff).
        const crossOff = this._nested ? 0 : (horizontal ? vp.Y : vp.X);
        const crossExtent = horizontal
            ? Math.max(finalSize.Height, this.measuredCross)
            : Math.max(finalSize.Width,  this.measuredCross);
        for (const [index, container] of this.realized)
        {
            const off  = offsets[index]! - scrollOff;
            const size = this.sizeOf(index);
            const rect = horizontal
                ? new Rect(off, -crossOff, size, crossExtent)
                : new Rect(-crossOff, off, crossExtent, size);
            container.Arrange(rect);
            // Per-level composition: a realized container that hosts its own
            // virtualizing panel (an expanded TreeViewItem) gets the SHARED
            // viewport plus its own absolute offset, so its nested panel
            // realizes the right slice. absoluteOffset = this panel's origin +
            // the container's local offset. Changing the child's viewport marks
            // it Measure-dirty; the tree converges over the next layout pass.
            if (isNestedViewportHost(container))
            {
                container.SetOuterViewport(vp, this._originOffset + offsets[index]!);
            }
        }
        return finalSize;
    }

    // ── Variable-size helpers ───────────────────────────────────────

    // Primary-axis extent for item `index`: measured size if cached,
    // otherwise the consumer's ItemHeight / ItemWidth estimate.
    private sizeOf(index: number): number
    {
        const cached = this.sizeCache.get(index);
        return cached !== undefined ? cached : this.itemExtent;
    }

    // Walk cumulative offsets to find the first index whose band ends
    // strictly after `start` and the last index whose band begins
    // strictly before `end`. O(count) — acceptable for our typical
    // item counts; a binary-search prefix-sum could speed it up if a
    // profile demands it.
    private indicesIntersecting(start: number, end: number, count: number): { first: number; last: number }
    {
        let offset = 0;
        let first = -1;
        let last  = -1;
        for (let i = 0; i < count; i++)
        {
            const size  = this.sizeOf(i);
            const itemEnd = offset + size;
            if (first === -1 && itemEnd > start)
            {
                first = i;
            }
            if (offset < end)
            {
                last = i;
            }
            else if (first !== -1)
            {
                break;  // past the viewport — no more intersections.
            }
            offset = itemEnd;
        }
        if (first === -1) return { first: 0, last: -1 };
        return { first, last };
    }

    private totalPrimaryExtent(count: number): number
    {
        let total = 0;
        for (let i = 0; i < count; i++)
        {
            total += this.sizeOf(i);
        }
        return total;
    }

    protected override RecycleAll(): void
    {
        const owner = this.itemsOwner;
        for (const [, container] of this.realized)
        {
            this.RemoveVisualChild(container);
            owner?.DetachContainer(container);
            owner?.Generator.Recycle(container);
        }
        this.realized.clear();
        this.sizeCache.clear();
    }

    // ── Incremental items-change hooks (§ 10.4) ────────────────────────

    protected override realizedIndices(): Iterable<number>
    {
        return this.realized.keys();
    }

    protected override recycleAtIndices(indices: readonly number[]): void
    {
        const owner = this.itemsOwner;
        for (const idx of indices)
        {
            const container = this.realized.get(idx);
            if (container === undefined) continue;
            this.RemoveVisualChild(container);
            owner?.DetachContainer(container);
            owner?.Generator.Recycle(container);
            this.realized.delete(idx);
            this.sizeCache.delete(idx);
        }
    }

    protected override shiftRealizedIndices(fromIndex: number, delta: number): void
    {
        if (delta === 0) return;
        // Capture the keys-to-rewrite snapshot before mutating either
        // map — iterating Map.keys() during mutation skips elements.
        const movingRealized = [...this.realized.keys()].filter(k => k >= fromIndex);
        const movingSizes    = [...this.sizeCache.keys()].filter(k => k >= fromIndex);
        // Walk in descending order when delta > 0 (shifting up) so we
        // don't overwrite an existing key before its own move; ascending
        // when delta < 0 (shifting down) for the symmetric reason.
        const sortedRealized = delta > 0
            ? movingRealized.sort((a, b) => b - a)
            : movingRealized.sort((a, b) => a - b);
        for (const oldIdx of sortedRealized)
        {
            const c = this.realized.get(oldIdx)!;
            this.realized.delete(oldIdx);
            this.realized.set(oldIdx + delta, c);
        }
        const sortedSizes = delta > 0
            ? movingSizes.sort((a, b) => b - a)
            : movingSizes.sort((a, b) => a - b);
        for (const oldIdx of sortedSizes)
        {
            const s = this.sizeCache.get(oldIdx)!;
            this.sizeCache.delete(oldIdx);
            this.sizeCache.set(oldIdx + delta, s);
        }
    }

    protected override realizedIndexAt(index: number): number | undefined
    {
        return this.realized.has(index) ? index : undefined;
    }

    // Reconcile the realized set against the desired [first, last]
    // range: drop out-of-range realized containers, fill in missing
    // in-range items. Index keys mirror item indices in the owner's
    // Items collection so re-resolution after Items mutation falls
    // out naturally (mutation forces a measure via OnItemsChanged).
    private realizeRange(first: number, last: number): void
    {
        const owner = this.itemsOwner!;

        // Recycle indices outside the new range. Snapshot the keys
        // first because we mutate the map mid-loop.
        for (const index of [...this.realized.keys()])
        {
            if (index < first || index > last)
            {
                const container = this.realized.get(index)!;
                this.RemoveVisualChild(container);
                owner.DetachContainer(container);
                owner.Generator.Recycle(container);
                this.realized.delete(index);
            }
        }

        // Realize in-range items via the generator's session API.
        // GenerateNext returns (container, isNewlyRealized); newly-
        // realized containers need tree wiring (panel.AddVisualChild +
        // owner.AttachContainer), then every container — fresh or
        // reused — gets PrepareItemContainer so ItemContainerStyle,
        // AlternationIndex, and subclass-specific Prepare logic run
        // exactly once per realization. Skipping that call was a
        // long-standing gap in the previous Realize-direct loop —
        // virtualized rows missed ItemContainerStyle entirely.
        const session = owner.Generator.StartAt(
            owner.Generator.GeneratorPositionFromIndex(first));
        try
        {
            for (let i = first; i <= last; i++)
            {
                if (this.realized.has(i))
                {
                    // Skip past — advance the cursor by calling
                    // GenerateNext but discard the result (it'll be
                    // the same already-realized container).
                    session.GenerateNext();
                    continue;
                }
                const { container, isNewlyRealized } = session.GenerateNext();
                if (container === undefined) continue;
                if (isNewlyRealized)
                {
                    this.AddVisualChild(container);
                    owner.AttachContainer(container);
                }
                owner.Generator.PrepareItemContainer(container);
                this.realized.set(i, container);
            }
        }
        finally
        {
            session.dispose();
        }
    }

    private itemCount(): number
    {
        return this.itemsOwner?.ItemCount() ?? 0;
    }
}
