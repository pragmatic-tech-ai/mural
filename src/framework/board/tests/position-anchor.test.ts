import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PositionAnchor } from '../position-anchor.js';
import { ENUM_MEMBERS } from '../../../compiler/symbol-table.js';

describe('PositionAnchor', () => {
    test('has the two PowerPoint "From" anchors', () => {
        assert.equal(PositionAnchor.TopLeftCorner, 'TopLeftCorner');
        assert.equal(PositionAnchor.Center, 'Center');
    });
    test('is registered as a markup enum', () => {
        const members = ENUM_MEMBERS.get('PositionAnchor');
        assert.ok(members, 'PositionAnchor registered in ENUM_MEMBERS');
        assert.ok(members!.has('TopLeftCorner') && members!.has('Center'));
    });
});
