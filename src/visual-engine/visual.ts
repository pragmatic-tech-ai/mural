import type { Brush } from './drawing/brush.js';
import { MuralBase } from '../runtime/model.js';
import { Freezable } from '../runtime/freezable.js';
import { peekPropertyBag, propertyValues } from '../runtime/model-internals.js';
import type { PropertyDescriptor } from '../runtime/property-descriptor.js';
import { MetaData, affectsArrange, affectsMeasure, affectsRender, inherits } from '../runtime/metadata.js';

import { NameScope } from './namescope.js';
import { ObservableCollection } from '../runtime/observable-collection.js';
import { Matrix, Point, Rect, Size, Thickness, transformBounds } from './primitives.js';
import type { DrawingContext } from './drawing-context.js';
import type { TextMeasurer } from './text-measurer.js';
import { Storyboard } from './animation/storyboard.js';
import type { AnimationTimeline } from './animation/timeline.js';
import { applyImplicitTransition } from './animation/implicit-transition-engine.js';
import { PropertyTransition } from './animation/property-transition.js';
import type { DragStartCallback } from './drag-drop.js';
import type { Effect } from './drawing/effect.js';
import type { Transform } from './drawing/transform.js';
import { RectangleGeometry, type Geometry } from './geometry/geometry.js';
import type { Pen } from './drawing/pen.js';

// Routed event names that map to the per-instance _routedListeners
// registry. These are the public NAMES authors use in `on Xxx { … }`
// markup; the routed-event dispatcher fires them after each
// bubble-phase virtual.
/** @internal — shared with TriggerHost (§ 1.8) for the
 *  "is this RoutedEvent a known generic dispatch name" check inside
 *  EventTrigger install. Library-internal: not re-exported from any
 *  barrel. */
export const KNOWN_ROUTED_EVENTS = new Set([
    'PointerDown', 'PointerUp', 'PointerMove', 'PointerWheel',
    'PointerEnter', 'PointerLeave',
    'MouseLeftButtonDown', 'MouseLeftButtonUp',
    'MouseRightButtonDown', 'MouseRightButtonUp',
    'PreviewGotMouseCapture', 'GotMouseCapture',
    'PreviewLostMouseCapture', 'LostMouseCapture',
    'PreviewStylusDown', 'StylusDown', 'PreviewStylusUp', 'StylusUp',
    'PreviewStylusMove', 'StylusMove',
    'PreviewTouchDown', 'TouchDown', 'PreviewTouchUp', 'TouchUp',
    'PreviewTouchMove', 'TouchMove',
    'ManipulationStarting', 'ManipulationStarted', 'ManipulationDelta',
    'ManipulationInertiaStarting', 'ManipulationCompleted',
    'KeyDown', 'KeyUp', 'TextInput', 'QueryCursor',
    'GotFocus', 'LostFocus',
    'PreviewGotKeyboardFocus', 'GotKeyboardFocus',
    'PreviewLostKeyboardFocus', 'LostKeyboardFocus',
    'DragEnter', 'DragLeave', 'DragOver', 'Drop',
]);

// Snapshot-then-iterate helper used by every per-instance listener
// fan-out — routed events, Loaded, Unloaded, DynamicResource
// re-wire. Without the snapshot, a listener that registers /
// unregisters another listener mid-fire would mutate the Set / Array
// we're iterating; with it, the iteration sees a stable view and
// the registration takes effect on the NEXT fire. Same pattern that
// used to be inlined four times (§ 1.16). Accepts iterables so both
// Set<Fn> and Array<Fn> sites share the same helper.
/** @internal — shared with Element (§ Phase B) for its lifecycle
 *  listener fan-outs. Library-internal; not re-exported. */
export function safeFire<A extends unknown[]>(
    listeners: Iterable<(...args: A) => void> | undefined,
    ...args: A
): void
{
    if (listeners === undefined) return;
    // `Array.from` for both Set and Array — a Set iterator would
    // otherwise mutate-during-iteration if a listener calls add or
    // delete on the same Set.
    for (const l of Array.from(listeners)) l(...args);
}

// Horizontal positioning of a Visual within its parent-given slot when
// the rendered area is smaller than the slot. Stretch fills the slot
// when no explicit Width is set; with an explicit Width, Stretch falls
// back to Center (WPF semantics).
export enum HorizontalAlignment
{
    Left    = 'left',
    Center  = 'center',
    Right   = 'right',
    Stretch = 'stretch',
}

// Vertical counterpart of HorizontalAlignment.
export enum VerticalAlignment
{
    Top     = 'top',
    Center  = 'center',
    Bottom  = 'bottom',
    Stretch = 'stretch',
}

// WPF-parity Visibility. Controls whether a Visual is rendered, takes
// part in hit-testing, AND occupies layout space:
//
//   * Visible   — measured, arranged, rendered, hit-tested. Default.
//   * Hidden    — measured + arranged normally (still occupies its slot
//                 in the parent), NOT rendered, NOT hit-tested. Used to
//                 reserve space without painting (placeholder spacers).
//   * Collapsed — DesiredSize forced to Zero, arrange skipped, NOT
//                 rendered, NOT hit-tested. The visual takes NO space —
//                 siblings flow as if it weren't in the tree. This is
//                 what consumers want when toggling sections on/off.
//
// String values mirror member names so .mu parsers can write
// `[Visibility=Collapsed]` literally without a separate enum mapping.
//
// Layout impact is enforced inside Visual.Measure / Visual.Arrange.
// Render suppression is enforced both inside Visual.Render (so headless
// targets honour it) and at the SVG-renderer walk (which also sets
// pointer-events=none so the dispatcher's hit-test source-finding skips
// the subtree — no separate gate in routed-event.ts).
export enum Visibility
{
    Visible   = 'Visible',
    Hidden    = 'Hidden',
    Collapsed = 'Collapsed',
}

// What a Visual sees of its host. Concrete implementation lives in the
// visual-engine layer (PresentationTarget and its subclasses). Defined
// here so Visual has typed references for routing layout/render
// invalidation without runtime importing visual-engine. The visual-
// engine class satisfies this contract structurally.
export interface VisualHost
{
    OnMeasureInvalidated(visual: Visual): void;
    OnArrangeInvalidated(visual: Visual): void;
    OnRenderInvalidated(visual: Visual): void;

    // Per-environment text measurement service. Visuals that need to
    // size text (TextBlock, future label-bearing controls) read this
    // during MeasureOverride. Defaults to APPROXIMATE_TEXT_MEASURER on
    // PresentationTarget unless a concrete subclass wires something more
    // accurate (FontMetricsMeasurer with loaded fonts, a future
    // CanvasTextMeasurer in HtmlTarget, etc.).
    readonly TextMeasurer: TextMeasurer;

    // Optional exact (paint-engine) text measurer. Where TextMeasurer is the
    // fast primary (Canvas 2D on HtmlTarget), this is the measurer whose
    // widths match the RENDERER's own text layout (offscreen SVG <text> on
    // HtmlTarget). undefined unless a concrete target installs one. A Visual
    // sizing itself to text at MeasurementFidelity.Exact (a Chip label) reads
    // it so its measured width equals the painted width — see TextBlock's
    // MeasurementFidelity. Absent → the Visual falls back to TextMeasurer.
    readonly ExactTextMeasurer?: TextMeasurer;

    // Optional focus surface — populated on PresentationTarget by
    // delegating to its InputManager. Visual.Focus() / Blur() use this
    // back-channel; tests that mock VisualHost without focus support
    // can omit the methods and Focus() degrades to a no-op.
    SetFocus?(visual: Visual | undefined): void;
    GetFocusedVisual?(): Visual | undefined;

    // Overlay layer — attached as the visual hop of `Visual.AttachOverlayChild`
    // so popups / dropdowns / tooltips paint above the main Content
    // tree. The host materialises the layer lazily on first use. Visual
    // calls these through the VisualHost reference (not by importing
    // PresentationTarget) so the runtime layer stays independent of
    // visual-engine. PresentationTarget supplies the concrete shape.
    AttachOverlay(visual: Visual): void;
    DetachOverlay(visual: Visual): void;
}

// Tree-aware MuralBase with WPF-style layout + render lifecycle.
//
// Public lifecycle entry points (called by the layout/render pass — do
// not override directly):
//   * Measure(availableSize)  → caches DesiredSize via MeasureOverride
//   * Arrange(finalRect)      → caches RenderSize + ArrangedRect via ArrangeOverride
//   * Render(dc)              → delegates to RenderOverride
//
// Subclass override points (where layout / drawing policy lives):
//   * MeasureOverride(availableSize): Size  — return the desired size
//   * ArrangeOverride(finalSize): Size      — place children, return actual used size
//   * RenderOverride(dc)                    — emit drawing primitives for THIS Visual
//
// Invalidation API (call these when something that affects layout or
// rendering changes — usually fired automatically through OnPropertyChanged
// per the property's MetaData flags):
//   * InvalidateMeasure()   — measure + arrange cache invalidated, host notified
//   * InvalidateArrange()   — arrange cache invalidated, host notified
//   * InvalidateVisual()    — render request, host notified
//
// Tree + host:
//   * parent: Visual | undefined  — set by Attach / Detach
//   * target: VisualHost | undefined — back-pointer to the PresentationTarget
//     owning this tree, propagated through Attach / Detach for O(1) lookup
//
// Plain Models stay storage-only. Only Visuals participate in layout,
// rendering, the visual tree, and property value inheritance.
export class Visual extends MuralBase
{
    // Typed-key DPs. Inline static initializers run in declaration order
    // when the class is loaded, so by the time the first Visual is
    // constructed every key exists and every descriptor is registered.
    // The string names below are still the canonical binding-path
    // identities (`Binding(t, 'Width')` resolves them); the typed keys
    // are an opt-in faster, type-safe path for direct accessor code.

    // NaN is the "not set" sentinel for explicit size constraints —
    // matches WPF FrameworkElement.Width / .Height. Marked Measure so
    // changing either invalidates the layout pass.
    public static readonly WidthKey      = MuralBase.RegisterProperty<number>(Visual, 'Width',     Number.NaN,               MetaData.Measure);
    public static readonly HeightKey     = MuralBase.RegisterProperty<number>(Visual, 'Height',    Number.NaN,               MetaData.Measure);
    public static readonly MinWidthKey   = MuralBase.RegisterProperty<number>(Visual, 'MinWidth',  0,                        MetaData.Measure);
    public static readonly MinHeightKey  = MuralBase.RegisterProperty<number>(Visual, 'MinHeight', 0,                        MetaData.Measure);
    public static readonly MaxWidthKey   = MuralBase.RegisterProperty<number>(Visual, 'MaxWidth',  Number.POSITIVE_INFINITY, MetaData.Measure);
    public static readonly MaxHeightKey  = MuralBase.RegisterProperty<number>(Visual, 'MaxHeight', Number.POSITIVE_INFINITY, MetaData.Measure);
    public static readonly HorizontalAlignmentKey = MuralBase.RegisterProperty<HorizontalAlignment>(Visual, 'HorizontalAlignment', HorizontalAlignment.Stretch, MetaData.Arrange);
    public static readonly VerticalAlignmentKey   = MuralBase.RegisterProperty<VerticalAlignment>(  Visual, 'VerticalAlignment',   VerticalAlignment.Stretch,   MetaData.Arrange);

