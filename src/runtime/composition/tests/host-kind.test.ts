import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HostKind } from '../host-kind.js';

describe('HostKind', () => {
    test('carries its Name', () => {
        const desktop = new HostKind('desktop');
        assert.equal(desktop.Name, 'desktop');
    });

    test('identity, not name, is the key — two mints with the same name are distinct', () => {
        const a = new HostKind('web');
        const b = new HostKind('web');
        assert.notStrictEqual(a, b);
    });
});
