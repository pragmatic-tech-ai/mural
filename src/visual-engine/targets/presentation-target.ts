import { APPROXIMATE_TEXT_MEASURER, MetaData, MuralBase } from '../../runtime/index.js';
import { InputManager } from '../../framework/input-manager.js';
import { Rect, Size } from '../primitives.js';
import type { TextMeasurer, Visual, Element, VisualHost } from '../../runtime/index.js';
import type { Brush } from '../drawing/brush.js';
import { OverlayLayer } from './overlay-layer.js';
import { FontManager, type FontConsumer, type RegisteredFont } from '../text/index.js';

// Abstract base for the scene-description-plus-host-bridge classes
// (HtmlTarget, FileTarget, …). Follows the WPF
// PresentationSource pattern: one class per host environment, sharing a
// common scene description on the MuralBase layer. Named "Target" rather
// than "Source" because in our split this class also fulfills WPF's
// CompositionTarget role — it's both where the Visual tree is hosted
// and where pixels are written.
//
// The base carries the renderer-agnostic state: Width, Height, Content
// (root Visual), Background, DeviceScale. Concrete subclasses add the
// host-specific concerns — HtmlTarget owns the DOM mount +
// resize observer + event delegate; FileTarget owns the
// output target + Save() method; etc. Each concrete subclass also
// picks and instantiates its renderer internally (SvgRenderer,
// CanvasRenderer, PdfRenderer, …) so the user constructs one object
// instead of pairing two.
//
// Two sizing modes:
//   * Fixed   — Width / Height are set to numbers. The target tells
//               Content to Measure within those exact dimensions and
//               Arranges at (0, 0, Width, Height). ActualWidth /
//               ActualHeight mirror Width / Height after Render.
//   * Auto    — Either or both of Width / Height are left as NaN (the
//               default). The auto axis is measured with +Infinity so
//               Content reports its natural DesiredSize; the target's
//               surface for that axis becomes Content.DesiredSize and
//               Arrange uses it. Width / Height stay NaN (user input is
//               preserved), and ActualWidth / ActualHeight expose the
//               resolved surface dimensions after Render.
// Axes are independent — `target.Width = 800; target.Height = NaN`
// pins width and lets height grow with content (e.g. a known-width
// column whose height is determined by its contents).
//
// PresentationTarget is a MuralBase (not a Visual) so its properties
// participate in the binding/change-notification system — the subclass's
// renderer subscribes to Width/Height to know when to re-measure and to
// Content to know when the visual root was replaced. There is NO
// parent/child relationship between PresentationTarget and Content;
// assigning the same Visual to two PresentationTargets is undefined
// behavior.
//
// MetaData flags on the properties are advisory only — MuralBase's
// OnPropertyChanged is a no-op, so Mark*Dirty does not auto-fire.
// Subclasses' renderers subscribe via AddPropertyChangedListener.
//
// Coordinate system matches the rest of the engine: top-left origin,
// y-down, DIPs. DeviceScale multiplies DIPs to get device pixels for
// raster output (defaults to 1; HtmlTarget typically reads
// window.devicePixelRatio at construction and assigns it).
export abstract class PresentationTarget extends MuralBase implements VisualHost, FontConsumer
{
    // NaN = "auto" — the axis sizes to Content.DesiredSize at Render
    // time. Any finite number = fixed mode for that axis.
    public static readonly WidthKey       = MuralBase.RegisterProperty<number>(            PresentationTarget, 'Width',       Number.NaN, MetaData.Measure);
    public static readonly HeightKey      = MuralBase.RegisterProperty<number>(            PresentationTarget, 'Height',      Number.NaN, MetaData.Measure);
    public static readonly DeviceScaleKey = MuralBase.RegisterProperty<number>(            PresentationTarget, 'DeviceScale', 1,          MetaData.Measure);
    public static readonly ContentKey     = MuralBase.RegisterProperty<Visual | undefined>(PresentationTarget, 'Content',     undefined,  MetaData.Render);
    public static readonly BackgroundKey  = MuralBase.RegisterProperty<Brush | undefined>( PresentationTarget, 'Background',  undefined,  MetaData.Render);

    private _actualWidth:  number = 0;
    private _actualHeight: number = 0;

    // Top-layer container for popups, dropdowns, and Drawer-Temporary
    // panes. Lazily materialised on the first AttachOverlay call to
    // keep simple targets that never use overlays free of the extra
    // Visual + render walk.
    private _overlayRoot: OverlayLayer | undefined;

    // Unsubscribe thunk for this target's FontManager subscription.
    private readonly _fontUnsubscribe: () => void;

