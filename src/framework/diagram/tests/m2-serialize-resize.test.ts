// M2 interim shim: Figure save/load round-trip + container→VM resize chain.
// Part A (serialize): Figure nodes survive Save/Load via the legacy
//   {id,kind,left,top,w,h,d} record format.
// Part B (resize): container Width change propagates into VM.Geometry rebuild.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import {
    Application,
    ObservableCollection,
    Visual,
    type MountableTarget,
    Size,
} from '../../../runtime/index.js';
import { Border, ItemsPanelTemplate } from '../../../basic/index.js';
import { PaginatedCanvas } from '../../../basic/panels/paginated-canvas.js';
import { Diagram } from '../diagram.js';
import { DiagramDocument, type DiagramStorage } from '../diagram-document.js';
import { Figure } from '../figure.js';
import { GeometryCombineMode } from '../commands/combine.js';

// ── In-memory DiagramStorage (same pattern as diagram-document-connectors.test.ts) ──

class MemoryStorage implements DiagramStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function newDoc(storage?: DiagramStorage): DiagramDocument
{
    Application.current = null;
    new Application();
    return new DiagramDocument(storage);
}

// ── Part A: serialize round-trip (pure, no layout) ───────────────────

describe('DiagramDocument — Figure serialize round-trip (M2)', () => {
    test('CreateNode + Save + Load restores a Figure with correct Kind/Left/Top', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        const vm = doc.CreateNode('rectangle', 12, 34);
        assert.ok(vm !== null, 'CreateNode should return a Figure');
        assert.ok(vm instanceof Figure, 'CreateNode return value should be Figure');

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 1, 'Loaded document should have exactly 1 node');
        const restored = doc2.Nodes.Get(0)!;
        assert.ok(restored instanceof Figure, 'Restored node should be a Figure');
        const restoredVm = restored as Figure;
        assert.equal(restoredVm.Kind, 'rectangle', 'Restored Kind should be rectangle');
        assert.equal(restoredVm.Left, 12, 'Restored Left should be 12');
        assert.equal(restoredVm.Top,  34, 'Restored Top should be 34');
    });

    test('CombineSelection (fromSource) Figure round-trips with defined Geometry', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);

        // CombineSelection produces a fromSource VM with a custom d-string.
        const a = doc.CreateNode('rectangle',  0, 0)!;
        const b = doc.CreateNode('rectangle', 60, 0)!;
        doc.CombineSelection([a, b], GeometryCombineMode.Union);

        assert.equal(doc.Nodes.Count, 1, 'After combine, should have 1 node');

        doc.Save();

        const doc2 = newDoc(storage);
        doc2.Storage = storage;
        doc2.Load();

        assert.equal(doc2.Nodes.Count, 1, 'Loaded document should have 1 node');
        const restored = doc2.Nodes.Get(0)! as Figure;
        assert.ok(restored instanceof Figure, 'Restored combined node should be Figure');
        assert.notEqual(restored.Geometry, undefined, 'Restored combined node must have defined Geometry');
    });
});

// ── Part B: resize chain (container → VM → geometry) ─────────────────

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

describe('Figure — container→VM resize chain (M2)', () => {
    beforeEach(() => {
        initTestApp();
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

    test('setting container.Width propagates into vm.Geometry rebuild', () => {
        const { diagram, surface } = build();

        const vm = Figure.fromKind('rectangle', 30, 20);
        const col = new ObservableCollection<Figure>();
        col.Add(vm);
        diagram.ItemsSource = col;
        layout(surface);

        const container = diagram.Generator.ContainerFromItem(vm) as Figure;
        assert.ok(container instanceof Figure, 'ContainerFromItem should return a Figure');

        // Capture geometry before resize.
        const geometryBefore = vm.Geometry;
        assert.notEqual(geometryBefore, undefined, 'vm.Geometry should be defined after layout');

        // Simulate a resize by changing the container's Width — the two-way
        // binding should push into vm.Width, which triggers _rebuildGeometry.
        const newWidth = vm.Width + 40;
        container.Width = newWidth;

        // vm.Width should reflect the new width via the reverse binding.
        assert.equal(vm.Width, newWidth,
            'vm.Width should equal the new container width after reverse binding');
        // The geometry object should be a new instance (rebuilt by OnPropertyChanged).
        assert.notEqual(vm.Geometry, geometryBefore,
            'vm.Geometry should be a new object after container.Width change drives a rebuild');
    });
});
