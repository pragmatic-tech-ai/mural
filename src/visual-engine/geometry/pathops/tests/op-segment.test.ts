// Phase 6 chunk 2 — OpSegment + OpContour structural tests.
//
// Verifies:
//   * Contour.appendSegment hands back the inline head for the first
//     call and freshly-allocated segments thereafter; sets prev/next
//     links correctly.
//   * Segment.init wires fPts / weight / verb / bounds and creates
//     sentinel head + tail spans linked through prev/next.
//   * Segment.addT inserts interior spans in t-order, returns existing
//     pt-Ts on exact-t match, and refuses out-of-range params.
//   * Segment.markDone / markAllDone update fDoneCount and flip done().
//   * Segment.release decrements counts and respects the doneCount
//     invariant.
//   * Segment.subDivide produces a line/quad/cubic OpCurveCarrier
//     matching the existing Line/Quad/Cubic.subDivide outputs.
//   * Contour.calcAngles allocates angles on every span boundary.
//   * Contour.joinSegments wires the tail of each segment into the
//     head of the next (or the contour's head for the last segment).
//   * Bounds aggregate across segments via Contour.setBounds.
//   * OpContourBuilder elides an exact-reverse line pair and flushes
//     pending lines before quad / cubic adds.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Cubic } from '../cubic.js';
import { Point } from '../point.js';
import { Quad } from '../quad.js';
import { OpGlobalState } from '../op-global-state.js';
import { OpSpan } from '../op-span.js';
import { OpSegment } from '../op-segment.js';
import {
    OpContour,
    OpContourBuilder,
    OpContourHead,
} from '../op-contour.js';
import { OpVerb } from '../op-fwd.js';

const P = (x: number, y: number) => new Point(x, y);

function newContour(): { state: OpGlobalState; contour: OpContour }
{
    const state = new OpGlobalState();
    const contour = new OpContour();
    contour.init(state, false, false);
    return { state, contour };
}

// ── OpContour basics ──────────────────────────────────────────────

describe('OpContour — segment append + linkage', () => {
    test('appendSegment returns head first, fresh segments after, with prev/next links', () => {
        const { contour } = newContour();
        const s1 = contour.appendSegment();
        const s2 = contour.appendSegment();
        const s3 = contour.appendSegment();
        assert.equal(s1, contour.fHead, 'first append returns the inline head');
        assert.notEqual(s2, s1);
        assert.notEqual(s3, s2);
        assert.equal(s1.prev(), undefined);
        assert.equal(s1.next(), s2);
        assert.equal(s2.prev(), s1);
        assert.equal(s2.next(), s3);
        assert.equal(s3.prev(), s2);
        assert.equal(s3.next(), undefined);
        assert.equal(contour.count(), 3);
    });

    test('first() throws on empty contour', () => {
        const { contour } = newContour();
        assert.throws(() => contour.first());
    });
});

// ── OpSegment.init + addLine/Quad/Cubic ──────────────────────────

