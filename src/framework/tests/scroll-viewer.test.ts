import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import {
    Color,
    DataObject,
    DragDropEffects,
    DragEventArgs,
    DragSession,
    NoModifiers,
    PropertyTransition,
    Rect,
    Size,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { RectangleGeometry, SolidColorBrush, ScaleTransform } from '../../visual-engine/index.js';
import { DataTemplate, VirtualizingStackPanel } from '../../basic/index.js';
import { ItemsControl, ScrollViewer } from '@pragmatic-tech-ai/mural/framework';

// Fixed-size leaf that paints a colored rect — useful as ScrollViewer
// content for measuring extent.
class FixedRect extends Element
{
    constructor(private box: Size, private color: Color = Color.Red) { super(); }
    protected override MeasureOverride(_a: Size): Size { return this.box; }
    protected override RenderOverride(dc: DrawingContext): void
    {
        dc.DrawRectangle(new SolidColorBrush(this.color), undefined, new Rect(0, 0, this.box.Width, this.box.Height));
    }
}

describe('ScrollViewer — clip-and-translate mode (plain content)', () => {
    beforeEach(() => { initTestApp(); });

    test('without Content, ExtentWidth/Height are zero', () => {
        const sv = new ScrollViewer();
        sv.Measure(new Size(100, 100));
        assert.equal(sv.ExtentWidth, 0);
        assert.equal(sv.ExtentHeight, 0);
        assert.equal(sv.ViewportWidth, 100);
        assert.equal(sv.ViewportHeight, 100);
    });

    test('Content extent comes from the child\'s natural DesiredSize (measured with Infinity)', () => {
        const sv = new ScrollViewer();
        sv.Content = new FixedRect(new Size(500, 800));
        sv.Measure(new Size(100, 200));
        assert.equal(sv.ExtentWidth, 500);
        assert.equal(sv.ExtentHeight, 800);
        assert.equal(sv.ViewportWidth, 100);
        assert.equal(sv.ViewportHeight, 200);
        assert.equal(sv.ScrollableWidth, 400);
        assert.equal(sv.ScrollableHeight, 600);
    });

    test('a LayoutTransform-scaled child grows the extent (scrollbars follow zoom)', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(500, 800));
        content.LayoutTransform = new ScaleTransform(2, 2);
        sv.Content = content;
        sv.Measure(new Size(100, 200));
        assert.equal(sv.ExtentWidth, 1000);
        assert.equal(sv.ExtentHeight, 1600);
    });

    test('Content is arranged at (-offset.X, -offset.Y) with full extent size', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(500, 800));
        sv.Content = content;
        sv.HorizontalOffset = 50;
        sv.VerticalOffset   = 100;
        sv.Measure(new Size(100, 200));
        sv.Arrange(new Rect(0, 0, 100, 200));
        assert.equal(content.ArrangedRect.X,      -50);
        assert.equal(content.ArrangedRect.Y,      -100);
        assert.equal(content.ArrangedRect.Width,   500);
        assert.equal(content.ArrangedRect.Height,  800);
    });

    test('Clip is set on the Content visual (in its own local space) rather than the ScrollViewer outer', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(500, 500));
        sv.Content = content;
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));
        // ScrollViewer's outer is unclipped so the scrollbar children
        // (which sit beyond the viewport on the cross axis) remain
        // visible.
        assert.equal(sv.Clip, undefined);
        // Content's clip is sized to the inner viewport (100 - 10 DIP
        // gutter on each axis = 90×90) and positioned at (offset.X,
        // offset.Y) because the content's outer carries a -(offset)
        // translate, leaving (offset, offset) as the local origin of
        // the visible window.
        const clip = content.Clip as RectangleGeometry;
        assert.ok(clip instanceof RectangleGeometry);
        assert.equal(clip.Rect.X,      0);
        assert.equal(clip.Rect.Y,      0);
        assert.equal(clip.Rect.Width,  90);
        assert.equal(clip.Rect.Height, 90);
    });

    test('out-of-range offsets clamp to ScrollableWidth/Height at Arrange time (raw value preserved)', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(200, 200));
        sv.Content = content;
        sv.VerticalOffset = 9999;     // way past scrollable
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));
        // Both axes overflow → both bars eat a 10 DIP gutter. Viewport
        // is 90×90; ScrollableHeight = 200 - 90 = 110; effective offset
        // clamps at 110 and the content shifts up by that much.
        assert.equal(content.ArrangedRect.Y, -110);
        // Raw user-set value preserved on the property.
        assert.equal(sv.VerticalOffset, 9999);
    });

    test('negative offsets clamp to 0', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(500, 500));
        sv.Content = content;
        sv.HorizontalOffset = -50;
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));
        assert.equal(content.ArrangedRect.X, 0);
    });

    test('ScrollToTop / ScrollToBottom / ScrollToLeft / ScrollToRight', () => {
        const sv = new ScrollViewer();
        sv.Content = new FixedRect(new Size(400, 300));
        sv.Measure(new Size(100, 100));
        sv.ScrollToRight();
        assert.equal(sv.HorizontalOffset, 300);  // ScrollableWidth
        sv.ScrollToBottom();
        assert.equal(sv.VerticalOffset, 200);    // ScrollableHeight
        sv.ScrollToLeft();
        assert.equal(sv.HorizontalOffset, 0);
        sv.ScrollToTop();
        assert.equal(sv.VerticalOffset, 0);
    });

    test('Content is a logical child of the ScrollViewer; visually it lands in the SCP slot', () => {
        const sv = new ScrollViewer();
        const content = new FixedRect(new Size(100, 100));
        sv.Content = content;
        // ScrollViewer is now ContentControl-derived — visualChildren is
        // the template root (ScrollViewerLayout); the consumer Content
        // lives visually inside the ScrollContentPresenter slot, which
        // is reachable via the ContentPresenter accessor. logicalChildren
        // still tracks Content directly because the template only owns
        // the visual tree.
        assert.equal(sv.logicalChildren.length, 1);
        assert.equal(sv.logicalChildren[0], content);
        assert.ok(sv.ContentPresenter !== undefined);
        assert.equal(sv.ContentPresenter!.visualChildren[0], content);
    });

    test('replacing Content detaches the previous instance and attaches the new one', () => {
        const sv = new ScrollViewer();
        const a = new FixedRect(new Size(100, 100));
        const b = new FixedRect(new Size(200, 200));
        sv.Content = a;
        sv.Content = b;
        // The SCP's visual slot now holds `b` — the consumer-facing
        // contract is "Content goes through the presenter," not "Content
        // is sv.visualChildren[0]" (which is the template root now).
        assert.equal(sv.ContentPresenter!.visualChildren[0], b);
        // Detached `a` has no visual parent now.
        const aParent = (a as unknown as { visualParent: Visual | undefined }).visualParent;
        assert.equal(aParent, undefined);
    });

    test('ScrollIntoView pans the offset so a rect smaller than the viewport becomes visible', () => {
        const sv = new ScrollViewer();
        sv.Content = new FixedRect(new Size(500, 500));
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));

        // Rect off the right edge of the viewport.
        sv.ScrollIntoView(new Rect(200, 0, 10, 10));
        assert.ok(sv.HorizontalOffset > 0, 'right-edge rect should pan horizontally');

        // Rect off the bottom edge.
        sv.ScrollIntoView(new Rect(0, 300, 10, 10));
        assert.ok(sv.VerticalOffset > 0, 'bottom-edge rect should pan vertically');
    });

    test('ScrollIntoView does NOT oscillate when the rect is taller than the viewport', () => {
        // Tight viewport (10 DIP tall) wrapping a content that's
        // slightly taller (16 DIP), mirroring the SpinEdit case where
        // the caret rect (one line height) overflows the inner
        // TextBox's reduced content area. Without the rect-fits guard,
        // the "show top" and "show bottom" branches alternate fire on
        // every call, snapping the offset between 0 and the scrollable
        // max.
        const sv = new ScrollViewer();
        sv.Content = new FixedRect(new Size(100, 16));
        sv.Measure(new Size(100, 10));
        sv.Arrange(new Rect(0, 0, 100, 10));

        const tall = new Rect(0, 0, 5, 16);   // taller than viewport
        sv.VerticalOffset = 0;
        sv.ScrollIntoView(tall);
        assert.equal(sv.VerticalOffset, 0,
            'first ScrollIntoView should not push the offset down');
        sv.ScrollIntoView(tall);
        assert.equal(sv.VerticalOffset, 0,
            'repeat ScrollIntoView should remain stable');
    });
});

