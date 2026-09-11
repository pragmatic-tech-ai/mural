import { MuralBase, type Disposable } from '../../../runtime/index.js';
import { findDescriptor, resolveKey } from '../../../runtime/model-internals.js';
import { diagramSpaceRect, type SpatialNode } from '../coordinate-space.js';
import type { Diagram } from '../diagram.js';

// Internal collaborator owned by Diagram. Derives SelectionLeft / Top /
// Width / Height / Count (5 read-only DPs on Diagram) from the union
// bbox of every selected item's GEOMETRY HOST.
//
// The geometry host is the item itself when it carries Left/Top/Width/Height
// DPs (geometric-shape Figures, and legacy item-authoritative data rows), or
// the item's container Figure otherwise. Under container-owned-geometry a
// selected content node surfaces as a geometry-less VM in SelectedItems, so
// reading bounds off the item would collapse the bbox to zero and hide the
// adorner; resolving to the container keeps it in the box.
//
// Re-derives whenever:
//   * Selector.SelectionChanged fires (selection set membership changes)
//   * any selected item's Left / Top / Width / Height DP fires
//     PropertyChanged
//
// Per-item geometry listeners attach on selection-enter and detach on
// selection-exit. Listener keys resolved via the `resolveKey + typed-key
// API` pattern (model-internals.ts) — no by-name accessor surface.
//
// IFigure-shape duck-type check: item must be a `MuralBase` instance with
// Left / Top / Width / Height DPs registered somewhere in its class
// hierarchy. `findDescriptor` returns `undefined` on missing, so the
// check is non-throwing. Non-IFigure items (raw strings, opaque tokens)
// are silently excluded from both the bbox math and the count —
// consistent semantics across both surfaces.
export class SelectionBoundsTracker
{
    private readonly _diagram: Diagram;
    private readonly _itemListeners: Map<MuralBase, () => void> = new Map();

    constructor(diagram: Diagram)
    {
        this._diagram = diagram;
        diagram.AddSelectionChangedListener(() => this._onSelectionChanged());
        // Seed initial state — at construction SelectedItems is empty, so
        // this is a (0, 0, 0, 0, 0) write. Still useful: a consumer reading
        // SelectionCount immediately after `new Diagram()` gets 0, not the
        // DP's registered default (which happens to also be 0; the seed
        // makes the contract explicit).
        this._recompute();
    }

    private _onSelectionChanged(): void
    {
        // Detach every existing per-item listener — easier than diffing
        // old set vs new set, and selection-change events are infrequent
        // enough that the extra detach/reattach is invisible.
        for (const detach of this._itemListeners.values()) detach();
        this._itemListeners.clear();

        // Reattach against each selected item's GEOMETRY HOST. An item that
        // already carries geometry DPs is its own host (geometric-shape Figures,
        // and legacy item-authoritative data rows); a content VM carries none,
        // so its host is the container Figure (container-owned-geometry).
        // Resolving here — rather than reading SelectedItems directly — is what
        // keeps a selected content node in the bbox instead of being dropped.
        for (const item of this._diagram.SelectedItems)
        {
            const host = this._geometryHost(item);
            if (host !== undefined) this._itemListeners.set(host, this._listenItem(host));
        }

        this._recompute();
    }

    // The object whose Left/Top/Width/Height describe this item on the canvas:
    // the item itself when it carries geometry DPs, otherwise its container
    // Figure. Returns undefined when neither is figure-shaped (e.g. a plain
    // data row selected in a non-diagram Selector).
    private _geometryHost(item: unknown): MuralBase | undefined
    {
        if (this._isFigureShape(item)) return item;
        const container = this._diagram.Generator.ContainerFromItem(item);
        return this._isFigureShape(container) ? container : undefined;
    }

    private _listenItem(item: MuralBase): () => void
    {
        // resolveKey throws if any of Left / Top / Width / Height is
        // missing, but `_isFigureShape` already guarded — by the time
        // we get here the lookups all succeed.
        const leftKey = resolveKey(item, undefined, 'Left');
        const topKey  = resolveKey(item, undefined, 'Top');
        const wKey    = resolveKey(item, undefined, 'Width');
        const hKey    = resolveKey(item, undefined, 'Height');
        const handler = (): void => this._recompute();
        const subs: Disposable[] = [
            item.PropertyChanged(leftKey).subscribe(handler),
            item.PropertyChanged(topKey).subscribe(handler),
            item.PropertyChanged(wKey).subscribe(handler),
            item.PropertyChanged(hKey).subscribe(handler),
        ];
        return (): void => { for (const s of subs) s.dispose(); };
    }

    private _recompute(): void
    {
        // Lazy-import the Diagram class for the static Key references.
        // The selection-bounds DP keys live on Diagram itself — see
        // diagram.ts `SelectionLeftKey` etc.
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        // Collect every IFigure-shaped selected item. Use the listener
        // set as the authoritative set (it was filtered through
        // _isFigureShape on the way in) rather than re-walking
        // SelectedItems and re-filtering.
        const items = [...this._itemListeners.keys()];

        if (items.length === 0)
        {
            this._diagram.set_property_value_with_key(Diagram.SelectionLeftKey,   0);
            this._diagram.set_property_value_with_key(Diagram.SelectionTopKey,    0);
            this._diagram.set_property_value_with_key(Diagram.SelectionWidthKey,  0);
            this._diagram.set_property_value_with_key(Diagram.SelectionHeightKey, 0);
            this._diagram.set_property_value_with_key(Diagram.SelectionCountKey,  0);
            return;
        }

        let minLeft = Number.POSITIVE_INFINITY;
        let minTop  = Number.POSITIVE_INFINITY;
        let maxRight  = Number.NEGATIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        for (const item of items)
        {
            const it = item as unknown as { Left: number; Top: number; Width: number; Height: number; ContainerParent?: unknown };
            // A nested host's Left/Top are container-local; resolve to diagram
            // space (the adorner layer's coordinate space) so handles land on the
            // node on screen. Root hosts take the raw rect.
            const r = it.ContainerParent !== undefined
                ? diagramSpaceRect(item as unknown as SpatialNode)
                : { X: it.Left, Y: it.Top, Width: it.Width, Height: it.Height };
            if (r.X < minLeft) minLeft = r.X;
            if (r.Y < minTop)  minTop  = r.Y;
            if (r.X + r.Width  > maxRight)  maxRight  = r.X + r.Width;
            if (r.Y + r.Height > maxBottom) maxBottom = r.Y + r.Height;
        }
        this._diagram.set_property_value_with_key(Diagram.SelectionLeftKey,   minLeft);
        this._diagram.set_property_value_with_key(Diagram.SelectionTopKey,    minTop);
        this._diagram.set_property_value_with_key(Diagram.SelectionWidthKey,  maxRight  - minLeft);
        this._diagram.set_property_value_with_key(Diagram.SelectionHeightKey, maxBottom - minTop);
        this._diagram.set_property_value_with_key(Diagram.SelectionCountKey,  items.length);
    }

    private _isFigureShape(item: unknown): item is MuralBase
    {
        if (!(item instanceof MuralBase)) return false;
        const klass = item.constructor as Function;
        return findDescriptor(klass, 'Left')   !== undefined
            && findDescriptor(klass, 'Top')    !== undefined
            && findDescriptor(klass, 'Width')  !== undefined
            && findDescriptor(klass, 'Height') !== undefined;
    }
}
