// `Element as MuralElement` — this file uses the DOM's global `Element`
// heavily (setAttribute, elementsFromPoint, …), so the framework's
// Element is aliased to avoid shadowing it.
import { Element as MuralElement, type Visual } from '../../runtime/index.js';
import {
    AdornerLayer,
    AnimationManager,
    DataObject,
    DragDropEffects,
    DragGhostAdorner,
    DragSession,
    ManualClock,
    NoModifiers,
    PointerButton,
    RafClock,
    type KeyEventInit,
    type PointerEventInit,
    type WheelEventInit,
    WheelDeltaMode,
    type ModifierKeys,
    toModifierKeys,
    keyFromDom,
} from '../../runtime/index.js';
import { CanvasTextMeasurer } from '../text/canvas-text-measurer.js';
import { SvgTextMeasurer } from '../text/svg-text-measurer.js';
import { FontManager, FontSourceKind, type RegisteredFont } from '../text/index.js';
import { PresentationTarget } from './presentation-target.js';
import { SvgRenderer, VISUAL_BACKREF } from '../drawing/svg-renderer.js';
import { Point } from '../primitives.js';

// VISUAL_BACKREF stamp lives in svg-renderer.ts; re-import here for
// the HitTest walk so the read side agrees with the write side.
// Re-export so consumers (tests / extensions) can read the stamp off
// any painted node without importing the renderer.
export { VISUAL_BACKREF };

// The backref the renderer stamps on each outer <g> references the
// painted Visual — USUALLY an Element, but a rendering-only leaf (a raw
// `Visual` subclass, e.g. a DrawingVisual or a demo's GeometryView)
// paints and gets stamped too. Input targets Elements only (WPF:
// Mouse.DirectlyOver is always an IInputElement), so the hit-test read
// side resolves the stamp to the nearest Element via nearestInputElement
// before handing it to the InputManager.
interface BackrefHost { [VISUAL_BACKREF]?: MuralElement; }

// Climb from a hit Visual to the nearest Element ancestor (inclusive).
// The renderer can stamp a raw `Visual` (a rendering-only leaf) as the
// hit-test backref; input, however, flows only through Elements — the
// IsMouseOver / IsPressed state DPs and the On*/OnPreview* handlers live
// on Element. Returning the raw Visual would crash the pointer pipeline
// on those missing surfaces, so we surface the enclosing input element
// instead. Returns undefined only if the hit Visual has no Element
// ancestor at all (the target root is always an Element, so this is a
// defensive tail).
function nearestInputElement(v: Visual): MuralElement | undefined
{
    let cur: Visual | undefined = v;
    while (cur !== undefined && !(cur instanceof MuralElement))
    {
        cur = cur.GetVisualParent();
    }
    return cur as MuralElement | undefined;
}

// §19.2.7 — when the candidate Visual has a HitTestGeometry, the
// browser-pick is double-checked against the geometry. The element
// `el` is the SVG node that owns the back-ref — its `getScreenCTM()`
// maps the Visual's local SVG frame to viewport (client) coords, so
// the inverse takes (clientX, clientY) into local space.
function acceptsPoint(visual: Visual, el: Element, clientX: number, clientY: number): boolean
{
    const geom = visual.HitTestGeometry;
    if (geom === undefined) return true;
    // SVGGraphicsElement.getScreenCTM is the only API surface that
    // returns the cumulative SVG transform; bail conservatively if
    // the element doesn't expose it (e.g., a foreignObject-mounted
    // visual).
    const g = el as unknown as { getScreenCTM?: () => DOMMatrix | null };
    if (typeof g.getScreenCTM !== 'function') return true;
    const ctm = g.getScreenCTM();
    if (ctm === null) return true;
    const inv = ctm.inverse();
    const local = new DOMPoint(clientX, clientY).matrixTransform(inv);
    return geom.Contains(new Point(local.x, local.y));
}

// Normalise a browser PointerEvent into our runtime-side init record.
// PointerEvent.button is `-1` between presses (no button); we mirror
// that with PointerButton.None instead of leaking the negative value
// through the runtime types. `pressure` defaults to 0.5 for non-pressure
// pointers per the W3C spec — we forward whatever the event carries.
function pointerInit(
    e: PointerEvent,
    hostX: number,
    hostY: number,
    isDoubleClick = false,
): PointerEventInit
{
    return {
        HostX: hostX,
        HostY: hostY,
        Button: e.button < 0 ? PointerButton.None : (e.button as PointerButton),
        Buttons: e.buttons,
        Modifiers: extractModifiers(e),
        PointerId: e.pointerId,
        Pressure: e.pressure,
        PointerType: normalisePointerType(e.pointerType),
        IsDoubleClick: isDoubleClick,
    };
}

// Double-click detection thresholds. Standard OS defaults are ~500 ms
// + 4 px (Windows uses GetDoubleClickTime / GetSystemMetrics SM_CXDOUBLECLK).
// We don't read those system values here — they're not exposed to web
// content — but the constants line up with the typical OS feel.
const DOUBLE_CLICK_INTERVAL_MS = 500;
const DOUBLE_CLICK_TOLERANCE_PX = 4;

function extractModifiers(e: MouseEvent | KeyboardEvent | WheelEvent): ModifierKeys
{
    return toModifierKeys({
        shift:   e.shiftKey,
        control: e.ctrlKey,
        alt:     e.altKey,
        meta:    e.metaKey,
    });
}

function normalisePointerType(t: string): PointerEventInit['PointerType']
{
    if (t === 'mouse' || t === 'pen' || t === 'touch') return t;
    return 'unknown';
}

// WheelEvent.deltaMode is the integer constants 0 (pixel), 1 (line),
// 2 (page). The runtime types use the string forms to keep handler
// code readable; everything outside the spec range falls back to
// 'pixel' to avoid undefined behaviour on exotic devices.
function wheelDeltaMode(m: number): WheelDeltaMode
{
    if (m === 1) return WheelDeltaMode.Line;
    if (m === 2) return WheelDeltaMode.Page;
    return WheelDeltaMode.Pixel;
}

// "Printable" = produces a single character ready to insert into the
// document — excludes modifier keys ('Shift', 'Control', …), navigation
// ('ArrowLeft', 'Home'), editing ('Backspace', 'Delete'), function keys
// ('F1'), and anything else whose `key` string is longer than one
// glyph. Also gates out Ctrl/Meta chords (Ctrl+C, ⌘+V) so the chord
// reaches OnKeyDown as a single command instead of leaking through as
// stray text input. Alt+letter combinations DO flow through (matches
// macOS option-key special characters); a TextBox that wants to
// suppress them can filter in OnTextInput.
function isPrintableKey(e: KeyboardEvent): boolean
{
    if (e.ctrlKey || e.metaKey) return false;
    if (e.key.length !== 1)     return false;
    return true;
}

// HtmlTarget construction options. `backend` picks the rendering pipeline
// inside the host element (SVG node tree for <=10k visible elements,
// Canvas commands for everything else). `devicePixelRatio` lets tests
// override the default `window.devicePixelRatio`.
export enum RenderBackend
{
    Svg    = 'svg',
    Canvas = 'canvas',
}

enum PointerPhase
{
    Move  = 'move',
    Down  = 'down',
    Up    = 'up',
    Leave = 'leave',
}

enum KeyPhase
{
    Down = 'down',
    Up   = 'up',
}

