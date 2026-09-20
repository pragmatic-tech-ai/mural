import { Visual, type Disposable } from '../../../runtime/index.js';
import type { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';

// One-shape geometry bridge (sibling of FormatMirror): reflects the single
// selected shape's geometry into the Diagram's SelectedShape* DPs (seed on
// selection change AND on the shape's own geometry change, so the inspector
// tracks live drags/resizes) and routes inspector edits back to the shape.
// Reentrancy is gated with `_seeding` so seed→edit→seed can't loop. Only a
// selection of exactly one node counts — otherwise HasSelectedShape is false
// and writes are ignored (the Size/Position editor disables itself).
//
// The target is always the item's Figure CONTAINER, resolved via
// Generator.ContainerFromItem. For a geometric shape (a Figure item) the
// container IS the item. For a content node (a NodeViewModel item, e.g. Plexus
// ArchNodeVM) the Diagram wraps it in a Figure container that two-way binds
// Left/Top/Width/Height to the VM (diagram.ts bindContainer) — so mirroring the
// container works uniformly, and writes propagate back to the VM through those
// binds. Working on the container (rather than the raw item) also gives
// rotation + base-size for free, since only Figures carry those DPs.
export class SelectionGeometryMirror
{
    private readonly _d: Diagram;
    private _target: Figure | undefined;
    private _seeding = false;
    // True while a _writeBack is pushing a value INTO the figure. Writing one
    // field (e.g. Height, from a lock-linked resize) fires the figure's change
    // listener, which would otherwise re-seed EVERY SelectedShape* from the
    // figure — reading a SIBLING field (Width) that is still mid-update and
    // clobbering the correct inspector value. We already hold the values we're
    // writing, so a re-seed here is both redundant and corrupting; suppress it.
    private _writingBack = false;
    private _figureUnsub: (() => void) | undefined;

    constructor(diagram: Diagram)
    {
        this._d = diagram;
        const D = diagram.constructor as typeof import('../diagram.js').Diagram;
        diagram.AddSelectionChangedListener(() => this._retarget());
        // Edits flowing IN from the inspector → write to the Figure.
        diagram.PropertyChanged(D.SelectedShapeLeftKey).subscribe(     () => this._writeBack('Left'));
        diagram.PropertyChanged(D.SelectedShapeTopKey).subscribe(      () => this._writeBack('Top'));
        diagram.PropertyChanged(D.SelectedShapeWidthKey).subscribe(    () => this._writeBack('Width'));
        diagram.PropertyChanged(D.SelectedShapeHeightKey).subscribe(   () => this._writeBack('Height'));
        diagram.PropertyChanged(D.SelectedShapeRotationKey).subscribe( () => this._writeBack('Rotation'));
        // Per-shape editor intents (lock aspect, position anchor) also mirror
        // to/from the Figure so they are per-shape and persist.
        diagram.PropertyChanged(D.SelectedShapeLockAspectKey).subscribe(() => this._writeBack('LockAspect'));
        diagram.PropertyChanged(D.SelectedShapeAnchorKey).subscribe(    () => this._writeBack('Anchor'));
        this._retarget();
    }

    private _singleFigure(): Figure | undefined
    {
        const items = this._d.SelectedItems;
        if (items.length !== 1) return undefined;
        // Resolve the item to its Figure container — the item itself may be a
        // NodeViewModel (content node), whose container carries the geometry.
        const container = this._d.Generator.ContainerFromItem(items[0]);
        return container instanceof Figure ? container : undefined;
    }

    private _retarget(): void
    {
        this._figureUnsub?.(); this._figureUnsub = undefined;
        this._target = this._singleFigure();
        const D = this._d.constructor as typeof import('../diagram.js').Diagram;
        this._d.set_property_value(D.HasSelectedShapeKey, this._target !== undefined);
        const f = this._target;
        if (f !== undefined)
        {
            const seed = (): void => this._seed(f);
            const keys = [Figure.LeftKey, Figure.TopKey, Visual.WidthKey, Visual.HeightKey,
                          Figure.RotationKey, Figure.BaseWidthKey, Figure.BaseHeightKey,
                          Figure.LockAspectRatioKey, Figure.PositionFromKey];
            const subs: Disposable[] = keys.map(k => f.PropertyChanged(k).subscribe(seed));
            this._figureUnsub = (): void => { for (const s of subs) s.dispose(); };
            this._seed(f);
        }
    }

    private _seed(f: Figure): void
    {
        // A figure change fired by our own _writeBack must not re-seed — the
        // figure is only partially updated and would overwrite in-flight
        // sibling values (see _writingBack). External changes (canvas drag /
        // resize) still seed normally.
        if (this._writingBack) return;
        const D = this._d.constructor as typeof import('../diagram.js').Diagram;
        this._seeding = true;
        try
        {
            this._d.SelectedShapeLeft     = f.Left;
            this._d.SelectedShapeTop      = f.Top;
            this._d.SelectedShapeWidth    = f.Width;
            this._d.SelectedShapeHeight   = f.Height;
            this._d.SelectedShapeRotation = f.Rotation;
            this._d.set_property_value(D.SelectedShapeBaseWidthKey,  Number.isNaN(f.BaseWidth)  ? f.Width  : f.BaseWidth);
            this._d.set_property_value(D.SelectedShapeBaseHeightKey, Number.isNaN(f.BaseHeight) ? f.Height : f.BaseHeight);
            this._d.SelectedShapeLockAspect = f.LockAspectRatio;
            this._d.SelectedShapeAnchor     = f.PositionFrom;
        }
        finally { this._seeding = false; }
    }

    private _writeBack(prop: 'Left' | 'Top' | 'Width' | 'Height' | 'Rotation' | 'LockAspect' | 'Anchor'): void
    {
        if (this._seeding || this._target === undefined) return;
        // Each inspector DP maps to the value to push and the Figure property to
        // write it onto (lock/anchor use different names than the SelectedShape*
        // key, hence the explicit figProp).
        const spec = ({
            Left:       { v: this._d.SelectedShapeLeft,       figProp: 'Left' },
            Top:        { v: this._d.SelectedShapeTop,        figProp: 'Top' },
            Width:      { v: this._d.SelectedShapeWidth,      figProp: 'Width' },
            Height:     { v: this._d.SelectedShapeHeight,     figProp: 'Height' },
            Rotation:   { v: this._d.SelectedShapeRotation,   figProp: 'Rotation' },
            LockAspect: { v: this._d.SelectedShapeLockAspect, figProp: 'LockAspectRatio' },
            Anchor:     { v: this._d.SelectedShapeAnchor,     figProp: 'PositionFrom' },
        })[prop];
        // Guard the figure write so the change it fires can't re-seed us from a
        // half-updated figure (which would clobber the sibling field a
        // lock-linked resize is writing in the same gesture).
        this._writingBack = true;
        try { (this._target as unknown as Record<string, unknown>)[spec.figProp] = spec.v; }
        finally { this._writingBack = false; }
    }
}
