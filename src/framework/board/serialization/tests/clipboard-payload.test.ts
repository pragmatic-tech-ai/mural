import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeClipboard, decodeClipboard, CLIPBOARD_KIND } from '../clipboard-payload.js';

describe('clipboard-payload — encode / decode', () => {
    test('round-trips a payload through the tagged envelope', () => {
        const payload = {
            nodes:      [{ id: 'n1', type: 'shape', data: { kind: 'rectangle' } }],
            visuals:    { n1: { left: 10, top: 20, w: 80, h: 60 } },
            connectors: [{ source: { nodeId: 'n1' }, target: { nodeId: 'n2' } }],
        };
        const decoded = decodeClipboard(encodeClipboard(payload));
        assert.deepEqual(decoded, payload);
    });

    test('the envelope carries the kind marker', () => {
        const text = encodeClipboard({ nodes: [], visuals: {}, connectors: [] });
        assert.ok(JSON.parse(text).kind === CLIPBOARD_KIND);
    });

    test('foreign clipboard text (plain string) decodes to undefined', () => {
        assert.equal(decodeClipboard('just some copied text'), undefined);
    });

    test('untagged JSON decodes to undefined', () => {
        assert.equal(decodeClipboard('{"nodes":[],"foo":1}'), undefined);
    });

    test('missing sections default to empty rather than throwing', () => {
        const text = JSON.stringify({ kind: CLIPBOARD_KIND, version: 1 });
        assert.deepEqual(decodeClipboard(text), { nodes: [], visuals: {}, connectors: [] });
    });
});
