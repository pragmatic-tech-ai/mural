import type { Visual } from '../../runtime/index.js';
import { SvgDomDrawingContext } from './svg-dom-drawing-context.js';
import { pathGeometryToSvgD } from '../geometry/path-to-svg.js';
import type { PathGeometry } from '../geometry/geometry.js';

// Live-DOM renderer that paints a Visual tree into an `<svg>` surface
// and keeps the painted result in lock-step with the visual tree on
// subsequent layout / render invalidations.
//
// Document structure per visual:
//
//   <g class="mural-visual" [transform=…] [clip-path=…]>
//     <rect class="mural-hit" .../>     // invisible pointer-event pad
//     <g class="mural-own">             // present IFF RenderOverride
//       … RenderOverride emissions …    //   produced ≥ 1 primitive;
//     </g>                              //   detached when empty so
//                                       //   layout-only Visuals (panels,
//                                       //   presenters, containers)
//                                       //   don't pay for an empty <g>.
//     … child visuals' outer <g>s …
//   </g>
//
// The outer `<g>` carries the per-visual translate (from ArrangedRect)
// and clip-path (from the Visual.Clip DP) so child visuals inherit
// both transforms. The inner `<g class="mural-own">` is the only thing
// touched on a render-only invalidation — child outers stay put.
// When `repaintOwn` runs and the visual emits no primitives, the own
// group is removed from the outer; a later re-paint that does emit
// primitives re-inserts it (right after the hit pad, before children).
//
// Each outer `<g>` is stamped with the VISUAL_BACKREF symbol so the
// HtmlTarget's pointer hit-test (event.target → ancestor walk → back
// reference) can recover the Visual that owns any painted node.
//
// Lifecycle:
//   1. The first Render() walks the whole tree, creating outer + own
//      groups for every Visual and emitting primitives.
//   2. Subsequent Render()s drain the PresentationTarget's renderDirty
//      and arrangeDirty Sets:
//        * render-dirty visuals → own group cleared + re-emitted
//        * arrange-dirty visuals → outer group's transform updated
//        * brand-new visuals    → outer + own created and inserted at
//                                  the right position in the parent
//        * removed visuals      → outer detached and dropped from the map
//
// Limitations / deferred:
//   * No render-tree partition for templated subtrees — the renderer
//     walks `visualChildren`, which already gives the post-template
//     view. Template internals get one `<g>` each like any other Visual.
//   * No measurement / arrange — that's the PresentationTarget's job
//     and runs in Flush() before the render pass.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Stamped on every visual's outer `<g>` so HtmlTarget.HitTest can walk
// `event.target`'s ancestors to recover the owning Visual.
// `Symbol.for` keeps the stamp the same across module boundaries —
// extensions or other packages that grab the same registry symbol
// see the same key.
export const VISUAL_BACKREF: unique symbol = Symbol.for('mural:visual-backref');

interface BackrefHost { [VISUAL_BACKREF]?: Visual; }

interface VisualNodes
{
    outer: SVGGElement;
    // Invisible <rect> sized to the visual's ArrangedRect so the whole
    // arranged area is a pointer-event target. Without it, the SVG
    // default (visiblePainted) would miss any whitespace — wheel /
    // hover over the gap between text glyphs in a TreeView row would
    // silently fall through instead of dispatching to the row.
    hit:   SVGRectElement;
    own:   SVGGElement;
    // Lazily-created <g class="mural-children" clip-path> hosting the child
    // outers when ChildClip is set. Positioned after `own`, so own paint stays
    // unclipped and children paint on top. Absent when ClipToBounds is off.
    children?: SVGGElement;
    // Persistent <foreignObject> for a DomHost — created once, parked in the
    // outer group, sized on arrange, and NEVER touched by repaintOwn, so the
    // hosted DOM (a Monaco editor, a webview) survives render invalidations
    // instead of being torn down. Absent for ordinary painted visuals.
    foreign?: SVGForeignObjectElement;
    // Last (X, Y, W, H) the renderer wrote into the outer's transform
    // and the hit pad's dimensions. Used to detect arrange changes
    // that happened during a layout cascade without an explicit
    // InvalidateArrange — e.g., siblings of a collapsing visual shift
    // Y, but the dirty-Set says nothing about them. Comparing per-walk
    // is O(1) and far cheaper than reapplying both attributes for
    // every visual on every render.
    lastX: number;
    lastY: number;
    lastW: number;
    lastH: number;
    // Whether the outer <g> currently carries display="none". Tracked so the
    // visibility gate only touches the DOM on an actual transition — a visible
    // node's walk otherwise called removeAttribute('display') EVERY pass (a top
    // native hotspot in the render profile), and the common case is no change.
    displayNone: boolean;
}

export interface SvgRendererOptions
{
    /** Owner document used to create elements. Defaults to globalThis
     *  .document; tests using jsdom can pass an explicit document. */
    document?: Document;
}

