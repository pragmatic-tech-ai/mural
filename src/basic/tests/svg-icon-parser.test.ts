import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSvgIcon } from '../svg-icon-parser.js';
import { CURRENT_COLOR } from '../icon.js';
import { Color } from '../../visual-engine/primitives.js';

// A shape filled by a gradient reference resolves to the gradient's first stop
// color (a faithful solid stand-in) instead of the CURRENT_COLOR sentinel — the
// Azure/Fluent icon convention is a single `fill="url(#g)"` silhouette path.
test('a url(#gradient) fill resolves to the gradient first-stop color', () => {
    const svg = `<svg viewBox="0 0 18 18">
        <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="18">
            <stop offset="0" stop-color="#0078d4" />
            <stop offset="0.82" stop-color="#5ea0ef" />
        </linearGradient></defs>
        <path d="M0 0h18v18H0Z" fill="url(#g1)" />
    </svg>`;
    const icon = parseSvgIcon(svg);
    assert.equal(icon.Shapes.length, 1);
    const fill = icon.Shapes[0]!.Fill;
    assert.equal(fill?.R, 0);
    assert.equal(fill?.G, 120);
    assert.equal(fill?.B, 212);
});

test('a radialGradient reference resolves the same way', () => {
    const svg = `<svg viewBox="0 0 24 24"><defs>
        <radialGradient id="r"><stop offset="0" stop-color="#112233" /></radialGradient>
        </defs><rect width="24" height="24" fill="url(#r)" /></svg>`;
    const fill = parseSvgIcon(svg).Shapes[0]!.Fill;
    assert.equal(fill?.R, 0x11);
    assert.equal(fill?.G, 0x22);
    assert.equal(fill?.B, 0x33);
});

test('a url() reference to an unknown gradient stays CURRENT_COLOR (no regression)', () => {
    const svg = `<svg viewBox="0 0 18 18"><path d="M0 0h18v18H0Z" fill="url(#nope)" /></svg>`;
    assert.equal(parseSvgIcon(svg).Shapes[0]!.Fill, CURRENT_COLOR);
});

test('solid hex fills are unaffected', () => {
    const svg = `<svg viewBox="0 0 18 18"><path d="M0 0h18v18H0Z" fill="#f2f2f2" /></svg>`;
    const fill = parseSvgIcon(svg).Shapes[0]!.Fill;
    assert.equal(fill?.R, 0xf2);
    assert.equal(fill?.G, 0xf2);
    assert.equal(fill?.B, 0xf2);
});

test('a self-closing <g/> (empty group) does not swallow following shapes', () => {
    // Adobe Illustrator exports an empty layer as `<g id="Layer_1"/>`. It must
    // be treated as an empty group, not an open <g>: otherwise the depth count
    // never balances, findMatchingClose returns -1, and the whole parse bails
    // out emitting zero shapes (the Microsoft Teams icon rendered blank).
    const svg = '<svg viewBox="0 0 10 10"><g id="Layer_1"/><rect width="10" height="10" fill="#f00"/></svg>';
    const icon = parseSvgIcon(svg);
    assert.equal(icon.Shapes.length, 1);
    assert.equal(icon.Shapes[0]!.Fill?.R, 0xff);
});

// ── Opacity ──────────────────────────────────────────────────────────
// Figma / Fluent exports (e.g. Microsoft's copilotstudio.svg) prepend a
// full-canvas `fill="white" fill-opacity="0"` placeholder rect. Without
// opacity handling it converted to an opaque white background square behind
// the icon (a Foreground-coloured silhouette when Recolor=true). It must
// contribute no paint.
test('a fill-opacity="0" placeholder rect contributes no fill (no background square)', () => {
    const svg = '<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="white" fill-opacity="0.0" /></svg>';
    const icon = parseSvgIcon(svg);
    assert.equal(icon.Shapes.length, 1);
    assert.equal(icon.Shapes[0]!.Fill, undefined);   // no paint → renders nothing
});

test('a partial fill-opacity rides on the fill Color alpha', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0Z" fill="#ffffff" fill-opacity="0.7" /></svg>';
    const fill = parseSvgIcon(svg).Shapes[0]!.Fill;
    assert.ok(fill instanceof Color, 'fill stays a solid Color');
    assert.equal(fill.A, 179);   // round(255 * 0.7)
    assert.equal(fill.R, 255);   // colour channels untouched
});

test('element opacity multiplies both fill and stroke', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0Z" fill="#ff0000" stroke="#00ff00" stroke-width="1" opacity="0.5" /></svg>';
    const s = parseSvgIcon(svg).Shapes[0]!;
    assert.ok(s.Fill instanceof Color && s.Stroke instanceof Color);
    assert.equal(s.Fill.A, 128);     // round(255 * 0.5)
    assert.equal(s.Stroke.A, 128);
});

test('stroke-opacity="0" drops the stroke but keeps the fill', () => {
    const svg = '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0Z" fill="#123456" stroke="#000000" stroke-width="2" stroke-opacity="0" /></svg>';
    const s = parseSvgIcon(svg).Shapes[0]!;
    assert.ok(s.Fill instanceof Color);
    assert.equal(s.Fill.R, 0x12);
    assert.equal(s.Stroke, undefined);
});