// Sets up a free-standing ItemsControl (no parent) plus a
// VirtualizingStackPanel that uses it as its items owner — without
// going through ic.ItemsPanel (which would visually parent the panel
// to ic). Lets us put the panel directly as ScrollViewer's Content.
function makeStandalonePanel(items: readonly unknown[], itemHeight = 20): VirtualizingStackPanel
{
    const ic = new ItemsControl();
    ic.ItemTemplate = new DataTemplate(_ => new FixedRect(new Size(10, itemHeight)));
    ic.Items        = items;
    const panel = new VirtualizingStackPanel();
    panel.ItemHeight = itemHeight;
    panel.SetItemsOwner(ic);
    return panel;
}

describe('ScrollViewer — delegate mode (IScrollInfo content, e.g., VirtualizingStackPanel)', () => {
    beforeEach(() => { initTestApp(); });

    test('drives the panel\'s Viewport (position + size) and reads Extent back', () => {
        const sv    = new ScrollViewer();
        const panel = makeStandalonePanel(Array.from({ length: 100 }, (_, i) => i), 20);
        sv.Content = panel;

        sv.VerticalOffset = 60;
        sv.Measure(new Size(200, 80));

        // Panel's viewport is now (0, 60, 200, 80). ExtentHeight =
        // 100 items × 20 = 2000.
        assert.equal(sv.ExtentHeight, 2000);
        assert.equal(sv.ViewportHeight, 80);
        assert.equal(sv.ScrollableHeight, 1920);
        assert.equal(panel.HorizontalOffset, 0);
        assert.equal(panel.VerticalOffset, 60);
        assert.equal(panel.ViewportWidth, 200);
        assert.equal(panel.ViewportHeight, 80);

        // Only items intersecting [60, 140) are realized: items 3, 4, 5, 6.
        assert.deepEqual(panel.RealizedIndices, [3, 4, 5, 6]);
    });

    test('updating ScrollViewer.VerticalOffset re-realizes the panel\'s items', () => {
        const sv    = new ScrollViewer();
        const panel = makeStandalonePanel(Array.from({ length: 100 }, (_, i) => i), 20);
        sv.Content = panel;
        sv.Measure(new Size(200, 80));
        assert.deepEqual(panel.RealizedIndices, [0, 1, 2, 3]);

        sv.VerticalOffset = 500;
        sv.Measure(new Size(200, 80));
        // Viewport now at y=500, range [500, 580). Items 25..28
        // intersect; item 29 starts at y=580 exactly (the viewport's
        // exclusive top boundary), so it's not realized.
        assert.deepEqual(panel.RealizedIndices, [25, 26, 27, 28]);
    });

    test('no Clip is installed in delegate mode (panel handles its own clipping)', () => {
        const sv    = new ScrollViewer();
        const panel = makeStandalonePanel([1, 2, 3], 20);
        sv.Content = panel;
        sv.Measure(new Size(100, 50));
        sv.Arrange(new Rect(0, 0, 100, 50));
        assert.equal(sv.Clip, undefined);
    });
});