describe('OpSegment — init + add* + sentinel spans', () => {
    test('addLine sets fPts, verb, bounds, head/tail spans at t=0/1', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 5)]);
        assert.equal(s.verb(), OpVerb.kLine);
        assert.equal(s.weight(), 1);
        assert.equal(s.bounds().fLeft,   0);
        assert.equal(s.bounds().fTop,    0);
        assert.equal(s.bounds().fRight,  10);
        assert.equal(s.bounds().fBottom, 5);
        assert.equal(s.head().t(), 0);
        assert.equal(s.tail().t(), 1);
        assert.ok(s.head().pt().equals(P(0, 0)));
        assert.ok(s.tail().pt().equals(P(10, 5)));
        // head.next === tail; tail.prev === head.
        assert.equal(s.head().next(), s.tail());
        assert.equal(s.tail().prev(), s.head());
    });

    test('addQuad / addCubic set bounds (control-polygon AABB) and tail.pt at p_n', () => {
        const { contour } = newContour();
        const q = contour.addQuad([P(0, 0), P(1, 4), P(2, 0)]);
        assert.equal(q.verb(), OpVerb.kQuad);
        // Control-polygon AABB.
        assert.equal(q.bounds().fLeft,   0);
        assert.equal(q.bounds().fTop,    0);
        assert.equal(q.bounds().fRight,  2);
        assert.equal(q.bounds().fBottom, 4);
        assert.ok(q.tail().pt().equals(P(2, 0)));

        const c = contour.addCubic([P(0, 0), P(1, 3), P(2, -1), P(3, 0)]);
        assert.equal(c.verb(), OpVerb.kCubic);
        assert.equal(c.bounds().fLeft,   0);
        assert.equal(c.bounds().fTop,   -1);
        assert.equal(c.bounds().fRight,  3);
        assert.equal(c.bounds().fBottom, 3);
        assert.ok(c.tail().pt().equals(P(3, 0)));
    });

    test('addLine rejects degenerate segment (p0 === p1)', () => {
        const { contour } = newContour();
        assert.throws(() => contour.addLine([P(1, 1), P(1, 1)]));
    });

    test('isHorizontal / isVertical from bounds', () => {
        const { contour } = newContour();
        const h = contour.addLine([P(0, 5), P(10, 5)]);
        const v = contour.addLine([P(3, 0), P(3, 10)]);
        assert.equal(h.isHorizontal(), true);
        assert.equal(h.isVertical(),   false);
        assert.equal(v.isHorizontal(), false);
        assert.equal(v.isVertical(),   true);
    });
});

// ── ptAtT / dPtAtT / dSlopeAtT ────────────────────────────────────

describe('OpSegment — geometry delegates', () => {
    test('ptAtT line midpoint matches Line.ptAtT', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(4, 8)]);
        const mid = s.ptAtT(0.5);
        assert.equal(mid.fX, 2);
        assert.equal(mid.fY, 4);
    });

    test('ptAtT quad matches Quad.ptAtT', () => {
        const { contour } = newContour();
        const s = contour.addQuad([P(0, 0), P(1, 2), P(2, 0)]);
        // B(0.5) = 0.25*P0 + 0.5*P1 + 0.25*P2 = (1, 1).
        const mid = s.ptAtT(0.5);
        assert.ok(Math.abs(mid.fX - 1) < 1e-9);
        assert.ok(Math.abs(mid.fY - 1) < 1e-9);
    });

    test('dSlopeAtT quad at apex is horizontal', () => {
        const { contour } = newContour();
        const s = contour.addQuad([P(0, 0), P(1, 2), P(2, 0)]);
        const v = s.dSlopeAtT(0.5);
        assert.ok(Math.abs(v.y) < 1e-9, `dy at apex should be 0, got ${v.y}`);
        assert.ok(v.x > 0, 'dx at apex should be positive');
    });
});

// ── addT ─────────────────────────────────────────────────────────

describe('OpSegment.addT — pt-T allocator', () => {
    test('addT at existing t (0 or 1) returns sentinel pt-T without inserting', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        // At t=0 we should hit head.ptT.
        const p0 = s.addT(0);
        assert.equal(p0, s.head().ptT(), 'sentinel head pt-T');
        assert.equal(s.head().spanAddsCount(), 1, 'head bumped span-adds');
        // At t=1 we should hit tail.ptT.
        const p1 = s.addT(1);
        assert.equal(p1, s.tail().ptT());
        assert.equal(s.tail().spanAddsCount(), 1);
    });

    test('addT at fresh interior t inserts a new OpSpan in t-order', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        const a = s.addT(0.5);
        const b = s.addT(0.25);
        const c = s.addT(0.75);
        // All three should be different from sentinels.
        assert.notEqual(a, s.head().ptT());
        assert.notEqual(a, s.tail().ptT());
        // Walk head -> ... -> tail and confirm t-order: 0, 0.25, 0.5, 0.75, 1.
        const ts: number[] = [];
        let span = s.head() as OpSpan | undefined;
        while (span !== undefined)
        {
            ts.push(span.t());
            const next = span.next();
            const up = next.upCastable();
            if (up === undefined)
            {
                ts.push(next.t());
                break;
            }
            span = up;
        }
        assert.deepEqual(ts, [0, 0.25, 0.5, 0.75, 1],
            `t-order traversal: ${JSON.stringify(ts)}`);
        // pt at t=0.5 on the line (0,0)→(10,0) is (5, 0).
        assert.ok(a!.fPt.equals(P(5, 0)));
        assert.ok(b!.fPt.equals(P(2.5, 0)));
        assert.ok(c!.fPt.equals(P(7.5, 0)));
    });

    test('addT at exact-t-match returns existing pt-T (idempotent)', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        const first = s.addT(0.5);
        const again = s.addT(0.5);
        assert.equal(first, again);
        // span-adds on the newly-allocated span should be incremented
        // twice — once at first insert, once at the rediscovery.
        assert.equal(first!.span().spanAddsCount(), 2);
    });

    test('addT sets state.allocatedOpSpan', () => {
        const { state, contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        assert.equal(state.allocatedOpSpan(), false);
        s.addT(0.5);
        assert.equal(state.allocatedOpSpan(), true);
    });
});

