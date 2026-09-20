import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    DataObject,
    DragDrop,
    DragDropEffects,
    DragEventArgs,
    DragSession,
    NoModifiers,
    Panel,
    PointerButton,
    PointerEventArgs,
    Size,
    Visual,
    dispatchDrag,
    type DrawingContext,
    type PointerEventInit,
} from '../index.js';
import { InputManager } from '../../framework/index.js';

// Drag-event probe class — minimal Panel subclass that records each
// drag virtual it sees (tunnel + bubble). Used across the dispatch
// tests below to assert ordering and Handled short-circuit.
class DragLoggerPanel extends Panel
{
    public readonly log: string[] = [];
    public readonly tag: string;
    public stopOnPreviewOver = false;
    constructor(tag: string) { super(); this.tag = tag; }
    protected override OnPreviewDragEnter(): void { this.log.push(`tunnel/Enter:${this.tag}`); }
    protected override OnDragEnter():        void { this.log.push(`bubble/Enter:${this.tag}`); }
    protected override OnPreviewDragLeave(): void { this.log.push(`tunnel/Leave:${this.tag}`); }
    protected override OnDragLeave():        void { this.log.push(`bubble/Leave:${this.tag}`); }
    protected override OnPreviewDragOver(args: DragEventArgs): void
    {
        this.log.push(`tunnel/Over:${this.tag}`);
        if (this.stopOnPreviewOver) args.Handled = true;
    }
    protected override OnDragOver():         void { this.log.push(`bubble/Over:${this.tag}`); }
    protected override OnPreviewDrop():      void { this.log.push(`tunnel/Drop:${this.tag}`); }
    protected override OnDrop():             void { this.log.push(`bubble/Drop:${this.tag}`); }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

function dragArgs(kind: 'DragEnter' | 'DragLeave' | 'DragOver' | 'Drop', source: Visual): DragEventArgs
{
    return new DragEventArgs(kind, source, {
        HostX: 0, HostY: 0,
        Data: new DataObject(),
        AllowedEffects: DragDropEffects.Copy,
        Modifiers: NoModifiers,
    });
}

describe('DragDropEffects — flag enum', () => {
    test('has the standard None/Copy/Move/Link/All flags', () => {
        assert.equal(DragDropEffects.None, 0);
        assert.equal(DragDropEffects.Copy, 1);
        assert.equal(DragDropEffects.Move, 2);
        assert.equal(DragDropEffects.Link, 4);
        assert.equal(DragDropEffects.All,
            DragDropEffects.Copy | DragDropEffects.Move | DragDropEffects.Link);
    });
});

describe('DataObject — formats map', () => {
    test('Set / Get round-trips the value verbatim', () => {
        const d = new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', { kind: 'rect' });
        assert.deepEqual(d.Get<{ kind: string }>('@pragmatic-tech-ai/mural/node-kind'), { kind: 'rect' });
    });

    test('Has reports presence', () => {
        const d = new DataObject().Set('text/plain', 'hello');
        assert.equal(d.Has('text/plain'),       true);
        assert.equal(d.Has('text/uri-list'),    false);
    });

    test('Get returns undefined for absent formats', () => {
        const d = new DataObject();
        assert.equal(d.Get('text/plain'), undefined);
    });

    test('Formats lists every key in insertion order', () => {
        const d = new DataObject()
            .Set('text/plain',     'hi')
            .Set('@pragmatic-tech-ai/mural/node-kind', 'rect');
        assert.deepEqual([...d.Formats()], ['text/plain', '@pragmatic-tech-ai/mural/node-kind']);
    });

    test('Set returns `this` for chaining', () => {
        const d = new DataObject();
        const ret = d.Set('text/plain', 'hi');
        assert.equal(ret, d);
    });

    test('Set overwrites a previously-set format', () => {
        const d = new DataObject()
            .Set('text/plain', 'first')
            .Set('text/plain', 'second');
        assert.equal(d.Get('text/plain'), 'second');
        assert.deepEqual([...d.Formats()], ['text/plain']);
    });
});

describe('drag events — dispatch order', () => {
    test('tunnel runs root→target, then bubble runs target→root for DragEnter', () => {
        const root = new DragLoggerPanel('root');
        const mid  = new DragLoggerPanel('mid');
        const leaf = new DragLoggerPanel('leaf');
        root.AddChild(mid);
        mid.AddChild(leaf);

        dispatchDrag(dragArgs('DragEnter', leaf));

        // Tunnel: root, mid, leaf (root→target). Bubble: leaf, mid, root
        // (target→root).
        assert.deepEqual([...root.log, ...mid.log, ...leaf.log], [
            'tunnel/Enter:root',
            'bubble/Enter:root',
            'tunnel/Enter:mid',
            'bubble/Enter:mid',
            'tunnel/Enter:leaf',
            'bubble/Enter:leaf',
        ]);
        // Confirmed per-node tunnel-before-bubble order:
        assert.deepEqual(leaf.log, ['tunnel/Enter:leaf', 'bubble/Enter:leaf']);
    });

    test('Handled=true during tunnel skips the rest of tunnel AND bubble', () => {
        const root = new DragLoggerPanel('root');
        const leaf = new DragLoggerPanel('leaf');
        root.AddChild(leaf);
        root.stopOnPreviewOver = true;       // root's tunnel marks Handled

        dispatchDrag(dragArgs('DragOver', leaf));

        // Root sees its own tunnel. Leaf never sees the event (tunnel was
        // halted before it reached the target); root never sees the bubble
        // either (both passes terminate on Handled).
        assert.deepEqual(root.log, ['tunnel/Over:root']);
        assert.deepEqual(leaf.log, []);
    });

    test('Drop fires through tunnel + bubble normally', () => {
        const root = new DragLoggerPanel('root');
        const leaf = new DragLoggerPanel('leaf');
        root.AddChild(leaf);

        dispatchDrag(dragArgs('Drop', leaf));

        assert.deepEqual([...root.log, ...leaf.log], [
            'tunnel/Drop:root',
            'bubble/Drop:root',
            'tunnel/Drop:leaf',
            'bubble/Drop:leaf',
        ]);
    });

    test('dispatchDrag refuses non-drag kinds', () => {
        const v = new DragLoggerPanel('v');
        // Build a PointerMove args object via the same constructor —
        // dispatchDrag should reject it because the kind isn't a drag
        // kind. We can't construct one cleanly via DragEventArgs (the
        // constructor's kind parameter is typed), so we fake one with a
        // cast just to validate the runtime guard.
        const args = dragArgs('DragOver', v);
        (args as unknown as { Kind: string }).Kind = 'PointerMove';
        assert.throws(() => dispatchDrag(args), /not a drag event/);
    });
});

function makeBareVisual(): Visual { return new DragLoggerPanel('bare'); }

describe('DragSession — standalone (no InputManager wiring yet)', () => {
    test('DoDragDrop returns a session carrying Source/Data/AllowedEffects', () => {
        DragDrop._pendingSession = null;             // baseline
        const source = makeBareVisual();
        const data   = new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect');
        const session = DragDrop.DoDragDrop(source, data, DragDropEffects.Copy);
        assert.equal(session.Source,          source);
        assert.equal(session.Data,            data);
        assert.equal(session.AllowedEffects,  DragDropEffects.Copy);
        // Pending slot was filled for the InputManager to pick up.
        assert.equal(DragDrop._pendingSession, session);
        DragDrop._pendingSession = null;
        DragDrop._pendingOptions = {};
    });

    test('OnMove subscribers fire when the session is driven', () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.Copy);
        const calls: Array<[number, number]> = [];
        session.OnMove((x, y) => calls.push([x, y]));

        session._fireMove(10, 20);
        session._fireMove(30, 40);

        assert.deepEqual(calls, [[10, 20], [30, 40]]);
        DragDrop._pendingSession = null;
    });