// Pins backlog 8.4: auto-scroll while a drag is hovering near the
// viewport edges. The behavior installs an OnMove subscription on the
// active session; the move callback nudges HorizontalOffset /
// VerticalOffset toward the cursor's edge while the cursor stays in
// the gutter.
describe('ScrollViewer — auto-scroll near edges during drag (8.4)', () => {
    beforeEach(() => { initTestApp(); });

    function setupForAutoScroll(): { sv: ScrollViewer; session: DragSession }
    {
        const sv = new ScrollViewer();
        // Keep the vertical viewport a clean 100px tall: disable the
        // horizontal axis so no bottom gutter is reserved. (Every bar now
        // reserves its lane regardless of IsAutoHideScrollBars — the vertical
        // bar takes 10px of WIDTH, which these y-axis edge tests ignore.)
        sv.HorizontalScrollEnabled = false;
        // Inflate content so the viewport has scrollable extent.
        sv.Content = new (class extends Element
        {
            protected override MeasureOverride(_a: Size): Size { return new Size(500, 500); }
        })();
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));
        // Step large enough to see motion in one tick.
        sv.AutoScrollStep = 10;

        const session = new DragSession(undefined, new DataObject(), DragDropEffects.Copy);
        return { sv, session };
    }

    function fireEnter(sv: ScrollViewer, session: DragSession): void
    {
        const args = new DragEventArgs('DragEnter', sv, {
            HostX: 50, HostY: 50,
            Modifiers: NoModifiers,
            Data: session.Data,
            AllowedEffects: session.AllowedEffects,
            Session: session,
        });
        // Drive the preview virtual directly (mirrors what
        // applyReceiverChange + dispatchDrag do).
        (sv as unknown as { OnPreviewDragEnter(args: DragEventArgs): void }).OnPreviewDragEnter(args);
    }

    test('AutoScrollGutter defaults to 24; AutoScrollStep to 4', () => {
        const sv = new ScrollViewer();
        assert.equal(sv.AutoScrollGutter, 24);
        assert.equal(sv.AutoScrollStep, 4);
    });

    test('A drag enter wires a session.OnMove subscription that nudges VerticalOffset when near the bottom edge', async () => {
        const { sv, session } = setupForAutoScroll();
        fireEnter(sv, session);

        assert.equal(sv.VerticalOffset, 0);
        // Sample a move near the BOTTOM edge — within the 24px gutter
        // (viewport is 100×100 so y > 76 is in the gutter).
        session._fireMove(50, 95);
        // First tick fires synchronously inside _startAutoScrollTick.
        assert.equal(sv.VerticalOffset, 10);
        session.Cancel();  // tear down setInterval so the test runner exits
        await Promise.resolve();
    });

    test('A move in the middle stops the auto-scroll tick', async () => {
        const { sv, session } = setupForAutoScroll();
        fireEnter(sv, session);

        session._fireMove(50, 95);
        assert.equal(sv.VerticalOffset, 10);

        // Move back to the middle — tick must stop; subsequent move samples
        // don't change the offset.
        session._fireMove(50, 50);
        const before = sv.VerticalOffset;
        session._fireMove(50, 50);
        assert.equal(sv.VerticalOffset, before);
        session.Cancel();
        await Promise.resolve();
    });

    test('Cursor outside the viewport stops the tick', async () => {
        const { sv, session } = setupForAutoScroll();
        fireEnter(sv, session);
        session._fireMove(50, 95);
        const before = sv.VerticalOffset;

        // Cursor moves above the viewport (negative y in local) — stop.
        session._fireMove(50, -10);
        const after = sv.VerticalOffset;
        assert.equal(after, before);
        session.Cancel();
        await Promise.resolve();
    });

    test('AutoScrollGutter = 0 disables the feature', async () => {
        const { sv, session } = setupForAutoScroll();
        sv.AutoScrollGutter = 0;
        fireEnter(sv, session);
        session._fireMove(50, 95);
        assert.equal(sv.VerticalOffset, 0, 'no scroll when gutter is 0');
        session.Cancel();
        await Promise.resolve();
    });

    test('Session completion tears down the auto-scroll wiring', async () => {
        const { sv, session } = setupForAutoScroll();
        fireEnter(sv, session);
        session._fireMove(50, 95);
        assert.ok(sv.VerticalOffset > 0);

        session.Cancel();
        // Wait one microtask for the .then() callback to fire.
        await Promise.resolve();
        const after = sv.VerticalOffset;

        // Post-cancel moves should not nudge — the OnMove subscriber
        // was cleared on session complete.
        session._fireMove(50, 95);
        assert.equal(sv.VerticalOffset, after);
    });
});

