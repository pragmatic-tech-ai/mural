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

// Rotation + scale baseline are geometry — they live in the v3 `visuals`
// section (keyed by id), not in the shape serializer's content `data`.
describe('shape rotation + base size round-trip (v3 visuals)', () => {
    test('rotation + scaled size (baseWidth != width) survive save/load', () => {
        const s = new Mem(); const d = doc(s);
        const f = Figure.fromKind('rectangle', 5, 6, { width: 120, height: 60 }); f.Id = 'n1';
        f.Rotation = 45; f.Width = 240;   // scaled 2x from base 120
        d.Nodes.Add(f); d.Save();

        const raw = JSON.parse(s.GetItem('mural-diagram-state-v1')!) as {
            nodes: Array<{ data?: { rotation?: unknown } }>;
            visuals: Record<string, { rotation?: number; baseWidth?: number }>;
        };
        assert.equal(raw.nodes[0]!.data?.rotation, undefined, 'rotation is not in node content');
        assert.equal(raw.visuals.n1!.rotation, 45);
        assert.equal(raw.visuals.n1!.baseWidth, 120);

        const d2 = doc(s); d2.Storage = s; d2.Load();
        const back = d2.Nodes.Get(0)! as Figure;
        assert.equal(back.Rotation, 45);
        assert.equal(back.BaseWidth, 120);
        assert.equal(back.Width, 240);
    });
    test('a shape with no rotation loads as rotation 0, base = size', () => {
        const s = new Mem(); const d = doc(s);
        const f = Figure.fromKind('rectangle', 0, 0, { width: 80, height: 40 }); f.Id = 'n2';
        d.Nodes.Add(f); d.Save();

        const d2 = doc(s); d2.Storage = s; d2.Load();
        const back = d2.Nodes.Get(0)! as Figure;
        assert.equal(back.Rotation, 0);
        assert.equal(back.BaseWidth, 80);
        assert.equal(back.BaseHeight, 40);
    });
});