    // Outer spacing around this Visual. Eats into availableSize at
    // Measure time, inflates DesiredSize so the parent reserves the
    // space, and offsets the rendered area at Arrange time. Mirrors
    // WPF FrameworkElement.Margin.
    public static readonly MarginKey = MuralBase.RegisterProperty<Thickness>(Visual, 'Margin', Thickness.Zero, MetaData.Measure);

    // StyleKey (and the Style getter/setter) live on `Element`
    // (FrameworkElement tier — see [./element.ts](./element.ts) § Phase
    // B). A raw `Visual` doesn't carry a Style — the resource lookup,
    // implicit / theme resolution, and SetterFactory machinery are all
    // FE-tier concerns.

    // Effect — a renderer-side post-process applied to the Visual's
    // painted output. Concrete effect classes live in visual-engine
    // (DropShadowEffect, MaterialElevationEffect). The runtime side
    // accepts anything matching the Effect contract (toCssFilter())
    // so visual-engine can ship classes without runtime taking a
    // value-import dependency on it.
    //
    // MetaData.Render so changing the Effect re-emits via the
    // renderer (which reads the Effect during repaintOwn). The
    // renderer is allowed to no-op when the new filter string equals
    // the previously applied one — equality is the contract this DP
    // doesn't enforce.
    public static readonly EffectKey = MuralBase.RegisterProperty<Effect | undefined>(Visual, 'Effect', undefined, MetaData.Render);

    // Fill is the inherited fill brush — kept on Visual so Border
    // / Panel / Canvas / ContentControl all read it from the same slot.
    // Shape primitives expose their own typed `Fill: Brush | undefined`
    // DP on `Shape` and ignore Visual.Fill entirely. Subclasses
    // that don't paint (Panel, ContentControl, …) leave Fill at
    // its default undefined with zero render cost.
    public static readonly FillKey      = MuralBase.RegisterProperty<Brush | undefined>(Visual, 'Fill',      undefined, MetaData.Render);

    // Stroke pen — the outline drawn around this Visual's shape geometry
    // (buildClipGeometry). Consolidation target for Shape.Stroke. Default
    // undefined ≡ no outline; the base paint no-ops when both Fill and
    // Stroke are undefined, so plain Panels/Controls are unaffected.
    public static readonly StrokeKey    = MuralBase.RegisterProperty<Pen | undefined>(Visual, 'Stroke',    undefined, MetaData.Render);

    // Affine transform applied to the Visual's painted output (and the
    // painted output of every descendant) at render time. WPF parity —
    // UIElement.RenderTransform. Does NOT participate in layout: Measure
    // and Arrange ignore RenderTransform, so a 100×40 button that's
    // scaled 2× still reserves 100×40 in its parent's layout slot. Pair
    // with Margin / explicit Width/Height for layout-affecting shape
    // changes. Default undefined ≡ identity.
    //
    // MetaData.Render so a whole-DP swap (`v.RenderTransform = new
    // RotateTransform(45)`) invalidates the Visual. Inner-property
    // changes on the Transform itself (a RotateTransform's Angle
    // tweening, a ScaleTransform's ScaleX bound to a slider) reach the
    // renderer through Freezable's owner mechanism — this Visual registers
    // as an owner of the assigned Transform (§5.2, rewireFreezableOwner in
    // OnPropertyChanged), so a shared Transform notifies every holder.
    //
    // Hit-testing: the SVG renderer applies the transform via the
    // outer <g>, so `elementsFromPoint` automatically projects the
    // input coordinate into the visual's pre-transform local space —
    // a rotated button hit-tests by the rotated shape, matching WPF.
    public static readonly RenderTransformKey = MuralBase.RegisterProperty<Transform | undefined>(
        Visual, 'RenderTransform', undefined, MetaData.Render);

    // Origin of the RenderTransform expressed as a fraction of the
    // Visual's RenderSize (each axis is in 0..1, values outside the
    // unit interval are accepted and shift the pivot outside the
    // bounding rect). (0, 0) means top-left — WPF parity default;
    // (0.5, 0.5) is the center (typical for rotations / scaling);
    // (1, 1) is the bottom-right. The renderer translates by
    // (Origin.X · RenderSize.Width, Origin.Y · RenderSize.Height)
    // before applying the matrix and back after, so a 45°
    // RotateTransform with Origin (0.5, 0.5) spins the visual around
    // its own center rather than around its top-left corner.
    public static readonly RenderTransformOriginKey = MuralBase.RegisterProperty<Point>(
        Visual, 'RenderTransformOrigin', Point.Zero, MetaData.Render);

    // Affine transform that participates in LAYOUT (WPF parity —
    // FrameworkElement.LayoutTransform). Unlike RenderTransform, this is applied
    // BEFORE measure/arrange settle: a 100×40 element with LayoutTransform =
    // Scale(2) measures 200×80 and reserves 200×80 in its parent's slot, so a
    // containing ScrollViewer grows real scrollbars. MetaData.Measure | Arrange so
    // a whole-DP swap re-lays-out; inner-property changes on the Transform (a
    // ScaleTransform's ScaleX) reach layout through the same Freezable owner
    // mechanism as RenderTransform (rewireFreezableOwner dispatches by MetaData,
    // so measure/arrange are invalidated). Default undefined ≡ identity ≡ no layout
    // effect (the pre-existing code path runs verbatim). See EffectiveLayoutMatrix
    // for the render/adorner-facing composed matrix.
    public static readonly LayoutTransformKey = MuralBase.RegisterProperty<Transform | undefined>(
        Visual, 'LayoutTransform', undefined, MetaData.Measure | MetaData.Arrange);

    // Per-subtree paint opacity. Default 1 = fully opaque. The SVG
    // renderer mirrors this onto the outer <g>'s `opacity` attribute, so
    // children of an opacity<1 visual visually fade with the parent
    // (SVG's `opacity` composes multiplicatively across nested groups).
    // WPF parity: Opacity is paint-only — hit-testing ignores it, so a
    // 0-opacity visual still receives pointer events unless
    // IsHitTestVisible is also false. Authors hide-without-interaction
    // by combining the two; pure visual fades flip just Opacity.
    public static readonly OpacityKey = MuralBase.RegisterProperty<number>(Visual, 'Opacity', 1, MetaData.Render);

    // DefaultStyleKeyKey lives on `Element` (FE tier) alongside Style /
    // Resources. Subclasses opting into theme styles override metadata
    // via `MuralBase.OverrideMetadata(MyControl, Element.DefaultStyleKeyKey,
    // { default_value: MyControl })`.

    // Optional clip geometry applied to this Visual and its visual
    // subtree at render time. Typed as `unknown` here so the runtime
    // doesn't depend on visual-engine's Geometry class — the host's
    // DrawingContext.PushClip is what reads it. MetaData.Render so
    // changes re-render.
    public static readonly ClipKey = MuralBase.RegisterProperty<Geometry | undefined>(Visual, 'Clip', undefined, MetaData.Render);

    // When true, clip this Visual's CHILDREN (not its own paint) to its shape
    // inset by the full stroke — the region inside the outline. Off by default
    // (WPF parity). The geometry comes from buildChildClipGeometry (base: the
    // outline inset by the stroke; subclasses override — Border's inner rounded
    // rect, a shaped container's inset silhouette), applied at the tail of
    // Arrange via syncChildClip, which fills the internal ChildClip slot the
    // renderers read. The Visual's own paint (Fill + Stroke) is never masked, so
    // a bordered / shaped container trims its content while the stroke keeps
    // painting. For a hand-authored whole-subtree mask (own paint included), set
    // the Clip DP directly.
    public static readonly ClipToBoundsKey = MuralBase.RegisterProperty<boolean>(Visual, 'ClipToBounds', false, MetaData.Arrange);

    // The children-only clip geometry, in this Visual's local space. Set only by
    // syncChildClip (never authored directly); read by the renderers alongside
    // Clip / HitTestGeometry. MetaData.None so writing it never re-invalidates
    // layout. Public getter, internal setter.
    public static readonly ChildClipKey = MuralBase.RegisterProperty<Geometry | undefined>(Visual, 'ChildClip', undefined, MetaData.None);

    // DataContext DP + accessor moved to `Element` (§ Phase B / B5.2) —
    // FE-tier ambient-data root. The DP fires inheritance through the
    // logical tree, which itself lives on Element (§ B4.4).

    // IsEnabled DP + accessor moved to `Element` (§ Phase B / B5.3) —
    // FE-tier inheritable input-gate. Plain Visuals always pass the
    // routed-event disabled-state gate via the stub accessor below.

    // Input-state flags (IsMouseOver / IsPressed / IsFocused /
    // IsDragOver), the drop-target / hit-test / focus DPs (AllowDrop /
    // IsHitTestVisible / Focusable), and the declarative drag-source DPs
    // (IsDraggable / OnDragStart) all moved to `Element` (§ Phase B /
    // input) — the whole input surface is FE-tier. Visual exposes no-op
    // accessor stubs below so a Visual-typed reference still typechecks.

    // Implicit per-DP transition specs — CSS-`transition`-style. When a
    // DP whose name matches a PropertyTransition.Property changes on
    // this Visual, the implicit-transition engine cancels any running
    // animation for that DP and starts a fresh one from oldValue →
    // newValue over the spec's Duration / Easing. Unmatched DPs snap as
    // usual. See animation/implicit-transition-engine.ts for the
    // mechanism + type dispatch (number / Color / Thickness only;
    // brushes route through their own scheme-transition factory).
    //
    // The DP is undefined by default (no allocation cost when no
    // transitions are declared). The `Transitions` JS getter below
    // auto-instantiates the collection on first access — matches the
    // mutate-then-set pattern of `CommandBindings` / `InputBindings`
    // on Control. The compiler's `Transitions { … }` body block routes
    // its inner PropertyTransition elements through this getter, so
    // markup authoring never deals with the undefined case.
    public static readonly TransitionsKey = MuralBase.RegisterProperty<ObservableCollection<PropertyTransition> | undefined>(
        Visual, 'Transitions', undefined, MetaData.None);


    // WPF-parity Visibility (see the enum's doc for the three semantics).
    // Measure | Arrange | Render — a Visible↔Collapsed flip changes the
    // DesiredSize the parent reads (need re-measure), a Visible↔Hidden
    // flip keeps DesiredSize but changes paint + hit-test output. The
    // single Render flag handles the paint refresh on both transitions;
    // Measure | Arrange ensure the parent re-lays out around a newly
    // (un)collapsed child. Default Visible matches WPF and is what every
    // existing visual already assumes — switching the default later
    // would silently break every consumer that never sets the DP.
    public static readonly VisibilityKey = MuralBase.RegisterProperty<Visibility>(
        Visual, 'Visibility', Visibility.Visible,
        MetaData.Measure | MetaData.Arrange | MetaData.Render);

    // Precise-shape hit testing (§19.2.7). When set, the target consults
    // Geometry.Contains(localPoint) after the browser-side
    // elementsFromPoint pick — if the geometry rejects the point, the
    // hit walk falls through to the parent Visual. Default undefined
    // keeps today's AABB hit-testing behavior.
    //
    // The geometry is interpreted in this Visual's local coordinate
    // space (the outer <g>'s frame on the SVG backend). MetaData.None —
    // the renderer doesn't paint geometry; the input pipeline only
    // reads it on hit-test.
    //
    // Pairs with §5.7: a Visual with HitTestGeometry set is by
    // definition interactive in the precise-shape sense, so the SVG
    // renderer can drop the `mural-hit` pad — the geometry IS the pad.
    public static readonly HitTestGeometryKey = MuralBase.RegisterProperty<Geometry | undefined>(
        Visual, 'HitTestGeometry', undefined, MetaData.None);