// § 10.5 — Smooth scrolling: PropertyTransition installed on offset DPs.
describe('ScrollViewer — § 10.5 smooth scrolling', () => {

    beforeEach(() => { initTestApp(); });

    test('SmoothScroll defaults to false; no PropertyTransitions installed', () => {
        const sv = new ScrollViewer();
        assert.equal(sv.SmoothScroll, false);
        const tx = sv.Transitions;
        const managed = (tx?.toArray?.() ?? []).filter(
            (t: unknown) => (t as { _smoothScrollManaged?: boolean })._smoothScrollManaged === true,
        );
        assert.equal(managed.length, 0);
    });

    test('SmoothScroll=true installs two managed PropertyTransitions (H + V offsets)', () => {
        const sv = new ScrollViewer();
        sv.SmoothScroll = true;
        const list = sv.Transitions!;
        const managed: unknown[] = [];
        for (let i = 0; i < list.Count; i++)
        {
            const t = list.Get(i);
            if (t !== undefined && (t as { _smoothScrollManaged?: boolean })._smoothScrollManaged === true)
            {
                managed.push(t);
            }
        }
        assert.equal(managed.length, 2,
            'expected one transition for HorizontalOffset, one for VerticalOffset');
        const props = managed.map(t => (t as { Property: string }).Property).sort();
        assert.deepEqual(props, ['HorizontalOffset', 'VerticalOffset']);
    });

    test('SmoothScroll=true → false removes the managed transitions', () => {
        const sv = new ScrollViewer();
        sv.SmoothScroll = true;
        sv.SmoothScroll = false;
        const list = sv.Transitions;
        const managed: unknown[] = [];
        for (let i = 0; i < (list?.Count ?? 0); i++)
        {
            const t = list!.Get(i);
            if (t !== undefined && (t as { _smoothScrollManaged?: boolean })._smoothScrollManaged === true)
            {
                managed.push(t);
            }
        }
        assert.equal(managed.length, 0);
    });

    test('Duration / Easing changes propagate to the installed transitions', () => {
        const sv = new ScrollViewer();
        sv.SmoothScroll         = true;
        sv.SmoothScrollDuration = 500;
        const list = sv.Transitions!;
        for (let i = 0; i < list.Count; i++)
        {
            const t = list.Get(i);
            if (t !== undefined && (t as { _smoothScrollManaged?: boolean })._smoothScrollManaged === true)
            {
                assert.equal((t as { Duration: number }).Duration, 500);
            }
        }
    });

    test('consumer-added transitions are preserved across SmoothScroll toggle', () => {
        const sv = new ScrollViewer();
        const userT = new PropertyTransition();
        userT.Property = 'Opacity';
        sv.EnsureTransitions().Add(userT);

        sv.SmoothScroll = true;
        sv.SmoothScroll = false;

        let foundOpacity = false;
        const list = sv.Transitions!;
        for (let i = 0; i < list.Count; i++)
        {
            const t = list.Get(i);
            if ((t as { Property: string } | undefined)?.Property === 'Opacity') foundOpacity = true;
        }
        assert.equal(foundOpacity, true,
            'consumer-added Opacity transition should survive SmoothScroll on/off');
    });
});

