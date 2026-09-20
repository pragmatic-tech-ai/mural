import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';

import {
    Element,
    Visual,
    Panel,
    Application,
    NoModifiers,
    PointerButton,
    PointerEventArgs,
    type PointerEventInit,
} from '../../runtime/index.js';
import { InputManager } from '../index.js';

// Concrete Visual subclass that records every input virtual it sees.
// Lets the assertions reason about (a) which visuals received the
// event, (b) in which order, and (c) under which dispatch strategy
// (tunnel vs bubble). Used throughout the test file in lieu of
// per-test mocks.
class Probe extends Element
{
    public readonly log: Array<{
        strategy: 'tunnel' | 'bubble';
        kind:     string;
        name:     string;
    }> = [];

    public readonly name: string;
    /** Stop propagation when set — tests Handled short-circuit. */
    public swallow: 'tunnel' | 'bubble' | null = null;

    constructor(name: string)
    {
        super();
        this.name = name;
    }

    private record(strategy: 'tunnel' | 'bubble', kind: string, args: PointerEventArgs): void
    {
        this.log.push({ strategy, kind, name: this.name });
        if (this.swallow === strategy) args.Handled = true;
    }

    protected override OnPointerEnter       (a: PointerEventArgs): void { this.record('bubble', 'Enter', a); }
    protected override OnPointerLeave       (a: PointerEventArgs): void { this.record('bubble', 'Leave', a); }
    protected override OnPreviewPointerMove (a: PointerEventArgs): void { this.record('tunnel', 'Move',  a); }
    protected override OnPointerMove        (a: PointerEventArgs): void { this.record('bubble', 'Move',  a); }
    protected override OnPreviewPointerDown (a: PointerEventArgs): void { this.record('tunnel', 'Down',  a); }
    protected override OnPointerDown        (a: PointerEventArgs): void { this.record('bubble', 'Down',  a); }
    protected override OnPreviewPointerUp   (a: PointerEventArgs): void { this.record('tunnel', 'Up',    a); }
    protected override OnPointerUp          (a: PointerEventArgs): void { this.record('bubble', 'Up',    a); }
}

class ProbePanel extends Panel
{
    public readonly log: Array<{ strategy: string; kind: string; name: string }> = [];
    public readonly name: string;
    constructor(name: string) { super(); this.name = name; }
    private record(strategy: 'tunnel' | 'bubble', kind: string): void
    { this.log.push({ strategy, kind, name: this.name }); }
    protected override OnPointerEnter()        { this.record('bubble', 'Enter'); }
    protected override OnPointerLeave()        { this.record('bubble', 'Leave'); }
    protected override OnPreviewPointerMove()  { this.record('tunnel', 'Move'); }
    protected override OnPointerMove()         { this.record('bubble', 'Move'); }
    protected override OnPreviewPointerDown()  { this.record('tunnel', 'Down'); }
    protected override OnPointerDown()         { this.record('bubble', 'Down'); }
}

function syntheticInit(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX:       0,
        HostY:       0,
        Button:      PointerButton.Primary,
        Buttons:     1,
        Modifiers:   NoModifiers,
        PointerId:   0,
        Pressure:    0,
        PointerType: 'mouse',
        ...overrides,
    };
}

