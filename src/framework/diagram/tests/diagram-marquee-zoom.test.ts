import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import {
    ObservableCollection,
    NoModifiers,
    PointerButton,
    Visual,
    type PointerEventInit,
} from '../../../runtime/index.js';
import { InputManager } from '../../index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SelectionMode } from '../../list/selector.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';

function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0,
        Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse',
        ...overrides,
    };
}

// A Diagram at a known zoom with two figures at fixed CONTENT positions.
// The marquee gesture arrives in HOST pixels; the behavior must map it back
// through the camera (÷ Zoom) to hit-test against the figures' content rects.
function buildZoomedDiagram(zoom: number): { diagram: Diagram; a: Figure; b: Figure; panel: Visual }
{
    const a = Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); a.Id = 'a';
    const b = Figure.fromKind('rectangle', 200, 60, { width: 80,  height: 40 }); b.Id = 'b';
    const coll = new ObservableCollection<Figure>(); coll.Add(a); coll.Add(b);
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = coll;
    const target = new HeadlessTarget(800, 600);
    target.Content = diagram;
    diagram.SetCamera({ zoom, offsetX: 0, offsetY: 0 });
    target.Flush();
    // Enable AFTER the panel is live so the behavior binds to a real panel.
    diagram.AllowMarqueeSelection = true;
    const panel = diagram.ItemsPanelInstance as Visual;
    return { diagram, a, b, panel };
}

describe('MarqueeSelectionBehavior — camera zoom', () => {
    beforeEach(() => { initTestApp(); });

    test('marquee hit-tests in content space at zoom ≠ 1 (host rect is divided by Zoom)', () => {
        const zoom = 2;
        const { diagram, panel } = buildZoomedDiagram(zoom);

        // Calibrate host<->content so the drag is robust to any ruler/chrome
        // offset: HostToContent(0,0) = (-origin/zoom), so the host point for a
        // content coordinate is host = zoom * (content - HostToContent(0,0)).
        const o = diagram.HostToContent(0, 0);
        const hostFor = (cx: number, cy: number) => ({ x: zoom * (cx - o.X), y: zoom * (cy - o.Y) });

        // Drag a content-space box (5,15)-(115,75): it encloses figure a
        // (content 10..110, 20..70) and stays clear of b (content x ≥ 200).
        // The buggy translation-only path skips ÷Zoom, inflating the box to
        // ~(10,30)-(230,150) in content space — which wrongly grabs b.
        const p0 = hostFor(5, 15);
        const p1 = hostFor(115, 75);

        const im = new InputManager();
        im.InjectPointerDown(panel, pointer({ HostX: p0.x, HostY: p0.y }));
        im.InjectPointerMove(panel, pointer({ HostX: p1.x, HostY: p1.y }));
        im.InjectPointerUp  (panel, pointer({ HostX: p1.x, HostY: p1.y }));

        // The figures are their own containers here, so SelectedItems surfaces
        // them directly. The same content-space box selects only [a] at zoom 1;
        // at zoom 2 the buggy host-space rect is 2× too large and grabs b too.
        const ids = diagram.SelectedItems.map(it => (it as Figure).Id);
        assert.deepEqual(ids, ['a'], `expected only a selected, got ${JSON.stringify(ids)}`);
    });
});