export interface HtmlTargetOptions
{
    backend?: RenderBackend;
    devicePixelRatio?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Walk a freshly-cloned subtree and force pointer-events="none" on
// every element. Used when building the drag overlay's ghost: the
// renderer stamps `mural-hit` rects with `pointer-events="all"` (so
// hit-testing of normal scene visuals works against their empty
// fill); that explicit `all` would otherwise beat the overlay's
// inherited `none` and pollute elementsFromPoint with ghost geometry.
function suppressPointerEvents(root: Element): void
{
    root.setAttribute('pointer-events', 'none');
    const descendants = root.querySelectorAll('*');
    for (let i = 0; i < descendants.length; i++)
    {
        descendants[i]!.setAttribute('pointer-events', 'none');
    }
}

// PresentationTarget for browser hosting. Owns:
//   * the host Element (passed by the consumer — a <div>, <section>, …)
//   * the rendering surface (<svg> or <canvas>) appended inside the host
//   * a ResizeObserver that translates host size changes into
//     Width / Height updates on the PresentationTarget
//   * a one-shot read of window.devicePixelRatio into DeviceScale
//   * (deferred until build-order step 12.8) the SvgRenderer /
//     CanvasRenderer instance that does the actual painting
//
// Until the renderer is wired up, setting `Content` has no visible
// effect — the DOM mount, resize observation, and DPI tracking are all
// live and observable through the inherited PresentationTarget
// property surface, but the Visual tree is not yet painted.
export class HtmlTarget extends PresentationTarget
{
    private readonly host: Element;
    private readonly surface: SVGSVGElement; // TODO: HTMLCanvasElement when backend='canvas'
    private readonly resize_observer: ResizeObserver;
    private readonly options: Required<Pick<HtmlTargetOptions, 'backend'>> & HtmlTargetOptions;
    private readonly renderer: SvgRenderer;

    // Input plumbing. The InputManager owning hover-chain diffing,
    // IsMouseOver / IsPressed, pointer capture AND keyboard focus
    // lives on the base PresentationTarget — accessed below as
    // `this.InputManager`. The bound listeners below are stored so
    // Dispose can detach them cleanly.
    private readonly onPointerMove:  (e: PointerEvent) => void;
    private readonly onPointerDown:  (e: PointerEvent) => void;
    private readonly onPointerUp:    (e: PointerEvent) => void;
    private readonly onPointerLeave: (e: PointerEvent) => void;
    private readonly onPointerWheel: (e: WheelEvent)   => void;
    private readonly onKeyDown:      (e: KeyboardEvent) => void;
    private readonly onKeyUp:        (e: KeyboardEvent) => void;
    // Drag cancellation listeners — ESC, host blur, and the browser's
    // pointercancel (OS reclaiming the pointer, e.g. via a touch
    // gesture cancellation). All three call session.Cancel() and poll
    // the InputManager to tear down state.
    private readonly onDragKeyDown:   (e: KeyboardEvent) => void;
    private readonly onDragBlur:      () => void;
    private readonly onPointerCancel: (e: PointerEvent) => void;
    // OS-level drag listeners (8.1). The browser fires `dragenter` when
    // a drag crosses the host's bounding box (from outside OR from one
    // descendant to another), `dragover` continuously while moving,
    // `dragleave` when the drag exits the host, and `drop` on release.
    // The handlers synthesize a `DragSession` on first enter and
    // dispatch the same DragEnter/Over/Drop routed events the in-app
    // drag path uses.
    private readonly onOsDragEnter: (e: DragEvent) => void;
    private readonly onOsDragOver:  (e: DragEvent) => void;
    private readonly onOsDragLeave: (e: DragEvent) => void;
    private readonly onOsDrop:      (e: DragEvent) => void;
    // True while an OS drag is being tracked. Used to keep
    // `dragleave` from cancelling on internal element-boundary
    // crossings (the browser fires dragleave then dragenter on the
    // new element — the session must stay alive across that pair).
    private osDragSessionActive: boolean = false;

    // Double-click detection state — the host adapter is the source of
    // truth for `PointerEventArgs.IsDoubleClick` because the browser
    // doesn't dispatch separate Down events for the second tap of a
    // platform-native dblclick. Each pointerdown compares button +
    // time + position against the last recorded press; if all three
    // are within tolerance the new press is flagged as a double-click
    // and the timestamp is cleared so a third tap doesn't ALSO match.
    private lastClickAt:     number = 0;
    private lastClickX:      number = 0;
    private lastClickY:      number = 0;
    private lastClickButton: number = -1;

    // Drag overlay — a <g> appended on top of the renderer's scene
    // when a session starts and removed on session end. Mode A
    // (preview = undefined) populates `dragGhost` with a translucent
    // clone of the source's outer <g>; mode C (preview = DataTemplate)
    // routes the template's produced Visual through the OverlayLayer
    // and re-parents its outer <g> into `dragGhost` so the cursor-
    // follow transform covers it. Mode B (preview = null) creates the
    // overlay but no ghost — the author renders the feedback themselves
    // via session.OnMove (e.g. the diagram demo's rubber-band line).
    private dragOverlay: SVGGElement | undefined;
    private dragGhost:   SVGGElement | undefined;

