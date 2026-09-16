// §19-deferred #4 — `FontMetricsMeasurer.BuildGeometry` + `textOnPath` tests.
//
// Builds a controllable test font in memory (no font binary
// shipped in the repo) with two real glyph outlines:
//
//   'A' — open triangle, font coords: M(0, 0) L(500, 800) L(1000, 0) Z.
//          unitsPerEm = 1000; advance = 1000.
//   'i' — rect,             font coords: M(0, 0) L(200, 0) L(200, 600) L(0, 600) Z.
//          advance = 200.
//
// Y is flipped on the way out (font coords are Y-up; mural is Y-down).
// At fontSize = 100, scale = 0.1, so 'A's outline maps to
// M(0, 0) L(50, -80) L(100, 0) Z and its advance is 100.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as opentype from 'opentype.js/dist/opentype.mjs';

import { FontMetricsMeasurer } from '../text/font-metrics-measurer.js';
import { textOnPath } from '../text/text-on-path.js';
import { Point } from '../primitives.js';
import {
    LineSegment,
    PathFigure,
    PathGeometry,
} from '../geometry/geometry.js';

function makeTestFont(): ArrayBuffer
{
    const notdef = new opentype.Glyph({
        name: '.notdef',
        advanceWidth: 1000,
        path: new opentype.Path(),
    });

    const space = new opentype.Glyph({
        name: 'space',
        unicode: 32,
        advanceWidth: 500,
        path: new opentype.Path(),
    });

    const upperA = new opentype.Path();
    upperA.moveTo(0, 0);
    upperA.lineTo(500, 800);
    upperA.lineTo(1000, 0);
    upperA.close();
    const aGlyph = new opentype.Glyph({
        name: 'A',
        unicode: 65,
        advanceWidth: 1000,
        path: upperA,
    });

    const lowerI = new opentype.Path();
    lowerI.moveTo(0, 0);
    lowerI.lineTo(200, 0);
    lowerI.lineTo(200, 600);
    lowerI.lineTo(0, 600);
    lowerI.close();
    const iGlyph = new opentype.Glyph({
        name: 'i',
        unicode: 105,
        advanceWidth: 200,
        path: lowerI,
    });

    const font = new opentype.Font({
        familyName: 'TestSans',
        styleName:  'Regular',
        unitsPerEm: 1000,
        ascender:   800,
        descender:  -200,
        glyphs:     [notdef, space, aGlyph, iGlyph],
    });
    return font.toArrayBuffer();
}

// ── BuildGeometry ────────────────────────────────────────────────────

describe('FontMetricsMeasurer.BuildGeometry', () => {
    test('empty text yields empty PathGeometry', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const g = m.BuildGeometry('', 'TestSans', 100, 'normal', 'normal');
        assert.equal(g.Figures.length, 0);
    });

    test('no loaded font yields empty PathGeometry', () => {
        const m = new FontMetricsMeasurer();
        const g = m.BuildGeometry('A', 'Whatever', 100, 'normal', 'normal');
        assert.equal(g.Figures.length, 0);
    });

    test('single triangle glyph produces a closed triangle figure at scale', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const g = m.BuildGeometry('A', 'TestSans', 100, 'normal', 'normal');
        assert.equal(g.Figures.length, 1);
        const f = g.Figures[0]!;
        // Start at (0, 0) — baseline + left origin.
        assert.equal(f.StartPoint.X, 0);
        assert.equal(f.StartPoint.Y, 0);
        assert.equal(f.Segments.length, 2); // L (500*0.1, -800*0.1) + L (1000*0.1, 0)
        assert.ok(f.Segments[0] instanceof LineSegment);
        assert.equal((f.Segments[0] as LineSegment).Point.X, 50);
        assert.equal((f.Segments[0] as LineSegment).Point.Y, -80);
        assert.ok(f.Segments[1] instanceof LineSegment);
        assert.equal((f.Segments[1] as LineSegment).Point.X, 100);
        assert.equal((f.Segments[1] as LineSegment).Point.Y, 0);
        assert.equal(f.IsClosed, true);
    });

    test('two glyphs advance horizontally — second figure offset by first advance', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const g = m.BuildGeometry('Ai', 'TestSans', 100, 'normal', 'normal');
        assert.equal(g.Figures.length, 2);
        // 'A' advance = 100; 'i' figure starts at x = 100 with no kerning.
        const iFig = g.Figures[1]!;
        assert.equal(iFig.StartPoint.X, 100);
        assert.equal(iFig.StartPoint.Y, 0);
    });
});

// ── textOnPath ───────────────────────────────────────────────────────