// ── markDone / release ───────────────────────────────────────────

describe('OpSegment.markDone / release', () => {
    test('markDone increments fDoneCount; done() flips when all done', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        s.addT(0.5);
        // OpSpan.init now auto-bumps fCount (matches Skia's
        // SkOpSpan::init contract — without this, OpSegment.done()
        // returned true vacuously and the boolean-op walker
        // produced empty paths; see § 19.7 engine fix). addLine's
        // head + the addT(0.5) interior span = 2 bumps total.
        assert.equal(s.count(), 2);
        assert.equal(s.done(), false);
        s.markDone(s.head());
        assert.equal(s.head().done(), true);
        // Done count is now 1 of 2.
        assert.equal(s.done(), false);
        // The inserted span is between head and tail.
        const insert = s.head().next().upCastable()!;
        s.markDone(insert);
        assert.equal(s.done(), true);
    });

    test('markDone is idempotent (re-marking done span is a no-op)', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        // OpSpan.init auto-bumps via head → count = 1.
        s.markDone(s.head());
        s.markDone(s.head());     // re-mark
        assert.equal(s.done(), true);  // still done; fDoneCount didn't double-bump
    });

    test('release decrements count and respects count >= doneCount', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        s.addT(0.5);
        // OpSpan.init auto-bumps both head and the addT span → count = 2.
        assert.equal(s.count(), 2);
        s.release(s.head());
        assert.equal(s.count(), 1);
        // Marking the surviving span done + releasing should drop
        // both counts.
        const survivor = s.head();
        s.markDone(survivor);
        assert.equal(s.fDoneCount, 1);
        s.release(survivor);
        assert.equal(s.fDoneCount, 0);
        assert.equal(s.count(), 0);
    });

    test('clearOne zeros wind values and marks done', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        s.bumpCount();
        const span = s.head();
        span.fWindValue = 5;
        span.fOppValue  = 3;
        s.clearOne(span);
        assert.equal(span.fWindValue, 0);
        assert.equal(span.fOppValue,  0);
        assert.equal(span.done(), true);
    });
});

// ── subDivide ────────────────────────────────────────────────────