    // Hover-cursor affordance. String value passes through to the SVG
    // renderer which stamps it as the `cursor` attribute on the outer
    // <g>; the host inherits SVG's standard cursor cascade. Accepts any
    // CSS cursor keyword ('default', 'pointer', 'ew-resize', 'ns-resize',
    // 'grab', 'crosshair', …) or a `url(...)` value. Default `undefined`
    // means "inherit from the parent visual / host" — no attribute
    // emitted, browser's default cursor wins. MetaData.Render so flips
    // repaint without further wiring. WPF parity — UIElement.Cursor.
    public static readonly CursorKey = MuralBase.RegisterProperty<string | undefined>(
        Visual, 'Cursor', undefined, MetaData.Render);

    // Tag DP + Tag accessor moved to `Element` (§ Phase B / B5.1) —
    // FE-tier consumer handle, no place on a raw render-only Visual.

    /** Stub accessors; Element re-declares as real DPs (§ Phase B /
     *  input). Plain Visuals carry no input state — reads return the
     *  registered default `false`. The InputManager only ever writes
     *  input state on Elements, so no `_setIsXxx` stub is needed. */
    public get IsMouseOver(): boolean { return false; }
    public get IsPressed():   boolean { return false; }

    // Read-only getter — returns `undefined` when no transitions
    // collection has been allocated. Bindings / consumers wanting the
    // pure-read shape touch this. Mutators (the compiler's
    // `Transitions { … }` block, runtime push / remove) call
    // `EnsureTransitions()` below, which lazy-allocates AND fires the
    // DP write that subscribers expect.
    public get Transitions(): ObservableCollection<PropertyTransition> | undefined
    {
        return this.get_property_value(Visual.TransitionsKey);
    }

    /** Lazy-allocate the Transitions collection if missing, then
     *  return it. The collection is mutate-in-place — pushes /
     *  removes take effect immediately because the engine reads the
     *  current Transitions on every matched DP write rather than
     *  caching per-Visual. § 1.16 — separated from the bare getter so
     *  a read-only consumer (binding observer) doesn't accidentally
     *  fire the `set_property_value` write that allocation triggers.
     *
     *  § 1.14 — also registers the implicit-transition pre-write
     *  listener on first allocation. Visuals without any
     *  PropertyTransition pay zero per-write overhead: no listener,
     *  no Set, no fanout. Subscribers added via the public
     *  `AddBaseValueWriteListener` on MuralBase. */
    public EnsureTransitions(): ObservableCollection<PropertyTransition>
    {
        let t = this.get_property_value(Visual.TransitionsKey);
        if (t === undefined)
        {
            t = new ObservableCollection<PropertyTransition>();
            // Subscribe BEFORE the write so a future
            // `set_property_value(TransitionsKey, …)` consumer can't
            // race past the registration. The listener self-skips on
            // descriptor.Name === 'Transitions' so this first write
            // (and any later collection re-assignment) is a no-op.
            this.AddBaseValueWriteListener(
                (descriptor, new_value) => this.handle_base_value_write(descriptor, new_value),
            );
            this.set_property_value(Visual.TransitionsKey, t);
        }
        return t;
    }
    /** Stub accessors; Element re-declares the input DPs (§ Phase B /
     *  input). IsFocused / IsDragOver are read-only framework state and
     *  return their default `false`; AllowDrop reads `false` and swallows
     *  writes; IsHitTestVisible reads the default `true` and swallows
     *  writes. A real instance is always an Element, so these stubs only
     *  satisfy Visual-typed call sites — they're never the live path. */
    public get IsFocused(): boolean { return false; }
    // True when this Visual OR a descendant holds keyboard focus (WPF's
    // IsKeyboardFocusWithin). Stub on plain Visual; Element maintains the real DP.
    public get IsKeyboardFocusWithin(): boolean { return false; }
    public get AllowDrop(): boolean { return false; }
    public set AllowDrop(_v: boolean) { /* plain Visual: no-op */ }
    public get IsDragOver(): boolean { return false; }
    public get IsHitTestVisible(): boolean { return true; }
    public set IsHitTestVisible(_v: boolean) { /* plain Visual: no-op */ }

    // WPF Visibility — see the enum's doc. Hidden keeps the layout slot
    // but skips paint + hit; Collapsed forces zero DesiredSize so the
    // slot itself disappears. Default Visible.
    public get Visibility():  Visibility { return this.get_property_value(Visual.VisibilityKey); }
    public set Visibility(v: Visibility) { this.set_property_value(Visual.VisibilityKey, v); }

    // Precise-shape hit testing — see HitTestGeometryKey.
    public get HitTestGeometry():  Geometry | undefined { return this.get_property_value(Visual.HitTestGeometryKey); }
    public set HitTestGeometry(v: Geometry | undefined) { this.set_property_value(Visual.HitTestGeometryKey, v); }

    public get Cursor():  string | undefined { return this.get_property_value(Visual.CursorKey); }
    public set Cursor(v: string | undefined) { this.set_property_value(Visual.CursorKey, v); }

    /** Stub accessors; Element re-declares the declarative-drag-source
     *  DPs (IsDraggable / OnDragStart), the Focusable DP, and real
     *  Focus() / Blur() (§ Phase B / input). Plain Visuals are never
     *  draggable or focusable — reads return defaults, writes no-op, and
     *  Focus() / Blur() do nothing. A real instance is always an Element,
     *  so these only satisfy Visual-typed call sites. */
    public get IsDraggable(): boolean { return false; }
    public set IsDraggable(_v: boolean) { /* plain Visual: no-op */ }
    public get OnDragStart(): DragStartCallback | undefined { return undefined; }
    public set OnDragStart(_v: DragStartCallback | undefined) { /* plain Visual: no-op */ }
    public get Focusable(): boolean { return false; }
    public set Focusable(_v: boolean) { /* plain Visual: no-op */ }
    public Focus(): void { /* plain Visual: not focusable */ }
    public Blur(): void { /* plain Visual: never focused */ }

    /** Animate the given property to the timeline's To value. Implicit
     *  Storyboard wrap — equivalent to `new Storyboard(); sb.Add(this,
     *  propertyName, timeline); sb.Begin();`. Returns the underlying
     *  Storyboard so the caller can Stop / AddCompletedListener / chain.
     *
     *  Convenience entry mirrors WPF's UIElement.BeginAnimation. Pass
     *  the same propertyName you'd pass to set_property_value. */
    public BeginAnimation(propertyName: string, timeline: AnimationTimeline): Storyboard
    {
        const sb = new Storyboard();
        sb.Add(this, propertyName, timeline);
        sb.Begin();
        return sb;
    }

    /** Stub accessor pair; Element re-declares as a real
     *  `DataContext: unknown` pair backed by `Element.DataContextKey`
     *  (§ Phase B / B5.2). Plain Visuals own no ambient data root —
     *  reads return undefined, writes silently no-op. Bindings that
     *  consult DataContext (`DataContextBinding`, `MultiBinding`)
     *  resolve the DP by name against the dynamic class; on a plain
     *  Visual the resolution throws, which mirrors the practice (no
     *  binding subsystem talks to a raw Visual). */
    public get DataContext(): unknown { return undefined; }
    public set DataContext(_v: unknown) { /* plain Visual: no-op */ }

    /** Stub accessor pair; Element re-declares as a real
     *  `IsEnabled: boolean` pair backed by `Element.IsEnabledKey`
     *  (§ Phase B / B5.3). Plain Visuals are always enabled — the stub
     *  returns the registered default `true` so the routed-event
     *  disabled-state walker `routeSuppressedByDisabled` lets them
     *  through without an Element instanceof check. Writes silently
     *  no-op on plain Visuals (no input dispatch ever targets one in
     *  practice). */
    public get IsEnabled(): boolean { return true; }
    public set IsEnabled(_v: boolean) { /* plain Visual: no-op */ }

    /** Stub accessor pair; Element re-declares as a real `Tag: unknown`
     *  pair backed by `Element.TagKey` (§ Phase B / B5.1). Selector +
     *  list-control machinery types its containers as `Visual` but in
     *  practice always receives Elements; the stub keeps those call
     *  sites typechecking when the container is a plain (non-Element)
     *  Visual — reads return undefined, writes silently no-op. Mirrors
     *  the `Name` accessor stub above (B4.6). */
    public get Tag(): unknown { return undefined; }
    public set Tag(_v: unknown) { /* plain Visual: no-op */ }

    // Two parent pointers: visual (renderer / hit-testing / target
    // propagation) and logical (property inheritance / future named-
    // element scoping / resource lookup). For all non-templated Visuals
    // both pointers reference the same parent — they only diverge when
    // a ControlTemplate slots user-supplied logical content into a
    // template-generated visual subtree (Phase 2 work). Default Attach
    // sets both; AttachVisual / AttachLogical exist for template code
    // to wire them independently.
    // `_logicalParent` lives on `Element` (§ Phase B / B4.2). Visual
    // exposes `logicalParent` / `GetLogicalParent` / `SetLogicalParent`
    // as virtual stubs (default undefined / no-op) so Visual-typed call
    // sites still typecheck — plain Visuals own no logical-tree state.
    // AttachLogical / DetachLogical / walk_inherited reach Element's
    // backing field via the `_LogicalParentHost` friend interface.
    private _visualParent:  Visual | undefined;
    private _target: VisualHost | undefined;
    // _overlayChildren collection + AttachOverlayChild / DetachOverlayChild
    // / forEachOverlayChild / allLogicalDescendantSubtreeRoots all live
    // on `Element` (§ Phase B / B4.1). Visual exposes no-op virtual
    // stubs below so the inheritance / style cascades' `forEachOverlay`
    // dispatch still typechecks on a Visual-typed receiver — plain
    // Visuals carry no overlay collection.
    // Set true when InvalidateVisual fires while _target is undefined
    // (the Visual is detached — typically sitting in a recycle pool
    // between Rebind and re-attach). On re-attach SetTarget invalidates
    // so the renderer sees the pending repaint. Without this flag, a
    // property change during the detached window (e.g. ListBoxItem's
    // IsSelected flipping during bindContainer for a recycled
    // container) silently never reaches the SVG and the stale paint
    // from the prior binding leaks through.
    private _renderInvalidatedWhileDetached: boolean = false;

    // _templatedParent moved to Element (§ Phase B / B4.5) alongside
    // the templatedParent getter + SetTemplatedParent. Visual exposes
    // no-op stubs below so Visual-typed call sites still typecheck.

    // `Name`, `_nameScope`, the `nameScope` getter, `SetNameScope`,
    // and `FindName` all live on `Element` (§ Phase B / B4.6).
    // Visual exposes Name as a no-op accessor pair so consumers with
    // a Visual-typed reference still typecheck — Element overrides
    // with a real backing field.

    // Resources / Style / implicit + theme Style / StyleApplicator /
    // ResourceResolver / subscriptions — all FE-tier and now live on
    // `Element` (§ Phase B). Visual itself doesn't carry resource
    // lookup or style cascades.

    // Trigger install / evaluation / teardown machinery is FE-tier —
    // `_triggerHost` field + the install / uninstall trampolines live
    // on `Element` (§ Phase B / B3). A raw Visual carries no triggers.