    protected constructor(width?: number, height?: number, content?: Visual)
    {
        super();
        if (width   !== undefined) this.Width = width;
        if (height  !== undefined) this.Height = height;
        if (content !== undefined) this.Content = content;
        // Receive every font the FontManager knows about now or later —
        // load each into our TextMeasurer (metrics) and let concrete
        // targets embed it for rendering. Replays existing registrations.
        this._fontUnsubscribe = FontManager.Current.Subscribe(this);
    }

    // FontConsumer — a font was registered (or replayed on subscribe).
    // Load its bytes into the current measurer so text using it gets real
    // metrics, then hand it to the render-side embed hook. Errors (bad
    // URL, unparseable font) are swallowed so one broken font can't break
    // layout of everything else.
    public ReceiveFont(font: RegisteredFont): void
    {
        void FontManager.Current.LoadBuffer(font).then(buf =>
        {
            this.TextMeasurer.LoadFont(font.Family, buf, font.Weight, font.Style);
            this.EmbedFontForRender(font, buf);
            // Newly-available metrics can change measured sizes — nudge a
            // relayout of the current content so text reflows.
            this.Content?.InvalidateMeasure();
        }).catch(() => { /* unreachable font — leave fallback metrics */ });
    }

    // Render-side embedding hook. Base targets (headless / SVG-string) do
    // nothing — they emit `font-family` verbatim and rely on the consumer
    // having the font. HtmlTarget overrides this to register the face with
    // the live document (FontFace API) so custom fonts actually paint.
    protected EmbedFontForRender(_font: RegisteredFont, _buffer: ArrayBuffer): void
    {
        /* no-op in the base target */
    }

    // Re-push every registered font into the current measurer. Concrete
    // targets call this after swapping their TextMeasurer (e.g. HtmlTarget
    // installing a CanvasTextMeasurer post-attach) so fonts loaded before
    // the swap are present in the new measurer too.
    protected ReloadFontsIntoMeasurer(): void
    {
        for (const font of FontManager.Current.Faces) this.ReceiveFont(font);
    }

    /** Drop this target's font subscription (teardown / tests). */
    public DisposeFonts(): void
    {
        this._fontUnsubscribe();
    }

    // User-set width. NaN (the default) means the width is resolved
    // from Content.DesiredSize at Render time. A finite value pins
    // the surface to exactly that width.
    public get Width(): number { return this.get_property_value(PresentationTarget.WidthKey); }
    public set Width(value: number) { this.set_property_value(PresentationTarget.WidthKey, value); }

    // User-set height. NaN (the default) means the height is resolved
    // from Content.DesiredSize at Render time. A finite value pins
    // the surface to exactly that height.
    public get Height(): number { return this.get_property_value(PresentationTarget.HeightKey); }
    public set Height(value: number) { this.set_property_value(PresentationTarget.HeightKey, value); }

    // Resolved surface dimensions in DIPs, updated by the concrete
    // target's Render pass. In fixed mode these equal Width / Height;
    // in auto mode they hold the Content.DesiredSize value chosen for
    // that axis. Zero on a freshly-constructed target — only meaningful
    // after at least one Render call.
    public get ActualWidth(): number  { return this._actualWidth; }
    public get ActualHeight(): number { return this._actualHeight; }

    // Called by concrete subclasses' Render pass after auto-mode
    // resolution. Separate from Width / Height so user inputs (NaN-as-
    // auto) survive re-rendering with a different Content.
    protected SetActualSize(width: number, height: number): void
    {
        this._actualWidth  = width;
        this._actualHeight = height;
    }

    // ------------------------------------------------------------------
    // Overlay layer
    // ------------------------------------------------------------------
    //
    // Controls that need to paint above the main Content tree (Drawer's
    // Temporary variant, ComboBox's open popup, dialogs, tooltips) call
    // AttachOverlay / DetachOverlay. The overlay layer is rendered AFTER
    // Content by the concrete subclass's renderer, which puts it on top
    // visually and ahead of Content under elementsFromPoint hit-testing.
    //
    // OverlayRoot exposes the live container so the renderer can walk
    // it; it stays `undefined` until something is attached so simple
    // targets pay nothing for the feature.

