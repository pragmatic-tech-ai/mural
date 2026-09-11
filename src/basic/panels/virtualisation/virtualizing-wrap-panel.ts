import {
    MetaData,
    MuralBase,
    Rect,
    Size,
    Visual,
    type IScrollInfo,
} from '../../../runtime/index.js';
import { VirtualizingPanel } from './virtualizing-panel.js';

// Wrap panel that realizes containers only for items whose cell rect
// intersects the Viewport. Uniform-cell mode — every item is assumed
// to occupy an ItemWidth × ItemHeight slot. That assumption turns
// viewport → realized-index math into O(1) and lets the panel skip
// measuring un-realized containers entirely (the dominant cost in a
// non-virtualized WrapPanel at scale).
//
// Layout, with strideX = ItemWidth + HorizontalSpacing and strideY =
// ItemHeight + VerticalSpacing, given N items and a (Width × Height)
// viewport with offset (X, Y):
//
//   columns       = max(1, floor((viewportWidth + HorizontalSpacing) / strideX))
//   firstVisRow   = floor(Y / strideY)
//   lastVisRow    = floor((Y + viewportHeight - 1) / strideY)
//   firstIndex    = firstVisRow × columns
//   lastIndex     = min(N - 1, (lastVisRow + 1) × columns - 1)
//   Extent        = (columns × strideX − HorizontalSpacing,
//                    totalRows × strideY − VerticalSpacing)
//
// Items below the last full row get a partial-row slot; the cross-axis
// extent of the panel is `columns × strideX − HorizontalSpacing`
// regardless of how many items the last row contains. The IScrollInfo
// getters report this so a hosting ScrollViewer can publish a stable
// horizontal extent (cells never re-pack horizontally as Y changes).
//
// Spacing semantics:
//   * `HorizontalSpacing` is the gap BETWEEN adjacent cells in a row.
//     n cells in a row consume n·ItemWidth + (n−1)·HorizontalSpacing;
//     the "+HorizontalSpacing" trick in the column-count formula is what
//     comes from solving n ≤ (W + HorizontalSpacing) / strideX.
//   * `VerticalSpacing` is the gap BETWEEN adjacent rows. Same shape.
//   * Both default to 0 so existing consumers keep their current
//     uniform-cell layout. The cell Measure call stays at
//     Size(ItemWidth, ItemHeight) — items still get the cell budget
//     exactly; spacing just spreads them further apart.
//
// Orientation:
//   * Horizontal (default) — items flow left-to-right, wrap to the
//     next row, scroll vertically. This is the "tile palette" shape
//     the demo wants.
//   * Vertical            — items flow top-to-bottom, wrap to the
//     next column, scroll horizontally. Symmetrical math; the
//     primary/cross axes swap.
//
// What's NOT in this cut:
//   * Variable-size items — every cell is fixed at ItemWidth/Height.
//     A future variable-cell variant would need a per-item size cache
//     and a binary-search viewport hit-test (same shape as VSP's
//     sizeCache, but 2D).
//   * Item alignment within a partial last row — items pack left-to-
//     right with no centering / justification.
export class VirtualizingWrapPanel extends VirtualizingPanel implements IScrollInfo
{
    public static readonly ItemWidthKey         = MuralBase.RegisterProperty<number>(VirtualizingWrapPanel, 'ItemWidth',         100, MetaData.Measure);
    public static readonly ItemHeightKey        = MuralBase.RegisterProperty<number>(VirtualizingWrapPanel, 'ItemHeight',        100, MetaData.Measure);
    public static readonly HorizontalSpacingKey = MuralBase.RegisterProperty<number>(VirtualizingWrapPanel, 'HorizontalSpacing',   0, MetaData.Measure);
    public static readonly VerticalSpacingKey   = MuralBase.RegisterProperty<number>(VirtualizingWrapPanel, 'VerticalSpacing',     0, MetaData.Measure);

    public get ItemWidth():  number { return this.get_property_value(VirtualizingWrapPanel.ItemWidthKey); }
    public set ItemWidth(v:  number) { this.set_property_value(VirtualizingWrapPanel.ItemWidthKey, v); }