describe('OpSegment.subDivide — emit OpCurveCarrier matching Line/Quad/Cubic.subDivide', () => {
    test('line subDivide writes start and end points; returns false', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        const out: { value: import('../op-fwd.js').OpCurveCarrier } = {
            value: { verb: OpVerb.kLine, fLine: undefined as never },
        };
        const r = s.subDivide(s.head(), s.tail(), out);
        assert.equal(r, false);
        assert.equal(out.value.verb, OpVerb.kLine);
        if (out.value.verb === OpVerb.kLine)
        {
            assert.ok(out.value.fLine.fPts[0].equals(P(0, 0)));
            assert.ok(out.value.fLine.fPts[1].equals(P(10, 0)));
        }
    });

    test('quad subDivide [0.25, 0.75] matches Quad.subDivide(0.25, 0.75)', () => {
        const { contour } = newContour();
        const s = contour.addQuad([P(0, 0), P(1, 2), P(2, 0)]);
        s.addT(0.25);
        s.addT(0.75);
        // Find the spans at t=0.25 and t=0.75 in the chain.
        let a: import('../op-span.js').OpSpanBase | undefined = s.head();
        while (a !== undefined && a.t() !== 0.25)
        {
            const up = a.upCastable();
            if (up === undefined) break;
            a = up.next();
        }
        let b: import('../op-span.js').OpSpanBase | undefined = a;
        while (b !== undefined && b.t() !== 0.75)
        {
            const up = b.upCastable();
            if (up === undefined) break;
            b = up.next();
        }
        assert.ok(a !== undefined && a.t() === 0.25);
        assert.ok(b !== undefined && b.t() === 0.75);
        const out: { value: import('../op-fwd.js').OpCurveCarrier } = {
            value: { verb: OpVerb.kLine, fLine: undefined as never },
        };
        const r = s.subDivide(a!, b!, out);
        assert.equal(r, true);
        assert.equal(out.value.verb, OpVerb.kQuad);
        // Compare to direct Quad.subDivide.
        const full = new Quad();
        full.fPts = [P(0, 0), P(1, 2), P(2, 0)];
        const expected = full.subDivide(0.25, 0.75);
        if (out.value.verb === OpVerb.kQuad)
        {
            for (let i = 0; i < 3; ++i)
            {
                assert.ok(Math.abs(out.value.fQuad.fPts[i]!.fX - expected.fPts[i]!.fX) < 1e-9);
                assert.ok(Math.abs(out.value.fQuad.fPts[i]!.fY - expected.fPts[i]!.fY) < 1e-9);
            }
        }
    });

    test('cubic subDivide endpoint early-out (t in {0, 1})', () => {
        const { contour } = newContour();
        const s = contour.addCubic([P(0, 0), P(1, 3), P(2, -1), P(3, 0)]);
        const out: { value: import('../op-fwd.js').OpCurveCarrier } = {
            value: { verb: OpVerb.kLine, fLine: undefined as never },
        };
        const r = s.subDivide(s.head(), s.tail(), out);
        assert.equal(r, false, 'endpoint case skips midpoint computation');
        assert.equal(out.value.verb, OpVerb.kCubic);
        if (out.value.verb === OpVerb.kCubic)
        {
            // Original control points (p1, p2) preserved.
            assert.ok(out.value.fCubic.fPts[1]!.equals(P(1, 3)));
            assert.ok(out.value.fCubic.fPts[2]!.equals(P(2, -1)));
        }
    });

    test('cubic subDivide interior [0.25, 0.75] matches Cubic.subDivide', () => {
        const { contour } = newContour();
        const s = contour.addCubic([P(0, 0), P(1, 3), P(2, -1), P(3, 0)]);
        const aP = s.addT(0.25)!;
        const bP = s.addT(0.75)!;
        const out: { value: import('../op-fwd.js').OpCurveCarrier } = {
            value: { verb: OpVerb.kLine, fLine: undefined as never },
        };
        const r = s.subDivide(aP.span(), bP.span(), out);
        assert.equal(r, true);
        assert.equal(out.value.verb, OpVerb.kCubic);
        const full = new Cubic();
        full.fPts = [P(0, 0), P(1, 3), P(2, -1), P(3, 0)];
        const expected = full.subDivide(0.25, 0.75);
        if (out.value.verb === OpVerb.kCubic)
        {
            for (let i = 0; i < 4; ++i)
            {
                assert.ok(Math.abs(out.value.fCubic.fPts[i]!.fX - expected.fPts[i]!.fX) < 1e-9,
                    `cubic.fPts[${i}].x: ${out.value.fCubic.fPts[i]!.fX} vs ${expected.fPts[i]!.fX}`);
                assert.ok(Math.abs(out.value.fCubic.fPts[i]!.fY - expected.fPts[i]!.fY) < 1e-9);
            }
        }
    });
});

// ── calcAngles + joinSegments + bounds aggregate ──────────────────

