import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application, MuralBase, ObservableCollection, Observable, Binding,
    type MountableTarget, Visual, Size,
} from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Diagram } from '../diagram.js';
import { Connector } from '../connector.js';

// A plain source VM exposing an ObservableCollection the Diagram's
// Connectors DP binds to — mirrors `Connectors=$Connectors` in markup.
class GraphVM extends Observable
{
    public readonly Connectors = new ObservableCollection<MuralBase>();
}

// A non-Connector edge item, so materialization goes through
// ConnectorTemplate (a Connector item would bypass the template via the
// items-are-Connectors convention in the materializer's _instantiate).
class EdgeItem extends MuralBase {}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void {}
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

describe('Diagram.Connectors identity guard', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('a bound collection materializes each connector once, not O(M^2)', () => {
        const vm = new GraphVM();
        const diagram = new Diagram();
        diagram.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());

        // Counting template: one Apply == one connector materialization.
        let applies = 0;
        diagram.ConnectorTemplate = new DataTemplate(() => { applies++; return new Connector(); });

        // Bind the Connectors DP to vm.Connectors (installs the collection +
        // the pulse-on-mutation channel — same as markup binding).
        diagram.set_property_value(Diagram.ConnectorsKey, new Binding(vm as unknown as never, 'Connectors'));

        // Mount so the items panel exists and connectors can mount.
        const surface = new Border();
        (surface as unknown as { Child: Visual }).Child = diagram;
        const target = new FakeTarget();
        target.Content = surface;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);

        const M = 50;
        for (let i = 0; i < M; i++)
        {
            vm.Connectors.Add(new EdgeItem());   // each Add pulses the bound DP
        }

        // With the guard: exactly M materializations. Without it, the pulse
        // re-materializes ALL current connectors each Add => M(M+1)/2.
        assert.equal(applies, M, `expected ${M} materializations, got ${applies}`);
    });
});