// Structural 2D affine — matches the Matrix class without importing it (the
// renderer stays dependency-free of runtime/visual-engine).
type MatrixLike = {
    M11: number; M12: number; M21: number; M22: number;
    OffsetX: number; OffsetY: number;
    IsIdentity: boolean;
};

// Companion accessors the renderer needs from each Visual. Declared as
// a structural interface so this file doesn't depend on the concrete
// Visual class (which would cycle through runtime/visual-engine).
interface RenderableVisual extends BackrefHost
{
    readonly ArrangedRect: { X: number; Y: number; Width: number; Height: number };
    readonly Clip:         unknown;
    // Visual.ChildClip — clips the CHILDREN only (not own paint), applied via a
    // `mural-children` group. Undefined means children paint directly in the
    // outer <g> as usual.
    readonly ChildClip:    unknown;
    readonly IsHitTestVisible: boolean;
    // Visual.Visibility — string-enum: 'Visible' (paint + hit-test),
    // 'Hidden' (slot reserved, no paint, no hit), 'Collapsed' (zero
    // slot, no paint, no hit). The renderer compares to the literal
    // 'Visible' so a missing import here doesn't drag the enum in.
    readonly Visibility:       string;
    readonly Cursor:           string | undefined;
    readonly Effect:           { toCssFilter(): string } | undefined;
    readonly Opacity:          number;
    // Visual.RenderTransform — affine applied after Arrange, before
    // child paint. Reading `.Matrix` returns the composed 2D affine;
    // undefined means identity (skip the matrix factor entirely so the
    // outer <g>'s transform attribute stays minimal). The renderer
    // never mutates the transform.
    readonly RenderTransform: { readonly Matrix: MatrixLike } | undefined;
    // Visual.RenderTransformOrigin — fraction of RenderSize used as the
    // pivot for RenderTransform. (0, 0) = top-left; (0.5, 0.5) = center.
    readonly RenderTransformOrigin: { X: number; Y: number };
    // Visual.EffectiveLayoutMatrix — the composed LayoutTransform (shifted so
    // its transformed bbox min sits at the local origin), or undefined when
    // there's no LayoutTransform. Emitted INNER to RenderTransform so the layout
    // scale applies to content first, matching the measure/arrange footprint.
    readonly EffectiveLayoutMatrix: MatrixLike | undefined;
    // Optional live DOM element (DomHost) to host inside a <foreignObject>.
    // Present only on DOM-hosting visuals; undefined for every ordinary
    // painted visual, so the renderer skips the foreignObject path for them.
    readonly ForeignElement?: HTMLElement;
    readonly visualChildren: Iterable<RenderableVisual>;
    Render(dc: SvgDomDrawingContext): void;
}

// Compose the outer <g> `transform` attribute from the arrange offset, an
// optional RenderTransform (pivoted by RenderTransformOrigin × ArrangedRect),
// and an optional LayoutTransform (EffectiveLayoutMatrix). SVG applies a
// transform list right-to-left to a point, so the emitted order is
// `translate(offset)  RenderTransform-block  matrix(layout)` — layout innermost
// (applied to content first), render outer, offset outermost. Returns undefined
// when nothing applies (keeps the DOM clean). Pure + unit-tested.
export function buildTransformAttr(
    rect: { X: number; Y: number; Width: number; Height: number },
    layout: MatrixLike | undefined,
    render: MatrixLike | undefined,
    origin: { X: number; Y: number },
): string | undefined
{
    const hasRender = render !== undefined && !render.IsIdentity;
    const hasLayout = layout !== undefined && !layout.IsIdentity;
    const hasOffset = rect.X !== 0 || rect.Y !== 0;
    if (!hasRender && !hasLayout && !hasOffset) return undefined;
    const parts: string[] = [];
    if (hasOffset)
    {
        parts.push(`translate(${formatNumber(rect.X)},${formatNumber(rect.Y)})`);
    }
    if (hasRender)
    {
        const ox = origin.X * rect.Width;
        const oy = origin.Y * rect.Height;
        const m  = render!;
        if (ox !== 0 || oy !== 0) parts.push(`translate(${formatNumber(ox)},${formatNumber(oy)})`);
        parts.push(`matrix(${formatNumber(m.M11)},${formatNumber(m.M12)},${formatNumber(m.M21)},${formatNumber(m.M22)},${formatNumber(m.OffsetX)},${formatNumber(m.OffsetY)})`);
        if (ox !== 0 || oy !== 0) parts.push(`translate(${formatNumber(-ox)},${formatNumber(-oy)})`);
    }
    if (hasLayout)
    {
        const m = layout!;
        parts.push(`matrix(${formatNumber(m.M11)},${formatNumber(m.M12)},${formatNumber(m.M21)},${formatNumber(m.M22)},${formatNumber(m.OffsetX)},${formatNumber(m.OffsetY)})`);
    }
    return parts.length > 0 ? parts.join(' ') : undefined;
}