    constructor(host: Element, options: HtmlTargetOptions = {})
    {
        super();
        this.host = host;
        this.options = { backend: RenderBackend.Svg, ...options };

        this.DeviceScale = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

        // Content box, not border box — the SVG mounts INSIDE the host's
        // padding edge, so any border / scrollbar width shouldn't widen
        // the surface. `clientWidth` / `clientHeight` give exactly that
        // in real browsers; jsdom returns 0 (no layout engine) so we
        // fall back to `getBoundingClientRect` for tests that patch the
        // bounding rect to drive layout.
        const cw = (host as HTMLElement).clientWidth;
        const ch = (host as HTMLElement).clientHeight;
        if (cw > 0 && ch > 0)
        {
            this.Width  = cw;
            this.Height = ch;
        }
        else
        {
            const rect = host.getBoundingClientRect();
            this.Width  = rect.width;
            this.Height = rect.height;
        }

        if (this.options.backend === RenderBackend.Svg)
        {
            this.surface = document.createElementNS(SVG_NS, 'svg');
            this.surface.style.display = 'block';
            this.surface.style.width = '100%';
            this.surface.style.height = '100%';
            // Mural surfaces present UI controls, not selectable
            // documents — disable native text selection so clicks +
            // drags don't trigger range selection on `<text>` nodes
            // (which would highlight button labels and steal pointer
            // focus mid-drag). Both the modern `user-select` and the
            // legacy WebKit prefix are set so Safari < 17 honours it.
            // Consumers building selectable surfaces (future text
            // editor / inspector) override this on the host element
            // they pass in.
            this.surface.style.userSelect = 'none';
            (this.surface.style as unknown as { webkitUserSelect: string })
                .webkitUserSelect = 'none';
            this.surface.setAttribute('width',  String(this.Width));
            this.surface.setAttribute('height', String(this.Height));
            host.appendChild(this.surface);
        }
        else
        {
            // Canvas backend lands with the CanvasRenderer in a later
            // step — for now reject so it fails loudly instead of
            // silently producing nothing.
            throw new Error("HtmlTarget: backend 'canvas' is not implemented yet (deferred to a later build-order step).");
        }

        this.resize_observer = new ResizeObserver(entries =>
        {
            // We only ever observe one element (the host), so the first
            // entry's contentRect is the new size.
            const entry = entries[0];
            if (entry === undefined) return;
            const { width, height } = entry.contentRect;
            const sizeChanged = width !== this.Width || height !== this.Height;
            if (!sizeChanged) return;
            this.Width = width;
            this.Height = height;
            this.surface.setAttribute('width',  String(width));
            this.surface.setAttribute('height', String(height));
            // PresentationTarget.OnPropertyChanged is a no-op (MuralBase
            // default), so the Width / Height writes above don't
            // automatically schedule a layout pass. Invalidate the
            // Content + OverlayLayer explicitly so the next microtask
            // Flush re-measures and re-arranges them against the new
            // surface size. Without this the host element resizes but
            // the Visual tree stays laid out for the old dimensions.
            this.Content?.InvalidateMeasure();
            this.Content?.InvalidateArrange();
            this.OverlayRoot?.InvalidateMeasure();
            this.OverlayRoot?.InvalidateArrange();
        });
        this.resize_observer.observe(this.host);

        // Make the host element programmatically focusable so it can
        // receive keyboard events. tabindex=0 also puts it in the
        // natural Tab order so users can Tab into a mural surface from
        // surrounding page chrome. Consumers that want different Tab
        // semantics override the attribute on the host element AFTER
        // construction — we only set it when the consumer hasn't.
        //
        // We deliberately do NOT set tabindex on the inner <svg>
        // surface: leaving SVG and its children unfocusable means a
        // click inside the surface won't compete with the host for the
        // browser's "transfer focus on click" walk. Instead we call
        // host.focus() explicitly on every pointer-down (see
        // handlePointer) so DOM focus follows wherever the user
        // clicked. Without that explicit focus call, keydown events
        // would fire on document.body (the previously-focused element)
        // and never reach our host-level listener.
        if (!(host as HTMLElement).hasAttribute('tabindex'))
        {
            (host as HTMLElement).tabIndex = 0;
        }
        // Drop the dotted focus ring the browser draws by default —
        // mural controls render their own focus visuals.
        (host as HTMLElement).style.outline = 'none';

        // PointerEvents listeners on the host. Using the host (not the
        // surface) keeps the listener set stable across re-renders
        // that swap the surface — and it makes leave detection work
        // for the whole content area instead of just the SVG node.
        this.onPointerMove  = (e) => this.handlePointer(PointerPhase.Move,  e);
        this.onPointerDown  = (e) => this.handlePointer(PointerPhase.Down,  e);
        this.onPointerUp    = (e) => this.handlePointer(PointerPhase.Up,    e);
        this.onPointerLeave = (e) => this.handlePointer(PointerPhase.Leave, e);
        this.onPointerWheel = (e) => this.handleWheel(e);
        this.onKeyDown      = (e) => this.handleKey(KeyPhase.Down, e);
        this.onKeyUp        = (e) => this.handleKey(KeyPhase.Up, e);
        this.onDragKeyDown = (e: KeyboardEvent) => {
            if (this.InputManager.IsDragActive && e.key === 'Escape')
            {
                this.InputManager.CurrentDragSession?.Cancel();
                this.PollSessionCancellation();
            }
        };
        this.onDragBlur = () => {
            if (this.InputManager.IsDragActive)
            {
                this.InputManager.CurrentDragSession?.Cancel();
                this.PollSessionCancellation();
            }
        };
        this.onPointerCancel = (_e: PointerEvent) => {
            if (this.InputManager.IsDragActive)
            {
                this.InputManager.CurrentDragSession?.Cancel();
                this.PollSessionCancellation();
            }
        };
        this.onOsDragEnter = (e: DragEvent) => this.handleOsDragEnter(e);
        this.onOsDragOver  = (e: DragEvent) => this.handleOsDragOver(e);
        this.onOsDragLeave = (e: DragEvent) => this.handleOsDragLeave(e);
        this.onOsDrop      = (e: DragEvent) => this.handleOsDrop(e);
        this.host.addEventListener('pointermove',   this.onPointerMove   as EventListener);
        this.host.addEventListener('pointerdown',   this.onPointerDown   as EventListener);
        this.host.addEventListener('pointerup',     this.onPointerUp     as EventListener);
        this.host.addEventListener('pointerleave',  this.onPointerLeave  as EventListener);
        this.host.addEventListener('pointercancel', this.onPointerCancel as EventListener);
        this.host.addEventListener('wheel',         this.onPointerWheel  as EventListener);
        this.host.addEventListener('keydown',       this.onKeyDown       as EventListener);
        this.host.addEventListener('keydown',       this.onDragKeyDown   as EventListener);
        this.host.addEventListener('keyup',         this.onKeyUp         as EventListener);
        this.host.addEventListener('blur',          this.onDragBlur      as EventListener);
        // OS-level drop wiring. `dragenter` synthesizes the session on
        // the first crossing; `dragover` must call preventDefault() to
        // tell the browser to allow the drop (the default is to reject);
        // `drop` finishes the session.
        this.host.addEventListener('dragenter', this.onOsDragEnter as EventListener);
        this.host.addEventListener('dragover',  this.onOsDragOver  as EventListener);
        this.host.addEventListener('dragleave', this.onOsDragLeave as EventListener);
        this.host.addEventListener('drop',      this.onOsDrop      as EventListener);

        // Bridge mural's pointer capture to the browser's native
        // setPointerCapture so a captured drag survives the cursor
        // leaving the host element's bounds. Without this, a drag
        // (a Figure reposition, a Thumb pull, …) would lose
        // pointermove events the moment the cursor wanders into
        // chrome / outside the document; the InputManager's internal
        // capture map only redirects events that DO arrive. Wrap
        // setPointerCapture / releasePointerCapture in try/catch
        // because the DOM rejects calls for pointers that don't exist
        // (synthesized inputs from tests, stale ids after a Cancel).
        this.InputManager.SetCaptureBridge((target, pointerId) => {
            const el = this.host as HTMLElement;
            try {
                if (target !== undefined) el.setPointerCapture(pointerId);
                else                       el.releasePointerCapture(pointerId);
            } catch {
                // Pointer id may be invalid (release-after-up race, or a
                // synthesized id from a test harness). Either way, the
                // capture state is consistent with what we asked for.
            }
        });

        // Cursor lock bridge — stamps the drag cursor as an inline style
        // on the HOST element (the container the consumer handed us).
        // Inline styles beat any CSS rule on the host or its ancestors,
        // including the common `#app { cursor: default }` pattern host
        // pages set to tame the default I-beam over text-free panels.
        // Cursor inherits down through the SVG surface and every Visual
        // that doesn't override with its own Cursor DP, so the locked
        // cursor wins for the duration of the capture. We also clear
        // any body-level cursor on release so a previous body write
        // (drag-drop session, splitter pull) doesn't strand a cursor.
        // Cleared by InputManager on capture release and on PointerUp
        // auto-release.
        const hostEl = this.host as HTMLElement;
        this.InputManager.SetCursorBridge((cursor) => {
            hostEl.style.cursor = cursor ?? '';
        });

        // SvgRenderer paints the visual tree into the SVG surface and
        // maintains DOM identity per visual across re-render passes.
        // The renderer is driven from Flush() below — every layout
        // flush triggers a paint that drains renderDirty + arrangeDirty.
        this.renderer = new SvgRenderer(this.surface, {
            document: this.host.ownerDocument ?? document,
        });

        // Swap the base-class default (ApproximateTextMeasurer) for the
        // Canvas-backed measurer. Canvas 2D's measureText uses the same
        // browser font engine the SVG renderer paints with, so widths
        // line up closely with the painted glyphs while taking only a
        // few microseconds per call — fast enough to re-measure the
        // whole TextBox on every keystroke.
        //
        // SvgTextMeasurer (using `<text>.getSubStringLength`) gives
        // pixel-exact widths because it IS the renderer, but each call
        // forces a synchronous layout flush — for a multi-line TextBox
        // that turns every keystroke into hundreds of layouts and a
        // visibly stuttery editor. The export stays available for
        // consumers who need exact accuracy and aren't doing live
        // editing.
        //
        // Consumers wanting FontMetricsMeasurer (PDF / Node parity,
        // off-screen rendering) overwrite TextMeasurer after
        // construction and pair it with a LoadFont call.
        try
        {
            this.TextMeasurer = new CanvasTextMeasurer(this.host.ownerDocument ?? document);
            // The base ctor already pushed any pre-registered fonts into
            // the ApproximateTextMeasurer (a no-op there). Re-push them so
            // the freshly-installed CanvasTextMeasurer also has them.
            this.ReloadFontsIntoMeasurer();
            // Paint-engine-accurate measurer for MeasurementFidelity.Exact
            // (size-to-text chrome — Chip labels). Uses the same offscreen
            // SVG <text> layout the renderer paints with, so a chip's measured
            // label width equals its painted width in every Chromium build.
            // No font reload needed: SvgTextMeasurer.LoadFont is a no-op (the
            // browser owns @font-face / FontFace registration).
            this.ExactTextMeasurer = new SvgTextMeasurer(this.host.ownerDocument ?? document);
        }
        catch
        {
            // Canvas 2D unavailable. Stick with the approximate
            // measurer rather than failing construction.
        }

        // Animation engine ticks against AnimationManager.Instance.Clock.
        // The default ManualClock is great for tests but goes nowhere on
        // its own; a browser host expects rAF. Swap in a RafClock IFF the
        // current clock is still the default ManualClock — never stomp a
        // clock the consumer (or an earlier HtmlTarget in a multi-target
        // app) has already installed. Two HtmlTargets in one app share
        // the same RafClock instance and the same animation tick, which
        // is what we want — multiple surfaces, one frame loop.
        if (AnimationManager.Instance.Clock instanceof ManualClock)
        {
            AnimationManager.Instance.Clock = new RafClock();
        }
    }