describe('routed events — dispatch order', () => {
    beforeEach(() => { initTestApp(); });

    test('tunnel runs root→target, then bubble runs target→root', () => {
        const root  = new ProbePanel('root');
        const mid   = new ProbePanel('mid');
        const leaf  = new Probe('leaf');
        root.AddChild(mid);
        mid.AddChild(leaf);

        const im = new InputManager();
        im.InjectPointerDown(leaf, syntheticInit());

        // Each visual sees both Down passes (no Handled). Enter
        // events are also fired on the hover-chain setup, but those
        // are direct (single hop per visual) so they only appear in
        // each visual's own log.
        for (const v of [root, mid, leaf])
        {
            const downs = v.log.filter(e => e.kind === 'Down').map(e => e.strategy);
            assert.deepEqual(downs, ['tunnel', 'bubble'],
                `${v.name} should see tunnel then bubble for Down`);
        }
    });

    test('Handled = true during tunnel skips the rest of tunnel AND bubble', () => {
        const root  = new ProbePanel('root');
        const leaf  = new Probe('leaf');
        root.AddChild(leaf);

        leaf.swallow = 'tunnel';

        const im = new InputManager();
        im.InjectPointerDown(leaf, syntheticInit());

        // Tunnel order is root → leaf. Leaf swallows at the end of
        // the tunnel pass; bubble never runs on either visual.
        const rootDowns = root.log.filter(e => e.kind === 'Down').map(e => e.strategy);
        const leafDowns = leaf.log.filter(e => e.kind === 'Down').map(e => e.strategy);
        assert.deepEqual(rootDowns, ['tunnel']);
        assert.deepEqual(leafDowns, ['tunnel']);
    });

    test('Handled = true during bubble stops the rest of the bubble', () => {
        const root  = new ProbePanel('root');
        const leaf  = new Probe('leaf');
        root.AddChild(leaf);
        leaf.swallow = 'bubble';

        const im = new InputManager();
        im.InjectPointerDown(leaf, syntheticInit());

        // Tunnel runs in full (root then leaf); bubble starts at leaf
        // (swallowed) so root never sees the bubble:Down.
        const rootDowns = root.log.filter(e => e.kind === 'Down').map(e => e.strategy);
        const leafDowns = leaf.log.filter(e => e.kind === 'Down').map(e => e.strategy);
        assert.deepEqual(rootDowns, ['tunnel']);
        assert.deepEqual(leafDowns, ['tunnel', 'bubble']);
    });
});

describe('IsMouseOver chain', () => {
    beforeEach(() => { initTestApp(); });

    test('Enter sets IsMouseOver on every ancestor of the hit visual', () => {
        const root = new ProbePanel('root');
        const mid  = new ProbePanel('mid');
        const leaf = new Probe('leaf');
        root.AddChild(mid);
        mid.AddChild(leaf);

        const im = new InputManager();
        im.InjectPointerMove(leaf, syntheticInit());

        assert.equal(leaf.IsMouseOver, true);
        assert.equal(mid.IsMouseOver,  true);
        assert.equal(root.IsMouseOver, true);
    });

    test('Move to a sibling clears IsMouseOver on the previous leaf only', () => {
        const root  = new ProbePanel('root');
        const childA = new Probe('a');
        const childB = new Probe('b');
        root.AddChild(childA);
        root.AddChild(childB);

        const im = new InputManager();
        im.InjectPointerMove(childA, syntheticInit());
        assert.deepEqual(
            [childA.IsMouseOver, childB.IsMouseOver, root.IsMouseOver],
            [true, false, true],
        );

        im.InjectPointerMove(childB, syntheticInit());
        // childA loses IsMouseOver; childB gains it; root unchanged.
        assert.deepEqual(
            [childA.IsMouseOver, childB.IsMouseOver, root.IsMouseOver],
            [false, true, true],
        );
    });

    test('PointerLeave on the host clears IsMouseOver across the whole chain', () => {
        const root = new ProbePanel('root');
        const leaf = new Probe('leaf');
        root.AddChild(leaf);

        const im = new InputManager();
        im.InjectPointerMove(leaf, syntheticInit());
        assert.equal(leaf.IsMouseOver, true);
        assert.equal(root.IsMouseOver, true);

        im.InjectPointerLeave(syntheticInit());
        assert.equal(leaf.IsMouseOver, false);
        assert.equal(root.IsMouseOver, false);
    });

    test('Enter fires only on newly-added visuals; ancestor stays untouched on lateral move', () => {
        const root = new ProbePanel('root');
        const a    = new Probe('a');
        const b    = new Probe('b');
        root.AddChild(a);
        root.AddChild(b);

        const im = new InputManager();
        im.InjectPointerMove(a, syntheticInit());
        // Reset logs so we measure only the second move.
        root.log.length = 0;
        a.log.length = 0;
        b.log.length = 0;

        im.InjectPointerMove(b, syntheticInit());

        // Enter / Leave are direct — `a` only sees its own Leave
        // (single hop), `b` only sees its own Enter (single hop).
        // Move tunnels + bubbles through root + b, so root sees one
        // Move pair (tunnel + bubble) and `b` sees one Move pair.
        assert.deepEqual(a.log.map(e => e.kind), ['Leave']);
        assert.deepEqual(b.log.map(e => e.kind), ['Enter', 'Move', 'Move']);
        assert.deepEqual(root.log.map(e => e.kind), ['Move', 'Move']);
    });
});

