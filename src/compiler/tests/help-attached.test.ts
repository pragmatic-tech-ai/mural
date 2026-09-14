import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';

describe('compile — Help.Topic attached property', () => {
    test('Help.Topic on a control emits set_property_value(Help.TopicKey, "…")', () => {
        const js = compile(`
            Application{ resources: {
                Canvas x:root {
                    Border [ Help.Topic = "skills#create-a-skill" ]
                }
            } }
        `).js;
        // Attached-property setter resolves generically through emitSetDP — the
        // Help owner class is registered (mural framework bundle), so this lowers.
        assert.match(js, /set_property_value\(Help\.TopicKey, "skills#create-a-skill"\)/);
        // Help is imported so the emitted key reference resolves at runtime.
        assert.match(js, /\bHelp\b/);
    });
});