    // Drive the renderer from the layout flush. Layout runs first
    // (super.Flush() resolves Measure / Arrange), then the renderer
    // walks the tree to paint everything that's render- or arrange-
    // dirty. Both Sets are cleared by the renderer after the walk.
    // Render-side font embedding. Registers the face with the live
    // document via the FontFace API so the SVG renderer's `font-family`
    // references actually resolve to the custom font. A URL source loads
    // by URL (browser dedups the fetch with our metrics fetch); a buffer
    // source loads from the bytes we already have. Idempotent-ish: adding
    // an equal FontFace twice is cheap and the set dedups by identity.
    protected override EmbedFontForRender(font: RegisteredFont, buffer: ArrayBuffer): void
    {
        const doc = this.host.ownerDocument ?? document;
        // `document.fonts` (FontFaceSet) is the standard surface; guard
        // for environments (older jsdom) that lack it.
        const fontSet = (doc as Document & { fonts?: FontFaceSet }).fonts;
        if (fontSet === undefined || typeof FontFace === 'undefined') return;
        try
        {
            const url = FontManager.Current.SourceUrl(font);
            const src = font.Source.kind === FontSourceKind.Url && url !== undefined
                ? `url(${JSON.stringify(url)})`
                : buffer;
            const face = new FontFace(font.Family, src as string | BufferSource, {
                weight: font.Weight,
                style:  font.Style,
            });
            fontSet.add(face);
            void face.load();
        }
        catch { /* malformed font / unsupported environment — skip embed */ }
    }

    public override Flush(): void
    {
        super.Flush();
        // `as any` to reach the protected renderDirty Set without
        // adding a getter; the renderer is the only consumer that
        // needs raw access in v1. Adding a typed accessor is a
        // bigger refactor than the renderer wiring warrants.
        const renderDirty  = (this as unknown as { renderDirty: Set<Visual> }).renderDirty;
        const arrangeDirty = (this as unknown as { arrangeDirty: Set<Visual> }).arrangeDirty;
        this.renderer.Render(this.Content, this.OverlayRoot, renderDirty, arrangeDirty);
    }

    // Tear down DOM listeners and unmount the surface. Call before
    // discarding an HtmlTarget so the host element is left clean.
    public dispose(): void
    {
        this.resize_observer.disconnect();
        this.host.removeEventListener('pointermove',   this.onPointerMove   as EventListener);
        this.host.removeEventListener('pointerdown',   this.onPointerDown   as EventListener);
        this.host.removeEventListener('pointerup',     this.onPointerUp     as EventListener);
        this.host.removeEventListener('pointerleave',  this.onPointerLeave  as EventListener);
        this.host.removeEventListener('pointercancel', this.onPointerCancel as EventListener);
        this.host.removeEventListener('wheel',         this.onPointerWheel  as EventListener);
        this.host.removeEventListener('keydown',       this.onKeyDown       as EventListener);
        this.host.removeEventListener('keydown',       this.onDragKeyDown   as EventListener);
        this.host.removeEventListener('keyup',         this.onKeyUp         as EventListener);
        this.host.removeEventListener('blur',          this.onDragBlur      as EventListener);
        this.renderer.dispose();
        this.surface.remove();
        this.DisposeFonts();
    }

    // Drag cancellation poll. Called by the cancellation listeners and
    // available to consumers (e.g. tests) that want to react to a
    // session.Cancel() from author code without going through a DOM
    // event. Reads InputManager.ObserveSessionCancellation and, if the
    // session is now done, runs OnDragSessionEnded for DOM cleanup.
    public PollSessionCancellation(): void
    {
        if (!this.InputManager.IsDragActive) return;
        this.InputManager.ObserveSessionCancellation();
        if (!this.InputManager.IsDragActive)
        {
            this.OnDragSessionEnded();
        }
    }

    // ── HitTest ────────────────────────────────────────────────────

    // SVG backend hit-test: ask the browser which DOM node sits at the
    // host coordinates, then climb to the nearest ancestor carrying a
    // VISUAL_BACKREF stamp from SvgDrawingContext. Returns undefined
    // if the pointer is outside the painted content or on a non-visual
    // DOM node (e.g., the host's chrome).
    //
    // §19.2.7: when a candidate Visual has a `HitTestGeometry`, the
    // browser-pick is double-checked by inverse-mapping (clientX,
    // clientY) into the Visual's local SVG frame via
    // `getScreenCTM().inverse()` and calling `geometry.Contains(...)`.
    // On rejection we fall through to the next ancestor — letting a
    // pointer slip "through" the AABB corners of an Expressive shape
    // to whatever sits behind it.
    public override HitTest(hostX: number, hostY: number): MuralElement | undefined
    {
        const rect = this.host.getBoundingClientRect();
        const clientX = rect.left + hostX;
        const clientY = rect.top  + hostY;
        // `elementsFromPoint` returns elements in front-to-back order;
        // the first one with a back-reference is the deepest painted
        // visual at that point.
        const stack = (this.host.ownerDocument ?? document)
            .elementsFromPoint(clientX, clientY);
        for (const el of stack)
        {
            for (let cur: Node | null = el; cur !== null; cur = cur.parentNode)
            {
                const back = (cur as unknown as BackrefHost)[VISUAL_BACKREF];
                if (back !== undefined)
                {
                    if (acceptsPoint(back, cur as Element, clientX, clientY))
                    {
                        // Resolve a raw-Visual hit to the nearest Element
                        // (WPF DirectlyOver semantics). A rendering-only
                        // leaf with no Element ancestor falls through to
                        // the next hit-stack candidate.
                        const target = nearestInputElement(back);
                        if (target !== undefined) return target;
                    }
                    // Geometry rejected (or no input element) — keep climbing.
                    continue;
                }
                if (cur === this.host) break;   // ran off the top of the host
            }
        }
        return undefined;
    }

    // ── Drag overlay (modes A and C) ────────────────────────────────

    private ensureDragOverlay(): SVGGElement
    {
        if (this.dragOverlay !== undefined) return this.dragOverlay;
        const doc = this.host.ownerDocument ?? document;
        const g = doc.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'mural-drag-overlay');
        // pointer-events=none so the ghost never blocks receiver
        // hit-testing — receivers under the cursor still pick up
        // pointermove events. The overlay only carries visuals.
        g.setAttribute('pointer-events', 'none');
        // Append AFTER the renderer's scene so it paints on top.
        this.surface.appendChild(g);
        this.dragOverlay = g;
        return g;
    }

    private removeDragOverlay(): void
    {
        this.dragOverlay?.parentNode?.removeChild(this.dragOverlay);
        this.dragOverlay = undefined;
        this.dragGhost   = undefined;
    }

