// A Figure's Fill / Stroke are user-editable via the Format Shape pane and
// MUST survive Save / Load — the serializer used to persist only kind + geometry,
// so a fill-colour change was silently lost on reopen.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Color, Pen, SolidColorBrush } from '../../../visual-engine/index.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';
import { Figure } from '../figure.js';

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function newDoc(storage?: BoardStorage): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument(storage);
}

describe('Figure — Fill / Stroke Save / Load round-trip', () => {
    test('a changed fill and stroke survive Save / Load', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const vm = doc.CreateNode('ellipse', 40, 40)!;
        vm.Fill   = new SolidColorBrush(Color.FromHex('#00ff00'));
        vm.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#ff0000')), 3);
        doc.Save();

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();

        const node = restored.Nodes.Get(0) as Figure;
        assert.ok(node instanceof Figure);
        assert.ok(node.Fill instanceof SolidColorBrush, 'fill is a solid brush');
        assert.equal((node.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#00ff00');
        assert.ok(node.Stroke instanceof Pen, 'stroke is a pen');
        assert.equal((node.Stroke!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#ff0000');
        assert.equal(node.Stroke!.Thickness, 3, 'stroke width round-trips');
    });

    test('an unchanged shape still round-trips its default fill', () => {
        const storage = new MemoryStorage();
        const doc = newDoc(storage);
        const vm = doc.CreateNode('rectangle', 0, 0)!;
        const defaultHex = (vm.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7);
        doc.Save();

        const restored = newDoc(storage);
        restored.Storage = storage;
        restored.Load();
        const node = restored.Nodes.Get(0) as Figure;
        assert.equal((node.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), defaultHex);
    });
});