    public get ItemHeight(): number { return this.get_property_value(VirtualizingWrapPanel.ItemHeightKey); }
    public set ItemHeight(v: number) { this.set_property_value(VirtualizingWrapPanel.ItemHeightKey, v); }

    public get HorizontalSpacing(): number { return this.get_property_value(VirtualizingWrapPanel.HorizontalSpacingKey); }
    public set HorizontalSpacing(v: number) { this.set_property_value(VirtualizingWrapPanel.HorizontalSpacingKey, v); }

    public get VerticalSpacing(): number { return this.get_property_value(VirtualizingWrapPanel.VerticalSpacingKey); }
    public set VerticalSpacing(v: number) { this.set_property_value(VirtualizingWrapPanel.VerticalSpacingKey, v); }

    // Sparse map from item index → realized container Visual.
    private realized: Map<number, Visual> = new Map();

    // Cached columns count last computed during MeasureOverride.
    // Reorder math and tests read it after a layout pass.
    private _columns: number = 1;

    public get Columns(): number { return this._columns; }
    public get RealizedIndices(): readonly number[]
    {
        return [...this.realized.keys()].sort((a, b) => a - b);
    }

    private itemCount(): number
    {
        return this.itemsOwner?.ItemCount() ?? 0;
    }

    private columnsFor(viewportPrimary: number): number
    {
        const cw = this.ItemWidth;
        if (cw <= 0) return 1;
        // n cells with (n−1) gaps fit when n·cw + (n−1)·hSp ≤ W, which
        // rearranges to n ≤ (W + hSp) / (cw + hSp). The `+hSp` collapses
        // away when HorizontalSpacing is 0, preserving the original
        // floor(W / cw) result.
        const hSp = Math.max(0, this.HorizontalSpacing);
        return Math.max(1, Math.floor((viewportPrimary + hSp) / (cw + hSp)));
    }

    private rowsFor(count: number, columns: number): number
    {
        if (count <= 0 || columns <= 0) return 0;
        return Math.ceil(count / columns);
    }

    // ── IScrollInfo ───────────────────────────────────────────────
    //
    // Extent: full content bounds in cells. Columns derive from the
    // viewport's primary-axis size; if the viewport is zero (no
    // hosting ScrollViewer yet, pre-measure read), fall back to one
    // column so the host sees a sensible Extent and doesn't divide-by-
    // zero.

    public get ExtentWidth(): number
    {
        const vp = this.Viewport;
        const columns = vp.Width > 0 ? this.columnsFor(vp.Width) : 1;
        // columns × cw + (columns−1) × hSp  ≡  columns × strideX − hSp.
        // Clamp to 0 when there are no columns (defensive — columnsFor
        // already returns at least 1, but the math should still be
        // honest about an empty extent).
        const hSp = Math.max(0, this.HorizontalSpacing);
        return columns > 0 ? columns * (this.ItemWidth + hSp) - hSp : 0;
    }

    public get ExtentHeight(): number
    {
        const vp = this.Viewport;
        const columns = vp.Width > 0 ? this.columnsFor(vp.Width) : 1;
        const rows = this.rowsFor(this.itemCount(), columns);
        const vSp = Math.max(0, this.VerticalSpacing);
        return rows > 0 ? rows * (this.ItemHeight + vSp) - vSp : 0;
    }

    public get ViewportWidth():  number { return this.Viewport.Width; }
    public get ViewportHeight(): number { return this.Viewport.Height; }
    public get HorizontalOffset(): number { return this.Viewport.X; }
    public get VerticalOffset():   number { return this.Viewport.Y; }

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

    // ── Layout ────────────────────────────────────────────────────

