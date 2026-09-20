import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import {
    Application,
    ModifierKeys,
    ObservableCollection,
    Visual,
    type MountableTarget,
    Size,
} from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate, TextBlock } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

class TestNodeVM extends NodeViewModel {}

// Walk the visual subtree depth-first and return every node encountered.
function collectVisuals(root: Visual): Visual[]
{
    const result: Visual[] = [];
    const stack: Visual[] = [root];
    while (stack.length > 0)
    {
        const v = stack.pop()!;
        result.push(v);
        for (const child of v.visualChildren)
        {
            stack.push(child);
        }
    }
    return result;
}

describe('Diagram — NodeViewModel container content + position binding (m1)', () => {
    beforeEach(() => {
        initTestApp();
        // Register a DataTemplate for TestNodeVM so the Diagram can resolve it
        // from the application resource dictionary (implicit DataType lookup).
        Application.current!.Resources.Set(
            TestNodeVM,
            new DataTemplate((_d) => {
                const b = new Border();
                b.SetChild(new TextBlock('vm'));
                return b;
            }, TestNodeVM),
        );
    });

    function build(): { diagram: Diagram; surface: Border }
    {
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;
        return { diagram, surface };
    }

    function layout(surface: Border): void
    {
        surface.Measure(new Size(800, 600));
        surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    }

    test('renders the DataTemplate into the container', () => {
        const { diagram, surface } = build();
        const vm = new TestNodeVM();
        const col = new ObservableCollection<TestNodeVM>();
        col.Add(vm);
        diagram.ItemsSource = col;
        layout(surface);

        const container = diagram.Generator.ContainerFromItem(vm);
        assert.ok(container !== undefined, 'ContainerFromItem should return a container');
        assert.ok(container instanceof Figure, 'container should be a Figure');

        // Walk the entire visual subtree of the container Figure.
        const visuals = collectVisuals(container);

        // Direct proof the DataTemplate resolved + rendered: its own
        // TextBlock('vm') must be in the subtree. (A bare `instanceof Border`
        // check would false-positive on the Figure template's own
        // PART_LabelHost Border, which is always present.)
        const hasTemplateContent = visuals.some(
            v => v instanceof TextBlock && (v as TextBlock).Text === 'vm',
        );
        assert.ok(hasTemplateContent, "DataTemplate's TextBlock('vm') should be present in the Figure subtree");

        // And the "can not resolve template" fallback TextBlock must not appear.
        const hasErrorBlock = visuals.some(
            v => v instanceof TextBlock
              && (v as TextBlock).Text.startsWith('can not resolve template'),
        );
        assert.ok(!hasErrorBlock, 'unresolved-template error TextBlock must not be present');
    });

    test('container owns geometry + mirrors the VM Id; VM stays content-only', () => {
        const { diagram, surface } = build();
        const vm = new TestNodeVM();
        vm.Id = 'v1';

        const col = new ObservableCollection<TestNodeVM>();
        col.Add(vm);
        diagram.ItemsSource = col;
        layout(surface);

        const container = diagram.Generator.ContainerFromItem(vm) as Figure;
        assert.ok(container instanceof Figure, 'container must be a Figure');

        // The container carries the geometry (owner) — set directly (production
        // seeds it from the NodeVisualStore). The VM has no geometry to reflect.
        container.Left = 60; container.Top = 30;
        assert.equal(container.Left, 60);
        assert.equal(container.Top,  30);
        assert.equal((vm as unknown as { Left?: number }).Left, undefined, 'VM carries no geometry');

        // The container mirrors the VM Id (so container-bound connector endpoints
        // serialize by the node's stable id) and is a content tile.
        assert.equal(container.Id, 'v1', 'container mirrors the VM Id');
        assert.equal(container.SizeToContent, true, 'a VM container fits its content');
    });

    test('selection surfaces the VM, not the container Figure', () => {
        const { diagram, surface } = build();
        const vm = new TestNodeVM();

        const col = new ObservableCollection<TestNodeVM>();
        col.Add(vm);
        diagram.ItemsSource = col;
        layout(surface);

        const container = diagram.Generator.ContainerFromItem(vm) as Figure;
        assert.ok(container instanceof Figure, 'container must be a Figure');

        diagram.HandleContainerClick(container, ModifierKeys.None);
        assert.equal(diagram.SelectedItem, vm, 'SelectedItem should be the VM, not the Figure container');
    });
});
