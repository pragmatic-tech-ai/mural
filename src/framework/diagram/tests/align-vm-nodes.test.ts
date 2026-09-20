// Align/distribute must operate on content-VM nodes too. Under container-owned-
// geometry the selected item is a geometry-less VM; DiagramCommands._collectSelected
// resolves it to its container Figure so the align/distribute commands can read and
// write its bounds. Without the resolve the VM fails the _isFigureShape filter, the
// node is dropped from the operation, and canAlign disables the toolbar entirely.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection, Size, ModifierKeys, Visual } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SelectionMode } from '../../list/list-box.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { NodeViewModel } from '../node-view-model.js';

// Three content-VM nodes, each wrapped in a container Figure that owns geometry.
function mountVMs(): { diagram: Diagram; vms: NodeViewModel[]; conts: Figure[] }
{
    Application.current = null; new Application();
    const vms = [0, 1, 2].map((i) => { const v = new NodeViewModel(); v.Id = 'v' + i; return v; });
    const coll = new ObservableCollection<NodeViewModel>(); vms.forEach((v) => coll.Add(v));
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: Visual }).Child = diagram;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    const conts = vms.map((v) => diagram.Generator.ContainerFromItem(v) as Figure);
    // Staggered lefts; equal size.
    conts[0]!.Left = 10;  conts[0]!.Top = 10; conts[0]!.Width = 40; conts[0]!.Height = 30;
    conts[1]!.Left = 100; conts[1]!.Top = 50; conts[1]!.Width = 40; conts[1]!.Height = 30;
    conts[2]!.Left = 300; conts[2]!.Top = 90; conts[2]!.Width = 40; conts[2]!.Height = 30;
    return { diagram, vms, conts };
}

function select(diagram: Diagram, item: unknown, mods: ModifierKeys): void
{
    const container = diagram.Generator.ContainerFromItem(item);
    if (container === undefined) throw new Error('no container');
    diagram.HandleContainerClick(container, mods);
}

describe('align/distribute on content-VM nodes', () => {
    test('AlignLeft is enabled and aligns the container Figures', () => {
        const { diagram, vms, conts } = mountVMs();
        select(diagram, vms[0], ModifierKeys.None);
        select(diagram, vms[1], ModifierKeys.Control);
        const cmd = diagram.AlignLeftCommand;
        assert.ok(cmd !== undefined, 'AlignLeft command present');
        assert.equal(cmd!.CanExecute(undefined), true, 'enabled with 2 content nodes selected');
        cmd!.Execute(undefined);
        assert.equal(conts[0]!.Left, 10, 'anchor stays');
        assert.equal(conts[1]!.Left, 10, 'second container aligned to min left');
    });

    test('DistributeHorizontal spreads three container Figures evenly', () => {
        const { diagram, vms, conts } = mountVMs();
        select(diagram, vms[0], ModifierKeys.None);
        select(diagram, vms[1], ModifierKeys.Control);
        select(diagram, vms[2], ModifierKeys.Control);
        const cmd = diagram.DistributeHorizontalCommand;
        assert.ok(cmd !== undefined && cmd.CanExecute(undefined) === true, 'enabled with 3 content nodes');
        cmd!.Execute(undefined);
        // Ends pinned; middle repositioned so the inter-node gaps are equal.
        assert.equal(conts[0]!.Left, 10);
        assert.equal(conts[2]!.Left, 300);
        const gapA = conts[1]!.Left - (conts[0]!.Left + conts[0]!.Width);
        const gapB = conts[2]!.Left - (conts[1]!.Left + conts[1]!.Width);
        assert.ok(Math.abs(gapA - gapB) < 1e-6, 'equal gaps after distribute');
    });
});
