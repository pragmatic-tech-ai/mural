import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { DiagramDocument, type DiagramStorage } from '../diagram-document.js';
import { Figure } from '../figure.js';

class Mem implements DiagramStorage
{
    private m = new Map<string, string>();
    GetItem(k: string): string | null { return this.m.get(k) ?? null; }
    SetItem(k: string, v: string): void { this.m.set(k, v); }
}
function doc(s?: DiagramStorage): DiagramDocument { Application.current = null; new Application(); return new DiagramDocument(s); }

describe('v3 two-section serialization', () => {
    test('save emits {version:3, nodes(content-only), visuals}', () => {
        const s = new Mem(); const d = doc(s);
        const f = Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); f.Id = 'n1'; f.Rotation = 45;
        d.Nodes.Add(f); d.Save();
        const raw = JSON.parse(s.GetItem('mural-diagram-state-v1')!) as {
            version: number;
            nodes: Array<{ id: string; type: string; left?: number; data?: unknown }>;
            visuals: Record<string, { left: number; rotation?: number }>;
        };
        assert.equal(raw.version, 3);
        assert.equal(raw.nodes[0]!.id, 'n1');
        assert.equal(raw.nodes[0]!.left, undefined, 'no inline geometry on the node record');
        assert.equal(raw.visuals.n1!.left, 10);
        assert.equal(raw.visuals.n1!.rotation, 45);
    });
    test('round-trip restores geometry + rotation via the visuals section', () => {
        const s = new Mem(); const d = doc(s);
        const f = Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); f.Id = 'n1'; f.Rotation = 45;
        d.Nodes.Add(f); d.Save();
        const d2 = doc(s); d2.Storage = s; d2.Load();
        const r = d2.Nodes.Get(0)! as Figure;
        assert.equal(r.Left, 10); assert.equal(r.Width, 100); assert.equal(r.Rotation, 45);
    });
});
