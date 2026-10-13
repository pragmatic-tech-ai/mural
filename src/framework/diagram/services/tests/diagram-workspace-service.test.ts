import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { DiagramDocument } from '../../diagram-document.js';
import { DiagramWorkspaceService } from '../diagram-workspace-service.js';

describe('DiagramWorkspaceService', () =>
{
    test('hosts a single in-memory DiagramDocument with a default title', () =>
    {
        const svc = new DiagramWorkspaceService(new ServiceProvider());
        assert.ok(svc.Document instanceof DiagramDocument);
        assert.equal(svc.Document.Title, 'Untitled Diagram');
        assert.notEqual(svc.Document, null);
        assert.equal(svc.Document.IsDirty, false);
        // Opens EMPTY — content comes from the bound ArchModel or a .diagram file.
        assert.equal(svc.Document.Nodes.Count, 0);
        assert.equal(svc.Document.Connectors.Count, 0);
        assert.strictEqual(svc.Document, svc.Document);
        const other = new DiagramWorkspaceService(new ServiceProvider());
        assert.notStrictEqual(svc.Document, other.Document);
    });

    test('Key is a ServiceKey', () =>
    {
        assert.ok(DiagramWorkspaceService.Key instanceof ServiceKey);
    });
});
