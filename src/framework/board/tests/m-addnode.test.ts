import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { BoardDocument } from '../board-document.js';
import { Figure } from '../figure.js';

beforeEach(() => { initTestApp(); });

test('AddNode adds a pre-built Figure to the Nodes collection', () => {
    const doc = new BoardDocument();
    const vm = Figure.fromKind('rectangle', 10, 20, { width: 40, height: 30 });

    // AddNode should add the VM to the Nodes collection
    doc.AddNode(vm);

    assert.equal(doc.Nodes.Count, 1);
    assert.equal(doc.Nodes.Get(0), vm);
    assert.equal(vm.Left, 10);
    assert.equal(vm.Top, 20);
});