export class SvgRenderer
{
    private readonly surface: SVGSVGElement;
    private readonly defs:    SVGDefsElement;
    private readonly doc:     Document;

    // Visual → its outer + own `<g>` pair. Populated lazily on first
    // visit, kept stable across re-render passes so DOM identity (and
    // any consumer-side references to elements) survive incremental
    // updates.
    private readonly nodes: Map<RenderableVisual, VisualNodes> = new Map();

    // Monotonic counter for `<clipPath>` ids — passed to every
    // SvgDomDrawingContext instance so siblings rendering into the
    // same surface don't collide on identifiers.
    private clipCounter:     number = 0;
    private gradientCounter: number = 0;
    // Cross-DC ImageBrush pattern cache. Same URI + Stretch / Alignment
    // reuses a single `<pattern>` in `<defs>` across every Visual and
    // every repaint, so the browser only resolves the href once per
    // unique (URI, fit) pair on the surface. Cleared in Dispose.
    private imagePatternCache: Map<string, string> = new Map<string, string>();

    constructor(surface: SVGSVGElement, options: SvgRendererOptions = {})
    {
        this.surface = surface;
        this.doc     = options.document ?? globalThis.document;

        // Single `<defs>` block for the surface. Created once,
        // re-used by every DC instance. Cleared during Dispose; the
        // renderer never empties it mid-session because clip-path ids
        // could still be referenced by retained nodes from prior
        // passes (incremental updates keep some clip groups alive).
        //
        // localName test (not `instanceof SVGDefsElement`) so the
        // check works in test environments — jsdom defines the
        // element but not the constructor as a global.
        const existing = surface.querySelector('defs');
        if (existing !== null && existing.localName === 'defs')
        {
            this.defs = existing as SVGDefsElement;
        }
        else
        {
            this.defs = this.doc.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
            surface.insertBefore(this.defs, surface.firstChild);
        }
    }

    // Render (or re-render) the given root Visual subtrees into the
    // surface. Idempotent: calling Render again after no invalidations
    // does nothing observable; calling it after invalidations brings
    // the DOM up to date with the current visual tree.
    //
    // `root` is the PresentationTarget's Content; `overlay` is its
    // OverlayRoot (or undefined when nothing has called AttachOverlay
    // yet). Both are passed explicitly so the renderer doesn't depend
    // on the target type. The renderer walks every reachable visual
    // and reconciles its DOM presence:
    //
    //   * Visit a known visual → maybe update transform / clip, maybe
    //     re-emit own primitives if render-dirty.
    //   * Visit a new visual   → create outer + own groups, insert at
    //     the right position under its parent's outer.
    //   * After walking everything reachable, any leftover entry in
    //     `nodes` is an orphan from a tree mutation → detach + drop.
    //
    // Document order is `<defs>`, Content's outer `<g>`, then the
    // overlay's outer `<g>` — overlay paints last (i.e., on top of
    // Content) and `elementsFromPoint` returns its nodes first.
    //
    // The renderer accepts the renderDirty / arrangeDirty Sets from
    // the PresentationTarget and drains them. Passing `null` for both
    // means "full re-render of the whole subtree" — used on the very
    // first paint when nothing is in the map yet.
    public Render(
        root:        Visual | undefined,
        overlay:     Visual | undefined,
        renderDirty: Set<Visual> | null,
        arrangeDirty: Set<Visual> | null,
    ): void
    {
        // Track which visuals were visited so we can reap orphans.
        const visited = new Set<RenderableVisual>();
        if (root !== undefined)
        {
            this.walk(
                root as unknown as RenderableVisual,
                this.surface,
                renderDirty as unknown as Set<RenderableVisual> | null,
                arrangeDirty as unknown as Set<RenderableVisual> | null,
                visited,
            );
        }
        if (overlay !== undefined)
        {
            this.walk(
                overlay as unknown as RenderableVisual,
                this.surface,
                renderDirty as unknown as Set<RenderableVisual> | null,
                arrangeDirty as unknown as Set<RenderableVisual> | null,
                visited,
            );
        }
        // Reap orphans — visuals in the map but not visited this pass.
        for (const v of this.nodes.keys())
        {
            if (!visited.has(v))
            {
                const info = this.nodes.get(v)!;
                info.outer.remove();
                this.nodes.delete(v);
            }
        }
        renderDirty?.clear();
        arrangeDirty?.clear();
    }