    // Public hook the pointer adapter calls when a session enters.
    // Reads the session's preview option from
    // InputManager.CurrentDragOptions.
    //   mode A (preview undefined): snapshot the source's outer <g>
    //     and append a 60%-opacity clone to the overlay.
    //   mode B (preview === null): create the overlay shell only —
    //     author renders feedback via session.OnMove.
    //   mode C (preview is a DataTemplate-shaped object): instantiate
    //     the template, route the produced Visual through AttachOverlay
    //     so the renderer paints it, then move its outer <g> into the
    //     drag overlay so SetDragGhostPosition can translate it.
    public OnDragSessionStarted(): void
    {
        const session = this.InputManager.CurrentDragSession;
        if (session === null) return;
        // Cursor is deliberately NOT mutated during a drag — the
        // browser-native "move / copy / not-allowed" CSS cursors (the
        // 4-direction arrow on Windows, the green-plus on copy, the
        // ⊘ on not-allowed) were visually loud and read as desktop-
        // app chrome rather than in-app drag affordance. Receivers
        // still publish an Effect (which the InsertionAdornerTemplate
        // / drag-ghost reflect visually), but the host cursor stays
        // whatever it was when the gesture started.
        const opts = this.InputManager.CurrentDragOptions;
        if (opts.preview === null)
        {
            this.ensureDragOverlay();      // mode B — shell only
            return;
        }

        // Prefer the AdornerLayer path when the visual tree carries an
        // AdornerDecorator — the drag ghost then participates in the
        // standard render pipeline (the renderer's outer-<g> translate
        // handles positioning) instead of riding a surface-level
        // dragOverlay <g> owned by the host. Mode A clones the
        // source's painted subtree under the adorner's outer; mode C
        // hosts the preview Visual as the adorner's content.
        const content = this.Content;
        const layer = content !== undefined
            ? AdornerLayer.FindFirstInSubtree(content)
            : undefined;

        if (opts.preview === undefined)
        {
            // Mode A — translucent clone of the source. OS-level drops
            // (8.1) have `Source === undefined`; the browser already
            // owns the drag image in that case, so the framework
            // skips its own ghost.
            if (session.Source !== undefined)
            {
                if (layer !== undefined)
                {
                    this.attachGhostAdornerFromSource(layer, session.Source);
                }
                else
                {
                    this.attachGhostFromSource(session.Source);
                }
            }
            return;
        }
        if (layer !== undefined)
        {
            this.attachGhostAdornerFromTemplate(layer, opts.preview, session.Data);
        }
        else
        {
            this.attachGhostFromTemplate(opts.preview, session.Data);
        }
    }

    // No-op — cursor is intentionally not mutated during a drag. See
    // the comment in OnDragSessionStarted for the rationale. Kept as a
    // public method (rather than removed) so the InputManager's
    // per-move call site doesn't need a feature-flag check; tests that
    // previously asserted cursor mappings now assert that the cursor
    // stays unchanged.
    public UpdateCursorForEffect(_effect: DragDropEffects): void
    {
        /* deliberately empty */
    }

    public OnDragSessionEnded(): void
    {
        // Adorner-mode teardown takes precedence — the adorner owns the
        // ghost <g> (mode A) / preview Visual (mode C) in this case;
        // removing the adorner detaches both from the layer.
        if (this._ghostAdorner !== undefined && this._ghostAdornerLayer !== undefined)
        {
            this._ghostAdornerLayer.Remove(this._ghostAdorner);
            this._ghostAdorner       = undefined;
            this._ghostAdornerLayer  = undefined;
            this._modeCPreviewVisual = undefined;
            return;
        }
        // Detach the mode-C preview Visual from the OverlayLayer if it
        // was attached — keeps the framework's overlay tracking in
        // sync. The <g> is already gone (parented under dragOverlay
        // which removeDragOverlay clears), so this just clears the
        // visual-tree side.
        if (this._modeCPreviewVisual !== undefined)
        {
            this.DetachOverlay(this._modeCPreviewVisual);
            this._modeCPreviewVisual = undefined;
        }
        this.removeDragOverlay();
    }

    private _modeCPreviewVisual: Visual | undefined;
    // Adorner-mode state. Populated when an AdornerLayer is present in
    // the content tree and we host the ghost there instead of on a
    // surface-level dragOverlay <g>.
    private _ghostAdorner:        DragGhostAdorner | undefined;
    private _ghostAdornerLayer:   AdornerLayer | undefined;

    // True iff a drag ghost is currently in the DOM (either path):
    //   * `dragOverlay` defined  — surface-level overlay path (legacy /
    //                              no-adorner fallback).
    //   * `_ghostAdorner` defined — adorner-layer path (the AdornerDecorator
    //                              is present somewhere in the content tree).
    // Either condition means OnDragSessionStarted has already wired up
    // the ghost for the active drag; callers use this to avoid a second
    // wire-up on the next move sample.
    private isGhostAttached(): boolean
    {
        return this.dragOverlay !== undefined || this._ghostAdorner !== undefined;
    }

    private attachGhostFromTemplate(
        template: { Apply(data: unknown): Visual },
        data: DataObject,
    ): void
    {
        const overlay = this.ensureDragOverlay();
        const previewVisual = template.Apply(data);
        // Route through the existing OverlayLayer so the renderer
        // paints the preview into the overlay's outer <g>.
        this.AttachOverlay(previewVisual);
        this.Flush();
        const outer = this.findOuterGForVisual(previewVisual);
        if (outer === null) return;          // renderer didn't paint
        // Wrap in a translate-able ghost <g> and re-parent the
        // produced outer <g> under it.
        const doc = this.host.ownerDocument ?? document;
        const ghost = doc.createElementNS(SVG_NS, 'g');
        ghost.setAttribute('class', 'mural-drag-ghost');
        // Strip the scene-position transform so the preview content
        // lands at the ghost's local origin — see attachGhostFromSource
        // for the full reasoning.
        outer.removeAttribute('transform');
        // Same hit-test transparency contract as mode A — the renderer
        // stamped pointer-events="all" on every mural-hit descendant
        // of the freshly-painted preview, and we need them invisible
        // to HitTest while the ghost follows the cursor.
        suppressPointerEvents(outer);
        ghost.appendChild(outer);
        overlay.appendChild(ghost);
        this.dragGhost           = ghost;
        this._modeCPreviewVisual = previewVisual;
    }

    public SetDragGhostPosition(hostX: number, hostY: number): void
    {
        // Subtract the press-relative cursor offset so the cursor stays
        // anchored at the point inside the source where the user pressed.
        // Without this, a stretched source (an ItemsControl
        // ContentPresenter spanning a wide panel with a smaller centered
        // tile inside) shows the visible tile offset from the cursor by
        // the centering distance, even though the outer's scene-position
        // transform is stripped. The latch populates ghostCursorOffset
        // from the press coords + source's host-coord position; defaults
        // to (0, 0) for imperative DoDragDrop callers and OS-drag.
        const offset = this.InputManager.CurrentDragOptions.ghostCursorOffset ?? { x: 0, y: 0 };
        const hx = hostX - offset.x;
        const hy = hostY - offset.y;

        if (this._ghostAdorner !== undefined && this._ghostAdornerLayer !== undefined)
        {
            // Adorner path — write layer-local coords. The renderer's
            // outer-translate then positions the ghost via the
            // standard arrange pipeline.
            const layerOff = this.layerHostOffset(this._ghostAdornerLayer);
            this._ghostAdorner.SetPosition(hx - layerOff.x, hy - layerOff.y);
            return;
        }
        if (this.dragGhost === undefined) return;
        this.dragGhost.setAttribute('transform', `translate(${hx},${hy})`);
    }

