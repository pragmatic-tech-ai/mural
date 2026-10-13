import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { FileDiagramStorage } from '../file-diagram-storage.js';

// FileDiagramStorage bridges mural's synchronous DiagramStorage seam onto an
// async IStorage: reads serve an in-memory snapshot, writes fire in the
// background and are awaited via WhenWritten(). These verify that bridge against
// a FakeStorage (no Electron, no disk).
describe('FileDiagramStorage', () =>
{
    test('GetItem serves the seed snapshot before any write', () =>
    {
        const store = new FileDiagramStorage('a.diagram', new FakeStorage(), '{"seed":true}');
        assert.equal(store.GetItem('ignored-key'), '{"seed":true}');
    });

    test('GetItem is null when opened with no seed', () =>
    {
        const store = new FileDiagramStorage('a.diagram', new FakeStorage(), null);
        assert.equal(store.GetItem('ignored-key'), null);
    });

    test('SetItem updates the snapshot synchronously and persists to storage', async () =>
    {
        const storage = new FakeStorage();
        const store = new FileDiagramStorage('diagrams/a.diagram', storage, null);

        store.SetItem('ignored-key', '{"nodes":[]}');
        assert.equal(store.GetItem('ignored-key'), '{"nodes":[]}');   // visible immediately

        await store.WhenWritten();
        assert.equal(await storage.ReadText('diagrams/a.diagram'), '{"nodes":[]}');
    });

    test('the storage key is ignored - a file is one slot', () =>
    {
        const store = new FileDiagramStorage('a.diagram', new FakeStorage(), 'v');
        assert.equal(store.GetItem('k1'), 'v');
        assert.equal(store.GetItem('k2'), 'v');
    });
});