    // Walk the visual subtree depth-first, reconciling the DOM
    // against `visual` and recursing into its visualChildren. Returns
    // the visual's outer `<g>` so the caller can insert it into the
    // parent if it's new.
    private walk(
        visual:       RenderableVisual,
        parentNode:   SVGElement,
        renderDirty:  Set<RenderableVisual> | null,
        arrangeDirty: Set<RenderableVisual> | null,
        visited:      Set<RenderableVisual>,
    ): void
    {
        visited.add(visual);

        let info = this.nodes.get(visual);
        const isNew = info === undefined;

        if (info === undefined)
        {
            const hit = this.doc.createElementNS(SVG_NS, 'rect') as SVGRectElement;
            // Invisible fill but `pointer-events: all` keeps the rect
            // hit-testable. The pad sits BEHIND own + children so its
            // hits register only when no painted descendant intercepts
            // first (DOM document order — the hit pad is added before
            // own + child outers).
            hit.setAttribute('class', 'mural-hit');
            hit.setAttribute('fill', 'none');
            hit.setAttribute('pointer-events', 'all');
            info = {
                outer: this.doc.createElementNS(SVG_NS, 'g') as SVGGElement,
                hit,
                own:   this.doc.createElementNS(SVG_NS, 'g') as SVGGElement,
                // NaN sentinels guarantee the first applyTransform /
                // applyHitPad fire for a brand-new node — NaN never
                // equals anything (including itself).
                lastX: Number.NaN,
                lastY: Number.NaN,
                lastW: Number.NaN,
                lastH: Number.NaN,
                // A brand-new outer <g> has no display attribute yet.
                displayNone: false,
            };
            info.outer.setAttribute('class', 'mural-visual');
            info.own  .setAttribute('class', 'mural-own');
            (info.outer as unknown as BackrefHost)[VISUAL_BACKREF] = visual as unknown as Visual;
            // Order matters for hit-test priority. elementsFromPoint
            // returns front-to-back (last sibling on top), so the hit
            // pad goes FIRST and gets the lowest priority — descendants
            // and own-group paint always win when they cover the point.
            info.outer.appendChild(info.hit);
            // `own` is left detached for now — repaintOwn (called below)
            // inserts it iff the visual emits at least one primitive.
            this.nodes.set(visual, info);
        }

        // Ensure the outer <g> lives under the CURRENT walk parent. A fresh node
        // has no DOM parent yet; a Visual reparented in the visual tree AFTER its
        // first render (e.g. ContainerPlacement re-homing a Figure into a
        // container's child host) keeps its existing <g> — appendChild RELOCATES
        // an already-attached element to the new parent. Without this the SVG DOM
        // diverges from the visual tree and ancestor transforms stop composing
        // onto the moved subtree, so the subtree renders at its stale position.
        // (applyChildClip, which runs before the child recursion, already places
        // a visual's own children into/out of its clip group, so this is a no-op
        // in that case — the parents already match.)
        if (info.outer.parentNode !== parentNode)
        {
            parentNode.appendChild(info.outer);
        }

        // Visibility gate. Hidden / Collapsed both suppress paint AND
        // hit-testing. `display="none"` is the cleanest SVG knob — it
        // cascades to every descendant element (so we don't need to
        // touch each child <g>) and removes the subtree from the
        // browser's hit-test walk in one shot. The own group and any
        // child rects/transforms are NOT updated while invisible:
        // there's nothing to paint and the rect/transform can lag until
        // the visual becomes visible again, at which point a render-
        // dirty signal will refresh everything.
        //
        // The subtree is still marked visited so the post-walk orphan
        // sweep doesn't reap each descendant's DOM (which would force a
        // full rebuild on every Visibility toggle).
        if (visual.Visibility !== 'Visible')
        {
            // Only write the attribute on the Visible→hidden transition; a node
            // that was already hidden needs no DOM touch.
            if (!info.displayNone)
            {
                info.outer.setAttribute('display', 'none');
                info.displayNone = true;
            }
            this.markSubtreeVisited(visual, visited);
            return;
        }
        // Clear a stale `display="none"` only when one is actually present —
        // the common visible-node case then does no DOM work at all.
        if (info.displayNone)
        {
            info.outer.removeAttribute('display');
            info.displayNone = false;
        }

        // DOM host (DomHost): wrap the visual's `ForeignElement` in a
        // persistent <foreignObject> parked in the OUTER group. Created once
        // and never touched by repaintOwn, so a stateful embed — a Monaco
        // editor, a webview — survives every render-only invalidation instead
        // of being torn down. Lazy: the host element materialises when a
        // consumer first mounts into it, which may be after the first paint,
        // so this reconciles on every walk (not just the isNew branch).
        const foreignEl = visual.ForeignElement;
        if (foreignEl !== undefined && info.foreign === undefined)
        {
            const fo = this.doc.createElementNS(SVG_NS, 'foreignObject') as SVGForeignObjectElement;
            fo.setAttribute('x', '0');
            fo.setAttribute('y', '0');
            // The host element is created in the ambient document; adopt it
            // into the surface's document when they differ (off-screen / multi-
            // document hosts) so appendChild won't throw a WrongDocument error.
            const owned = foreignEl.ownerDocument === this.doc
                ? foreignEl
                : (this.doc.adoptNode(foreignEl) as HTMLElement);
            fo.appendChild(owned);
            // Appended AFTER the hit pad (later in document order → painted on
            // top), so the embedded DOM wins native pointer events over the
            // mural hit rect sitting behind it.
            info.outer.appendChild(fo);
            info.foreign = fo;
            // Force the transform/size block below to run this pass even if the
            // rect looks unchanged, so a late-materialised host is sized at once.
            info.lastW = Number.NaN;
        }

        // Detect rect changes from the previous render so the cascade
        // logic below can refresh transform, hit-pad, AND own primitives
        // even when the dirty Sets miss them (an Arrange-cascade past
        // siblings doesn't necessarily flag every affected visual).
        const rect = visual.ArrangedRect;
        const sizeChanged = info.lastW !== rect.Width || info.lastH !== rect.Height;
        const moveChanged = info.lastX !== rect.X     || info.lastY !== rect.Y;

        // Transform AND hit-pad geometry — apply on first paint, on an
        // explicit dirty signal, or whenever the visual's ArrangedRect
        // actually moved / resized. The direct rect comparison catches
        // sibling shifts that happen during an Arrange cascade without
        // an explicit InvalidateArrange (a CollapsibleStack collapsing
        // repositions everything below it, but the dirty Sets don't
        // track that). renderDirty also triggers: Visual.RenderTransform
        // and RenderTransformOrigin flag render-dirty (not arrange-
        // dirty), and applyTransform composes both into the outer <g>
        // attribute, so a transform-only change re-emits the string.
        if (isNew || renderDirty === null || arrangeDirty === null
            || arrangeDirty.has(visual) || moveChanged || sizeChanged
            || renderDirty.has(visual))
        {
            this.applyTransform(info.outer, visual);
            this.applyHitPad(info.hit, visual);
            if (info.foreign !== undefined) this.applyForeignSize(info.foreign, visual);
            info.lastX = rect.X;
            info.lastY = rect.Y;
            info.lastW = rect.Width;
            info.lastH = rect.Height;
        }
        // Clip — respond to BOTH arrange-dirty (rect-driven repositioning
        // could expose a stale clip rect) AND render-dirty (the Clip DP
        // itself was reassigned — MetaData.Render only populates
        // renderDirty, so without this branch a runtime clip change
        // would never reach the DOM).
        if (isNew || renderDirty === null || arrangeDirty === null
            || arrangeDirty.has(visual) || renderDirty.has(visual))
        {
            this.applyClip(info.outer, visual);
            this.applyHitTestVisibility(info.outer, info.hit, visual);
            this.applyCursor(info.outer, visual);
            this.applyEffect(info.outer, visual);
            this.applyOpacity(info.outer, visual);
        }

        // Own primitives — re-emit on first paint, when render-dirty,
        // OR when the visual's SIZE changed. Size matters because
        // RenderOverride emissions (rects, paths, etc.) typically use
        // RenderSize / ArrangedRect, so a Border that grew from 0×0 to
        // 10×500 has its own group stale until we re-emit. Position-
        // only moves don't need this — the outer <g> translate handles
        // them — so `moveChanged` alone is NOT a trigger.
        if (isNew || renderDirty === null || renderDirty.has(visual) || sizeChanged)
        {
            this.repaintOwn(info, visual);
        }

        // Children-only clip. AFTER repaintOwn so the mural-children group is
        // inserted after `own` (own paint stays unclipped). ChildClip is
        // rebuilt at arrange, so respond to arrange-dirty as well as render.
        if (isNew || renderDirty === null || arrangeDirty === null
            || arrangeDirty.has(visual) || renderDirty.has(visual) || sizeChanged)
        {
            this.applyChildClip(info, visual);
        }

        // Recurse into children — into the clipped group when present, else the
        // outer <g>. Each child's walk re-uses an existing outer (no DOM move)
        // or creates + inserts under the given parent.
        // Recurse in visualChildren (paint) order AND reconcile DOM order: each
        // child's outer <g> is positioned to directly follow the previous child's
        // outer, so a ZIndex reorder (which reorders visualChildren) repaints in
        // the new order. insertBefore fires ONLY on a mismatch, so a correctly-
        // ordered subtree does zero DOM writes. The parent's own hit/own/foreign
        // nodes precede all child outers and are never moved (they are not
        // g.mural-visual). walk() has already ensured each child's outer lives
        // under childParent (relocating reparented nodes), so we only reorder here.
        const childParent = info.children ?? info.outer;
        let prevOuter: SVGGElement | undefined;
        for (const child of visual.visualChildren)
        {
            this.walk(child, childParent, renderDirty, arrangeDirty, visited);
            const childInfo = this.nodes.get(child);
            if (childInfo === undefined) continue;
            const outer = childInfo.outer;
            if (outer.parentNode !== childParent)
            {
                // Defensive: a child skipped by walk's relocation. Leave it.
            }
            else if (prevOuter === undefined)
            {
                // Must be the first child-outer under childParent.
                const firstChildOuter = childParent.querySelector(':scope > g.mural-visual');
                if (firstChildOuter !== null && firstChildOuter !== outer)
                    childParent.insertBefore(outer, firstChildOuter);
            }
            else if (outer.previousElementSibling !== prevOuter)
            {
                childParent.insertBefore(outer, prevOuter.nextSibling);
            }
            prevOuter = outer;
        }
    }

