import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { BoardDocument } from '../board-document.js';
import { Callout } from '../callout.js';
import { TextNode } from '../text-node.js';

// NOTE: assert against identity / undefined via booleans, never assert.equal on
// the DP objects themselves — PathGeometry / NodeViewModel carry circular DP
// graphs that node:assert deep-formats into a multi-GB diff on mismatch.

describe('Callout — detach on delete', () => {
    beforeEach(() => { initTestApp(); });

    test('deleting a callout stops it tracking its target', () => {
        const doc = new BoardDocument();
        const target = new TextNode(); target.Id = 't'; target.Left = 200; target.Top = 200;
        const callout = new Callout(); callout.Id = 'c';
        doc.AddNode(target); doc.AddNode(callout);
        callout.LeaderTargetNode = target;
        const before = callout.LeaderGeometry;
        assert.ok(before !== undefined, 'leader present with a target');

        doc.DeleteNodes([callout]);
        // Moving the (surviving) target must no longer recompute the deleted
        // callout's geometry — its listener was detached, so the DP keeps the
        // same object reference.
        target.Left = 900;
        assert.ok(callout.LeaderGeometry === before, 'detached: no recompute after delete');
    });

    test('deleting a target clears the surviving callout leader', () => {
        const doc = new BoardDocument();
        const target = new TextNode(); target.Id = 't'; target.Left = 200; target.Top = 200;
        const callout = new Callout(); callout.Id = 'c';
        doc.AddNode(target); doc.AddNode(callout);
        callout.LeaderTargetNode = target;
        assert.ok(callout.LeaderGeometry !== undefined);

        doc.DeleteNodes([target]);
        assert.ok(callout.LeaderTargetNode === undefined, 'target ref cleared');
        assert.ok(callout.LeaderGeometry === undefined, 'leader removed');
    });
});