// § 10.7 — Marquee autoscroll: ScrollViewer.EvaluateEdgeAutoScroll
// exposes the same gutter math the drag-drop path uses, so the marquee
// behavior can drive autoscroll without faking a DragSession.
describe('ScrollViewer — § 10.7 EvaluateEdgeAutoScroll public API', () => {

    beforeEach(() => { initTestApp(); });

    test('cursor inside the gutter near the bottom edge starts scrolling down', () => {
        const sv = new ScrollViewer();
        sv.AutoScrollGutter = 24;
        sv.AutoScrollStep   = 4;
        const content = new FixedRect(new Size(100, 1000));
        sv.Content = content;
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));

        const before = sv.VerticalOffset;
        // Bottom-gutter zone: viewport-local Y ∈ [vh - gutter, vh].
        // hostY translates 1:1 since ScrollViewer is at host origin (0, 0).
        sv.EvaluateEdgeAutoScroll(50, 95);
        // First tick fires immediately — so VerticalOffset should
        // advance by AutoScrollStep before any setInterval delay.
        assert.ok(sv.VerticalOffset > before,
            `expected VerticalOffset to advance from ${before}; got ${sv.VerticalOffset}`);
        sv.StopEdgeAutoScroll();
    });

    test('cursor outside the viewport stops scrolling', () => {
        const sv = new ScrollViewer();
        sv.AutoScrollGutter = 24;
        const content = new FixedRect(new Size(100, 1000));
        sv.Content = content;
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));

        sv.EvaluateEdgeAutoScroll(50, 95);  // start
        const after_first = sv.VerticalOffset;
        sv.EvaluateEdgeAutoScroll(50, 250); // far outside
        sv.StopEdgeAutoScroll();
        // Make a third call from outside — should be a no-op.
        sv.EvaluateEdgeAutoScroll(50, 250);
        assert.ok(sv.VerticalOffset >= after_first,
            'after stop + outside cursor, offset stays put');
    });

    test('StopEdgeAutoScroll cleans up cleanly without throwing when no autoscroll was active', () => {
        const sv = new ScrollViewer();
        assert.doesNotThrow(() => sv.StopEdgeAutoScroll());
    });
});

