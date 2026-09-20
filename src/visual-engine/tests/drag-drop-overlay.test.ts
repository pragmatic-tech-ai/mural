import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
    Application,
    DataObject,
    DragDrop,
    DragDropEffects,
    Size,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { Border, TextBlock } from '../../basic/index.js';
import { HtmlTarget } from '../index.js';
import { SolidColorBrush } from '../index.js';
import { Color } from '../../runtime/index.js';

// Install JSDOM globals needed by HtmlTarget. The target reads
// `window.devicePixelRatio`, calls `document.createElementNS`, and
// constructs a ResizeObserver. JSDOM doesn't ship ResizeObserver, so
// we stub it.
function makeDom(): { dom: JSDOM; host: HTMLElement; document: Document }
{
    const dom = new JSDOM(
        '<!doctype html><html><body><div id="host" style="width:400px;height:300px"></div></body></html>',
        { pretendToBeVisual: true },
    );
    const win = dom.window as unknown as Window & typeof globalThis;
    (globalThis as unknown as { window: Window }).window     = win;
    (globalThis as unknown as { document: Document }).document = win.document;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class
    {
        observe():    void {}
        disconnect(): void {}
        unobserve():  void {}
    };
    // Stub clientWidth/Height so the HtmlTarget constructor can size
    // the surface — JSDOM returns 0 because it has no layout engine.
    const host = win.document.getElementById('host') as HTMLElement;
    Object.defineProperty(host, 'clientWidth',  { value: 400, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 300, configurable: true });
    return { dom, host, document: win.document };
}

// Concrete leaf Visual that paints a small filled rect. Used as the
// drag source — gives the renderer something to stamp with
// VISUAL_BACKREF so the ghost-clone path has a real outer <g> to
// snapshot. Sized 20x20 so it shows up at any layout pass.
class TestSquare extends Element
{
    protected override MeasureOverride(_a: Size): Size { return new Size(20, 20); }
    protected override RenderOverride(dc: DrawingContext): void
    {
        dc.DrawRectangle(
            new SolidColorBrush(Color.Red),
            undefined,
            { X: 0, Y: 0, Width: 20, Height: 20 } as never,
        );
    }
}

function resetPendingDrag(): void
{
    DragDrop._pendingSession = null;
    DragDrop._pendingOptions = {};
}

describe('HtmlTarget — drag ghost overlay (mode A)', () => {
    beforeEach(() => {
        Application.current = null;
        resetPendingDrag();
    });

    test('starting a session with preview=undefined appends a clone to the drag overlay', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        // Need a painted Visual so the renderer stamps VISUAL_BACKREF
        // on its outer <g> for the ghost-clone to snapshot.
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        DragDrop.DoDragDrop(source, new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
            DragDropEffects.Copy);          // opts.preview undefined → mode A
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        const overlay = doc.querySelector('g.mural-drag-overlay');
        assert.ok(overlay !== null, 'overlay <g> should be present');
        const ghost = overlay!.querySelector('g.mural-drag-ghost');
        assert.ok(ghost !== null, 'ghost should be appended to overlay');
        assert.equal(ghost!.getAttribute('opacity'), '0.6');
    });

    test('overlay has pointer-events=none so it does not block receiver hit-testing', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        const overlay = doc.querySelector('g.mural-drag-overlay')!;
        assert.equal(overlay.getAttribute('pointer-events'), 'none');
    });

    test('SetDragGhostPosition translates the ghost', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        target.SetDragGhostPosition(120, 80);

        const ghost = doc.querySelector('g.mural-drag-ghost') as SVGGElement;
        assert.match(ghost.getAttribute('transform') ?? '', /translate\(120,?\s*80\)/);
    });

    test('ending the session removes the ghost from the DOM', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        assert.ok(doc.querySelector('g.mural-drag-ghost'));

        target.OnDragSessionEnded();
        assert.equal(doc.querySelector('g.mural-drag-ghost'), null);
        assert.equal(doc.querySelector('g.mural-drag-overlay'), null);
    });

    test('mode B (preview=null) creates an overlay shell but no ghost', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy,
            { preview: null });
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        assert.ok(doc.querySelector('g.mural-drag-overlay'),  'overlay shell exists');
        assert.equal(doc.querySelector('g.mural-drag-ghost'), null, 'no ghost in mode B');
    });
});

