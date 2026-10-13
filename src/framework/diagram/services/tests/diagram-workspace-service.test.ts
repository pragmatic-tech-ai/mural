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
        assert.equal(svc.Document, svc.Document);
    });

    test('Key is a ServiceKey', () =>
    {
        assert.ok(DiagramWorkspaceService.Key instanceof ServiceKey);
    });
});
