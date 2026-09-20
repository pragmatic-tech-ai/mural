import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import {
    DataContextBinding,
    Size,
    Visual,
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../basic/index.js';
import { PaginatedCanvas } from '../../basic/panels/paginated-canvas.js';
import { Diagram } from '../diagram/diagram.js';
import { DiagramDocument } from '../diagram/diagram-document.js';
import { SelectionMode } from '../list/list-box.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

// Regression coverage for the items-are-Figures architecture: distribute
// must move Figure.Left/Top directly AND surface in the visual arrange
// pass. Mirrors the diagram demo's wiring (ReflectSelectionToItems +
// AlignmentGuidesEnabled + SelectionResizeEnabled + framework theme).
describe('Diagram — Distribute on Figure items (new arch, with framework theme)', () => {
    beforeEach(() => { initTestApp(); });

    function build(): { diagram: Diagram; doc: DiagramDocument; surface: Border }
    {
        const doc = new DiagramDocument();
        const diagram = new Diagram();
        diagram.SelectionMode = SelectionMode.Extended;
        diagram.ItemsPanel    = new ItemsPanelTemplate(() => new PaginatedCanvas());
        diagram.ReflectSelectionToItems = true;
        diagram.SelectionResizeEnabled  = true;
        diagram.AlignmentGuidesEnabled  = true;
        diagram.ItemsSource   = doc.Nodes;
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        return { diagram, doc, surface };
    }

    function layout(surface: Border): void
    {
        surface.Measure(new Size(800, 600));
        surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    }

    function selectAll(diagram: Diagram, items: readonly unknown[]): void
    {
        items.forEach((item, i) => {
            const mods = i === 0
                ? ModifierKeys.None
                : ModifierKeys.Control;
            // Items are now NodeViewModels; resolve the Figure container so
            // HandleContainerClick receives an actual Visual.
            const container = diagram.Generator.ContainerFromItem(item) ?? (item as Visual);
            diagram.HandleContainerClick(container, mods);
        });
    }

    test('DistributeHorizontal moves middle Figure + visual updates', () => {
        const { diagram, doc, surface } = build();
        const rectOf = (vm: unknown) => diagram.Generator.ContainerFromItem(vm)?.ArrangedRect;
        const a = doc.CreateNode('rectangle',  10, 50)!;
        const b = doc.CreateNode('ellipse',    50, 50)!;
        const c = doc.CreateNode('heart',     200, 50)!;
        layout(surface);
        selectAll(diagram, [a, b, c]);
        diagram.DistributeHorizontalCommand?.Execute();
        layout(surface);
        assert.equal(b.Left, 105);
        assert.equal(rectOf(b)?.X, 105);
    });

    test('DistributeVertical moves middle Figure + visual updates', () => {
        const { diagram, doc, surface } = build();
        const rectOf = (vm: unknown) => diagram.Generator.ContainerFromItem(vm)?.ArrangedRect;
        const a = doc.CreateNode('rectangle', 50,  10)!;
        const b = doc.CreateNode('ellipse',   50,  50)!;
        const c = doc.CreateNode('heart',     50, 200)!;
        layout(surface);
        selectAll(diagram, [a, b, c]);
        diagram.DistributeVerticalCommand?.Execute();
        layout(surface);
        assert.equal(b.Top, 105);
        assert.equal(rectOf(b)?.Y, 105);
    });

    test('AlignMiddle centres each Figure on bbox midline + visual updates', () => {
        const { diagram, doc, surface } = build();
        const rectOf = (vm: unknown) => diagram.Generator.ContainerFromItem(vm)?.ArrangedRect;
        const a = doc.CreateNode('rectangle',  0,   0)!;
        const b = doc.CreateNode('ellipse',   50,  50)!;
        const c = doc.CreateNode('heart',    100, 200)!;
        layout(surface);
        const expectedMidY = (a.Top + Math.max(a.Top + a.Height, b.Top + b.Height, c.Top + c.Height)) / 2;
        selectAll(diagram, [a, b, c]);
        diagram.AlignMiddleCommand?.Execute();
        layout(surface);
        assert.equal(a.Top, expectedMidY - a.Height / 2);
        assert.equal(b.Top, expectedMidY - b.Height / 2);
        assert.equal(c.Top, expectedMidY - c.Height / 2);
        assert.equal(rectOf(a)?.Y, expectedMidY - a.Height / 2);
    });

    test('Mutator auto-wires from DataContext when DC implements DiagramMutator', () => {
        // Mirrors the diagram demo's wiring after the $Self semantic
        // fix: DataContext is the DiagramDocument; Mutator is NOT set
        // in markup. The Diagram detects that the DC duck-types
        // DiagramMutator and auto-installs it. Combine should now
        // mutate Nodes end-to-end.
        const { diagram, doc, surface } = build();
        diagram.DataContext = doc;
        assert.equal(diagram.Mutator, doc, 'Auto-wire should have installed doc as Mutator');
        const a = doc.CreateNode('rectangle',  0, 0)!;
        const b = doc.CreateNode('rectangle', 40, 0)!;
        layout(surface);
        selectAll(diagram, [a, b]);
        const before = doc.Nodes.Count;
        diagram.CombineUnionCommand?.Execute();
        layout(surface);
        assert.equal(doc.Nodes.Count, before - 1,
            `Combine should have collapsed ${before} nodes to ${before - 1}; got ${doc.Nodes.Count}.`);
    });

    test('$Self in DataContextBinding resolves to the control, not DataContext.Self', () => {
        // Regression for the $Self semantic. `DataContextBinding(target,
        // "Self")` (what the compiler emits for `$Self`) must return
        // `target` regardless of what the target's DataContext exposes.
        // Pre-fix this walked DataContext.Self and silently resolved to
        // undefined when no Self DP existed — the root cause of the
        // "shape-op buttons do nothing" bug.
        const { diagram } = build();
        const binding = DataContextBinding(diagram, 'Self');
        assert.equal(binding.get_value(), diagram, '$Self should resolve to the target Visual');
    });

    test('Explicit Mutator write survives a DataContext swap', () => {
        // Consumer-controlled override beats auto-wire. After an
        // explicit Mutator set, swapping DataContext must not clobber it.
        const { diagram, doc } = build();
        const customMutator = {
            Group:            (): void => {},
            Ungroup:          (): void => {},
            CombineSelection: (): void => {},
            DeleteNodes:      (): void => {},
            CreateNode:       (): unknown => undefined,
        };
        diagram.Mutator     = customMutator;
        diagram.DataContext = doc;
        assert.equal(diagram.Mutator, customMutator, 'DC swap must not override explicit Mutator');
    });

    test('Mutator auto-wires when DataContext arrives via INHERITANCE (template materialization order)', () => {
        // The real demo materializes a DataTemplate: the Border root is
        // constructed; its descendants (including the Diagram) are
        // constructed during the factory; DataContext is set on the
        // root AFTER and inherits down to the Diagram. This test mirrors
        // that order so we know the auto-wire fires for inherited DC,
        // not just imperative writes on the Diagram itself.
        const doc = new DiagramDocument();
        const diagram = new Diagram();
        diagram.SelectionMode = SelectionMode.Extended;
        diagram.ItemsPanel    = new ItemsPanelTemplate(() => new PaginatedCanvas());
        diagram.ItemsSource   = doc.Nodes;
        diagram.ReflectSelectionToItems = true;
        diagram.SelectionResizeEnabled  = true;
        diagram.AlignmentGuidesEnabled  = true;
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        // ── At this point Mutator is still undefined (no DataContext yet).
        assert.equal(diagram.Mutator, undefined, 'Pre-DC sanity: Mutator should be undefined');
        // ── Now set DataContext on the root; inheritance pushes it down.
        surface.DataContext = doc;
        layout(surface);
        assert.equal(diagram.DataContext, doc, 'DC must inherit from root → Diagram');
        assert.equal(diagram.Mutator, doc, 'Auto-wire must trigger on inherited DC change');
    });

    test('End-to-end: drop on Diagram-as-DropReceiver with auto-wired Mutator creates a node', async () => {
        // Mirrors the diagram demo exactly: DropReceiver = $Self (the
        // Diagram itself), Mutator auto-wired off DataContext. A drop
        // carrying the toolbox-item format should run through canvas-drop
        // behavior → ItemDropped → mutator.CreateNode → Nodes.Add.
        const { Application } = await import('../../runtime/index.js');
        const { DragEventArgs, dispatchDrag } = await import('../../visual-engine/index.js');
        const { DataObject, DragDropEffects, NoModifiers } = await import('../../runtime/index.js');
        const { TOOLBOX_ITEM_FORMAT } = await import('../diagram/behaviors/canvas-drop-behavior.js');
        Application.current = null;
        new Application();

        const doc = new DiagramDocument();
        const diagram = new Diagram();
        diagram.SelectionMode = SelectionMode.Extended;
        diagram.ItemsPanel    = new ItemsPanelTemplate(() => new PaginatedCanvas());
        diagram.ItemsSource   = doc.Nodes;
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        surface.DataContext = doc;
        layout(surface);
        // Pin DropReceiver via $Self semantic — same as the demo's markup.
        diagram.set_property_value(Diagram.DropReceiverKey, DataContextBinding(diagram, 'Self'));
        assert.equal(diagram.DropReceiver, diagram, 'DropReceiver should be Diagram itself');
        assert.equal(diagram.Mutator,      doc,     'Mutator auto-wired off DC');

        const before = doc.Nodes.Count;
        const data = new DataObject();
        // The built-in Shapes page (first-inited by the Diagram ctor) carries a
        // "shape:rectangle" item; the router resolves it to the shape factory,
        // which calls mutator.CreateNode → Nodes.Add.
        data.Set(TOOLBOX_ITEM_FORMAT, 'shape:rectangle');
        const args = new DragEventArgs('Drop', diagram, {
            HostX: 200, HostY: 150, Modifiers: NoModifiers,
            Data: data, AllowedEffects: DragDropEffects.All, Session: undefined,
        });
        dispatchDrag(args);
        assert.equal(doc.Nodes.Count, before + 1,
            `Drop should add a node; before=${before}, after=${doc.Nodes.Count}`);
    });

    test('DropReceiver = $Self installs canvas-drop behavior on the Diagram', () => {
        // Repro for "drag & drop from toolbox does not work" after the
        // $Self semantic change. `DropReceiver = $Self` should resolve
        // to the Diagram itself; the Diagram then attaches its canvas-
        // drop behavior to that receiver. We verify by reading
        // DropReceiver back through the DP.
        const { diagram } = build();
        diagram.set_property_value(Diagram.DropReceiverKey, DataContextBinding(diagram, 'Self'));
        assert.equal(diagram.DropReceiver, diagram,
            `DropReceiver after $Self binding install should be the Diagram itself; got ${String(diagram.DropReceiver)}`);
    });

    test('Dragging a Figure inside a Group moves the entire group (items-are-Figures)', () => {
        // Repro for "can not move a group on the canvas". Set up a
        // diagram with 3 figures, group them, then synthesize a drag
        // gesture on one member — partners should follow and the Group
        // bbox should track.
        const { diagram, doc, surface } = build();
        diagram.DataContext = doc;
        const a = doc.CreateNode('rectangle', 100, 100)!;
        const b = doc.CreateNode('ellipse',   300, 200)!;
        const c = doc.CreateNode('heart',     500, 350)!;
        layout(surface);
        // Group via Mutator (auto-wired). After Group: members keep
        // their positions, a Group entity sits in Nodes at the union.
        doc.Group([a, b, c]);
        layout(surface);
        const groups = [];
        for (let i = 0; i < doc.Nodes.Count; i++)
        {
            const n = doc.Nodes.Get(i);
            if ((n as { Members?: unknown }).Members !== undefined) groups.push(n);
        }
        assert.equal(groups.length, 1, 'one group created');
        const grp = groups[0] as { Left: number; Top: number; Width: number; Height: number };

        // Sanity: group bbox = union of members.
        assert.equal(grp.Left, 100,  'group Left at member-min');
        assert.equal(grp.Top,  100,  'group Top at member-min');

        // Synthesize a drag on `a` via the container Figure's PointerDown/Move.
        // VM members' pointer handlers live on the wrapping Figure container.
        // PointerDown at (150, 150) — inside A. PointerMove to (200, 170).
        // Expected delta on a: +50, +20. Same delta on b and c.
        const fa = diagram.Generator.ContainerFromItem(a) as unknown as {
            OnPointerDown(a: unknown): void; OnPointerMove(a: unknown): void;
        };
        const argsDown = {
            Kind: 'PointerDown' as const, Source: fa, Visual: fa,
            HostX: 150, HostY: 150, PointerId: 0,
            Modifiers: ModifierKeys.None,
            Handled: false,
            CapturePointer: () => {},
            ReleasePointerCapture: () => {},
        };
        fa.OnPointerDown(argsDown);

        const argsMove = { ...argsDown, Kind: 'PointerMove' as const, HostX: 200, HostY: 170, Handled: false };
        fa.OnPointerMove(argsMove);

        assert.equal(a.Left, 150, 'A.Left after drag');
        assert.equal(b.Left, 350, 'B.Left should shift along with A');
        assert.equal(c.Left, 550, 'C.Left should shift along with A');
        assert.equal(grp.Left, 150, 'Group bbox follows members');
    });

    test('AlignCenter with a Group in the selection preserves intra-group spacing', () => {
        // Repro for "distance between shapes in the group was eaten
        // during the alignment". When the user marquee-selects across
        // a group, the leaf Figures end up in SelectedItems directly
        // (not the Group). alignCenter then collapses each onto the
        // shared midline, losing the group's internal layout. The fix
        // walks each selection entry up to its top-level ancestor, so
        // a Group's members are treated as a single rigid entity whose
        // Left setter translates them all together.
        const { diagram, doc, surface } = build();
        diagram.DataContext = doc;
        const standalone = doc.CreateNode('rectangle', 0, 0)!;
        const m1 = doc.CreateNode('ellipse', 200, 100)!;
        const m2 = doc.CreateNode('heart',   300, 100)!;
        layout(surface);
        doc.Group([m1, m2]);
        layout(surface);
        // Pre-alignment spacing inside the group: m2.Left - m1.Left.
        const preSpacing = m2.Left - m1.Left;
        assert.equal(preSpacing, 100, 'pre-spacing sanity');

        // Selection that mimics a marquee dragging across the canvas:
        // it picks the LEAVES of the group, not the Group itself.
        // VM members' pointer handlers live on the wrapping Figure container —
        // use ContainerFromItem so HandleContainerClick receives an actual Visual.
        const clk = (vm: unknown) =>
            diagram.HandleContainerClick(
                diagram.Generator.ContainerFromItem(vm) as unknown as Visual,
                ModifierKeys.Control);
        diagram.HandleContainerClick(
            diagram.Generator.ContainerFromItem(standalone) as unknown as Visual,
            ModifierKeys.None);
        clk(m1);
        clk(m2);

        diagram.AlignCenterCommand?.Execute();
        layout(surface);

        const postSpacing = m2.Left - m1.Left;
        assert.equal(postSpacing, preSpacing,
            `Intra-group spacing must survive AlignCenter; pre=${preSpacing}, post=${postSpacing}`);
    });

    test('Auto-wired Mutator releases when DataContext swaps to non-mutator', () => {
        // The withdraw-on-DC-change branch: auto-wired mutators must
        // detach when the new DataContext doesn't satisfy the surface,
        // so the stale instance doesn't keep handling events.
        const { diagram, doc } = build();
        diagram.DataContext = doc;
        assert.equal(diagram.Mutator, doc);
        diagram.DataContext = { unrelated: 'object' };
        assert.equal(diagram.Mutator, undefined, 'Stale auto-wired mutator must be withdrawn');
    });

});