    // Recursively mark every descendant of a non-Visible visual as
    // visited so the post-walk orphan sweep doesn't reap their DOM. We
    // skipped the real walk for the parent (display="none" cascades
    // visually), but the descendants' info entries still exist in
    // `this.nodes` and would otherwise be treated as orphans on the
    // next pass. No DOM work — purely a bookkeeping pass.
    private markSubtreeVisited(
        visual:  RenderableVisual,
        visited: Set<RenderableVisual>,
    ): void
    {
        for (const child of visual.visualChildren)
        {
            visited.add(child);
            this.markSubtreeVisited(child, visited);
        }
    }

    // Compose the outer <g> transform from THREE inputs:
    //
    //   1. ArrangedRect.X / Y — position assigned by the parent's
    //      Arrange pass. Always applied (translates the visual into
    //      its layout slot).
    //   2. Visual.RenderTransformOrigin — pivot fraction (0..1 per
    //      axis) of RenderSize. (0, 0) is top-left (default — WPF
    //      parity); (0.5, 0.5) is center.
    //   3. Visual.RenderTransform.Matrix — the affine itself. Skipped
    //      when undefined or identity, so the typical "no transform"
    //      case stays a plain translate.
    //
    // SVG transform list applies LEFT-TO-RIGHT to the coordinate
    // system, equivalently right-to-left to a point. We emit:
    //
    //     translate(rect.X, rect.Y)
    //       translate(originX·W, originY·H)
    //         matrix(M11, M12, M21, M22, OffsetX, OffsetY)
    //       translate(-originX·W, -originY·H)
    //
    // — so the matrix applies in local space pivoted at the origin,
    // and the rect translate positions the result. Removing the
    // attribute entirely when nothing applies (no offset AND no
    // transform) keeps the DOM clean for the common case.
    private applyTransform(outer: SVGGElement, visual: RenderableVisual): void
    {
        const attr = buildTransformAttr(
            visual.ArrangedRect,
            visual.EffectiveLayoutMatrix,
            visual.RenderTransform?.Matrix,
            visual.RenderTransformOrigin,
        );
        if (attr === undefined) outer.removeAttribute('transform');
        else outer.setAttribute('transform', attr);
    }

