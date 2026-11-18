// SP4: the deserialize fallback id generator ('n' + counter) must not collide
// with an explicit inbound id. A fresh doc's _nextId starts at 1, so an empty-id
// node would regenerate 'n1' — clashing with an explicit 'n1' in the same
// payload and overwriting it in the byId map.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';

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

describe('BoardDocument deserialize — id-collision guard', () => {
    test('an empty-id node does not collide with an explicit "n1"', () => {
        const storage = new MemoryStorage();
        // v3 records: one explicit id 'n1', one empty id. With _nextId starting
        // at 1, the empty-id fallback would regenerate 'n1'.
        storage.SetItem('mural-board-state-v1', JSON.stringify({
            version: 3,
            nodes: [
                { id: 'n1', type: 'shape', data: { kind: 'rectangle', d: '' } },
                { id: '',   type: 'shape', data: { kind: 'rectangle', d: '' } },
            ],
            visuals: {
                n1: { left: 0,  top: 0, w: 60, h: 40 },
                '': { left: 80, top: 0, w: 60, h: 40 },
            },
            connectors: [],
            nextId: 1,
        }));

        const doc = newDoc(storage);
        doc.Storage = storage;
        doc.Load();

        const ids = doc.Nodes.ToArray().map((n) => (n as { Id?: string }).Id);
        assert.equal(ids.length, 2, 'both nodes present');
        assert.equal(new Set(ids).size, 2, `ids must be unique, got ${JSON.stringify(ids)}`);
        assert.ok(ids.includes('n1'), 'explicit id preserved');
    });
});