    // Adds `visual` as a VISUAL-only child of the overlay layer — sets
    // its visualParent + target back-pointers, but does NOT touch its
    // logical parent. Logical-tree wiring (so the popup inherits theme
    // tokens, DataContext, and other inheritable DPs from its OWNING
    // CONTROL rather than from the overlay layer) is the caller's
    // responsibility. The recommended path is `Visual.AttachOverlayChild`,
    // which combines this visual hop with `AttachLogical` on the owner
    // — closes the § 18.10 gap by making "the popup belongs logically
    // to the control that opened it" the canonical pattern.
    //
    // Direct callers (tests, low-level renderers) get the visual hop
    // only; resource cascades through these popups will fall through to
    // Application.ResolveDefaultResource (theme tokens still resolve,
    // subtree Scheme overrides do not).
    public AttachOverlay(visual: Visual): void
    {
        if (this._overlayRoot === undefined)
        {
            this._overlayRoot = new OverlayLayer();
            // Cascade the host back-pointer through the overlay layer
            // so any invalidation inside it reaches our dirty queue.
            // Bracket access bypasses TS protected-member check, mirror
            // of the same call in the Content setter below.
            this._overlayRoot['SetTarget'](this);
        }
        this._overlayRoot.AddVisualChild(visual);
        // Panel.AddVisualChild does NOT auto-invalidate its own measure;
        // the framework leaves that to the caller. Same gap ComboBox papers
        // over (see comments in combo-box.ts). Without the explicit
        // invalidation here the overlay keeps a stale cached size and
        // the new child never gets laid out.
        this._overlayRoot.InvalidateMeasure();
        // Defensive: the freshly-attached child may carry stale
        // _isMeasureValid = false from property writes that happened
        // before AttachOverlay wired its host back-pointer (same
        // pattern as the Content setter). Re-invalidating ensures
        // those queued invalidations reach the host's dirty queue.
        visual.InvalidateMeasure();
    }

    public DetachOverlay(visual: Visual): void
    {
        if (this._overlayRoot === undefined) return;
        this._overlayRoot.RemoveVisualChild(visual);
        this._overlayRoot.InvalidateMeasure();
    }

    // Read-only handle for the renderer. `undefined` until the first
    // AttachOverlay materialises the layer.
    public get OverlayRoot(): Visual | undefined { return this._overlayRoot; }

    // ------------------------------------------------------------------
    // Hit testing
    // ------------------------------------------------------------------
    //
    // Translate a point in the target's content coordinate space (top-
    // left = (0, 0)) to the Visual under that point, or `null` if the
    // pointer is outside the rendered content. Concrete targets pick
    // whichever implementation suits their backend:
    //
    //   * HtmlTarget (SVG backend) — leans on the browser's native DOM
    //     hit test, recovering the Visual via a back-reference stamped
    //     on each painted SVG element. Cheap, correct, and respects
    //     CSS transforms on the host element.
    //   * HtmlTarget (canvas backend, future) — walks the visual tree
    //     spatially using each Visual's arranged bounds.
    //   * HeadlessTarget — currently returns `null`; can grow a tree
    //     walk if tests need pointer simulation off-DOM.
    //
    // Default implementation is `null` so any subclass that hasn't
    // wired hit-testing still satisfies the contract (no events fire).
    public HitTest(_hostX: number, _hostY: number): Visual | undefined
    {
        return undefined;
    }

    public get DeviceScale(): number { return this.get_property_value(PresentationTarget.DeviceScaleKey); }
    public set DeviceScale(value: number) { this.set_property_value(PresentationTarget.DeviceScaleKey, value); }

    public get Content(): Visual | undefined { return this.get_property_value(PresentationTarget.ContentKey); }
    // Setter cascades the host back-pointer (`_target`) through the new
    // Visual subtree, and clears it on the old one. Bracket access on
    // SetTarget bypasses TS's protected-member check — same pattern as
    // Single / Panel call sites that reach into Visual's tree-walk hooks.
    public set Content(value: Visual | undefined)
    {
        const old = this.Content;
        if (old === value) return;
        old?.['SetTarget'](undefined);
        this.set_property_value(PresentationTarget.ContentKey, value);
        // The mounted root has no logical parent, so it never ran the
        // AttachLogical style cascade: resolve its own implicit / theme
        // Style now (a ContentControl root gets its Template here). Done
        // before SetTarget so a freshly-applied template subtree is
        // covered by the host back-pointer cascade.
        value?._refresh_root_styles();
        value?.['SetTarget'](this);
        // Kick the layout queue. The new Content's subtree may carry
        // stale `_isMeasureValid = false` flags from property writes
        // that happened before SetTarget wired the host back-pointer —
        // those invalidations couldn't notify a host that didn't exist
        // yet. Re-invalidating Measure on the root after SetTarget
        // schedules a Flush; the renderer's initial-paint path handles
        // the first paint without needing an explicit render-dirty
        // entry (a Visual that isn't in the renderer's map yet always
        // gets created + drawn).
        value?.InvalidateMeasure();
    }

