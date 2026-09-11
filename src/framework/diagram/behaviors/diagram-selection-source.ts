import {
    MuralBase,
    Rect,
    type PropertyKey,
    type Disposable,
} from '../../../runtime/index.js';
import { findDescriptor, resolveKey } from '../../../runtime/model-internals.js';
import { HorizontalAnchor, VerticalAnchor, type SelectionSource } from '../../../basic/index.js';
import type { Diagram } from '../diagram.js';
import { DiagramSettings } from '../diagram-settings.js';

// Adapter from Diagram's selection-bounds DPs (Phase C) + selected
// IFigure items into the SelectionSource contract that
// SelectionBoundsAdorner expects.
//
// Bounds + Count → routed straight from Diagram.SelectionLeft/Top/Width/
// Height/Count (read-only DPs driven by SelectionBoundsTracker).
//
// beginResize / applyResize / endResize → snapshot each selected
// IFigure-shaped item's rect on begin, scale + reposition on apply
// based on the anchor, clear the snapshot on end. Per-item writes go
// through `set_property_value_with_key` after resolveKey, same pattern
// as Group's Translate.
//
// IGroup handling: the v1 path treats every selected item uniformly
// — if a group's Left / Top / Width / Height are READ-ONLY (the standard
// shape per spec § 3.3), the writes throw and the source skips that
// entity with a warning. A later phase can add per-group leaf-scaling
// math (the demo's DiagramVM.ApplySelectionResize does this) but it
// requires a `Members`-walk contract beyond plain IFigure.

interface FigureSnapshot {
    item:    MuralBase;
    leftKey: PropertyKey<unknown>;
    topKey:  PropertyKey<unknown>;
    wKey:    PropertyKey<unknown>;
    hKey:    PropertyKey<unknown>;
    // Present only for nodes that carry a UserSized latch (content nodes). A
    // hand-resize sets it so their content auto-fit stops and the size sticks.
    userSizedKey?: PropertyKey<unknown>;
    left: number; top: number; w: number; h: number;
    // Snapshot of the figure's LockAspectRatio at gesture start. When true,
    // applyResize constrains the drag to a uniform scale so the shape keeps
    // its w:h ratio (per-shape — content VMs lack the DP → always false).
    lockAspect: boolean;
    // True iff every geometry DP is read-only — skip this entry in
    // applyResize (we can't write through). Groups land here.
    isReadOnly: boolean;
}

export class DiagramSelectionSource implements SelectionSource
{
    private readonly _diagram: Diagram;
    private _snapshot: FigureSnapshot[] | undefined = undefined;

    constructor(diagram: Diagram)
    {
        this._diagram = diagram;
    }

    public get Count(): number
    {
        return this._diagram.SelectionCount;
    }

    public get Bounds(): Rect
    {
        return new Rect(
            this._diagram.SelectionLeft,
            this._diagram.SelectionTop,
            this._diagram.SelectionWidth,
            this._diagram.SelectionHeight,
        );
    }