    // Resize the hit pad to mirror the visual's ArrangedRect so the
    // whole area picks up pointer events even when no descendant
    // paints there. A zero-area pad is set to size 0 (so collapsed /
    // 0×0 visuals don't unexpectedly capture events from neighbours).
    private applyHitPad(hit: SVGRectElement, visual: RenderableVisual): void
    {
        const rect = visual.ArrangedRect;
        hit.setAttribute('width',  formatNumber(Math.max(0, rect.Width)));
        hit.setAttribute('height', formatNumber(Math.max(0, rect.Height)));
    }

    // Size a DomHost's <foreignObject> to the visual's arranged box. x / y
    // stay 0 — the outer <g> already carries the ArrangedRect translate — so
    // only width / height track the layout. A <foreignObject> needs explicit
    // dimensions or its HTML content won't lay out or paint at all.
    private applyForeignSize(fo: SVGForeignObjectElement, visual: RenderableVisual): void
    {
        const rect = visual.ArrangedRect;
        fo.setAttribute('width',  formatNumber(Math.max(0, rect.Width)));
        fo.setAttribute('height', formatNumber(Math.max(0, rect.Height)));
    }

    // Clip handling: when Visual.Clip is set, emit a `<clipPath>` in
    // <defs> and reference it from the outer `<g>`. When clearing, drop
    // both the reference and any prior clip-path def the renderer owns
    // for this visual. Tracked via a WeakMap so we can find and remove
    // the prior def without scanning <defs>.
    private clipDefs = new WeakMap<RenderableVisual, SVGElement>();
    private childClipDefs = new WeakMap<RenderableVisual, SVGElement>();

    // Mirror IsHitTestVisible onto BOTH the outer <g> and the mural-hit
    // pad. When false, the outer gets `pointer-events="none"` so this
    // visual drops out of the elementsFromPoint walk; the PAD also gets
    // "none" so it doesn't catch events with its explicit "all" — that
    // matters for container visuals (an AdornerLayer painted over a
    // subtree) that want to be transparent to events so hits fall
    // through to siblings underneath. Descendants with their own
    // explicit `pointer-events="all"` (their own mural-hit pad) keep
    // working — CSS cascade silences inheritance, but explicit
    // overrides win. When true (the default), clear the outer's
    // attribute and restore the pad's explicit "all".
    private applyHitTestVisibility(outer: SVGGElement, hit: SVGRectElement, visual: RenderableVisual): void
    {
        if (visual.IsHitTestVisible)
        {
            outer.removeAttribute('pointer-events');
            hit.setAttribute('pointer-events', 'all');
        }
        else
        {
            outer.setAttribute('pointer-events', 'none');
            hit.setAttribute('pointer-events', 'none');
        }
    }

