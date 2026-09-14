import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Border } from '../../basic/index.js';
import { Help } from '../help.js';

describe('Help attached property', () => {
    test('default topic is empty string', () => {
        assert.equal(Help.GetTopic(new Border()), '');
    });

    test('SetTopic / GetTopic round-trip', () => {
        const b = new Border();
        Help.SetTopic(b, 'skills#create-a-skill');
        assert.equal(Help.GetTopic(b), 'skills#create-a-skill');
    });

    test('Topic is NOT inherited to children', () => {
        const parent = new Border();
        const child = new Border();
        parent.Child = child;
        Help.SetTopic(parent, 'skills#create-a-skill');
        assert.equal(Help.GetTopic(child), '');
    });

    test('ParseTopic splits docId and anchor at the first #', () => {
        assert.deepEqual(Help.ParseTopic('skills#create-a-skill'), { docId: 'skills', anchor: 'create-a-skill' });
    });

    test('ParseTopic returns undefined for malformed topics', () => {
        assert.equal(Help.ParseTopic(''), undefined);
        assert.equal(Help.ParseTopic('nohash'), undefined);
        assert.equal(Help.ParseTopic('#anchor-only'), undefined);
        assert.equal(Help.ParseTopic('docid#'), undefined);
    });
});