    // The per-instance routed-listener registry moved to `Element`
    // (§ Phase B / input) — see the AddRoutedEventListener /
    // FireRoutedListeners stubs below.

    // Inner-property changes on a Freezable-valued DP (RotateTransform.
    // Angle, SolidColorBrush.Color, …) now flag this Visual dirty through
    // Freezable's owner mechanism — see rewireFreezableOwner in
    // OnPropertyChanged. No per-Visual invalidator closure is captured here
    // any more (§5.2 removed the RenderTransform-only `_setRenderInvalidator`).

    // The declarative drag-source latch (IsDraggable / OnDragStart +
    // _onDragLatch* listeners) moved to `Element` (§ Phase B / input).

    // Lifecycle listeners (Loaded / Attached / Unloaded / Detached)
    // and the Behaviors subsystem live on `Element` — see § Phase B
    // (and § 1.11 for the Attached/Detached symmetric pair design).

    // Layout state cache. Updated by Measure / Arrange runs; read by the
    // renderer and by parents during their own MeasureOverride /
    // ArrangeOverride passes. _isMeasureValid / _isArrangeValid track
    // whether the cached values reflect the current property state — a
    // freshly-constructed Visual starts invalid; Invalidate* flips it back.
    private _desiredSize: Size = Size.Zero;
    private _renderSize: Size = Size.Zero;
    private _arrangedRect: Rect = Rect.Zero;
    private _previousAvailableSize: Size = Size.Empty;
    private _isMeasureValid: boolean = false;
    private _isArrangeValid: boolean = false;
    // The child's local (untransformed) desired size, recorded during Measure
    // when a LayoutTransform is set, so Arrange can lay the child out in local
    // space. Only read when _layoutMatrix() is defined.
    private _layoutLocalSize: Size = Size.Zero;
    // The effective layout matrix (LayoutTransform shifted so its transformed
    // bbox min sits at the local origin), recorded during Arrange. Consumed by
    // the SVG emitter and the adorner layer. Undefined when there's no
    // LayoutTransform. See EffectiveLayoutMatrix.
    private _effectiveLayout: Matrix | undefined = undefined;

    // ------------------------------------------------------------------
    // Tree + host
    // ------------------------------------------------------------------

    // Parent in the VISUAL tree — what the renderer walks. Set by
    // AttachVisual / cleared by DetachVisual (and through the Attach /
    // Detach convenience methods that wire both trees at once).
    protected get visualParent(): Visual | undefined
    {
        return this._visualParent;
    }

    // Public accessor used by the routed-event dispatcher (lives
    // outside the class hierarchy, so the protected getter is out of
    // reach). Returns the same value as `visualParent` — no separate
    // book-keeping. Don't call this from subclass code; use the
    // protected getter instead.
    public GetVisualParent(): Visual | undefined
    {
        return this._visualParent;
    }

    /** @internal — § Phase B / B4.2. Visual-tier no-op virtual; Element
     *  overrides to expose its `_logicalParent` field. Subclass code
     *  walking up the logical chain should use this protected getter
     *  rather than reaching into the field directly. */
    protected get logicalParent(): Visual | undefined
    {
        return undefined;
    }

    /** Public companion to the protected `logicalParent` getter. Used
     *  by controls that walk the logical ancestry to find an owning
     *  host — e.g. a TreeViewItem locating its containing TreeView for
     *  selection updates. Symmetric with GetVisualParent; subclass code
     *  should use the protected getter. Visual-tier stub returns
     *  undefined; Element overrides to return its `_logicalParent`. */
    public GetLogicalParent(): Visual | undefined
    {
        return undefined;
    }

    /** @internal — § Phase B / B4.5. Visual-tier no-op virtual;
     *  Element overrides to expose its `_templatedParent` field.
     *  Plain Visuals own no templated-parent back-pointer. */
    public get templatedParent(): Visual | undefined
    {
        return undefined;
    }

    // The PresentationTarget hosting this Visual's tree, or undefined
    // when the Visual is unattached. WPF equivalent of
    // PresentationSource.FromVisual(v) — consumers reach for the host's
    // ActualWidth / ActualHeight / DeviceScale / TextMeasurer / overlay
    // surface without walking GetVisualParent() themselves. Returns the
    // structural VisualHost contract; consumers in the visual-engine
    // layer that need the concrete PresentationTarget surface cast at
    // the call site. The back-pointer is cascaded through SetTarget at
    // attach time, so this is an O(1) read despite the name — no
    // ancestor walk happens at call time.
    public FindAncestorPresentationTarget(): VisualHost | undefined
    {
        return this._target;
    }

    /** @internal — § Phase B / B4.5. Visual-tier no-op stub; Element
     *  overrides to actually store `p` in its `_templatedParent`
     *  field and fire DynamicResource re-wire on edge. The template
     *  walker types its cursor as Visual, so the stub keeps the
     *  call site typechecking when the walker hits a plain (non-
     *  Element) node. */
    public SetTemplatedParent(_p: Visual | undefined): void { }

    /** @internal — § Phase B / B4.6. Visual-tier no-op virtual;
     *  Element overrides to expose its per-instance NameScope. */
    public get nameScope(): NameScope | undefined { return undefined; }

    /** @internal — § Phase B / B4.6. Visual-tier no-op stub; Element
     *  overrides to attach a NameScope to itself as a FindName
     *  boundary. The template walker types its cursor as Visual, so
     *  this stub keeps the call site typechecking when the walker
     *  hits a plain (non-Element) node. */
    public SetNameScope(_scope: NameScope | undefined): void { }

    /** Stub field; Element re-declares as a real `Name: string |
     *  undefined` accessor pair backed by a private `_name`. Plain
     *  Visuals return undefined and silently swallow writes. */
    public get Name(): string | undefined { return undefined; }
    public set Name(_v: string | undefined) { /* plain Visual: no-op */ }

    /** @internal — § Phase B / B4.6. Visual-tier no-op virtual;
     *  Element overrides to walk the logical chain (with
     *  templatedParent fallback) until it hits the first ancestor
     *  carrying a NameScope, then resolves `name` against it.
     *  Plain Visuals own no NameScope, so they always return
     *  undefined. */
    public FindName(_name: string): Visual | undefined { return undefined; }

    // Resources / Style / DefaultStyleKey / TryFindResource /
    // FindResource — all FE-tier, now on `Element`. See
    // [./element.ts](./element.ts) § Phase B for the move + rationale.

    // Visual Effect (DropShadow, MaterialElevation, …). Set this to
    // attach a renderer-side post-process. The renderer reads
    // effect.toCssFilter() and assigns the result to the visual's
    // wrapper element's CSS filter. Setting to undefined clears any
    // previously applied filter.
    public get Effect(): Effect | undefined { return this.get_property_value(Visual.EffectKey); }
    public set Effect(value: Effect | undefined) { this.set_property_value(Visual.EffectKey, value); }

    /** Fill brush. Read by Border + Shape subclasses' RenderOverride.
     *  Default undefined ≡ no fill. */
    public get Fill(): Brush | undefined { return this.get_property_value(Visual.FillKey); }
    public set Fill(value: Brush | undefined) { this.set_property_value(Visual.FillKey, value); }

    /** Stroke pen for the Visual's shape outline. Default undefined ≡ no stroke. */
    public get Stroke(): Pen | undefined { return this.get_property_value(Visual.StrokeKey); }
    public set Stroke(value: Pen | undefined) { this.set_property_value(Visual.StrokeKey, value); }

    /** Affine transform applied at render time. See RenderTransformKey
     *  for semantics. Default undefined (identity). */
    public get RenderTransform(): Transform | undefined { return this.get_property_value(Visual.RenderTransformKey); }
    public set RenderTransform(value: Transform | undefined) { this.set_property_value(Visual.RenderTransformKey, value); }

    /** Layout-affecting affine transform. See LayoutTransformKey. */
    public get LayoutTransform(): Transform | undefined { return this.get_property_value(Visual.LayoutTransformKey); }
    public set LayoutTransform(value: Transform | undefined) { this.set_property_value(Visual.LayoutTransformKey, value); }

    // The LayoutTransform's matrix when set and non-identity, else undefined —
    // the fast-path guard used by measure/arrange so the default path is
    // byte-for-byte unchanged.
    protected _layoutMatrix(): Matrix | undefined
    {
        const lt = this.LayoutTransform;
        if (lt === undefined || lt.Matrix.IsIdentity) return undefined;
        return lt.Matrix;
    }

    /** Origin point for RenderTransform, as a fraction of RenderSize.
     *  See RenderTransformOriginKey for semantics. Default (0, 0). */
    public get RenderTransformOrigin(): Point { return this.get_property_value(Visual.RenderTransformOriginKey); }
    public set RenderTransformOrigin(value: Point) { this.set_property_value(Visual.RenderTransformOriginKey, value); }

    /** Per-subtree paint opacity in [0, 1]. Default 1. Values outside
     *  the range are accepted by the DP but the renderer clamps before
     *  emitting the SVG attribute. */
    public get Opacity(): number       { return this.get_property_value(Visual.OpacityKey); }
    public set Opacity(value: number)  { this.set_property_value(Visual.OpacityKey, value); }

    // DefaultStyleKey getter, refresh_active_style, apply_setter
    // trampolines, and ApplyTriggerSetter / ClearTriggerSetter all
    // live on `Element` (§ Phase B). DataTemplate's per-target trigger
    // wiring types its `target` as `Element` so the public
    // ApplyTriggerSetter surface is reachable from a typed reference.

    // AddEventTrigger / RemoveEventTrigger and the five `_install_*` /
    // `_uninstall_*` trampolines live on `Element` (§ Phase B / B3) —
    // triggers are FE-tier, installed through the Style cascade.

    // ── Per-instance routed listener registry — stubs ──────────────────
    //
    // The real registry lives on `Element` (§ Phase B / input): routed
    // events invoke per-Element virtuals (OnPointerDown, etc.) on each
    // route node, then FireRoutedListeners so per-instance EventTriggers
    // / consumer-attached listeners run. Visual exposes no-op stubs so a
    // Visual-typed reference still typechecks; a real instance is always
    // an Element, so these stubs are never the live path.
    public AddRoutedEventListener(_eventName: string, _listener: (args: unknown) => void): void { }
    public RemoveRoutedEventListener(_eventName: string, _listener: (args: unknown) => void): void { }
    public FireRoutedListeners(_eventName: string, _args: unknown): void { }

    // Lifecycle listener public API (AddLoaded / AddAttached /
    // AddUnloaded / AddDetached and their Remove counterparts) and
    // the Behavior attachment surface (AddBehavior / RemoveBehavior /
    // Behaviors) live on `Element`. See [./element.ts](./element.ts)
    // (§ Phase B).

    // CommandBindings / InputBindings live on Control (the templated-
    // control base in `mural/framework`). Routed
    // commands + InputBindings dispatch only reach Control-shaped
    // visuals — Border / Canvas / plain panels participate in routing
    // but don't carry per-instance binding tables. CommandManager and
    // the routed-event walker `instanceof Control` before reading the
    // collections.

    // ── Named storyboard registry ──────────────────────────────────────
    //
    // BeginStoryboardAction with a Name stashes the freshly-built
    // Storyboard here so later StopStoryboardAction /
    // PauseStoryboardAction / ResumeStoryboardAction can find it. The
    // map's `name` keys are SCOPED to this Visual — two Buttons that
    // both run a "fade" storyboard each have their own independent
    // copy, so a `StopStoryboard Name="fade"` on one Button doesn't
    // stop the other's. Last-write-wins semantics: re-firing
    // BeginStoryboard with the same Name silently replaces the prior
    // Storyboard reference (its lifecycle is up to the consumer —
    // typically still pinned at HoldEnd or already Stopped).
    private _namedStoryboards: Map<string, Storyboard> | undefined;