    // ------------------------------------------------------------------
    // Invalidation queue + coalesced flush
    // ------------------------------------------------------------------
    //
    // Visuals attached to this PresentationTarget call OnMeasureInvalidated /
    // OnArrangeInvalidated / OnRenderInvalidated when their corresponding
    // InvalidateMeasure / InvalidateArrange / InvalidateVisual fires (either
    // automatically through OnPropertyChanged + MetaData flags, or via
    // explicit Invalidate* calls).
    //
    // Each notification:
    //   1. Records the Visual in the matching per-phase Set (deduped).
    //   2. Schedules a single microtask Flush() if one isn't already pending.
    //
    // Flush() runs layout root-down (measure + arrange) on Content. Visual's
    // own _isMeasureValid / _isArrangeValid caches make untouched subtrees
    // O(1), so an "everything dirty" pass still costs only what genuinely
    // changed.
    //
    // The render set persists across Flush() — Flush() resolves layout but
    // doesn't paint (the base has no DrawingContext). A concrete subclass
    // with a renderer drains renderDirty during its render pass. The
    // built-in HeadlessTarget consumes it in Render(dc).

    protected readonly measureDirty: Set<Visual> = new Set();
    protected readonly arrangeDirty: Set<Visual> = new Set();
    protected readonly renderDirty:  Set<Visual> = new Set();
    private flushScheduled: boolean = false;

    public OnMeasureInvalidated(visual: Visual): void
    {
        this.measureDirty.add(visual);
        this.scheduleFlush();
    }

    public OnArrangeInvalidated(visual: Visual): void
    {
        this.arrangeDirty.add(visual);
        this.scheduleFlush();
    }

    public OnRenderInvalidated(visual: Visual): void
    {
        this.renderDirty.add(visual);
        this.scheduleFlush();
    }

    // True when measure or arrange has pending work. Cleared by Flush().
    // Exposed for tests and for renderers that want to skip a frame when
    // nothing has changed.
    public get HasPendingLayout(): boolean
    {
        return this.measureDirty.size > 0 || this.arrangeDirty.size > 0;
    }

    // True when render-only invalidations are queued. Not cleared by
    // Flush() — only a render pass consumes the render set. Exposed so
    // concrete subclasses can ask "is there paint work?" without
    // inspecting the Set directly.
    public get HasPendingRender(): boolean
    {
        return this.renderDirty.size > 0;
    }