    // Adorner-mode mode-A: the adorner is a positioning shell; after
    // the next Flush paints its outer <g>, we append the source's
    // cloned <g> into it. The transform-strip + pointer-events
    // suppression contracts are identical to the surface-overlay path
    // — only the host changes.
    private attachGhostAdornerFromSource(layer: AdornerLayer, source: Visual): void
    {
        const sourceOuter = this.findOuterGForVisual(source);
        if (sourceOuter === null) return;

        const adorner = new DragGhostAdorner(layer);
        layer.Add(adorner);
        this._ghostAdorner      = adorner;
        this._ghostAdornerLayer = layer;
        // Drive a paint so the renderer creates the adorner's outer <g>.
        this.Flush();
        const adornerOuter = this.findOuterGForVisual(adorner);
        if (adornerOuter === null) return;

        const clone = sourceOuter.cloneNode(true) as Element;
        clone.removeAttribute('transform');
        suppressPointerEvents(clone);
        adornerOuter.setAttribute('opacity', '0.6');
        adornerOuter.appendChild(clone);
    }

    // Adorner-mode mode-C: the preview Visual becomes the adorner's
    // child. The renderer paints it under the adorner's outer <g> — no
    // DOM gymnastics needed because the preview is a real Visual.
    private attachGhostAdornerFromTemplate(
        layer: AdornerLayer,
        template: { Apply(data: unknown): Visual },
        data: DataObject,
    ): void
    {
        const previewVisual = template.Apply(data);
        const adorner = new DragGhostAdorner(layer);
        adorner.SetContent(previewVisual);
        layer.Add(adorner);
        this._ghostAdorner       = adorner;
        this._ghostAdornerLayer  = layer;
        this._modeCPreviewVisual = previewVisual;
        // Drive a paint so the adorner / preview Visual reach the DOM
        // before the first move sample writes a Position into them.
        this.Flush();
        const adornerOuter = this.findOuterGForVisual(adorner);
        if (adornerOuter !== null)
        {
            // Pointer-events transparency contract — same as the
            // surface-overlay drag ghost. The preview's mural-hit
            // rects would otherwise eat HitTest while the cursor
            // tracks the ghost.
            suppressPointerEvents(adornerOuter);
            adornerOuter.setAttribute('opacity', '0.6');
        }
    }

    // Walk from the AdornerLayer up through ArrangedRect offsets to
    // compute the layer's top-left in host coords. Used to convert
    // host-coord cursor positions to layer-local coords before
    // writing them into a DragGhostAdorner.
    private layerHostOffset(layer: AdornerLayer): { x: number; y: number }
    {
        let x = 0, y = 0;
        let cur: Visual | undefined = layer;
        while (cur !== undefined)
        {
            x += cur.ArrangedRect.X;
            y += cur.ArrangedRect.Y;
            cur = cur.GetVisualParent();
        }
        return { x, y };
    }

    private attachGhostFromSource(source: Visual): void
    {
        const sourceOuter = this.findOuterGForVisual(source);
        if (sourceOuter === null) return;        // not yet painted

        const overlay = this.ensureDragOverlay();
        const doc     = this.host.ownerDocument ?? document;
        const ghost   = doc.createElementNS(SVG_NS, 'g');
        ghost.setAttribute('class',   'mural-drag-ghost');
        ghost.setAttribute('opacity', '0.6');
        const clone = sourceOuter.cloneNode(true) as Element;
        // The renderer set a `transform="translate(srcX,srcY)"` on the
        // source's outer <g> to position it within the scene. cloneNode
        // copies that attribute, so without stripping it the clone
        // would render at the source's original scene position
        // ADDED to the ghost's own translate — leaving the visual
        // feedback offset from the cursor by (srcX, srcY). We want the
        // clone's content to land at the ghost's local origin (0,0),
        // which the per-move SetDragGhostPosition then translates to
        // the cursor.
        clone.removeAttribute('transform');
        // The renderer paints each visual with an invisible `mural-hit`
        // rect carrying `pointer-events="all"` so hit-testing of normal
        // scene content works against the empty fill. That explicit
        // `all` overrides the inherited `pointer-events="none"` from
        // the drag-overlay — meaning elementsFromPoint would return the
        // ghost's CLONED hit rects FIRST and HitTest would not be able
        // to walk past them to the actual scene underneath. Strip the
        // attribute (and set explicit `none`) on every element in the
        // cloned subtree so the ghost is truly transparent to hit-test.
        suppressPointerEvents(clone);
        ghost.appendChild(clone);
        overlay.appendChild(ghost);
        this.dragGhost = ghost;
    }

    // Locate the outer <g> for a given Visual by walking the surface
    // looking for a node whose VISUAL_BACKREF matches.
    private findOuterGForVisual(target: Visual): SVGGElement | null
    {
        const stack: Node[] = [this.surface];
        while (stack.length > 0)
        {
            const node = stack.pop()!;
            const back = (node as unknown as BackrefHost)[VISUAL_BACKREF];
            if (back === target) return node as SVGGElement;
            for (const child of Array.from(node.childNodes)) stack.push(child);
        }
        return null;
    }

    // ── Pointer adapters ───────────────────────────────────────────

    // Classify this PointerDown as a double-click if:
    //   * same button as the previous press
    //   * within DOUBLE_CLICK_INTERVAL_MS of the previous press
    //   * within DOUBLE_CLICK_TOLERANCE_PX of the previous position
    // On a positive match the timestamp is cleared so a third press
    // doesn't ALSO match — only the immediate next press would qualify
    // for another double-click sequence (i.e. clicks 3-4 could pair).
    // On a negative match the new press's stats are recorded so it can
    // become the first half of the NEXT double-click.
    private classifyDoubleClick(e: PointerEvent, hostX: number, hostY: number): boolean
    {
        const now = e.timeStamp;
        const dt  = now - this.lastClickAt;
        const dx  = hostX - this.lastClickX;
        const dy  = hostY - this.lastClickY;
        const sameButton = e.button === this.lastClickButton;
        const inTime     = dt > 0 && dt <= DOUBLE_CLICK_INTERVAL_MS;
        const inDist     =
            Math.abs(dx) <= DOUBLE_CLICK_TOLERANCE_PX &&
            Math.abs(dy) <= DOUBLE_CLICK_TOLERANCE_PX;
        if (sameButton && inTime && inDist)
        {
            this.lastClickAt = 0;
            return true;
        }
        this.lastClickAt     = now;
        this.lastClickX      = hostX;
        this.lastClickY      = hostY;
        this.lastClickButton = e.button;
        return false;
    }