    public RegisterNamedStoryboard(name: string, sb: Storyboard): void
    {
        if (this._namedStoryboards === undefined) this._namedStoryboards = new Map();
        this._namedStoryboards.set(name, sb);
    }

    public GetNamedStoryboard(name: string): Storyboard | undefined
    {
        return this._namedStoryboards?.get(name);
    }

    // Implicit / theme style resolution (resolve_implicit_style,
    // resolve_theme_style), applyDefaultStyle, subscribe_styles /
    // unsubscribe_styles, and FindResource all live on `Element`
    // (§ Phase B). Visual proper has no style cascade — those are
    // FrameworkElement-tier concerns.

    // The VisualHost (PresentationTarget) that owns this Visual's tree,
    // or undefined when the Visual is unattached.
    protected get target(): VisualHost | undefined
    {
        return this._target;
    }

    protected SetVisualParent(p: Visual | undefined): void
    {
        const wasAttached = this._visualParent !== undefined;
        this._visualParent = p;
        // Fire the FE-tier detach hook on the defined → undefined
        // transition. Element overrides `on_detach_edge` to fire its
        // Unloaded / Detached listeners (which is where Behaviors hook
        // their teardown via Visual.AddBehavior → AddUnloadedListener).
        // Re-attach + detach cycles fire on each detach (not
        // one-shot like Loaded — see Element.fire_unloaded_listeners
        // contract).
        if (wasAttached && p === undefined)
        {
            this.on_detach_edge();
        }
    }

    /** Visual-tier hook fired on the defined → undefined `visualParent`
     *  transition. Empty on Visual; Element overrides to fan out to
     *  its Unloaded / Detached listener sets. § Phase B. */
    protected on_detach_edge(): void { }

    /** Visual-tier hook fired on the undefined → defined `_target`
     *  transition (the FE-tier "I am now mounted" edge). Empty on
     *  Visual; Element overrides to fan out to its Loaded / Attached
     *  listener sets. § Phase B. */
    protected on_attach_edge(): void { }

    /** @internal — § Phase B / B4.2. Visual-tier no-op virtual;
     *  Element overrides to actually store `p` in its
     *  `_logicalParent` field. AttachLogical / DetachLogical (still
     *  on Visual until B4.3) call this on `child` — Element
     *  children store; plain Visual children silently no-op (they
     *  carry no logical-tree state). */
    protected SetLogicalParent(_p: Visual | undefined): void { }

    // Sets this Visual's host back-pointer and cascades it down the
    // VISUAL subtree via propagate_target_to_visual_children. The host
    // is a rendering concept (where pixels go, where layout invalidation
    // routes to), so it follows visual ancestry — a template's
    // internally-generated visuals all share their templated control's
    // host, and consumer-supplied logical content slotted into them
    // picks up the same host through its visual parent.
    protected SetTarget(target: VisualHost | undefined): void
    {
        if (this._target === target) return;
        if (this._target !== undefined && target !== undefined)
        {
            throw new Error('Visual is already attached to a host; detach from the current host first.');
        }
        const wasLoaded = this._target !== undefined;
        this._target = target;
        this.propagate_target_to_visual_children();
        // Replay any pending render invalidation queued while detached.
        // Without this, a property change inside a recycle/rebind cycle
        // (the trigger un-applying a Fill while the container
        // sits in the pool) silently never reaches the renderer and
        // the SVG keeps the prior binding's paint.
        if (target !== undefined && this._renderInvalidatedWhileDetached)
        {
            this._renderInvalidatedWhileDetached = false;
            target.OnRenderInvalidated(this);
        }
        // Delegate the FE-tier "Loaded once + Attached every-edge"
        // fan-out to Element's override of `on_attach_edge`. Visual
        // itself is render-tier only — the lifecycle listener state
        // lives on Element (§ Phase B).
        if (!wasLoaded && target !== undefined)
        {
            this.on_attach_edge();
        }
    }

    // § 1.15 — the four propagate_* virtuals now have one-line
    // bodies that delegate to the `forEachVisualChild` /
    // `forEachLogicalChild` virtuals below. Single and Panel only
    // need to override the two `forEachXxxChild` virtuals to wire
    // up their iteration shape; the four propagates fall through
    // automatically. Subclasses with non-uniform logical / visual
    // topology (ContentControl, ItemsControl, Drawer) keep their
    // custom propagate_* overrides — the helper-driven defaults
    // don't model the "Content slot + template root in two
    // different trees" case.
    protected propagate_target_to_visual_children(): void
    {
        const t = this['target'];
        this.forEachVisualChild(c => c['SetTarget'](t));
    }

    // Children iteration surface — every Visual exposes its visual
    // children (for the renderer / hit-testing) and its logical
    // children (for tree walks that need the consumer-authored
    // structure). Base default is empty (leaf Visual). Single and
    // Panel override; templated controls (Phase 2) override these
    // independently so the two collections can differ.
    public get visualChildren(): readonly Visual[]  { return []; }
    public get logicalChildren(): readonly Visual[] { return []; }

    /** @internal — § Phase B / B4.1. Visual-tier empty generator;
     *  Element overrides to yield logical children + overlay
     *  children. Used by Style / DynamicResource subtree cascades
     *  that need to walk both branches. Plain Visuals own no
     *  overlay collection, so the empty default is correct. */
    protected *allLogicalDescendantSubtreeRoots(): IterableIterator<Visual> { }

    /** @internal — § Phase B / B4.1. Visual-tier no-op virtual;
     *  Element overrides to iterate `_overlayChildren`. The
     *  inheritance fan-out (Visual.OnPropertyChanged) and B2-era
     *  subtree cascades call this on `this` and on each child —
     *  plain Visuals fall through with zero work. */
    protected forEachOverlayChild(_fn: (child: Visual) => void): void { }

    // VISUAL-tree wiring only: sets the child's visual parent and
    // cascades the host (renderer needs both). Does NOT touch the
    // logical parent or refresh inheritance — those ride the logical
    // tree. Call this directly only from templating code that's
    // attaching template-generated visuals to their templated control;
    // for ordinary user-supplied children use Attach (which wires both
    // trees).
    protected AttachVisual(child: Visual): void
    {
        if (child === this)
        {
            throw new Error('A Visual cannot be its own child.');
        }
        if (child._visualParent !== undefined)
        {
            throw new Error('Visual already has a visual parent; detach it from the current parent first.');
        }
        child.SetVisualParent(this);
        child.SetTarget(this._target);
    }

    protected DetachVisual(child: Visual): void
    {
        if (child._visualParent !== this)
        {
            throw new Error('Cannot detach a Visual that is not a visual child of this.');
        }
        child.SetVisualParent(undefined);
        child.SetTarget(undefined);
    }

    /** Detach `child` only if it is still our visual child; a no-op otherwise.
     *  A Visual is single-parent, so a SHARED or re-presented content Visual can
     *  legitimately leave a host (another host CLAIMS it via
     *  `_release_from_visual_parent`). A content host clearing a possibly-stale
     *  slot must tolerate that, rather than assume it still owns the child — the
     *  symmetric partner to AttachVisual's release-then-attach. */
    protected DetachVisualIfChild(child: Visual): void
    {
        if (child._visualParent === this)
        {
            this.DetachVisual(child);
        }
    }

    /** @internal Detach this Visual from its current visual parent, if any.
     *  Used by content hosts (ContentPresenter) to CLAIM a Visual that a
     *  now-discarded prior view still references — re-presenting a shared Visual
     *  (e.g. a shared toolbox preview Visual bound into a palette tile whose view a
     *  capability switch tore down) would otherwise hit the single-parent guard
     *  in AttachVisual. No-op when already parentless. */
    public _release_from_visual_parent(): void
    {
        this._visualParent?.DetachVisual(this);
    }

    /** @internal Logical-tree companion — Visual-tier no-op (plain Visuals carry
     *  no logical-tree state); Element overrides to detach from its logical
     *  parent. Lets content hosts release a Visual of unknown Element-ness
     *  without branching. */
    public _release_from_logical_parent(): void { }

    // LOGICAL-tree wiring only: sets the child's logical parent and
    // refreshes property-value inheritance for the new ancestry. Use
    // directly from templating code when slotting consumer-supplied
    // logical content into a templated control (the child's visual
    // parent is set separately by the ContentPresenter / ItemsPresenter
    // doing the visual slotting).
    // AttachLogical / DetachLogical moved to Element (§ Phase B / B4.3)
    // alongside the `_logicalParent` field and the inheritance / style
    // / DynamicResource subtree cascades they fire.

    /** @internal — § Phase B. Visual-tier no-op virtual; `Element`
     *  overrides to walk this Element + every logical / overlay
     *  descendant, re-resolving implicit + theme styles and re-
     *  subscribing to ancestor ResourceDictionary changes.
     *  AttachLogical / DetachLogical call this on every child without
     *  branching on Element-ness — plain Visuals fall through here
     *  and pay zero work. Same pattern as `on_attach_edge` /
     *  `on_detach_edge` for the Loaded / Unloaded fan-out. */
    public _refresh_styles_subtree(): void { }

    /** @internal — § Phase B. Visual-tier no-op virtual; `Element`
     *  overrides to tear down ancestor ResourceDictionary
     *  subscriptions across its subtree before a detach. */
    public _unsubscribe_styles_subtree(): void { }

    // ── Overlay children — logical-owner-side wiring ─────────────────
    //
    // AttachOverlayChild / DetachOverlayChild moved to `Element`
    // (§ Phase B / B4.1) alongside the `_overlayChildren` collection
    // and the iteration helpers. Visual exposes no-op stubs below so
    // consumers with a Visual-typed reference still typecheck — plain
    // Visuals carry no overlay collection.

    /** @internal — § Phase B / B4.1. Visual-tier stub; Element
     *  overrides to attach `child` as an overlay-mounted logical
     *  child (visual hop into the host's OverlayLayer, logical hop
     *  sets child's logicalParent to this Element). Throws on a
     *  plain Visual — overlay children need FE-tier state. */
    public AttachOverlayChild(_child: Visual): void
    {
        throw new Error(
            'Visual.AttachOverlayChild: this Visual does not own an overlay collection. '
            + 'AttachOverlayChild is FE-tier — call it on an Element-derived host.',
        );
    }

    /** @internal — § Phase B / B4.1. Visual-tier stub; Element
     *  overrides to detach `child` from the overlay collection.
     *  Plain Visuals carry no overlay state, so the call is a
     *  silent no-op (matches the AttachOverlayChild error path's
     *  intent: a plain Visual never had an overlay child to detach). */
    public DetachOverlayChild(_child: Visual): void { }

    // `Attach` / `Detach` convenience helpers moved to Element
    // (§ Phase B / B4.3) — they call AttachLogical / DetachLogical
    // alongside AttachVisual / DetachVisual, and the logical-tree
    // half is FE-tier.

    // ------------------------------------------------------------------
    // Layout / Render lifecycle
    // ------------------------------------------------------------------