    // Mirror Visual.Cursor onto the outer <g>'s `cursor` attribute.
    // Undefined clears the attribute so the browser inherits from the
    // parent SVG element (matching CSS cursor inheritance). Anything
    // else passes through verbatim — accepts standard CSS keywords
    // ('ew-resize', 'pointer', 'grab') and url(...) references.
    private applyCursor(outer: SVGGElement, visual: RenderableVisual): void
    {
        const cursor = visual.Cursor;
        if (cursor === undefined)
        {
            outer.removeAttribute('cursor');
        }
        else
        {
            outer.setAttribute('cursor', cursor);
        }
    }

    // Visual.Effect → CSS `filter` on the outer wrapper. Setting
    // `filter` rather than `<filter>` keeps the implementation small
    // and works in both HTML and SVG contexts. The check for an
    // equal filter string avoids re-touching the DOM when the visual
    // is render-dirty for an unrelated reason.
    private applyEffect(outer: SVGGElement, visual: RenderableVisual): void
    {
        const effect = visual.Effect;
        const next = effect !== undefined ? effect.toCssFilter() : '';
        if (outer.style.filter !== next)
        {
            outer.style.filter = next;
        }
    }

    // Visual.Opacity → outer <g>'s `opacity` attribute. SVG composes
    // group opacities multiplicatively, so a 0.5-opacity ancestor with
    // a 0.5-opacity child renders the child at 0.25 — matching WPF's
    // Opacity-cascade semantics. Omitting the attribute when the value
    // is 1 (fully opaque) keeps the painted DOM clean.
    //
    // Hit-testing intentionally ignores opacity here; that's
    // applyHitTestVisibility's job. WPF parity: an Opacity=0 visual
    // still receives pointer events unless IsHitTestVisible is also
    // false. Authors hide-and-disable by flipping both DPs.
    private applyOpacity(outer: SVGGElement, visual: RenderableVisual): void
    {
        const raw = visual.Opacity;
        const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
        if (clamped >= 1)
        {
            outer.removeAttribute('opacity');
        }
        else
        {
            outer.setAttribute('opacity', formatNumber(clamped));
        }
    }

    // Build a fresh <clipPath> for `geom` (rect / ellipse / path — the same
    // geometry classes the DC recognises), append it to defs, and return it —
    // or undefined for an unsupported / empty geometry. Shared by the
    // whole-subtree Clip (applyClip) and the children-only ChildClip
    // (applyChildClip); the geometry is in the visual's local space either way.
    private buildClipPath(geom: unknown): SVGElement | undefined
    {
        const clip = geom as { Rect?: unknown; Center?: unknown; Figures?: unknown } | undefined;
        if (clip === undefined || clip === null) return undefined;

        const id = `mural-clip-${this.clipCounter++}`;
        const cp = this.doc.createElementNS(SVG_NS, 'clipPath') as SVGElement;
        cp.setAttribute('id', id);

        if ('Rect' in (clip as object))
        {
            const r = clip as { Rect: { X: number; Y: number; Width: number; Height: number };
                                 RadiusX: number; RadiusY: number };
            const shape = this.doc.createElementNS(SVG_NS, 'rect') as SVGElement;
            shape.setAttribute('x',      formatNumber(r.Rect.X));
            shape.setAttribute('y',      formatNumber(r.Rect.Y));
            shape.setAttribute('width',  formatNumber(r.Rect.Width));
            shape.setAttribute('height', formatNumber(r.Rect.Height));
            if (r.RadiusX > 0) shape.setAttribute('rx', formatNumber(r.RadiusX));
            if (r.RadiusY > 0) shape.setAttribute('ry', formatNumber(r.RadiusY));
            cp.appendChild(shape);
        }
        else if ('Center' in (clip as object))
        {
            const e = clip as { Center: { X: number; Y: number }; RadiusX: number; RadiusY: number };
            const shape = this.doc.createElementNS(SVG_NS, 'ellipse') as SVGElement;
            shape.setAttribute('cx', formatNumber(e.Center.X));
            shape.setAttribute('cy', formatNumber(e.Center.Y));
            shape.setAttribute('rx', formatNumber(e.RadiusX));
            shape.setAttribute('ry', formatNumber(e.RadiusY));
            cp.appendChild(shape);
        }
        else if ('Figures' in (clip as object))
        {
            // Arbitrary path clip (e.g. a shaped Figure's silhouette).
            // Lower to <path d="…"> via the SAME serializer DrawGeometry
            // uses, so the clip tracks the painted outline exactly.
            const path = clip as unknown as PathGeometry;
            const shape = this.doc.createElementNS(SVG_NS, 'path') as SVGElement;
            shape.setAttribute('d', pathGeometryToSvgD(path));
            if ((clip as { FillRule?: string }).FillRule === 'evenodd')
                shape.setAttribute('clip-rule', 'evenodd');
            cp.appendChild(shape);
        }
        else
        {
            return undefined;   // Unsupported clip shape.
        }

        this.defs.appendChild(cp);
        return cp;
    }