    // First invalidation per task queues a microtask that drains. Repeated
    // invalidations within the same task share that one tick — that's the
    // whole point of the dirty Sets: coalescing.
    private scheduleFlush(): void
    {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() =>
        {
            this.flushScheduled = false;
            this.Flush();
        });
    }

    // Resolves layout for the Content subtree:
    //   1. Measure Content with the user-set Width / Height, swapping in
    //      +Infinity on any auto axis so Content reports its natural
    //      DesiredSize.
    //   2. Publish the resolved surface size via SetActualSize.
    //   3. Arrange Content at (0, 0, ActualWidth, ActualHeight).
    //
    // Callable explicitly (tests, sync code paths); also runs automatically
    // on the microtask after any invalidation. Idempotent — Visual's
    // _isMeasureValid / _isArrangeValid caches short-circuit if nothing
    // actually changed since the last Flush.
    //
    // Iterates until the dirty queues stay empty after a layout pass.
    // The common case converges in one iteration: a single measure +
    // arrange does the work and no cross-Visual coupling re-invalidates
    // anyone. Cross-Visual coupling (e.g. Grid's SharedSizeGroup
    // member-set invalidation) can take 1–2 extra iterations to
    // settle: pass N's invalidation lands in the queue, pass N+1
    // re-measures the affected visual, and any new invalidations land
    // in turn. `maxIterations` caps the loop so a pathological scene
    // (cyclic invalidation that never reaches a fixed point) can't
    // hang the host — when the cap is hit, the queues are cleared
    // anyway and Flush returns silently. Default is plenty for
    // realistic scenes; specialised hosts can raise it.
    //
    // Render-set state is preserved across iterations — a concrete
    // subclass's renderer is responsible for consuming it during paint.
    public Flush(maxIterations: number = 16): void
    {
        for (let iter = 0; iter < maxIterations; iter++)
        {
            // Clear measure/arrange queues BEFORE each pass so any
            // invalidations triggered DURING the pass are captured
            // fresh. Per-Visual _isMeasureValid / _isArrangeValid
            // caches still drive what actually gets re-measured —
            // visuals that aren't dirty skip the recompute.
            this.measureDirty.clear();
            this.arrangeDirty.clear();
            this.runLayoutPass();
            // Converged when the pass produced no new invalidations.
            if (this.measureDirty.size === 0 && this.arrangeDirty.size === 0) break;
        }
        // Final clear — Flush is done regardless of whether we
        // converged or hit the cap. HasPendingLayout reflects that.
        this.measureDirty.clear();
        this.arrangeDirty.clear();
    }

    private runLayoutPass(): void
    {
        const content = this.Content;
        const autoW = Number.isNaN(this.Width);
        const autoH = Number.isNaN(this.Height);

        let surfaceW: number;
        let surfaceH: number;

        if (content !== undefined)
        {
            const availW = autoW ? Number.POSITIVE_INFINITY : this.Width;
            const availH = autoH ? Number.POSITIVE_INFINITY : this.Height;
            content.Measure(new Size(availW, availH));

            surfaceW = autoW ? content.DesiredSize.Width  : this.Width;
            surfaceH = autoH ? content.DesiredSize.Height : this.Height;
        }
        else
        {
            // No content: auto axes have nothing to measure → 0. Fixed
            // axes keep their value (Background still paints over them
            // when the subclass renders).
            surfaceW = autoW ? 0 : this.Width;
            surfaceH = autoH ? 0 : this.Height;
        }

        this.SetActualSize(surfaceW, surfaceH);

        if (content !== undefined)
        {
            content.Arrange(new Rect(0, 0, surfaceW, surfaceH));
        }

        // Overlay layer rides the same surface as Content. Measure and
        // arrange at the resolved surface size so popups, drawers, and
        // tooltips cover whatever Content is showing.
        if (this._overlayRoot !== undefined)
        {
            this._overlayRoot.Measure(new Size(surfaceW, surfaceH));
            this._overlayRoot.Arrange(new Rect(0, 0, surfaceW, surfaceH));
        }
    }

    // Text measurement service exposed via VisualHost. Default is the
    // stateless approximation (no real font metrics); concrete subclasses
    // or consumers can swap in a FontMetricsMeasurer (opentype.js-backed)
    // or, when HtmlTarget lands, a CanvasTextMeasurer. The TextMeasurer
    // type on VisualHost is readonly, but this concrete field is
    // assignable — `target.TextMeasurer = new FontMetricsMeasurer()`.
    public TextMeasurer: TextMeasurer = APPROXIMATE_TEXT_MEASURER;

    // Optional paint-engine-accurate measurer (VisualHost.ExactTextMeasurer).
    // undefined on the base target; HtmlTarget installs an SvgTextMeasurer so
    // MeasurementFidelity.Exact controls measure their label width with the
    // same engine that paints it. Assignable for the same reason TextMeasurer
    // is — concrete targets swap it in post-construction.
    public ExactTextMeasurer: TextMeasurer | undefined = undefined;

    // Owned InputManager — single source of truth for pointer state
    // (hover chain, IsMouseOver, IsPressed, pointer capture) AND
    // keyboard focus (current focused Visual, IsFocused DP). Concrete
    // hosts (HtmlTarget) wire their DOM event listeners through this
    // instance; tests that drive input synthetically use it directly
    // via `target.InputManager.Inject*`. Visual.Focus() / Blur() route
    // through SetFocus / GetFocusedVisual below so the host satisfies
    // VisualHost's optional focus surface.
    public readonly InputManager: InputManager = new InputManager();

    public SetFocus(visual: Element | undefined): void
    {
        this.InputManager.SetFocus(visual);
    }

    public GetFocusedVisual(): Element | undefined
    {
        return this.InputManager.GetFocusedVisual();
    }

    // Convenience: load a font into whatever TextMeasurer is currently
    // installed. ApproximateTextMeasurer ignores the call; FontMetricsMeasurer
    // parses the buffer and stores the font keyed by (family, weight, style).
    // Weight / style are auto-detected from the font's OS/2 table when
    // omitted — explicit values override.
    public LoadFont(
        family: string,
        source: ArrayBuffer | Uint8Array,
        weight?: string,
        style?: string,
    ): void
    {
        this.TextMeasurer.LoadFont(family, source, weight, style);
    }

    public get Background(): Brush | undefined { return this.get_property_value(PresentationTarget.BackgroundKey); }
    public set Background(value: Brush | undefined) { this.set_property_value(PresentationTarget.BackgroundKey, value); }
}
