import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, type MountableTarget, Size, Visual } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Border, ItemsPanelTemplate, TextBlock } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { TextAutoFit } from '../shape-text.js';
import { TextNode } from '../text-node.js';
import { Diagram } from '../diagram.js';
import { Figure, resolveEditTarget } from '../figure.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

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

describe('M4 TextNode', () => {
    beforeEach(() => {
        initTestApp();
    });

    test('defaults: 120x44, empty label, GrowShape autofit', () => {
        const vm = new TextNode();
        assert.equal(vm.Width, 120);
        assert.equal(vm.Height, 44);
        assert.equal(vm.LabelText, '');
        assert.equal(vm.Text.AutoFit, TextAutoFit.GrowShape);
    });

    test('LabelText proxies Text.Content', () => {
        const vm = new TextNode();
        vm.LabelText = 'note';
        assert.equal(vm.Text.Content, 'note');
        vm.Text.Content = 'changed';
        assert.equal(vm.LabelText, 'changed');
    });

    test('edit target resolves to the node Text (Figure edit path)', () => {
        const vm = new TextNode();
        const calls: string[] = [];
        vm.Text.BeginEdit  = () => { calls.push('begin'); };
        vm.Text.CommitEdit = () => { calls.push('commit'); };
        vm.Text.CancelEdit = () => { calls.push('cancel'); };
        // A TextNode is a shapeless Figure with no wrapped content, so the
        // Figure edit path resolves the edit target to its own ShapeText.
        const target = resolveEditTarget(vm);
        assert.equal(target, vm.Text, 'edit target is the node Text');
        target!.BeginEdit();
        target!.CommitEdit();
        target!.CancelEdit();
        assert.deepEqual(calls, ['begin', 'commit', 'cancel']);
    });

    test('renders TextNode via [DataType=TextNode] DataTemplate into the container', () => {
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new PaginatedCanvas());
        const surface = new Border();
        surface.SetChild(diagram);
        const target = new FakeTarget();
        target.Content = surface;

        const vm = new TextNode();
        vm.LabelText = 'hello';
        const col = new ObservableCollection<TextNode>();
        col.Add(vm);
        diagram.ItemsSource = col;

        surface.Measure(new Size(800, 600));
        surface.Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);

        const container = diagram.Generator.ContainerFromItem(vm);
        assert.ok(container !== undefined, 'ContainerFromItem should return a container');
        assert.ok(container instanceof Figure, 'container should be a Figure');

        const visuals = collectVisuals(container);

        // The DataTemplate must not have fallen back to the error placeholder.
        const hasErrorBlock = visuals.some(
            v => v instanceof TextBlock
              && (v as TextBlock).Text.startsWith('can not resolve template'),
        );
        assert.ok(!hasErrorBlock, 'unresolved-template error TextBlock must not be present');

        // The template should render a Border (background rectangle).
        const hasBorder = visuals.some(v => v instanceof Border);
        assert.ok(hasBorder, 'DataTemplate should render a Border (background)');
    });
});