    private applyClip(outer: SVGGElement, visual: RenderableVisual): void
    {
        // Tear down any prior clip-path def we own for this visual.
        const prior = this.clipDefs.get(visual);
        if (prior !== undefined)
        {
            prior.remove();
            this.clipDefs.delete(visual);
            outer.removeAttribute('clip-path');
        }
        // Clip wraps the WHOLE subtree (own + children), so it lives on the
        // outer <g>, not nested inside the own group.
        const cp = this.buildClipPath(visual.Clip);
        if (cp === undefined) return;
        this.clipDefs.set(visual, cp);
        outer.setAttribute('clip-path', `url(#${cp.getAttribute('id')})`);
    }

    // Children-only clip: when ChildClip is set, host the child outers in a
    // `<g class="mural-children" clip-path>` inserted after `own`, so the
    // visual's own paint stays unclipped and only its children are trimmed.
    // The geometry is in the visual's local space (no per-child translation).
    private applyChildClip(info: VisualNodes, visual: RenderableVisual): void
    {
        // Rebuild our clip def from scratch each pass we're invoked.
        const prior = this.childClipDefs.get(visual);
        if (prior !== undefined) { prior.remove(); this.childClipDefs.delete(visual); }

        const cp = this.buildClipPath(visual.ChildClip);
        if (cp !== undefined)
        {
            let g = info.children;
            if (g === undefined)
            {
                g = this.doc.createElementNS(SVG_NS, 'g') as SVGGElement;
                g.setAttribute('class', 'mural-children');
                info.outer.appendChild(g);   // after hit + own → children paint on top
                // Move existing child outers into the group (toggle-on).
                for (const node of Array.from(info.outer.children))
                {
                    if (node !== g && (node as Element).getAttribute('class') === 'mural-visual')
                    {
                        g.appendChild(node);
                    }
                }
                info.children = g;
            }
            this.childClipDefs.set(visual, cp);
            g.setAttribute('clip-path', `url(#${cp.getAttribute('id')})`);
        }
        else if (info.children !== undefined)
        {
            // ChildClip cleared — move children back to the outer <g>, drop group.
            const g = info.children;
            while (g.firstChild !== null) info.outer.appendChild(g.firstChild);
            g.remove();
            info.children = undefined;
        }
    }

    private repaintOwn(info: VisualNodes, visual: RenderableVisual): void
    {
        // Drop everything we drew last pass — child outers live in
        // the outer group, NOT inside `own`, so this clear is safe.
        const own = info.own;
        while (own.firstChild !== null) own.removeChild(own.firstChild);

        const dc = new SvgDomDrawingContext(own, {
            defs:              this.defs,
            nextClipId:        () => `mural-dc-clip-${this.clipCounter++}`,
            nextGradientId:    () => `mural-dc-grad-${this.gradientCounter++}`,
            imagePatternCache: this.imagePatternCache,
            document:          this.doc,
        });
        visual.Render(dc);

        // Lazy-attach the own group: keep it in the DOM iff at least
        // one primitive was emitted. Layout-only Visuals (panels,
        // ItemsPresenter, ContentPresenter, the TreeViewItem container,
        // CollapsibleStack, ...) emit nothing here, so for them the
        // empty `<g class="mural-own">` never reaches the DOM.
        //
        // When re-emit produces primitives on a previously-empty pass,
        // `insertBefore(own, hit.nextSibling)` puts own right after the
        // hit pad, before any child outers — preserves the document
        // order own paint → child paint that the hit-test relies on.
        const shouldAttach = own.firstChild !== null;
        const isAttached   = own.parentNode === info.outer;
        if (shouldAttach && !isAttached)
        {
            info.outer.insertBefore(own, info.hit.nextSibling);
        }
        else if (!shouldAttach && isAttached)
        {
            own.remove();
        }
    }

    // Detach everything the renderer added; leaves the surface itself
    // intact for HtmlTarget.Dispose to remove. Called when the host
    // discards the target or when Content swaps to a different root.
    public dispose(): void
    {
        for (const info of this.nodes.values())
        {
            info.outer.remove();
        }
        this.nodes.clear();
        this.imagePatternCache.clear();
        // <defs> stays — HtmlTarget removes the surface entirely.
    }
}

function formatNumber(n: number): string { return n.toString(); }
