import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { ClipboardService } from '../clipboard-service.js';

describe('ClipboardService', () =>
{
    test('forwards written text to the injected writer', async () =>
    {
        const written: string[] = [];
        const svc = new ClipboardService(new ServiceProvider(), async (t) => { written.push(t); });
        await svc.WriteText('hello');
        assert.deepEqual(written, ['hello']);
    });

    test('Key is a ServiceKey', () =>
    {
        assert.ok(ClipboardService.Key instanceof ServiceKey);
    });
});
