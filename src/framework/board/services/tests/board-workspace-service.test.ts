import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { BoardDocument } from '../../board-document.js';
import { BoardWorkspaceService } from '../board-workspace-service.js';

describe('BoardWorkspaceService', () =>
{
    test('hosts a single in-memory BoardDocument with a default title', () =>
    {
        const svc = new BoardWorkspaceService(new ServiceProvider());
        assert.ok(svc.Document instanceof BoardDocument);
        assert.equal(svc.Document.Title, 'Untitled Board');
        assert.notEqual(svc.Document, null);
        assert.equal(svc.Document.IsDirty, false);
        // Opens EMPTY — content comes from the bound ArchModel or a .board file.
        assert.equal(svc.Document.Nodes.Count, 0);
        assert.equal(svc.Document.Connectors.Count, 0);
        assert.strictEqual(svc.Document, svc.Document);
        const other = new BoardWorkspaceService(new ServiceProvider());
        assert.notStrictEqual(svc.Document, other.Document);
    });

    test('Key is a ServiceKey', () =>
    {
        assert.ok(BoardWorkspaceService.Key instanceof ServiceKey);
    });
});