    // Explicit size constraints. Width / Height: NaN means "size to
    // content" — MeasureOverride's result wins (clamped by Min/Max). Any
    // numeric value locks the size to exactly that value (clamped by
    // Min/Max in case of conflict). Min/Max: default 0 / +Infinity, so
    // by default they impose no constraint. Set them when you want a
    // fixed-size element ("100×100 box") or a range ("at least 40 wide,
    // never wider than 200"). All four contribute to a single per-axis
    // [min, max] range resolved in Measure.
    public get Width(): number { return this.get_property_value(Visual.WidthKey); }
    public set Width(value: number) { this.set_property_value(Visual.WidthKey, value); }

    public get Height(): number { return this.get_property_value(Visual.HeightKey); }
    public set Height(value: number) { this.set_property_value(Visual.HeightKey, value); }

    public get MinWidth(): number { return this.get_property_value(Visual.MinWidthKey); }
    public set MinWidth(value: number) { this.set_property_value(Visual.MinWidthKey, value); }

    public get MinHeight(): number { return this.get_property_value(Visual.MinHeightKey); }
    public set MinHeight(value: number) { this.set_property_value(Visual.MinHeightKey, value); }

    public get MaxWidth(): number { return this.get_property_value(Visual.MaxWidthKey); }
    public set MaxWidth(value: number) { this.set_property_value(Visual.MaxWidthKey, value); }

    public get MaxHeight(): number { return this.get_property_value(Visual.MaxHeightKey); }
    public set MaxHeight(value: number) { this.set_property_value(Visual.MaxHeightKey, value); }

    // Positioning within the parent-given slot when the rendered area
    // is smaller than the slot. Defaults to Stretch (fill the slot when
    // no explicit Width / Height is set; with explicit size, Stretch
    // falls back to Center per WPF semantics).
    public get HorizontalAlignment(): HorizontalAlignment { return this.get_property_value(Visual.HorizontalAlignmentKey); }
    public set HorizontalAlignment(value: HorizontalAlignment) { this.set_property_value(Visual.HorizontalAlignmentKey, value); }

    public get VerticalAlignment(): VerticalAlignment { return this.get_property_value(Visual.VerticalAlignmentKey); }
    public set VerticalAlignment(value: VerticalAlignment) { this.set_property_value(Visual.VerticalAlignmentKey, value); }

    // Outer spacing — distance from this Visual's rendered area to the
    // edges of its parent-given slot. Differs from a Border's Padding
    // (which is inside the border, around the child): Margin lives
    // OUTSIDE the Visual itself and is consumed by the parent's layout.
    public get Margin(): Thickness { return this.get_property_value(Visual.MarginKey); }
    public set Margin(value: Thickness) { this.set_property_value(Visual.MarginKey, value); }

    // Optional clip applied at render time — a Geometry in this
    // Visual's local coordinate space. The renderer pushes this clip
    // before RenderOverride and before walking visual children, pops
    // after children. Typed as `unknown` so runtime stays decoupled
    // from visual-engine's Geometry class; whatever shape DC.PushClip
    // accepts works here.
    public get Clip(): Geometry | undefined { return this.get_property_value(Visual.ClipKey); }
    public set Clip(value: Geometry | undefined) { this.set_property_value(Visual.ClipKey, value); }

    public get ClipToBounds(): boolean { return this.get_property_value(Visual.ClipToBoundsKey); }
    public set ClipToBounds(value: boolean) { this.set_property_value(Visual.ClipToBoundsKey, value); }

    // Read by the renderers; written only by syncChildClip.
    public get ChildClip(): Geometry | undefined { return this.get_property_value(Visual.ChildClipKey); }
    protected set ChildClip(value: Geometry | undefined) { this.set_property_value(Visual.ChildClipKey, value); }

    // Owns the ChildClip DP only while ClipToBounds is on (see syncChildClip).
    private _childClipApplied = false;

    // The Visual's outline in local space — the base geometry for own paint
    // (buildPaintGeometry insets it by half the stroke) and precise hit-testing
    // (Shape / Figure publish it as HitTestGeometry). Base returns the arranged
    // bounds rect; subclasses override to shape it (Border's rounded rect, a
    // Shape's silhouette). Also the base buildChildClipGeometry insets. Called
    // only with a positive size.
    protected buildClipGeometry(size: Size): Geometry
    {
        return new RectangleGeometry(new Rect(0, 0, size.Width, size.Height));
    }

    // The children-only clip geometry: the shape inset by the FULL stroke —
    // i.e. the region inside the outline's inner edge. Reuses buildPaintGeometry
    // (the outline inset by a given amount), so Border yields its inner rounded
    // rect and a shaped container yields its inset silhouette with no extra
    // code. Called only with a positive size (the sync guards degenerate boxes).
    protected buildChildClipGeometry(size: Size): Geometry | undefined
    {
        return this.buildPaintGeometry(size, this.Stroke?.Thickness ?? 0);
    }

    // Reconcile ChildClip with ClipToBounds at arrange time. ChildClip is a
    // dedicated slot (no consumer value is ever at risk), so the latch is only
    // for clean teardown on toggle-off. The Visual's own Clip DP is independent
    // — hand-authored only, never touched here.
    private syncChildClip(size: Size): void
    {
        if (this.ClipToBounds)
        {
            if (size.Width <= 0 || size.Height <= 0) return;   // wait for a real arranged size
            this.ChildClip = this.buildChildClipGeometry(size);
            this._childClipApplied = true;
        }
        else if (this._childClipApplied)
        {
            this.ChildClip = undefined;
            this._childClipApplied = false;
        }
    }

    public get DesiredSize(): Size  { return this._desiredSize; }
    public get RenderSize(): Size   { return this._renderSize; }
    public get ArrangedRect(): Rect { return this._arrangedRect; }
    public get IsMeasureValid(): boolean { return this._isMeasureValid; }
    public get IsArrangeValid(): boolean { return this._isArrangeValid; }

    // Measure pass entry point. Computes DesiredSize via MeasureOverride.
    // Cached: returns immediately when measure state is valid AND the
    // availableSize matches the prior call.
    //
    // Do not override directly — override MeasureOverride for custom
    // layout policy.
    public Measure(availableSize: Size): void
    {
        if (this._isMeasureValid && this._previousAvailableSize.Equals(availableSize)) return;
        this._previousAvailableSize = availableSize;

        // Visibility=Collapsed forces DesiredSize=Zero so the parent's
        // layout treats this visual as taking no space at all. Hidden
        // falls through and measures normally (it keeps its layout slot).
        // WPF parity. Margin / Min-Max / MeasureOverride are all skipped
        // — there's no content to size when the visual is collapsed.
        if (this.Visibility === Visibility.Collapsed)
        {
            this._desiredSize    = Size.Zero;
            this._isMeasureValid = true;
            this._isArrangeValid = false;
            return;
        }

        // Subtract Margin first — that space belongs to the gap between
        // this Visual and its parent's slot edge, not to this Visual's
        // own content. MeasureOverride sees only the inner budget.
        const margin = this.Margin;
        const marginH = margin.Horizontal;
        const marginV = margin.Vertical;
        const inner = new Size(
            Math.max(0, availableSize.Width  - marginH),
            Math.max(0, availableSize.Height - marginV),
        );

        // Resolve the effective [min, max] per axis from Width /
        // Height / MinWidth / MinHeight / MaxWidth / MaxHeight. Explicit
        // Width is the special case where min === max === Width.
        const mm = this.resolveMinMax();

        // availableSize handed to MeasureOverride is clamped to that
        // range — when Width is set, MeasureOverride sees exactly Width
        // (children measure themselves against the asserted size, not
        // the parent's slot).
        const constrained = new Size(
            Visual.clamp(inner.Width,  mm.minW, mm.maxW),
            Visual.clamp(inner.Height, mm.minH, mm.maxH),
        );

        // LayoutTransform (WPF FrameworkElement.LayoutTransform): measure the
        // child in its OWN (untransformed) space, then report the child's desired
        // size TRANSFORMED to its bounding box as this element's footprint. The
        // available budget is mapped into local space by the inverse first.
        // Undefined/identity → M is undefined and both steps are no-ops (the
        // pre-existing path runs verbatim).
        const M = this._layoutMatrix();
        let measureAvail = constrained;
        if (M !== undefined)
        {
            const inv = M.Invert();
            if (inv !== undefined) measureAvail = transformBounds(constrained, inv);
        }

        const measured = this.MeasureOverride(measureAvail);

        // Clamp MeasureOverride's result to the same range — Min/Max
        // act as floor/ceiling on the natural content size. With Width
        // set, this pins the inner size to Width regardless.
        const clamped = new Size(
            Visual.clamp(measured.Width,  mm.minW, mm.maxW),
            Visual.clamp(measured.Height, mm.minH, mm.maxH),
        );

        // Remember the child's local size so Arrange can lay it out unscaled.
        this._layoutLocalSize = clamped;

        // The parent-space footprint is the transformed bounding box (== clamped
        // when there is no LayoutTransform, so DesiredSize is unchanged).
        const footprint = M !== undefined ? transformBounds(clamped, M) : clamped;

        // Add Margin back so the parent reserves the full bounding box
        // (inner content + outer spacing) for this Visual.
        this._desiredSize = new Size(
            footprint.Width  + marginH,
            footprint.Height + marginV,
        );
        this._isMeasureValid = true;
        // A new desired size invalidates any prior arrangement that was
        // computed against the old desired size — the parent will need
        // to re-Arrange this Visual with a possibly different finalRect.
        this._isArrangeValid = false;
    }

    // Override to compute DesiredSize from this Visual's content and
    // (typically) its children's DesiredSize. Subclasses that contain
    // children must call child.Measure(constrainedSize) for each child
    // before reading child.DesiredSize.
    //
    // Default returns Size.Zero — the leaf-Visual case.
    protected MeasureOverride(_availableSize: Size): Size
    {
        return Size.Zero;
    }