    private handlePointer(
        phase: PointerPhase,
        e: PointerEvent,
    ): void
    {
        const { hostX, hostY } = this.toHostCoords(e);
        // Double-click detection — only meaningful for the `down`
        // phase. We classify BEFORE building the init record so the
        // flag flows straight through.
        const isDoubleClick = phase === PointerPhase.Down && this.classifyDoubleClick(e, hostX, hostY);
        const init = pointerInit(e, hostX, hostY, isDoubleClick);
        if (phase === PointerPhase.Leave)
        {
            this.InputManager.InjectPointerLeave(init);
            return;
        }
        const hit = this.HitTest(hostX, hostY);
        if (phase === PointerPhase.Down)
        {
            // Transfer DOM focus to the host so subsequent keydown /
            // keyup events fire on it (and reach our host-level
            // listener through normal bubble). Clicking inside the SVG
            // surface doesn't auto-focus the host — SVG descendants
            // aren't focusable, so the browser leaves focus wherever
            // it was (usually document.body), and keydowns would never
            // reach this target without this explicit call. The
            // `preventScroll` option keeps the page from jumping in
            // case the host happens to be outside the viewport.
            (this.host as HTMLElement).focus({ preventScroll: true });
            if (hit !== undefined) this.InputManager.InjectPointerDown(hit, init);
            // After dispatch, the InputManager may have picked up a
            // newly-started drag session (PointerDown handler called
            // DoDragDrop). Sync the overlay if so.
            if (this.InputManager.IsDragActive && !this.isGhostAttached())
            {
                this.OnDragSessionStarted();
                this.SetDragGhostPosition(hostX, hostY);
            }
            return;
        }
        if (phase === PointerPhase.Up)
        {
            const wasActive = this.InputManager.IsDragActive;
            this.InputManager.InjectPointerUp(hit ?? null, init);
            if (wasActive && !this.InputManager.IsDragActive)
            {
                this.OnDragSessionEnded();
            }
            return;
        }
        // move
        const wasActive = this.InputManager.IsDragActive;
        this.InputManager.InjectPointerMove(hit ?? null, init);
        // The declarative IsDraggable latch starts the drag during
        // *move* (after the threshold trip), not during down. The down
        // path above only catches imperative DoDragDrop calls made
        // from a PointerDown handler. Without this second pickup, the
        // latch-driven case leaves dragOverlay undefined, originalCursor
        // unsaved (so OnDragSessionEnded can't restore the cursor at
        // session end), and no ghost is ever drawn.
        //
        // The `isGhostAttached()` check covers BOTH the surface-overlay
        // path (`dragOverlay`) AND the adorner-layer path (`_ghostAdorner`).
        // Without the adorner-side check, every subsequent move sample
        // re-fired OnDragSessionStarted, appending another ghost clone
        // — visible as a trail of translucent copies behind the cursor.
        if (this.InputManager.IsDragActive && !this.isGhostAttached())
        {
            this.OnDragSessionStarted();
        }
        if (this.InputManager.IsDragActive)
        {
            // Order: dispatch first so receivers can update Effect, THEN
            // reposition the ghost and pull the cursor.
            this.SetDragGhostPosition(hostX, hostY);
            this.UpdateCursorForEffect(this.InputManager.CurrentDragEffect);
        }
        else if (wasActive)
        {
            // InjectPointerMove cancelled the session mid-move (a
            // source-side OnContinueQuery returned false — Shift-to-
            // cancel is the canonical case; see §8.3). PointerUp would
            // normally fire OnDragSessionEnded for us, but the session
            // is gone before the user releases, so we have to tear the
            // overlay / ghost down here.
            this.OnDragSessionEnded();
        }
    }

    // Keyboard dispatch. KeyDown / KeyUp route to the InputManager's
    // focused Visual. For KeyDown, if the key is a printable character
    // that isn't part of a Ctrl/Meta chord, we also synthesise a
    // TextInput event right after — matches WPF's KeyDown → TextInput
    // ordering and means a TextBox can subscribe just to OnTextInput
    // for character insertion while leaving OnKeyDown for editing
    // commands (arrows, Backspace, Delete, …).
    //
    // preventDefault is called when the focused Visual handled the
    // event — that's how we suppress the browser's page-scroll on
    // Space / arrow keys, tab navigation when AcceptsTab is true, and
    // the like, without globally swallowing every key on a focused
    // mural surface.
    private handleKey(phase: KeyPhase, e: KeyboardEvent): void
    {
        const init: KeyEventInit = {
            Key:       keyFromDom(e.code, e.key),
            KeyText:   e.key,
            Code:      e.code,
            Modifiers: extractModifiers(e),
            IsRepeat:  e.repeat,
        };
        let handled = phase === KeyPhase.Down
            ? this.InputManager.InjectKeyDown(init)
            : this.InputManager.InjectKeyUp(init);

        if (phase === KeyPhase.Down && isPrintableKey(e))
        {
            // Synthesise the TextInput pass for normal typing. IME
            // composition would normally route through compositionend /
            // beforeinput on a contenteditable element; v1 mural surfaces
            // aren't contenteditable, so dead keys / IME composes degrade
            // to whatever `e.key` produces. That's good enough for ASCII
            // typing today; a follow-up can layer a hidden contenteditable
            // proxy for full IME support.
            const tiHandled = this.InputManager.InjectTextInput({ Text: e.key });
            handled = handled || tiHandled;
        }

        if (handled) e.preventDefault();
    }

    private handleWheel(e: WheelEvent): void
    {
        const { hostX, hostY } = this.toHostCoords(e);
        const hit = this.HitTest(hostX, hostY);
        if (hit === undefined) return;
        const init: WheelEventInit = {
            HostX:    hostX,
            HostY:    hostY,
            Button:   PointerButton.None,
            Buttons:  e.buttons,
            Modifiers: extractModifiers(e),
            PointerId: 0,
            Pressure:  0,
            PointerType: 'mouse',
            DeltaX:    e.deltaX,
            DeltaY:    e.deltaY,
            DeltaZ:    e.deltaZ,
            DeltaMode: wheelDeltaMode(e.deltaMode),
        };
        this.InputManager.InjectPointerWheel(hit, init);
    }

    // Convert client coordinates from a DOM event into the target's
    // content coordinate space (top-left of the host element = (0, 0)).
    // getBoundingClientRect reflects the host's current on-screen rect
    // INCLUDING any CSS transforms applied to ancestors, so this works
    // even when the surface is inside a scaled / translated container.
    private toHostCoords(e: { clientX: number; clientY: number }): { hostX: number; hostY: number }
    {
        const rect = this.host.getBoundingClientRect();
        return {
            hostX: e.clientX - rect.left,
            hostY: e.clientY - rect.top,
        };
    }

    // ── OS-level drag/drop handlers (8.1) ──────────────────────────────
    //
    // The browser's DragEvent model:
    //   * dragenter — drag crossed into a new element (host root counts;
    //                 child elements also fire it as the cursor moves
    //                 between siblings inside the host).
    //   * dragover  — continuous while held over an element. MUST call
    //                 preventDefault() to allow the eventual drop.
    //   * dragleave — drag left the element. Fires on every internal
    //                 element-to-element crossing too, so we can't
    //                 cancel the session here without distinguishing
    //                 "leaving the host root" from "moving between
    //                 children".
    //   * drop      — pointer released over the host. MUST call
    //                 preventDefault() to suppress the browser's
    //                 default (e.g., opening a dropped file in a new
    //                 tab).
    //
    // Source-side drags initiated by the framework (via DoDragDrop) use
    // PointerEvent flow, NOT DragEvent — so these handlers fire only
    // for drags that originate outside the host (file drops from the
    // OS, drag-and-drop from another browser window, etc.). In that
    // case `session.Source === undefined`.

    private handleOsDragEnter(e: DragEvent): void
    {
        // If a framework-initiated drag is already active, this
        // dragenter is from one of OUR descendant elements during a
        // pointer drag — ignore it. (Browsers don't actually fire
        // DragEvents during a Pointer Events drag we initiated, but
        // defence-in-depth.)
        if (this.InputManager.IsDragActive && !this.osDragSessionActive) return;

        e.preventDefault();

        if (!this.osDragSessionActive)
        {
            const data = osDataObjectFrom(e.dataTransfer);
            const allowed = osAllowedEffectsFrom(e.dataTransfer);
            const session = new DragSession(undefined, data, allowed);
            this.InputManager.BeginOsDragSession(session);
            this.osDragSessionActive = true;
        }

        // Drive the first move so the receiver chain's DragEnter fires.
        const { hostX, hostY } = this.toHostCoords(e);
        const hit = this.hitVisualAt(hostX, hostY);
        this.InputManager.DriveDragMove(hit ?? null, {
            HostX: hostX, HostY: hostY,
            Button:      PointerButton.Primary,
            Buttons:     1,
            Modifiers:   NoModifiers,
            PointerId:   0,
            Pressure:    0,
            PointerType: 'mouse',
        });
    }

    private handleOsDragOver(e: DragEvent): void
    {
        if (!this.osDragSessionActive) return;
        e.preventDefault();

        const { hostX, hostY } = this.toHostCoords(e);
        const hit = this.hitVisualAt(hostX, hostY);
        this.InputManager.DriveDragMove(hit ?? null, {
            HostX: hostX, HostY: hostY,
            Button:      PointerButton.Primary,
            Buttons:     1,
            Modifiers:   NoModifiers,
            PointerId:   0,
            Pressure:    0,
            PointerType: 'mouse',
        });
        // Mirror the receiver's chosen Effect back to the browser so
        // the OS cursor matches.
        if (e.dataTransfer !== null)
        {
            e.dataTransfer.dropEffect = osDropEffectFor(this.InputManager.CurrentDragEffect);
        }
    }