describe('IsPressed semantics', () => {
    beforeEach(() => { initTestApp(); });

    test('PointerDown sets IsPressed; PointerUp clears it on the same target', () => {
        const root = new ProbePanel('root');
        const leaf = new Probe('leaf');
        root.AddChild(leaf);

        const im = new InputManager();
        im.InjectPointerDown(leaf, syntheticInit());
        assert.equal(leaf.IsPressed, true);

        im.InjectPointerUp(leaf, syntheticInit());
        assert.equal(leaf.IsPressed, false);
    });

    test('PointerUp clears IsPressed even when the up happens off-target', () => {
        const root = new ProbePanel('root');
        const a    = new Probe('a');
        const b    = new Probe('b');
        root.AddChild(a);
        root.AddChild(b);

        const im = new InputManager();
        im.InjectPointerDown(a, syntheticInit());
        assert.equal(a.IsPressed, true);

        // Release happens over `b`. `a` still gets IsPressed cleared —
        // matches WPF's button-drag-off behaviour. `b` never had
        // IsPressed in the first place.
        im.InjectPointerUp(b, syntheticInit());
        assert.equal(a.IsPressed, false);
        assert.equal(b.IsPressed, false);
    });

    test('PointerUp with no current target still clears IsPressed via tracked press-target', () => {
        const root = new ProbePanel('root');
        const leaf = new Probe('leaf');
        root.AddChild(leaf);

        const im = new InputManager();
        im.InjectPointerDown(leaf, syntheticInit());
        assert.equal(leaf.IsPressed, true);

        // Up with hit === null — pointer left the host entirely
        // between down and up.
        im.InjectPointerUp(null, syntheticInit());
        assert.equal(leaf.IsPressed, false);
    });
});

describe('end-to-end: pointer → IsMouseOver → Style trigger → DP update', () => {
    beforeEach(() => { initTestApp(); });

    test('hovering a Border with an IsMouseOver style trigger swaps its Fill', async () => {
        const { instantiate } = await import('../../compiler/index.js');
        const runtime  = await import('../../runtime/index.js');
        const controls = await import('../../basic/index.js');
        const engine   = await import('../../visual-engine/index.js');
        const ctx: Record<string, unknown> = { ...runtime, ...controls, ...engine };

        // Minimal app: one Border with a Style that swaps Fill
        // on IsMouseOver. The Canvas root is needed so the Border has
        // a visual parent for hover-chain routing.
        const app = instantiate(`
            Application{ resources: {
                @rest  = #4caf50
                @hover = #ff0000
                Style x:key="HoverBox"[TargetType=Border]{
                    Fill = @rest;
                    when( IsMouseOver ){ Fill = @hover; }
                }
                Canvas x:root{
                    Border[Style=@HoverBox, Width=50, Height=50]
                }
            } }
        `, ctx) as runtime.Application;
        const canvas = app.Resources.Root as InstanceType<typeof controls.Canvas>;
        const border = [...canvas.visualChildren][0]! as InstanceType<typeof controls.Border>;

        const restColour = (border.Fill as unknown as { Color: { ToCss(): string } }).Color.ToCss();
        assert.equal(restColour, 'rgb(76,175,80)');   // green

        const im = new InputManager();
        im.InjectPointerMove(border, syntheticInit());

        const hoverColour = (border.Fill as unknown as { Color: { ToCss(): string } }).Color.ToCss();
        assert.equal(hoverColour, 'rgb(255,0,0)');    // red — trigger fired

        // Move pointer away — the trigger setter unwinds and the
        // style-tier default (rest) takes over again.
        im.InjectPointerLeave(syntheticInit());
        const afterLeave = (border.Fill as unknown as { Color: { ToCss(): string } }).Color.ToCss();
        assert.equal(afterLeave, 'rgb(76,175,80)');
    });
});