    // Arrange pass entry point. Places this Visual into finalRect and
    // runs ArrangeOverride to position children. Forces a Measure if
    // measure state is invalid (using the previously-passed available
    // size, or finalRect.Size as a fallback). Cached: returns immediately
    // when arrange state is valid AND finalRect matches the prior call.
    //
    // Do not override directly — override ArrangeOverride.
    public Arrange(finalRect: Rect): void
    {
        if (this._isArrangeValid && this._arrangedRect.Equals(finalRect)) return;
        if (!this._isMeasureValid)
        {
            const available = this._previousAvailableSize.IsEmpty
                ? finalRect.Size
                : this._previousAvailableSize;
            this.Measure(available);
        }

        // Visibility=Collapsed — DesiredSize is already Zero from Measure;
        // pin the arranged rect to a degenerate point at the slot origin
        // (so hit-test math doesn't trip on a stale rect) and skip
        // ArrangeOverride entirely. There are no children to arrange and
        // no own rendering — the renderer will skip this subtree too.
        // Hidden falls through and arranges normally so the slot stays
        // reserved.
        if (this.Visibility === Visibility.Collapsed)
        {
            this._arrangedRect   = new Rect(finalRect.X, finalRect.Y, 0, 0);
            this._renderSize     = Size.Zero;
            this._isArrangeValid = true;
            return;
        }

        // Subtract Margin from the parent-given slot before computing
        // render size / alignment. The marginedRect is where this Visual's
        // own content actually lives; the margin gap is what's left
        // between marginedRect and finalRect on each side.
        const margin = this.Margin;
        const marginedRect = new Rect(
            finalRect.X + margin.Left,
            finalRect.Y + margin.Top,
            Math.max(0, finalRect.Width  - margin.Horizontal),
            Math.max(0, finalRect.Height - margin.Vertical),
        );

        const mm = this.resolveMinMax();
        const hAlign = this.HorizontalAlignment;
        const vAlign = this.VerticalAlignment;
        const explicitW = !Number.isNaN(this.Width);
        const explicitH = !Number.isNaN(this.Height);

        // Per-axis render size:
        //   * Explicit Width / Height — always wins, clamped to Min/Max.
        //   * Stretch alignment without explicit size — fill the margined
        //     slot (clamped to Min/Max).
        //   * Anything else — use DesiredSize minus margin (DesiredSize
        //     reported to the parent included margin, so peel it back
        //     out for the actual render size).
        const renderW = explicitW
            ? Visual.clamp(this.Width, mm.minW, mm.maxW)
            : hAlign === HorizontalAlignment.Stretch
                ? Visual.clamp(marginedRect.Width, mm.minW, mm.maxW)
                : Math.max(0, this._desiredSize.Width - margin.Horizontal);

        const renderH = explicitH
            ? Visual.clamp(this.Height, mm.minH, mm.maxH)
            : vAlign === VerticalAlignment.Stretch
                ? Visual.clamp(marginedRect.Height, mm.minH, mm.maxH)
                : Math.max(0, this._desiredSize.Height - margin.Vertical);

        const renderSize = new Size(renderW, renderH);

        // Position within the MARGINED slot per alignment. ArrangedRect
        // is the FINAL aligned rect (margined slot.X + alignment offset,
        // renderSize) — that's what the renderer pushes as a translate
        // and what hit-testing reads as the Visual's bounds. WPF Stretch
        // + explicit size falls back to centered; the same offset formula
        // handles both since Stretch with renderSize < slot has extra > 0.
        const offsetX = Visual.computeOffsetX(hAlign, marginedRect.Width,  renderW);
        const offsetY = Visual.computeOffsetY(vAlign, marginedRect.Height, renderH);

        // LayoutTransform: ArrangeOverride runs in the child's LOCAL
        // (untransformed) space; the element's parent-space footprint becomes the
        // transformed bounding box, and _effectiveLayout maps local content into
        // that footprint (the transform, shifted so its bbox min is at the local
        // origin). Undefined/identity → the pre-existing path runs verbatim.
        const M = this._layoutMatrix();
        if (M !== undefined)
        {
            this._renderSize = this.ArrangeOverride(this._layoutLocalSize);
            const rs = this._renderSize;
            const p0 = M.Transform(new Point(0, 0));
            const p1 = M.Transform(new Point(rs.Width, 0));
            const p2 = M.Transform(new Point(0, rs.Height));
            const p3 = M.Transform(new Point(rs.Width, rs.Height));
            const bx = Math.min(p0.X, p1.X, p2.X, p3.X);
            const by = Math.min(p0.Y, p1.Y, p2.Y, p3.Y);
            const fw = Math.max(p0.X, p1.X, p2.X, p3.X) - bx;
            const fh = Math.max(p0.Y, p1.Y, p2.Y, p3.Y) - by;
            this._effectiveLayout = M.Multiply(Matrix.Translate(-bx, -by));
            this._arrangedRect = new Rect(marginedRect.X + offsetX, marginedRect.Y + offsetY, fw, fh);
        }
        else
        {
            this._effectiveLayout = undefined;
            this._arrangedRect = new Rect(
                marginedRect.X + offsetX,
                marginedRect.Y + offsetY,
                renderW,
                renderH,
            );
            this._renderSize = this.ArrangeOverride(renderSize);
        }
        this._isArrangeValid = true;
        this.syncChildClip(this._renderSize);
    }

    /** The composed layout matrix (LayoutTransform shifted so its transformed
     *  bbox min sits at the local origin), or undefined when there's no
     *  LayoutTransform. Consumed by the SVG emitter and the adorner layer. */
    public get EffectiveLayoutMatrix(): Matrix | undefined { return this._effectiveLayout; }

    // ------------------------------------------------------------------
    // Layout helpers
    // ------------------------------------------------------------------

    private resolveMinMax(): { minW: number; maxW: number; minH: number; maxH: number }
    {
        const w = this.Width;
        const h = this.Height;
        const minW0 = this.MinWidth;
        const maxW0 = this.MaxWidth;
        const minH0 = this.MinHeight;
        const maxH0 = this.MaxHeight;

        // Explicit Width collapses [min, max] to a single value (clamped
        // to the user's own min/max if they conflict). Same for Height.
        let minW = minW0, maxW = maxW0;
        if (!Number.isNaN(w))
        {
            const locked = Visual.clamp(w, minW0, maxW0);
            minW = locked;
            maxW = locked;
        }

        let minH = minH0, maxH = maxH0;
        if (!Number.isNaN(h))
        {
            const locked = Visual.clamp(h, minH0, maxH0);
            minH = locked;
            maxH = locked;
        }

        return { minW, maxW, minH, maxH };
    }

    private static clamp(v: number, min: number, max: number): number
    {
        return Math.max(min, Math.min(max, v));
    }

    private static computeOffsetX(align: HorizontalAlignment, slotWidth: number, renderWidth: number): number
    {
        const extra = slotWidth - renderWidth;
        if (extra <= 0) return 0; // overflow / exact fit → no offset (clipped at slot origin)
        switch (align)
        {
            case HorizontalAlignment.Left:    return 0;
            case HorizontalAlignment.Right:   return extra;
            case HorizontalAlignment.Center:  return extra / 2;
            case HorizontalAlignment.Stretch: return extra / 2; // Stretch + content < slot → center
        }
    }

    private static computeOffsetY(align: VerticalAlignment, slotHeight: number, renderHeight: number): number
    {
        const extra = slotHeight - renderHeight;
        if (extra <= 0) return 0;
        switch (align)
        {
            case VerticalAlignment.Top:     return 0;
            case VerticalAlignment.Bottom:  return extra;
            case VerticalAlignment.Center:  return extra / 2;
            case VerticalAlignment.Stretch: return extra / 2;
        }
    }

    // Override to place children inside finalSize. Subclasses that
    // contain children call child.Arrange(rect) for each child.
    // Returns the actual size used (typically finalSize).
    //
    // Default returns finalSize — accept whatever the parent provided.
    protected ArrangeOverride(finalSize: Size): Size
    {
        return finalSize;
    }

    // Render pass entry point. Called by the host's renderer when this
    // Visual is render-dirty. Delegates to RenderOverride.
    //
    // Do not override directly — override RenderOverride.
    //
    // Visibility gate: Hidden and Collapsed both suppress painting (WPF
    // parity). The headless target's tree walk also skips visualChildren
    // for non-Visible visuals; the SVG renderer's walk sets display=none
    // on the outer <g> (which CSS-cascades to descendants) and
    // pointer-events=none so the dispatcher's source-finding ignores it.
    public Render(dc: DrawingContext): void
    {
        if (this.Visibility !== Visibility.Visible) return;
        this.RenderOverride(dc);
    }

    // Override to draw this Visual's contribution into the DrawingContext.
    // Children are rendered separately by the renderer's tree walk —
    // RenderOverride should only emit primitives belonging to this Visual.
    //
    // Base behaviour paints the Visual's shape geometry: Fill + Stroke over
    // buildPaintGeometry (the outline inset by half the pen so a centred
    // stroke lands fully inside the outline). No-op when both Fill and
    // Stroke are undefined, so pure-composition Visuals (Panel, Single,
    // ContentControl) contribute nothing unless painted. Subclasses that
    // override this call super.RenderOverride(dc) first, then draw on top.
    protected RenderOverride(dc: DrawingContext): void
    {
        const fill = this.Fill, stroke = this.Stroke;
        if (fill === undefined && stroke === undefined) return;
        const s = this._renderSize;
        if (s.Width <= 0 || s.Height <= 0) return;
        const half = (stroke?.Thickness ?? 0) / 2;
        dc.DrawGeometry(fill, stroke, this.buildPaintGeometry(s, half));
    }

    // The shape to PAINT: the outline (buildClipGeometry) inset by `inset`
    // px so a centred stroke stays inside the outline. Kept separate from
    // buildClipGeometry (the outline used for clip / hit) so those consume
    // the un-inset shape. Base insets its bounds rect; shape subclasses
    // inset their silhouette.
    protected buildPaintGeometry(size: Size, inset: number): Geometry
    {
        return new RectangleGeometry(
            new Rect(inset, inset, size.Width - 2 * inset, size.Height - 2 * inset));
    }

    // ------------------------------------------------------------------
    // Input handlers — moved to Element
    // ------------------------------------------------------------------
    //
    // The routed-event virtuals (OnPointerDown / OnPreview* / OnKeyDown /
    // OnDrop / …) live on `Element` (§ Phase B / input). They're
    // protected and only ever invoked by the routed-event dispatcher on
    // Element route nodes, so Visual carries no stubs — every node that
    // participates in routing is an Element.

    // ------------------------------------------------------------------
    // Invalidation API
    // ------------------------------------------------------------------

    // Mark this Visual's measure state invalid. Side effect: also
    // invalidates the arrange cache, because a new DesiredSize would
    // make the prior arrangement stale. Always notifies the host's
    // measure queue. Cascades UP the visual tree only if the cache
    // actually transitioned from valid to invalid — without that
    // upward walk, a parent whose own cache is still valid would
    // short-circuit the next top-down Measure pass and never reach
    // this Visual through its MeasureOverride. The "wasValid" check
    // dedups the cascade so it's O(depth-to-first-invalid) per call,
    // and prevents a paired InvalidateMeasure / InvalidateArrange on
    // the same property (Measure | Arrange metadata) from triggering
    // a duplicate upward walk.
    public InvalidateMeasure(): void
    {
        const wasValid = this._isMeasureValid;
        this._isMeasureValid = false;
        this._isArrangeValid = false;
        this._target?.OnMeasureInvalidated(this);
        if (wasValid)
        {
            this._visualParent?.InvalidateMeasure();
        }
    }

    // Mark arrange state invalid. Always notifies the host's arrange
    // queue — even if a prior InvalidateMeasure cleared the cache
    // already, the host still needs to know that arrange specifically
    // was requested for this Visual. Cascades up only on actual
    // transition (same reason as InvalidateMeasure).
    public InvalidateArrange(): void
    {
        const wasValid = this._isArrangeValid;
        this._isArrangeValid = false;
        this._target?.OnArrangeInvalidated(this);
        if (wasValid)
        {
            this._visualParent?.InvalidateArrange();
        }
    }

    // Request a re-render on the next render pass. Render state isn't
    // cached on the Visual (RenderOverride is always re-runnable), so
    // this is purely a host notification. When called on a detached
    // visual (no target), remember the pending invalidation so the
    // next attach can replay it — a recycled container's IsSelected
    // flip during bindContainer happens while the container sits in
    // the pool, and would otherwise never reach the renderer.
    public InvalidateVisual(): void
    {
        if (this._target !== undefined)
        {
            this._target.OnRenderInvalidated(this);
        }
        else
        {
            this._renderInvalidatedWhileDetached = true;
        }
    }

    // ------------------------------------------------------------------
    // Property-change routing
    // ------------------------------------------------------------------