    private handleOsDragLeave(e: DragEvent): void
    {
        if (!this.osDragSessionActive) return;
        // Internal element-boundary crossings fire dragleave on the old
        // element followed by dragenter on the new one — but BOTH may
        // be inside the host root. Distinguish "leaving the host" by
        // checking whether the relatedTarget (the element being entered)
        // is still inside this.host. If relatedTarget is null OR
        // outside the host, the drag has actually left.
        const related = e.relatedTarget as Node | null;
        if (related !== null && this.host.contains(related)) return;

        this.osDragSessionActive = false;
        this.InputManager.CurrentDragSession?.Cancel();
        this.PollSessionCancellation();
    }

    private handleOsDrop(e: DragEvent): void
    {
        if (!this.osDragSessionActive) return;
        e.preventDefault();
        this.osDragSessionActive = false;

        // Refresh the session's DataObject from the now-populated
        // dataTransfer. Browsers withhold file contents (`dt.files`
        // is empty) during dragenter/dragover for security — the
        // session's DataObject built at dragenter time only carried
        // the `'Files'` marker with an empty-string placeholder. At
        // drop time the FileList is real, and receivers reading
        // `args.Data.Get('Files')` expect the live list.
        const session = this.InputManager.CurrentDragSession;
        if (session !== null && e.dataTransfer !== null)
        {
            refreshOsDataObject(session.Data, e.dataTransfer);
        }

        const { hostX, hostY } = this.toHostCoords(e);
        const hit = this.hitVisualAt(hostX, hostY);
        this.InputManager.DriveDragUp(hit ?? null, {
            HostX: hostX, HostY: hostY,
            Button:      PointerButton.Primary,
            Buttons:     1,
            Modifiers:   NoModifiers,
            PointerId:   0,
            Pressure:    0,
            PointerType: 'mouse',
        });
    }

    // Hit-test at host coordinates. Mirror of the path used by
    // PointerEvent handlers above — both end up calling the same
    // PresentationTarget.HitTest. Extracted as a helper so the OS
    // drag handlers don't duplicate the rect-to-hit translation.
    private hitVisualAt(hostX: number, hostY: number): MuralElement | undefined
    {
        // Delegate to the inherited PresentationTarget.HitTest (overridden
        // above in this class), which walks the elementsFromPoint stack
        // looking for VISUAL_BACKREF stamps on each element's parent
        // chain. The previous implementation tried to read a
        // `__mural_visual__` property directly on the element — that
        // property is never set anywhere (the renderer uses the
        // VISUAL_BACKREF Symbol), so the function silently returned
        // undefined for every call, breaking OS drag hit-testing.
        return this.HitTest(hostX, hostY);
    }

    // The host element passed to the constructor. Read-only access for
    // debugging and for event-routing code that needs to attach
    // listeners at the host root rather than the surface.
    public get Host(): Element { return this.host; }

    // Exposed for the renderer (when it lands) to walk the live mount
    // without going through getElementsByTagName or similar.
    public get Surface(): SVGSVGElement { return this.surface; }

    // Convenience for setting Content via constructor-style call,
    // matching the ergonomic example in the design doc:
    //   new HtmlTarget(host).Show(rootVisual);
    public Show(content: Visual): this
    {
        this.Content = content;
        return this;
    }
}

// ── OS-drag helpers (8.1) ─────────────────────────────────────────────

// Translate a browser DataTransfer into a framework DataObject.
// Browser MIME format keys carry over verbatim (`text/plain`,
// `text/uri-list`, …). The synthetic `Files` key carries
// `FileList` when one or more files are part of the drag — receivers
// that want files iterate this list.
function osDataObjectFrom(dt: DataTransfer | null): DataObject
{
    const out = new DataObject();
    if (dt === null) return out;
    // `dt.types` is a DOMStringList in older browsers (Safari + older
    // Chromium) and a frozen Array in newer ones. DOMStringList is
    // index-accessible and has .length but isn't reliably iterable —
    // `for (const x of dt.types)` silently iterates nothing in those
    // cases. Walk by index so both shapes work, then explicitly check
    // the well-known `Files` marker which the spec guarantees is in
    // `types` whenever files are part of the drag (dt.files is empty
    // until drop for security, so this is the only signal we can read
    // during dragenter / dragover).
    const typesLen = dt.types?.length ?? 0;
    let sawFiles = false;
    for (let i = 0; i < typesLen; i++)
    {
        const type = dt.types[i] ?? '';
        if (type === 'Files') sawFiles = true;
        // getData throws during dragenter / dragover for some types
        // (browsers gate it for security). Wrap defensively — the
        // type is still discoverable via `out.Has(format)` even when
        // the value isn't readable until drop.
        try { out.Set(type, dt.getData(type)); }
        catch { out.Set(type, ''); }
    }
    // Belt-and-braces: even if `types` iteration somehow missed the
    // marker, fall back to dt.files (populated on drop) so receivers
    // that key off Has('Files') still match.
    if (!sawFiles && dt.files !== null && dt.files.length > 0)
    {
        out.Set('Files', dt.files);
    }
    else if (sawFiles)
    {
        // Replace the empty-string placeholder set by the loop above
        // with the actual FileList when it's populated (only on drop).
        if (dt.files !== null && dt.files.length > 0)
        {
            out.Set('Files', dt.files);
        }
    }
    return out;
}

// Drop-time refresh of the session's DataObject. At dragenter the
// browser populates `dt.types` (including the `'Files'` marker) but
// withholds file contents and the bytes of MIME-typed strings for
// security; `getData(type)` either throws or returns empty. At drop
// time those become readable. Re-walk `dt.types` and re-set each
// format; then overwrite `'Files'` with the now-populated FileList.
// Mutates `out` in place because the session's `Data` field is
// readonly (consumers hold the same DataObject reference across the
// drag).
function refreshOsDataObject(out: DataObject, dt: DataTransfer): void
{
    const typesLen = dt.types?.length ?? 0;
    for (let i = 0; i < typesLen; i++)
    {
        const type = dt.types[i] ?? '';
        try { out.Set(type, dt.getData(type)); }
        catch { /* keep the dragenter-time placeholder */ }
    }
    if (dt.files !== null && dt.files.length > 0)
    {
        out.Set('Files', dt.files);
    }
}

// Best-effort translation of `DataTransfer.effectAllowed` to the
// framework's `DragDropEffects` flag set. The browser's `'all'` /
// `'uninitialized'` map to All; specific allow-modes map to the
// matching subset; `'none'` maps to None so receivers reject.
function osAllowedEffectsFrom(dt: DataTransfer | null): DragDropEffects
{
    if (dt === null) return DragDropEffects.All;
    switch (dt.effectAllowed)
    {
        case 'none':           return DragDropEffects.None;
        case 'copy':           return DragDropEffects.Copy;
        case 'move':           return DragDropEffects.Move;
        case 'link':           return DragDropEffects.Link;
        case 'copyLink':       return DragDropEffects.Copy | DragDropEffects.Link;
        case 'copyMove':       return DragDropEffects.Copy | DragDropEffects.Move;
        case 'linkMove':       return DragDropEffects.Link | DragDropEffects.Move;
        case 'all':            return DragDropEffects.All;
        case 'uninitialized':  return DragDropEffects.All;
        default:               return DragDropEffects.All;
    }
}

// Mirror the receiver's chosen `Effect` back to the browser's
// `dataTransfer.dropEffect` so the OS cursor matches.
function osDropEffectFor(effect: DragDropEffects): 'none' | 'copy' | 'move' | 'link'
{
    if (effect & DragDropEffects.Copy) return 'copy';
    if (effect & DragDropEffects.Move) return 'move';
    if (effect & DragDropEffects.Link) return 'link';
    return 'none';
}