// A content element whose height can grow between arranges, to exercise
// AutoScrollToEnd's content-growth trigger.
class Growable extends Element
{
    public h: number;
    constructor(h: number) { super(); this.h = h; }
    protected override MeasureOverride(_a: Size): Size { return new Size(50, this.h); }
    public grow(dh: number): void { this.h += dh; this.InvalidateMeasure(); }
}

describe('ScrollViewer — AutoScrollToEnd (sticky)', () => {
    beforeEach(() => { initTestApp(); });

    function layout(sv: ScrollViewer): void
    {
        sv.Measure(new Size(100, 100));
        sv.Arrange(new Rect(0, 0, 100, 100));
    }

    test('snaps to the bottom when content grows and the viewport is at the end', () => {
        const sv = new ScrollViewer();
        sv.AutoScrollToEnd = true;
        const c = new Growable(300);
        sv.Content = c;
        layout(sv);
        // First content lands at the bottom (initial _wasAtEnd = true).
        assert.ok(sv.ScrollableHeight > 0);
        assert.equal(sv.VerticalOffset, sv.ScrollableHeight);

        c.grow(200);
        layout(sv);
        assert.equal(sv.VerticalOffset, sv.ScrollableHeight);
    });

    test('does NOT snap after the user scrolls up (sticky released)', () => {
        const sv = new ScrollViewer();
        sv.AutoScrollToEnd = true;
        const c = new Growable(300);
        sv.Content = c;
        layout(sv);

        sv.VerticalOffset = 0;   // user scrolls up
        layout(sv);              // recomputes _wasAtEnd = false
        c.grow(200);
        layout(sv);
        assert.equal(sv.VerticalOffset, 0, 'stayed put — no yank');
    });

    test('resumes snapping once the user scrolls back to the bottom', () => {
        const sv = new ScrollViewer();
        sv.AutoScrollToEnd = true;
        const c = new Growable(300);
        sv.Content = c;
        layout(sv);

        sv.VerticalOffset = 0;
        layout(sv);
        sv.ScrollToBottom();     // back to the end
        layout(sv);
        c.grow(200);
        layout(sv);
        assert.equal(sv.VerticalOffset, sv.ScrollableHeight);
    });

    test('default (AutoScrollToEnd=false) never auto-scrolls', () => {
        const sv = new ScrollViewer();
        const c = new Growable(300);
        sv.Content = c;
        layout(sv);
        assert.equal(sv.VerticalOffset, 0);
        c.grow(200);
        layout(sv);
        assert.equal(sv.VerticalOffset, 0);
    });
});