    // Visual override of MuralBase's virtual hook. Consults the property's
    // MetaData flags and routes to the matching Invalidate* method
    // plus — when the property is marked Inherits — pushes the change
    // down the subtree.
    // Pre-write hook — fires for every set_property_value before the
    // EVD's base-value tier is updated. The implicit-transition engine
    // hangs off here so a re-write during an in-flight animation can
    // see the new target value and re-engage (OnPropertyChanged would
    // miss it: the Animated tier is masking the Local write, so the
    // EVD doesn't observe an effective-value change).
    //
    // Skips the Transitions DP itself (changing the collection isn't
    // a property transition source) and any DP whose match against the
    // Transitions collection fails. Reads the current effective value
    // BEFORE the write so the animation starts from where the eye is
    // actually looking (including any in-flight animated value).
    /** § 1.14 — Pre-write listener body. Registered via
     *  `AddBaseValueWriteListener` from `EnsureTransitions` only when
     *  this Visual gains its first PropertyTransition; Visuals
     *  without transitions never see the fanout. */
    private handle_base_value_write(
        descriptor: PropertyDescriptor,
        new_value: any,
    ): void
    {
        if (descriptor.Name === 'Transitions') return;
        const transitions = this.get_property_value(Visual.TransitionsKey) as
            ObservableCollection<PropertyTransition> | undefined;
        if (transitions === undefined || transitions.Count === 0) return;
        for (const t of transitions)
        {
            if (t.Property !== descriptor.Name) continue;
            // Capture the effective value just before the write — picks
            // up an in-flight Animated value when one's active.
            const composed = descriptor.ComposedKey;
            const evd = propertyValues(this).get(composed);
            const old_effective = evd !== undefined ? evd.value : descriptor.DefaultValue;
            applyImplicitTransition(this, descriptor.Name, old_effective, new_value, t);
            return;
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        old_value: any,
        new_value: any,
    ): void
    {
        const meta = descriptor.MetaData;
        if (affectsMeasure(meta)) this.InvalidateMeasure();
        if (affectsArrange(meta)) this.InvalidateArrange();
        if (affectsRender(meta))  this.InvalidateVisual();
        // Inheritance cascade, Style writes, and the ambient-resource-
        // trigger DP fan-out (§ 17.1) are FE-tier and all live on
        // Element's OnPropertyChanged override (§ Phase B / B2-B4).
        // Visual itself has neither Style nor a logical tree to
        // cascade through.

        // §5.2 — Freezable owner wiring. When a DP value is (or was) a
        // Freezable, register / unregister THIS Visual as an owner so a
        // later IN-PLACE mutation of a shared Brush / Pen / Geometry /
        // Transform (or any nested Freezable it holds — Pen.Brush,
        // Brush.Transform, a TransformGroup's Children) re-invalidates us
        // per the DP's MetaData. The MetaData dispatch above already
        // handled the whole-DP swap; this covers subsequent inner writes.
        // Subsumes the old RenderTransform-only `_setRenderInvalidator`
        // hook (single-consumer — clobbered on sharing) and Shape's
        // hand-rolled subscribeAny property-list listener.
        this.rewireFreezableOwner(descriptor, old_value, new_value);
        // The declarative drag-source latch (IsDraggable flips) is wired
        // in Element.OnPropertyChanged (§ Phase B / input).
    }

    // Per-DP Freezable owner registrations, keyed by composite DP key, so
    // a value swap can unregister the old owner before registering the new.
    // Lazily allocated — most Visuals hold no Freezable-valued DP.
    private _freezableOwners: Map<string, { freezable: Freezable; cb: () => void }> | undefined;

    private rewireFreezableOwner(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        const newIsFreezable = newValue instanceof Freezable;
        // Fast path: nothing Freezable inbound and nothing tracked for this
        // DP — the overwhelmingly common case (numbers, strings, enums).
        if (!newIsFreezable && !(oldValue instanceof Freezable) && this._freezableOwners === undefined) return;

        const key = descriptor.ComposedKey;
        const prev = this._freezableOwners?.get(key);
        if (prev !== undefined)
        {
            prev.freezable.UnregisterOwner(prev.cb);
            this._freezableOwners!.delete(key);
        }
        if (newIsFreezable)
        {
            // Re-invalidate per the holding DP's MetaData when the shared
            // Freezable changes — same dispatch a whole-DP write would run.
            const meta = descriptor.MetaData;
            const cb = (): void =>
            {
                if (affectsMeasure(meta)) this.InvalidateMeasure();
                if (affectsArrange(meta)) this.InvalidateArrange();
                if (affectsRender(meta))  this.InvalidateVisual();
            };
            (newValue as Freezable).RegisterOwner(cb);
            (this._freezableOwners ??= new Map()).set(key, { freezable: newValue as Freezable, cb });
        }
    }

    // ------------------------------------------------------------------
    // Property value inheritance — FE-tier, lives on Element
    // ------------------------------------------------------------------
    //
    // `walk_inherited`, `_refresh_inherited`, `_refresh_inheritance_subtree`,
    // and the two `propagate_inheritance_*` virtuals all live on
    // `Element` (§ Phase B / B4.4). Visual exposes the two public
    // hooks below as no-op virtuals so AttachLogical / DetachLogical
    // and the propagate cascades that dispatch through
    // `c._refresh_inherited(...)` / `c._refresh_inheritance_subtree()`
    // typecheck and silently skip non-Element descendants. Same
    // pattern as `_refresh_styles_subtree` / `_unsubscribe_styles_subtree`
    // (B2) and `_refresh_dynamic_resources_subtree` (B3).

    /** @internal — § Phase B / B4.4. Visual-tier no-op virtual;
     *  Element overrides to walk every inheritable DP on `this` and
     *  re-resolve its value against the current logical-ancestor
     *  chain. */
    public _refresh_inheritance_subtree(): void { }

    /** @internal — § Phase B / B4.4. Visual-tier no-op virtual;
     *  Element overrides to re-resolve a single inheritable DP's
     *  value on `this` from the current logical-ancestor chain. */
    public _refresh_inherited(_descriptor: PropertyDescriptor): void { }

    /** Iteration virtual — Single/Panel override. Default empty for
     *  leaf Visuals (the renderer doesn't recurse through children
     *  on a leaf). § 1.15. */
    protected forEachVisualChild(_fn: (child: Visual) => void): void { }

    /** Iteration virtual — Single/Panel override. Default empty.
     *  § 1.15. */
    protected forEachLogicalChild(_fn: (child: Visual) => void): void { }

    // ── DynamicResource re-wire support ──────────────────────────────
    //
    // DynamicResource re-wire listeners + the subtree fan-out live on
    // `Element` (§ Phase B / B3). Visual carries no DynamicResource
    // state; the no-op `_refresh_dynamic_resources_subtree` stub below
    // lets AttachLogical / DetachLogical fan the cascade across every
    // child without `instanceof Element` branching.

    /** @internal — § Phase B. Visual-tier no-op virtual; `Element`
     *  overrides to fan out its registered DynamicResource re-wire
     *  listeners across this Element + every logical / overlay
     *  descendant after a reparent or theme override. Plain Visuals
     *  carry no listener state and pay zero work here. Same pattern
     *  as `_refresh_styles_subtree` / `_unsubscribe_styles_subtree`. */
    public _refresh_dynamic_resources_subtree(): void { }

    /** @internal — § Phase B. Visual-tier no-op virtual; `Element`
     *  overrides to fan out its registered DynamicResource re-wire
     *  listeners. Visual.SetTemplatedParent fires this on the per-
     *  visual edge when a template-applied tree first sees its
     *  templated-parent chain — plain Visuals no-op. */
    public _fire_dynamic_resource_listeners(): void { }

    /** @internal — § Phase B / B4.4. Public-with-underscore so
     *  Element's `_refresh_inheritance_subtree` can reach this
     *  static walker without bracket-access. The set is computed
     *  from the property registry, not from per-instance state. */
    public static _collect_inheritable_descriptors(klass: Function): PropertyDescriptor[]
    {
        return Visual.inheritableMemo(klass).list;
    }

    /** @internal — the same inheritable descriptors as
     *  `_collect_inheritable_descriptors`, but each paired with its
     *  precomputed composite key (`${RootOwner.name}.${Name}`). Element's
     *  `refresh_inherited_batch` iterates this so it never recomputes
     *  `compose_key` per descriptor per node — the composite is a pure
     *  function of the class and is cached here alongside the list. */
    public static _collect_inheritable_keyed(klass: Function): readonly InheritableEntry[]
    {
        return Visual.inheritableMemo(klass).keyed;
    }

    // Per-class memo. The result is a pure function of (klass's
    // prototype-chain bags) + (the global inheritable registry); both only
    // ever grow, and only a NEW inheritable registration changes the output
    // — captured by MuralBase's inheritable-generation counter. A subtree
    // refresh calls this once PER ELEMENT, so without the cache a click that
    // stamps a large template re-walked every prototype chain + re-allocated
    // per node (≈1s of a multi-second stall in the profiled trace).
    private static inheritableMemo(klass: Function): { gen: number; list: PropertyDescriptor[]; keyed: InheritableEntry[] }
    {
        const gen = MuralBase._inheritableGeneration();
        const hit = Visual._inheritableCache.get(klass);
        if (hit !== undefined && hit.gen === gen) return hit;

        // The dedup key is `${RootOwner.name}.${Name}` — same composite
        // key the per-instance value store uses, so cross-class
        // properties on different owners stay distinct even when their
        // simple Name collides. (Without the RootOwner prefix, a
        // Border.Tag and a TextBlock.Tag would dedupe as one entry.)
        const seen = new Set<string>();
        const list: PropertyDescriptor[] = [];
        const keyed: InheritableEntry[] = [];
        const add = (desc: PropertyDescriptor): void =>
        {
            const key = `${desc.RootOwner.name}.${desc.Name}`;
            if (seen.has(key)) return;
            seen.add(key);
            list.push(desc);
            keyed.push({ key, descriptor: desc });
        };
        let current: Function | null = klass;
        while (current !== null && current !== Function.prototype)
        {
            const bag = peekPropertyBag(current);
            if (bag !== undefined)
            {
                for (const desc of bag.values())
                {
                    if (inherits(desc.MetaData)) add(desc);
                }
            }
            current = Object.getPrototypeOf(current);
        }
        // Global cross-class inheritable registry (§ 15.2). Any
        // inheritable property registered on a class NOT in the target
        // Visual's prototype chain still cascades through the logical
        // tree — the registry exposes those descriptors so the refresh
        // picks them up.
        for (const desc of MuralBase._getInheritableDescriptors()) add(desc);

        const entry = { gen, list, keyed };
        Visual._inheritableCache.set(klass, entry);
        return entry;
    }

    // Memo for the inheritable-descriptor collection, keyed by class and
    // validated against MuralBase's inheritable-generation counter. WeakMap so
    // an unreachable class lets its cached lists be GC'd.
    private static _inheritableCache =
        new WeakMap<Function, { gen: number; list: PropertyDescriptor[]; keyed: InheritableEntry[] }>();
}

/** @internal — an inheritable descriptor paired with its precomputed
 *  composite storage key. Shared between Visual's memo and Element's
 *  subtree-refresh; not part of mural's published surface. */
export interface InheritableEntry
{
    key: string;
    descriptor: PropertyDescriptor;
}

// `Single` and `Panel` — child-collection helpers that used to live
// here — moved to [./element.ts](./element.ts) as part of § 1.1: both
// now extend `Element` so future Element-tier machinery (DataContext,
// Style, Resources, Triggers) attaches cleanly without re-touching
// every consumer.