describe('OpContour — calcAngles + joinSegments + setBounds', () => {
    test('calcAngles populates fFromAngle / fToAngle on inner spans', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        s.addT(0.5);
        contour.calcAngles();
        // Find the interior span and check both angle slots filled.
        const inner = s.head().next().upCastable()!;
        assert.notEqual(inner.fromAngle(), undefined);
        assert.notEqual(inner.toAngle(),   undefined);
    });

    test('joinSegments links each segment\'s tail.ptT into the next segment\'s head.ptT loop', () => {
        const { contour } = newContour();
        const a = contour.addLine([P(0, 0), P(1, 0)]);
        const b = contour.addLine([P(1, 0), P(2, 0)]);
        const c = contour.addLine([P(2, 0), P(0, 0)]);
        contour.joinSegments();
        // After join, each tail.ptT.next should equal the next head's ptT.
        assert.equal(a.tail().ptT().next(), b.head().ptT());
        assert.equal(b.tail().ptT().next(), c.head().ptT());
        assert.equal(c.tail().ptT().next(), a.head().ptT(),
            'last segment\'s tail closes the loop to the first head');
    });

    test('setBounds aggregates across all segments', () => {
        const { contour } = newContour();
        contour.addLine([P(-2, 0), P(0, 5)]);
        contour.addQuad([P(0, 5), P(2, 7), P(4, 5)]);
        contour.addLine([P(4, 5), P(-2, 0)]);
        contour.setBounds();
        assert.equal(contour.bounds().fLeft,  -2);
        assert.equal(contour.bounds().fTop,    0);
        assert.equal(contour.bounds().fRight,  4);
        assert.equal(contour.bounds().fBottom, 7);
    });
});

// ── OpContourHead — append/remove ────────────────────────────────

describe('OpContourHead — multi-contour linkage', () => {
    test('appendContour links new contours after the head; remove unlinks tail', () => {
        const state = new OpGlobalState();
        const head = new OpContourHead();
        head.init(state, false, false);
        const c1 = head.appendContour();
        const c2 = head.appendContour();
        assert.equal(head.next(), c1);
        assert.equal(c1.next(),   c2);
        assert.equal(c2.next(),   undefined);
        // Children inherit globalState pointer.
        assert.equal(c1.globalState(), state);
        // Remove must be applied to the tail of the list. After
        // removing c2, c1 becomes the new tail and is itself
        // removable; head then has no children.
        head.remove(c2);
        assert.equal(c1.next(), undefined);
        head.remove(c1);
        assert.equal(head.next(), undefined);
    });
});

// ── OpContourBuilder line elision ─────────────────────────────────

describe('OpContourBuilder — line elision', () => {
    test('exact reverse line cancels with prior; quad-add flushes pending line', () => {
        const { contour } = newContour();
        const builder = new OpContourBuilder(contour);
        builder.addLine([P(0, 0), P(1, 0)]);
        builder.addLine([P(1, 0), P(0, 0)]);   // exact reverse — both cancel
        builder.flush();
        assert.equal(contour.count(), 0, 'no segments added after cancellation');

        builder.addLine([P(0, 0), P(1, 0)]);
        builder.addQuad([P(1, 0), P(2, 1), P(3, 0)]);  // flushes pending line
        assert.equal(contour.count(), 2, 'line + quad both appended');
    });

    test('addCurve dispatches by verb', () => {
        const { contour } = newContour();
        const builder = new OpContourBuilder(contour);
        builder.addCurve(OpVerb.kQuad, [P(0, 0), P(1, 1), P(2, 0)]);
        builder.addCurve(OpVerb.kCubic, [P(2, 0), P(3, 1), P(4, -1), P(5, 0)]);
        builder.flush();
        assert.equal(contour.count(), 2);
    });
});

// ── Stub guard ────────────────────────────────────────────────────

// addMissing remains stubbed (only addIntersectTs uses it; that's the
// pair-wise BinarySearch sweep in step 5 of Phase 7).
describe('OpSegment — remaining stubs', () => {
    test('addMissing throws pending addIntersectTs', () => {
        const { contour } = newContour();
        const s = contour.addLine([P(0, 0), P(10, 0)]);
        assert.throws(() => s.addMissing(0.5, s), /Phase 6 follow-up/);
    });
});