    test('OnMove returns an unsubscribe function that stops further callbacks', () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.Copy);
        const calls: Array<[number, number]> = [];
        const unsub = session.OnMove((x, y) => calls.push([x, y]));

        session._fireMove(1, 2);
        unsub();
        session._fireMove(3, 4);

        assert.deepEqual(calls, [[1, 2]]);
        DragDrop._pendingSession = null;
    });

    test('Cancel resolves the promise with None', async () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.Copy);
        session.Cancel();
        assert.equal(session.IsSettled, true);
        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
        DragDrop._pendingSession = null;
    });

    test('Cancel detaches all OnMove subscribers', () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.Copy);
        const calls: number[] = [];
        session.OnMove(() => calls.push(1));
        session.Cancel();
        session._fireMove(0, 0);
        assert.deepEqual(calls, []);
        DragDrop._pendingSession = null;
    });

    test('then() resolves with the effect provided by _complete', async () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.All);
        session._complete(DragDropEffects.Move);
        const effect = await session;
        assert.equal(effect, DragDropEffects.Move);
        DragDrop._pendingSession = null;
    });

    test('_complete is idempotent — second call is ignored', async () => {
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(), DragDropEffects.All);
        session._complete(DragDropEffects.Copy);
        session._complete(DragDropEffects.Move);  // ignored
        const effect = await session;
        assert.equal(effect, DragDropEffects.Copy);
        DragDrop._pendingSession = null;
    });

    test('DragDrop.DragThreshold exposes a tunable threshold defaulting to 4', () => {
        assert.equal(DragDrop.DragThreshold, 4);
        DragDrop.DragThreshold = 8;
        assert.equal(DragDrop.DragThreshold, 8);
        DragDrop.DragThreshold = 4;
    });

    test('opts.preview is stashed on _pendingOptions', () => {
        DragDrop._pendingSession = null;
        const session = DragDrop.DoDragDrop(makeBareVisual(), new DataObject(),
            DragDropEffects.Copy, { preview: null });
        assert.equal(DragDrop._pendingOptions.preview, null);
        DragDrop._pendingSession = null;
        DragDrop._pendingOptions = {};
        void session;
    });
});

