import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Group } from '../group.js';
import { Figure } from '../figure.js';
import { BoardDocument } from '../board-document.js';

function app(): void { Application.current = null; new Application(); }

describe('M4 Group — VM members', () => {
    test('bbox = union of VM members', () => {
        app();
        const a = Figure.fromKind('rectangle', 100, 100, { width: 40, height: 40 });
        const b = Figure.fromKind('rectangle', 200, 180, { width: 60, height: 20 });
        const g = new Group([a, b]);
        assert.equal(g.Left, 100, 'group Left = member-min X');
        assert.equal(g.Top, 100, 'group Top = member-min Y');
        assert.equal(g.Width, 160, 'union width = 260 - 100');
        assert.equal(g.Height, 100, 'union height = 200 - 100');
    });

    test('grouping sets each VM member Parent', () => {
        app();
        const a = Figure.fromKind('rectangle', 0, 0);
        const g = new Group([a]);
        assert.equal(a.Parent, g, 'member VM Parent points at the group');
    });

    test('Translate moves every VM member and tracks bbox', () => {
        app();
        const a = Figure.fromKind('rectangle', 100, 100, { width: 40, height: 40 });
        const b = Figure.fromKind('rectangle', 200, 100, { width: 40, height: 40 });
        const g = new Group([a, b]);
        g.Translate(50, 20);
        assert.equal(a.Left, 150); assert.equal(a.Top, 120);
        assert.equal(b.Left, 250); assert.equal(b.Top, 120);
        assert.equal(g.Left, 150, 'bbox Left follows members');
        assert.equal(g.Top, 120, 'bbox Top follows members');
    });

    test('member move re-fires bbox recompute', () => {
        app();
        const a = Figure.fromKind('rectangle', 100, 100, { width: 40, height: 40 });
        const g = new Group([a]);
        a.Left = 300;
        assert.equal(g.Left, 300, 'bbox tracks an individual member move');
    });

    test('EnumerateLeaves yields VM leaves through nesting', () => {
        app();
        const a = Figure.fromKind('rectangle', 0, 0);
        const b = Figure.fromKind('rectangle', 100, 0);
        const inner = new Group([b]);
        const outer = new Group([a, inner]);
        const leaves = [...outer.EnumerateLeaves()];
        assert.deepEqual(new Set(leaves), new Set([a, b]));
    });

    test('Ungroup clears member Parent and restores them to the root', () => {
        app();
        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle', 0, 0)!;
        const b = doc.CreateNode('rectangle', 100, 0)!;
        doc.Group([a, b]);
        // Find the Group in doc.Nodes
        let grp: Group | undefined;
        for (let i = 0; i < doc.Nodes.Count; i++)
        {
            const n = doc.Nodes.Get(i);
            if (n instanceof Group) { grp = n; break; }
        }
        assert.ok(grp !== undefined, 'a Group should exist in doc.Nodes after grouping');
        doc.Ungroup([grp]);
        assert.equal(a.Parent, undefined, 'a.Parent should be cleared after ungroup');
        assert.equal(b.Parent, undefined, 'b.Parent should be cleared after ungroup');
        // a and b should still be in doc.Nodes, grp should be gone
        let foundA = false, foundB = false, foundGrp = false;
        for (let i = 0; i < doc.Nodes.Count; i++)
        {
            const n = doc.Nodes.Get(i);
            if (n === a) foundA = true;
            if (n === b) foundB = true;
            if (n === grp) foundGrp = true;
        }
        assert.ok(foundA, 'doc.Nodes should still contain a');
        assert.ok(foundB, 'doc.Nodes should still contain b');
        assert.ok(!foundGrp, 'doc.Nodes should no longer contain the group');
    });
});