    // Subscribe to every bound-related DP — any of them changing means
    // the adorner needs to re-arrange its bbox + handles.
    public subscribe(listener: () => void): () => void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        const keys = [
            Diagram.SelectionLeftKey,
            Diagram.SelectionTopKey,
            Diagram.SelectionWidthKey,
            Diagram.SelectionHeightKey,
            Diagram.SelectionCountKey,
        ];
        const subs: Disposable[] = keys.map(k => this._diagram.PropertyChanged(k).subscribe(listener));
        return (): void => {
            for (const s of subs) s.dispose();
        };
    }

    public beginResize(): void
    {
        // One history transaction for the whole resize drag (closed in endResize).
        (this._diagram as unknown as { _beginEdit?(l: string): void })._beginEdit?.('Resize');
        const snaps: FigureSnapshot[] = [];
        // Snapshot each selected item's GEOMETRY HOST — the item itself when it
        // carries geometry DPs (geometric-shape Figures / legacy item-authoritative
        // rows), else its container Figure. A content node surfaces in SelectedItems
        // as a geometry-less VM (container-owned-geometry); its geometry, and the
        // UserSized latch a hand-resize sets, live on its container.
        for (const raw of this._diagram.SelectedItems)
        {
            const item = this._geometryHost(raw);
            if (item === undefined) continue;
            const klass = item.constructor as Function;
            const leftDesc = findDescriptor(klass, 'Left');
            const topDesc  = findDescriptor(klass, 'Top');
            const wDesc    = findDescriptor(klass, 'Width');
            const hDesc    = findDescriptor(klass, 'Height');
            if (leftDesc === undefined || topDesc === undefined || wDesc === undefined || hDesc === undefined) continue;
            const isReadOnly = wDesc.IsReadOnly === true || hDesc.IsReadOnly === true;
            const hasUserSized = findDescriptor(klass, 'UserSized') !== undefined;
            snaps.push({
                item,
                leftKey: resolveKey(item, undefined, 'Left'),
                topKey:  resolveKey(item, undefined, 'Top'),
                wKey:    resolveKey(item, undefined, 'Width'),
                hKey:    resolveKey(item, undefined, 'Height'),
                userSizedKey: hasUserSized ? resolveKey(item, undefined, 'UserSized') : undefined,
                left: (item as unknown as { Left: number }).Left,
                top:  (item as unknown as { Top:  number }).Top,
                w:    (item as unknown as { Width:  number }).Width,
                h:    (item as unknown as { Height: number }).Height,
                lockAspect: (item as unknown as { LockAspectRatio?: boolean }).LockAspectRatio === true,
                isReadOnly,
            });
        }
        this._snapshot = snaps;
    }

    public applyResize(
        dw: number, dh: number,
        xAnchor: HorizontalAnchor,
        yAnchor: VerticalAnchor,
    ): void
    {
        if (this._snapshot === undefined) return;
        for (const s of this._snapshot)
        {
            // Skip read-only entries (Groups). v1 limitation — see file
            // header. Consumer can subscribe to Diagram.SelectedItems
            // and apply custom resize semantics if needed.
            if (s.isReadOnly) continue;

            const minDim = DiagramSettings.ShapeMinResize();
            let newW: number;
            let newH: number;
            if (s.lockAspect && s.w > 0 && s.h > 0)
            {
                // Aspect-locked: collapse the (dw, dh) drag to ONE uniform scale.
                // Drive it by whichever axis the user pushed further (larger
                // deviation from 1) — so a corner drag scales by its dominant
                // axis and an edge handle (one delta zero) still scales both.
                const scaleW = (s.w + dw) / s.w;
                const scaleH = (s.h + dh) / s.h;
                let scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
                // Clamp the single scale so BOTH dims stay ≥ min (clamping each
                // dim independently would break the locked ratio).
                scale = Math.max(scale, minDim / s.w, minDim / s.h);
                newW = s.w * scale;
                newH = s.h * scale;
            }
            else
            {
                newW = Math.max(minDim, s.w + dw);
                newH = Math.max(minDim, s.h + dh);
            }
            const newLeft = (xAnchor === HorizontalAnchor.Right)  ? s.left + s.w - newW : s.left;
            const newTop  = (yAnchor === VerticalAnchor.Bottom) ? s.top  + s.h - newH : s.top;

            // Latch UserSized so a content node stops auto-fitting and keeps the
            // hand-set size (no-op for nodes without the DP).
            if (s.userSizedKey !== undefined) s.item.set_property_value_with_key(s.userSizedKey, true);
            s.item.set_property_value_with_key(s.leftKey, newLeft);
            s.item.set_property_value_with_key(s.topKey,  newTop);
            s.item.set_property_value_with_key(s.wKey,    newW);
            s.item.set_property_value_with_key(s.hKey,    newH);
        }
    }

    public endResize(): void
    {
        this._snapshot = undefined;
        (this._diagram as unknown as { _endEdit?(): void })._endEdit?.();
    }

    // The MuralBase whose Left/Top/Width/Height describe this item on the canvas:
    // the item itself when it carries geometry DPs (geometric-shape Figures /
    // legacy item-authoritative rows), else its container Figure (content VMs
    // under container-owned-geometry). Undefined when neither is geometry-shaped.
    private _geometryHost(item: unknown): MuralBase | undefined
    {
        if (this._isFigureShape(item)) return item as MuralBase;
        const container = this._diagram.Generator.ContainerFromItem(item);
        return this._isFigureShape(container) ? (container as unknown as MuralBase) : undefined;
    }

    private _isFigureShape(item: unknown): boolean
    {
        if (!(item instanceof MuralBase)) return false;
        const klass = item.constructor as Function;
        return findDescriptor(klass, 'Left')   !== undefined
            && findDescriptor(klass, 'Top')    !== undefined
            && findDescriptor(klass, 'Width')  !== undefined
            && findDescriptor(klass, 'Height') !== undefined;
    }
}