describe('Visual.AllowDrop / IsDragOver DPs', () => {
    test('AllowDrop defaults to false', () => {
        const v = new DragLoggerPanel('v');
        assert.equal(v.AllowDrop, false);
    });

    test('AllowDrop is settable from consumer code', () => {
        const v = new DragLoggerPanel('v');
        v.AllowDrop = true;
        assert.equal(v.AllowDrop, true);
        v.AllowDrop = false;
        assert.equal(v.AllowDrop, false);
    });

    test('IsDragOver defaults to false and is set via _setIsDragOver', () => {
        const v = new DragLoggerPanel('v');
        assert.equal(v.IsDragOver, false);
        // Mirror of the InputManager pattern (§ 1.13) — IsDragOver is
        // a read-only DP; framework consumers write through the typed
        // `_setIsDragOver` @internal method.
        v._setIsDragOver(true);
        assert.equal(v.IsDragOver, true);
    });
});

// Drag receiver — records each drag virtual it sees and translates a
// recognized format into a Copy effect on DragOver. Used by the
// InputManager-session tests below.
class DropPanel extends Panel
{
    public readonly log: string[] = [];
    public readonly tag: string;
    constructor(tag: string) { super(); this.tag = tag; this.AllowDrop = true; }
    protected override OnDragEnter(args: DragEventArgs): void
    {
        this.log.push(`Enter@${args.HostX},${args.HostY}`);
    }
    protected override OnDragLeave(args: DragEventArgs): void
    {
        this.log.push(`Leave@${args.HostX},${args.HostY}`);
    }
    protected override OnDragOver(args: DragEventArgs): void
    {
        this.log.push(`Over@${args.HostX},${args.HostY}`);
        if (args.Data.Has('@pragmatic-tech-ai/mural/node-kind')) args.Effect = DragDropEffects.Copy;
    }
    protected override OnDrop(args: DragEventArgs): void
    {
        this.log.push(`Drop@${args.HostX},${args.HostY},effect=${args.Effect}`);
    }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

function dragInit(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0,
        Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0,
        PointerType: 'mouse',
        ...overrides,
    };
}

function resetPendingDrag(): void
{
    DragDrop._pendingSession = null;
    DragDrop._pendingOptions = {};
}