    protected override MeasureOverride(availableSize: Size): Size
    {
        const owner = this.itemsOwner;
        if (owner === undefined) return Size.Zero;
        const count = this.itemCount();
        const cw = this.ItemWidth;
        const ch = this.ItemHeight;
        const hSp = Math.max(0, this.HorizontalSpacing);
        const vSp = Math.max(0, this.VerticalSpacing);
        const strideY = ch + vSp;
        const vp = this.Viewport;

        // Columns are computed against the viewport (the slot the SCP
        // gave us). `availableSize.Width` is the same value in the
        // delegate-mode SCP path — both equal the visible viewport's
        // primary extent.
        const primary = vp.Width > 0 ? vp.Width : availableSize.Width;
        this._columns = this.columnsFor(primary);
        const rows = this.rowsFor(count, this._columns);

        if (count === 0)
        {
            return new Size(0, 0);
        }

        // Compute realized range from the viewport. When the viewport
        // is zero (pre-measure / no host), realize nothing — the
        // panel still reports a sensible Extent. With non-zero
        // VerticalSpacing the row stride grows by vSp, so the
        // viewport-to-row mapping divides by strideY instead of ch.
        const vpStart = vp.Y;
        const vpLen   = vp.Height;
        let first = 0;
        let last  = -1;
        if (vpLen > 0 && strideY > 0)
        {
            const firstRow = Math.max(0, Math.floor(vpStart / strideY));
            const lastRow  = Math.min(rows - 1, Math.floor((vpStart + vpLen - 1) / strideY));
            first = firstRow * this._columns;
            last  = Math.min(count - 1, (lastRow + 1) * this._columns - 1);
        }

        this.realizeRange(first, last);

        // Measure realized containers with their fixed cell size.
        // Uniform-cell mode: the cell is the budget; the container's
        // DesiredSize is whatever it fits inside.
        const cellSize = new Size(cw, ch);
        for (const [, container] of this.realized)
        {
            container.Measure(cellSize);
        }

        // DesiredSize: full-content extent, with inter-cell spacing
        // accounted for via the `n × stride − spacing` identity.
        return new Size(
            this._columns > 0 ? this._columns * (cw + hSp) - hSp : 0,
            rows > 0 ? rows * (ch + vSp) - vSp : 0,
        );
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const cw = this.ItemWidth;
        const ch = this.ItemHeight;
        const hSp = Math.max(0, this.HorizontalSpacing);
        const vSp = Math.max(0, this.VerticalSpacing);
        const strideX = cw + hSp;
        const strideY = ch + vSp;
        const columns = this._columns;
        // Viewport-local arrange. The SCP gives this panel a viewport-
        // sized slot at (0, 0) in delegate mode; items positioned at
        // full-extent row offsets (row × strideY) would land below the
        // slot when row > viewport.Y/strideY and never paint. Subtract
        // the viewport's vertical offset so the first visible row lands
        // at panel-local 0.
        const vpY = this.Viewport.Y;
        for (const [index, container] of this.realized)
        {
            const row = Math.floor(index / columns);
            const col = index % columns;
            container.Arrange(new Rect(col * strideX, row * strideY - vpY, cw, ch));
        }
        return finalSize;
    }

    // ── Realization ───────────────────────────────────────────────

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
    }

    // ── Incremental items-change hooks (§ 10.4) ────────────────────────
    //
    // Shared shape with VirtualizingStackPanel — the wrap panel has no
    // per-item size cache (uniform cells), so the hooks here just
    // touch the realized map.

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
        }
    }

    protected override shiftRealizedIndices(fromIndex: number, delta: number): void
    {
        if (delta === 0) return;
        const moving = [...this.realized.keys()].filter(k => k >= fromIndex);
        const sorted = delta > 0
            ? moving.sort((a, b) => b - a)
            : moving.sort((a, b) => a - b);
        for (const oldIdx of sorted)
        {
            const c = this.realized.get(oldIdx)!;
            this.realized.delete(oldIdx);
            this.realized.set(oldIdx + delta, c);
        }
    }

    protected override realizedIndexAt(index: number): number | undefined
    {
        return this.realized.has(index) ? index : undefined;
    }

    // Reconcile the realized set against the desired [first, last]
    // range: drop out-of-range realized containers, fill in missing
    // in-range items. Mirrors VirtualizingStackPanel's realizeRange —
    // same generator-session pattern so ItemContainerStyle /
    // AlternationIndex / PrepareContainerForItemOverride run exactly
    // once per realization, whether the container is newly built or
    // reused from the recycle pool.
    private realizeRange(first: number, last: number): void
    {
        const owner = this.itemsOwner!;

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

        if (first > last) return;

        const session = owner.Generator.StartAt(
            owner.Generator.GeneratorPositionFromIndex(first));
        try
        {
            for (let i = first; i <= last; i++)
            {
                if (this.realized.has(i))
                {
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
}
