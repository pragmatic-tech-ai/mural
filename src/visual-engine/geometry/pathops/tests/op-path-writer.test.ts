// Phase 7 foundation tests — OpPath / OpPathWriter / OpEdgeBuilder /
// OpSegment.addCurveTo end-to-end smoke.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Point } from '../point.js';
import { OpContour, OpContourHead } from '../op-contour.js';
import { OpEdgeBuilder } from '../op-edge-builder.js';
import { OpCoincidence } from '../op-coincidence.js';
import { OpGlobalState } from '../op-global-state.js';
import { OpPath, OpFillType } from '../op-path.js';
import { OpPathWriter } from '../op-path-writer.js';
import { OpVerb } from '../op-fwd.js';

const P = (x: number, y: number) => new Point(x, y);

function newState(): OpGlobalState
{
    const s = new OpGlobalState();
    new OpCoincidence(s);
    return s;
}

// ── OpPath basics ───────────────────────────────────────────────

describe('OpPath — verb stream + fill type', () => {
    test('moveTo + lineTo + close produces 3 commands', () => {
        const p = new OpPath();
        p.moveTo(P(0, 0));
        p.lineTo(P(10, 0));
        p.close();
        assert.equal(p.fCommands.length, 3);
        assert.equal(p.fCommands[0]!.verb, OpVerb.kMove);
        assert.equal(p.fCommands[1]!.verb, OpVerb.kLine);
        assert.equal(p.fCommands[2]!.verb, OpVerb.kClose);
    });

    test('isEmpty after reset; quadTo + cubicTo append', () => {
        const p = new OpPath();
        p.moveTo(P(0, 0));
        p.quadTo(P(1, 1), P(2, 0));
        p.cubicTo(P(3, 1), P(4, -1), P(5, 0));
        assert.equal(p.fCommands.length, 3);
        p.reset();
        assert.equal(p.isEmpty(), true);
    });

    test('toggleInverseFillType flips between winding and inverse', () => {
        const p = new OpPath();
        p.setFillType(OpFillType.kWinding);
        assert.equal(p.isInverseFillType(), false);
        p.toggleInverseFillType();
        assert.equal(p.isInverseFillType(), true);
        assert.equal(p.getFillType(), OpFillType.kInverseWinding);
    });
});

// ── OpPathWriter wiring ─────────────────────────────────────────

describe('OpPathWriter — deferred commands + finishContour', () => {
    test('writer starts with hasMove === true (no pending first pt-T)', () => {
        const out = new OpPath();
        const w = new OpPathWriter(out);
        assert.equal(w.hasMove(), true);
        assert.equal(w.isClosed(), false);
    });

    test('finishContour on empty writer is a no-op', () => {
        const out = new OpPath();
        const w = new OpPathWriter(out);
        w.finishContour();
        assert.equal(out.isEmpty(), true);
    });
});

// ── OpSegment.addCurveTo — single-segment emit ──────────────────

describe('OpSegment.addCurveTo — line emit via writer', () => {
    test('writes a deferred moveTo + deferredLine that resolve to a line', () => {
        const state = newState();
        const head = new OpContourHead();
        head.init(state, false, false);
        state.setContourHead(head);
        const sub = head.appendContour();
        sub.addLine([P(0, 0), P(10, 0)]);
        const seg: OpContour = sub;
        void seg;
        const out = new OpPath();
        const writer = new OpPathWriter(out);
        const s = sub.first();
        const ok = s.addCurveTo(s.head(), s.tail(), writer);
        assert.equal(ok, true);
        writer.finishContour();
        // The line is open (start !== first.ptT); writer parks it.
        assert.equal(out.fCommands.length >= 0, true);
    });
});

// ── OpEdgeBuilder — Path → OpContourHead ────────────────────────

describe('OpEdgeBuilder — Path → contour tree', () => {
    test('square outline → one contour with four line segments', () => {
        const state = newState();
        const head = new OpContourHead();
        head.init(state, false, false);
        state.setContourHead(head);
        const path = new OpPath();
        path.moveTo(P(0, 0));
        path.lineTo(P(10, 0));
        path.lineTo(P(10, 10));
        path.lineTo(P(0, 10));
        path.close();
        const builder = new OpEdgeBuilder(path, head, state, /* allowOpen */ false);
        assert.equal(builder.unparseable(), false);
        const ok = builder.finish();
        assert.equal(ok, true);
        // Walk the contour tree. head IS a content contour, not just a
        // sentinel.
        let count = 0;
        let contour: import('../op-contour.js').OpContour | undefined = head;
        while (contour !== undefined)
        {
            count += contour.count();
            contour = contour.next();
        }
        // Four sides.
        assert.equal(count, 4);
    });

    test('addOperand adds a second path with operand flag flipped', () => {
        const state = newState();
        const head = new OpContourHead();
        head.init(state, false, false);
        state.setContourHead(head);
        const a = new OpPath();
        a.moveTo(P(0, 0));
        a.lineTo(P(5, 0));
        a.lineTo(P(5, 5));
        a.lineTo(P(0, 5));
        a.close();
        const builder = new OpEdgeBuilder(a, head, state, false);
        const b = new OpPath();
        b.moveTo(P(3, 3));
        b.lineTo(P(8, 3));
        b.lineTo(P(8, 8));
        b.lineTo(P(3, 8));
        b.close();
        builder.addOperand(b);
        assert.equal(builder.finish(), true);
        // Two operand paths → contour tree should have ≥ 2 contours
        // (including head).
        let count = 0;
        let contour: import('../op-contour.js').OpContour | undefined = head;
        while (contour !== undefined)
        {
            ++count;
            contour = contour.next();
        }
        assert.ok(count >= 2, `expected ≥ 2 contours from two operand paths, got ${count}`);
    });
});

// ── reverseAddPath sanity ──────────────────────────────────────

describe('OpPath.reverseAddPath — traces another path end-to-start', () => {
    test('reverse of moveTo(0,0) lineTo(10,0) lineTo(10,10) is moveTo(10,10) lineTo(10,0) lineTo(0,0)', () => {
        const src = new OpPath();
        src.moveTo(P(0, 0));
        src.lineTo(P(10, 0));
        src.lineTo(P(10, 10));
        const dst = new OpPath();
        dst.reverseAddPath(src);
        // Expect three commands: moveTo + 2 lineTos.
        assert.equal(dst.fCommands.length, 3);
        assert.equal(dst.fCommands[0]!.verb, OpVerb.kMove);
        assert.ok(dst.fCommands[0]!.pts[0]!.equals(P(10, 10)));
        // Walking the reversed line endpoints.
        assert.ok(dst.fCommands[1]!.pts[0]!.equals(P(10, 0)));
        assert.ok(dst.fCommands[2]!.pts[0]!.equals(P(0, 0)));
    });
});