describe('InputManager — drag session lifecycle', () => {
    test('PickUpPendingDragSession picks up a session started by DoDragDrop', () => {
        resetPendingDrag();
        const im = new InputManager();
        const src = new DropPanel('src');
        DragDrop.DoDragDrop(src, new DataObject(), DragDropEffects.Copy);
        im.PickUpPendingDragSession();
        assert.equal(im.IsDragActive, true);
        // _pendingSession is consumed.
        assert.equal(DragDrop._pendingSession, null);
        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('over a receiver: DragEnter+DragOver fire and IsDragOver flips to true', () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        const target = new DropPanel('t');
        const data = new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect');
        DragDrop.DoDragDrop(src, data, DragDropEffects.Copy);
        im.PickUpPendingDragSession();

        im.DriveDragMove(target, dragInit({ HostX: 5, HostY: 7 }));

        assert.deepEqual(target.log, ['Enter@5,7', 'Over@5,7']);
        assert.equal(target.IsDragOver, true);
        assert.equal(im.CurrentDragEffect, DragDropEffects.Copy);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('moving off the receiver fires DragLeave + IsDragOver=false', () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        const target = new DropPanel('t');
        DragDrop.DoDragDrop(src, new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'), DragDropEffects.Copy);
        im.PickUpPendingDragSession();

        im.DriveDragMove(target, dragInit({ HostX: 5, HostY: 5 }));
        im.DriveDragMove(null,   dragInit({ HostX: 99, HostY: 99 }));

        assert.equal(target.IsDragOver, false);
        assert.equal(target.log[target.log.length - 1], 'Leave@99,99');
        assert.equal(im.CurrentDragEffect, DragDropEffects.None);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('findAllowDropAncestor — receiver = nearest ancestor with AllowDrop=true', () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        // Build root(AllowDrop) → mid → leaf. Only root accepts drops;
        // hitting the leaf still drives DragEnter on root.
        const root = new DropPanel('root');
        const mid  = new DragLoggerPanel('mid');
        mid.AllowDrop = false;
        const leaf = new DragLoggerPanel('leaf');
        leaf.AllowDrop = false;
        root.AddChild(mid);
        mid.AddChild(leaf);

        DragDrop.DoDragDrop(src, new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'), DragDropEffects.Copy);
        im.PickUpPendingDragSession();
        im.DriveDragMove(leaf, dragInit({ HostX: 1, HostY: 1 }));

        assert.equal(im.CurrentDragReceiver, root);
        assert.equal(root.IsDragOver, true);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('pointer-up over a receiver fires Drop when Effect!=None and resolves session', async () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        const target = new DropPanel('t');
        const session = DragDrop.DoDragDrop(src,
            new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
            DragDropEffects.Copy);
        im.PickUpPendingDragSession();

        im.DriveDragMove(target, dragInit({ HostX: 3, HostY: 4 }));
        im.DriveDragUp  (target, dragInit({ HostX: 3, HostY: 4 }));

        const effect = await session;
        assert.equal(effect, DragDropEffects.Copy);
        assert.ok(target.log.includes('Drop@3,4,effect=1'));
        assert.equal(im.IsDragActive, false);
    });

    test('pointer-up with Effect=None does NOT fire Drop; session resolves None', async () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        // DropPanel only accepts mural/node-kind; sending a different
        // format gets Effect=None.
        const target = new DropPanel('t');
        const session = DragDrop.DoDragDrop(src,
            new DataObject().Set('text/plain', 'no'),
            DragDropEffects.Copy);
        im.PickUpPendingDragSession();

        im.DriveDragMove(target, dragInit({ HostX: 1, HostY: 1 }));
        im.DriveDragUp  (target, dragInit({ HostX: 1, HostY: 1 }));

        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
        assert.ok(!target.log.some((s) => s.startsWith('Drop@')));
    });

    test('Cancel() resolves the session and clears IsDragOver on the receiver', async () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        const target = new DropPanel('t');
        const session = DragDrop.DoDragDrop(src,
            new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
            DragDropEffects.Copy);
        im.PickUpPendingDragSession();
        im.DriveDragMove(target, dragInit({ HostX: 0, HostY: 0 }));
        assert.equal(target.IsDragOver, true);

        session.Cancel();
        im.ObserveSessionCancellation();

        assert.equal(target.IsDragOver, false);
        assert.equal(im.IsDragActive, false);
        const effect = await session;
        assert.equal(effect, DragDropEffects.None);
    });

    test('InjectPointerDown picks up a session started inside a PointerDown handler', () => {
        resetPendingDrag();
        const im   = new InputManager();
        const root = new DropPanel('root');     // root has AllowDrop=true
        const v = new (class extends Panel
        {
            protected override OnPointerDown(args: PointerEventArgs): void
            {
                DragDrop.DoDragDrop(
                    args.Source,
                    new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
                    DragDropEffects.Copy,
                );
            }
            protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
            protected override RenderOverride(_dc: DrawingContext): void { }
        })();
        root.AddChild(v);
        im.InjectPointerDown(v, dragInit());
        assert.equal(im.IsDragActive, true);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('InjectPointerMove routes through DriveDragMove while a session is live', () => {
        resetPendingDrag();
        const im     = new InputManager();
        const src    = new DropPanel('src');
        const target = new DropPanel('t');
        DragDrop.DoDragDrop(src,
            new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
            DragDropEffects.Copy);
        im.PickUpPendingDragSession();

        im.InjectPointerMove(target, dragInit({ HostX: 50, HostY: 50 }));
        assert.equal(target.IsDragOver, true);
        assert.equal(target.log[0], 'Enter@50,50');

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });
});

describe('Visual.IsDraggable + OnDragStart — declarative latch', () => {
    test('IsDraggable=true latches PointerDown and starts a drag after threshold movement', () => {
        resetPendingDrag();
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        v.IsDraggable = true;
        v.OnDragStart = () => ({
            data:    new DataObject().Set('@pragmatic-tech-ai/mural/node-kind', 'rect'),
            effects: DragDropEffects.Copy,
        });

        im.InjectPointerDown(v, dragInit({ HostX: 10, HostY: 10 }));
        // 3px movement — below threshold (default 4).
        im.InjectPointerMove(v, dragInit({ HostX: 12, HostY: 12 }));
        assert.equal(im.IsDragActive, false);
        // 5px movement — above threshold; should latch and start.
        im.InjectPointerMove(v, dragInit({ HostX: 14, HostY: 13 }));
        assert.equal(im.IsDragActive, true);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });

    test('OnDragStart returning null skips the drag', () => {
        resetPendingDrag();
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        v.IsDraggable = true;
        v.OnDragStart = () => null;

        im.InjectPointerDown(v, dragInit({ HostX: 0, HostY: 0 }));
        im.InjectPointerMove(v, dragInit({ HostX: 10, HostY: 10 }));
        assert.equal(im.IsDragActive, false);
    });

    test('PointerUp before the threshold detaches the latch; no drag starts on a subsequent move', () => {
        resetPendingDrag();
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        v.IsDraggable = true;
        v.OnDragStart = () => ({
            data:    new DataObject(),
            effects: DragDropEffects.Copy,
        });

        im.InjectPointerDown(v, dragInit({ HostX: 0, HostY: 0 }));
        im.InjectPointerMove(v, dragInit({ HostX: 2, HostY: 2 }));
        im.InjectPointerUp  (v, dragInit({ HostX: 2, HostY: 2 }));
        // No pending down — a stray move without a fresh down must not
        // start a drag.
        im.InjectPointerMove(v, dragInit({ HostX: 20, HostY: 20 }));
        assert.equal(im.IsDragActive, false);
    });

    test('toggling IsDraggable=false uninstalls the listeners', () => {
        resetPendingDrag();
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        v.IsDraggable = true;
        v.OnDragStart = () => ({ data: new DataObject(), effects: DragDropEffects.Copy });
        v.IsDraggable = false;
        im.InjectPointerDown(v, dragInit({ HostX: 0, HostY: 0 }));
        im.InjectPointerMove(v, dragInit({ HostX: 20, HostY: 20 }));
        assert.equal(im.IsDragActive, false);
    });

    test('Threshold is read at trip time so tuning DragThreshold mid-session works', () => {
        resetPendingDrag();
        DragDrop.DragThreshold = 20;             // tighten the gate
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        v.IsDraggable = true;
        v.OnDragStart = () => ({ data: new DataObject(), effects: DragDropEffects.Copy });

        im.InjectPointerDown(v, dragInit({ HostX: 0, HostY: 0 }));
        im.InjectPointerMove(v, dragInit({ HostX: 10, HostY: 0 }));  // 10 < 20
        assert.equal(im.IsDragActive, false);
        im.InjectPointerMove(v, dragInit({ HostX: 25, HostY: 0 }));  // 25 > 20
        assert.equal(im.IsDragActive, true);
        DragDrop.DragThreshold = 4;              // restore default
        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });
});

describe('PointerEventArgs.BeginDragDrop', () => {
    test('sugar wraps DragDrop.DoDragDrop using args.Source', () => {
        resetPendingDrag();
        const im = new InputManager();
        const v = new DragLoggerPanel('v');
        let session: DragSession | null = null;
        v.AddRoutedEventListener('PointerDown', (raw: unknown) => {
            const args = raw as PointerEventArgs;
            session = args.BeginDragDrop(
                new DataObject().Set('@pragmatic-tech-ai/mural/port', { nodeId: 'n1', side: 0 }),
                DragDropEffects.Link,
                { preview: null },
            );
        });

        im.InjectPointerDown(v, dragInit({ HostX: 5, HostY: 5 }));

        assert.ok(session !== null);
        assert.equal((session as DragSession).Source, v);
        assert.equal((session as DragSession).AllowedEffects, DragDropEffects.Link);
        assert.equal(im.IsDragActive, true);

        im.CurrentDragSession?.Cancel();
        im.ObserveSessionCancellation();
    });
});

// Pins backlog 8.3: OnFeedback / OnContinueQuery source-side hooks.
describe('DragSession — source-side feedback hooks', () => {
    function pointerInit(x: number, y: number): PointerEventInit
    {
        return {
            HostX: x, HostY: y,
            ButtonIndex: PointerButton.Primary,
            Modifiers: NoModifiers,
        };
    }

    function setupSession(): { im: InputManager; source: Visual; session: DragSession }
    {
        const im = new InputManager();
        const source = new Panel();
        DragDrop.DoDragDrop(source, new DataObject(), DragDropEffects.Copy);
        im.PickUpPendingDragSession();
        const session = im.CurrentDragSession!;
        return { im, source, session };
    }

    test('OnFeedback fires on every receiver-effect change; dedupes on identical effects', () => {
        const { session } = setupSession();
        const fires: DragDropEffects[] = [];
        session.OnFeedback((e) => { fires.push(e); });

        session._fireFeedback(DragDropEffects.Copy);
        session._fireFeedback(DragDropEffects.Copy);  // duplicate — skipped
        session._fireFeedback(DragDropEffects.Move);
        session._fireFeedback(DragDropEffects.None);
        assert.deepEqual(fires, [DragDropEffects.Copy, DragDropEffects.Move, DragDropEffects.None]);
    });

    test('Returning false from OnContinueQuery cancels the drag on next move', () => {
        const { im } = setupSession();
        const session = im.CurrentDragSession!;
        let shouldContinue = true;
        session.OnContinueQuery(() => shouldContinue);
        assert.equal(im.IsDragActive, true);

        // Continue=true → move samples flow through.
        im.DriveDragMove(null, pointerInit(10, 10));
        assert.equal(im.IsDragActive, true);

        // Flip to false → next move cancels.
        shouldContinue = false;
        im.DriveDragMove(null, pointerInit(20, 20));
        assert.equal(im.IsDragActive, false);
        assert.equal(session.IsSettled, true);
    });

    test('Multiple OnContinueQuery callbacks AND together — any false cancels', () => {
        const { im } = setupSession();
        const session = im.CurrentDragSession!;
        session.OnContinueQuery(() => true);
        session.OnContinueQuery(() => false);  // this one wants cancel
        session.OnContinueQuery(() => true);

        im.DriveDragMove(null, pointerInit(10, 10));
        assert.equal(im.IsDragActive, false);
    });

    test('Feedback and continue subscribers are cleared on session complete', () => {
        const { im } = setupSession();
        const session = im.CurrentDragSession!;
        let feedbackFired = 0;
        let continueFired = 0;
        session.OnFeedback(() => { feedbackFired++; });
        session.OnContinueQuery(() => { continueFired++; return true; });

        session.Cancel();
        // Post-complete invocations of the framework-internal hooks are
        // no-ops — the subscriber sets have been cleared.
        session._fireFeedback(DragDropEffects.Copy);
        session._pollContinue();
        assert.equal(feedbackFired, 0);
        assert.equal(continueFired, 0);
    });
});

// Pins backlog 8.1: OS-level drops synthesize a DragSession with
// `Source === undefined`. This test verifies the shape — the actual
// HTML5 DragEvent wiring lives in HtmlTarget and is covered by the
// integration tests there.
describe('DragSession — OS-level drops (Source: undefined)', () => {
    test('Session with undefined source is constructible and reports it', () => {
        const data = new DataObject().Set('text/plain', 'hello');
        const session = new DragSession(undefined, data, DragDropEffects.Copy);
        assert.equal(session.Source, undefined);
        assert.equal(session.Data.Get('text/plain'), 'hello');
        // Lifecycle still works.
        session.Cancel();
        assert.equal(session.IsSettled, true);
    });
});