describe('HtmlTarget — drag preview mode C (DataTemplate)', () => {
    beforeEach(() => {
        Application.current = null;
        resetPendingDrag();
    });

    test('opts.preview = DataTemplate instantiates the template and adds the produced Visual to the overlay', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        // Minimal duck-typed preview matching the spec — Apply(data)
        // returns a Visual. We use TestSquare so the renderer paints a
        // <rect>; the test checks the rect makes it into the overlay
        // subtree.
        const template = { Apply: (_data: unknown): Visual => new TestSquare() };
        const data = new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect');

        DragDrop.DoDragDrop(source, data, DragDropEffects.Copy, { preview: template });
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        const overlay = doc.querySelector('g.mural-drag-overlay');
        assert.ok(overlay !== null);
        const ghost = overlay!.querySelector('g.mural-drag-ghost');
        assert.ok(ghost !== null, 'mode C ghost wraps the preview Visual');
        const rectInOverlay = overlay!.querySelector('rect');
        assert.ok(rectInOverlay !== null, 'rendered preview content is in the overlay');
    });

    test('ending a mode-C session detaches the preview Visual from the OverlayLayer', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        const template = { Apply: (_data: unknown): Visual => new TestSquare() };
        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy,
            { preview: template });
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        assert.ok(doc.querySelector('g.mural-drag-ghost'));

        target.OnDragSessionEnded();
        assert.equal(doc.querySelector('g.mural-drag-overlay'), null);
        assert.equal(target.OverlayRoot?.visualChildren.length ?? 0, 0,
            'preview Visual detached from OverlayLayer');
    });
});

describe('HtmlTarget — cursor styling', () => {
    beforeEach(() => {
        Application.current = null;
        resetPendingDrag();
    });

    // The HtmlTarget deliberately does NOT mutate the host's cursor
    // during a drag — the browser-native 4-direction-arrow / not-allowed
    // / copy-plus cursors were visually loud and read as desktop chrome
    // rather than in-app drag affordance. Effect feedback is the
    // adorner / ghost's job. These tests pin that contract so a future
    // edit to OnDragSessionStarted / UpdateCursorForEffect can't
    // silently re-introduce the cursor flip.

    test('OnDragSessionStarted leaves the host cursor untouched', () => {
        const { host } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();
        (host as HTMLElement).style.cursor = 'default';

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.All);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        assert.equal((host as HTMLElement).style.cursor, 'default');
    });

    test('UpdateCursorForEffect is a no-op regardless of effect', () => {
        const { host } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();
        (host as HTMLElement).style.cursor = 'default';

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.All);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        for (const eff of [
            DragDropEffects.Copy, DragDropEffects.Move, DragDropEffects.Link,
            DragDropEffects.None, DragDropEffects.Copy | DragDropEffects.Move,
        ])
        {
            target.UpdateCursorForEffect(eff);
            assert.equal((host as HTMLElement).style.cursor, 'default');
        }
    });

    test('OnDragSessionEnded leaves the host cursor untouched (nothing to restore)', () => {
        const { host } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();
        (host as HTMLElement).style.cursor = 'default';

        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        target.UpdateCursorForEffect(DragDropEffects.Copy);
        assert.equal((host as HTMLElement).style.cursor, 'default');

        target.OnDragSessionEnded();
        assert.equal((host as HTMLElement).style.cursor, 'default');
    });
});

describe('HtmlTarget — drag cancellation', () => {
    beforeEach(() => {
        Application.current = null;
        resetPendingDrag();
    });

    test('ESC keydown during drag resolves session with None', async () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        const session = DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        // Synthesize an ESC keydown on the host. The host listener
        // matches e.key === 'Escape' and calls Cancel + poll.
        const win = doc.defaultView!;
        host.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
        assert.equal(target.InputManager.IsDragActive, false);
        assert.equal(doc.querySelector('g.mural-drag-overlay'), null);
    });

    test('blur on the host during drag cancels the session', async () => {
        const { host } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        const session = DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();

        host.dispatchEvent(new (host.ownerDocument!.defaultView as Window).FocusEvent('blur',
            { bubbles: false }));

        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
        assert.equal(target.InputManager.IsDragActive, false);
    });

    test('session.Cancel() from author code is observed via PollSessionCancellation', async () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        const source = new TestSquare();
        root.SetChild(source);
        target.Flush();

        const session = DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        target.InputManager.PickUpPendingDragSession();
        target.OnDragSessionStarted();
        assert.ok(doc.querySelector('g.mural-drag-overlay'));

        session.Cancel();
        target.PollSessionCancellation();

        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
        assert.equal(target.InputManager.IsDragActive, false);
        assert.equal(doc.querySelector('g.mural-drag-overlay'), null);
    });

    test('ESC outside a drag session is a no-op', () => {
        const { host, document: doc } = makeDom();
        const target = new HtmlTarget(host);
        const root = new Border();
        target.Content = root;
        target.Flush();

        // No drag — ESC must not crash or affect state.
        const win = doc.defaultView!;
        host.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(target.InputManager.IsDragActive, false);
    });
});