describe('args.Visual rewriting + Source preserved', () => {
    beforeEach(() => { initTestApp(); });

    test('args.Source is the leaf hit; args.Visual rotates per hop', () => {
        const root = new ProbePanel('root');
        const leaf = new Probe('leaf');
        root.AddChild(leaf);

        class WatchedRoot extends Panel
        {
            public observed: { source: Visual; current: Visual; strategy: string }[] = [];
            protected override OnPointerDown(a: PointerEventArgs): void
            {
                this.observed.push({ source: a.Source, current: a.Visual, strategy: a.Strategy });
            }
            protected override OnPreviewPointerDown(a: PointerEventArgs): void
            {
                this.observed.push({ source: a.Source, current: a.Visual, strategy: a.Strategy });
            }
        }
        const wr = new WatchedRoot();
        const child = new Probe('child');
        wr.AddChild(child);

        const im = new InputManager();
        im.InjectPointerDown(child, syntheticInit());
        assert.equal(wr.observed.length, 2);
        for (const obs of wr.observed)
        {
            assert.equal(obs.source,  child);     // Source is the original target
            assert.equal(obs.current, wr);        // Visual is the hop we're on
        }
        assert.deepEqual(wr.observed.map(o => o.strategy), ['tunnel', 'bubble']);
    });
});

describe('raw Visual on the input route', () => {
    beforeEach(() => { initTestApp(); });

    // A rendering-only node: a raw `Visual` subclass with none of the
    // Element-tier input surface (no IsMouseOver DP, no On* virtuals).
    // Mirrors the text-on-path demo's GeometryView, added as a direct
    // child of a Canvas (`canvas.AddChild(geometryView)`). `Adopt`
    // exposes the protected visual-child wiring so a test can parent an
    // Element under a raw Visual (the ancestor case).
    class RawVisual extends Visual
    {
        public Adopt(child: Visual): void { this.AttachVisual(child); }
    }

    test('hovering a raw-Visual leaf resolves hover to its Element parent (no crash)', () => {
        // Regression: the hover chain used to call `_setIsMouseOver` on
        // every route node, throwing "v._setIsMouseOver is not a function"
        // the moment the pointer crossed a raw Visual (reported on the
        // text-on-path demo). buildRoute now drops raw Visuals from the
        // route, so hover lands on the nearest Element ancestor instead.
        const root = new ProbePanel('root');
        const raw  = new RawVisual();
        // Panel.AddChild wires the visual-parent link for a raw Visual
        // too — the same call the demo's Canvas makes.
        root.AddChild(raw as unknown as Element);

        const im = new InputManager();
        assert.doesNotThrow(
            () => im.InjectPointerMove(raw as unknown as Element, syntheticInit()),
            'a raw-Visual hit must not crash the hover pipeline');
        assert.equal(root.IsMouseOver, true,
            'hover resolves to the nearest Element ancestor of the raw Visual');
    });

    test('a raw Visual between two Elements is skipped in the route', () => {
        // Ancestor case: Element leaf under a raw-Visual container under
        // an Element root. The route must be [leaf, root] — the raw
        // container carries no input state and no On* virtuals, so it is
        // filtered out rather than dispatched to.
        const root = new ProbePanel('root');
        const mid  = new RawVisual();
        const leaf = new Probe('leaf');
        root.AddChild(mid as unknown as Element);
        mid.Adopt(leaf);

        const im = new InputManager();
        assert.doesNotThrow(
            () => im.InjectPointerMove(leaf, syntheticInit()),
            'a raw-Visual ancestor must not crash the hover pipeline');
        assert.equal(leaf.IsMouseOver, true, 'the Element leaf still hovers');
        assert.equal(root.IsMouseOver, true, 'hover reaches the Element root past the raw ancestor');
    });
});