describe('textOnPath', () => {
    test('empty text yields empty PathGeometry', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(1000, 0))], false)]);
        const g = textOnPath({ text: '', path, measurer: m, fontFamily: 'TestSans', fontSize: 100 });
        assert.equal(g.Figures.length, 0);
    });

    test('no loaded font yields empty PathGeometry', () => {
        const m = new FontMetricsMeasurer();
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(1000, 0))], false)]);
        const g = textOnPath({ text: 'A', path, measurer: m, fontFamily: 'Whatever', fontSize: 100 });
        assert.equal(g.Figures.length, 0);
    });

    test('horizontal path — single glyph centered on path', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        // Straight horizontal path from (0,0) → (1000, 0).
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(1000, 0))], false)]);
        // 'A' advance = 100. anchor = 0 + 100/2 = 50. So glyph center
        // lands at (50, 0). Original triangle is (0,0) (50,-80) (100,0).
        // Center offset = -advance/2 = -50. So glyph baseline points map:
        //   (0, 0)    + (-50, 0) → (-50, 0) → rotated 0° → (-50, 0) → trans (50, 0) → (0, 0)
        //   (50,-80)  + (-50, 0) → (0,  -80) → (0, -80) → (50, -80)
        //   (100, 0)  + (-50, 0) → (50, 0)   → (50, 0)  → (100, 0)
        const g = textOnPath({ text: 'A', path, measurer: m, fontFamily: 'TestSans', fontSize: 100 });
        assert.equal(g.Figures.length, 1);
        const f = g.Figures[0]!;
        // Float comparison with epsilon — sin(0)/cos(0) may drift.
        assert.ok(Math.abs(f.StartPoint.X - 0) < 1e-9);
        assert.ok(Math.abs(f.StartPoint.Y - 0) < 1e-9);
    });

    test('vertical path — glyph rotated 90° CW from horizontal baseline', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        // Vertical path from (0, 0) → (0, 1000) (going DOWN, y-down).
        // Tangent direction is +Y. atan2(+1, 0) = π/2.
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(0, 1000))], false)]);
        const g = textOnPath({ text: 'A', path, measurer: m, fontFamily: 'TestSans', fontSize: 100 });
        assert.equal(g.Figures.length, 1);
        const f = g.Figures[0]!;
        // Triangle vertices in glyph-local space: (0,0), (50,-80), (100,0).
        // Offset by -advance/2 = -50: (-50,0), (0,-80), (50,0).
        // Rotate by +90° CW (which is the +Y tangent direction):
        //   R = [[cos(π/2), -sin(π/2)], [sin(π/2), cos(π/2)]] = [[0,-1],[1,0]]
        //   (-50, 0)   → (0, -50)
        //   (0, -80)   → (80, 0)
        //   (50, 0)    → (0, 50)
        // Translate to anchor point at arclength 50 along the path =
        // (0, 50).
        //   (0, -50) + (0, 50) = (0, 0)
        //   (80, 0)  + (0, 50) = (80, 50)
        //   (0, 50)  + (0, 50) = (0, 100)
        assert.ok(Math.abs(f.StartPoint.X - 0) < 1e-9);
        assert.ok(Math.abs(f.StartPoint.Y - 0) < 1e-9);
        const s0 = f.Segments[0] as LineSegment;
        assert.ok(Math.abs(s0.Point.X - 80) < 1e-9);
        assert.ok(Math.abs(s0.Point.Y - 50) < 1e-9);
        const s1 = f.Segments[1] as LineSegment;
        assert.ok(Math.abs(s1.Point.X - 0) < 1e-9);
        assert.ok(Math.abs(s1.Point.Y - 100) < 1e-9);
    });

    test('glyph past the end of the path is dropped', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        // Path length 50 — fits the 'A' anchor (=50) but the next 'i'
        // (anchor 100 + 10 = 110) would land off-path.
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(50, 0))], false)]);
        const g = textOnPath({ text: 'Ai', path, measurer: m, fontFamily: 'TestSans', fontSize: 100 });
        assert.equal(g.Figures.length, 1);
    });

    test('startOffset shifts the run forward along the path', () => {
        const m = new FontMetricsMeasurer();
        m.LoadFont('TestSans', makeTestFont());
        const path = new PathGeometry([new PathFigure(new Point(0, 0), [new LineSegment(new Point(1000, 0))], false)]);
        const g1 = textOnPath({ text: 'A', path, measurer: m, fontFamily: 'TestSans', fontSize: 100 });
        const g2 = textOnPath({ text: 'A', path, measurer: m, fontFamily: 'TestSans', fontSize: 100, startOffset: 200 });
        // g2's glyph is at 200 + advance/2 = 250 along the (horizontal) path.
        // g1's glyph is at 0 + 50 = 50. Difference = 200.
        const f1 = g1.Figures[0]!;
        const f2 = g2.Figures[0]!;
        const s1 = f1.Segments[1] as LineSegment;
        const s2 = f2.Segments[1] as LineSegment;
        assert.ok(Math.abs((s2.Point.X - s1.Point.X) - 200) < 1e-9);
    });
});
