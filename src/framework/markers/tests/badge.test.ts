import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget, SvgDrawingContext } from '../../../visual-engine/index.js';
import { Badge, BadgeVariant } from '../badge.js';

// Wave-1 follow-up (B) — Numeric Badge render crash.
//
// `new Badge()` defaults to Variant=Numeric, whose template binds the
// pill's TextBlock.Text to Badge.Count — a NUMBER — straight into a
// string-typed DP. SvgDrawingContext.escapeXmlText calls `s.replace`
// on whatever it's handed, so painting a standalone numeric Badge
// throws a TypeError instead of rendering. This reproduces under the
// BASE (Material) template — markers.template.mu:147's `Text = $Count`
// carries both the wrong-sigil bug (DataContextBinding instead of
// TemplateBinding) AND the number→string type bug; Badge had zero
// test coverage before this fix, so the path is dead/broken for both
// themes today.
describe('Badge — Numeric variant render', () =>
{
    test('a standalone numeric Badge renders its Count without throwing', () =>
    {
        initTestApp();
        const badge = new Badge();
        badge.Variant = BadgeVariant.Numeric;
        badge.Count = 5;

        const target = new HeadlessTarget(32, 32, badge);
        const dc = new SvgDrawingContext();

        // Pre-fix, this throws: TypeError: s.replace is not a function
        // (escapeXmlText receives the raw number 5, not a string).
        assert.doesNotThrow(() => target.Render(dc));

        const svg = dc.ToFragment();
        assert.ok(svg.includes('>5<'), `expected the rendered pill to carry "5", got: ${svg}`);
    });

    test('the default Count (0) renders as "0"', () =>
    {
        initTestApp();
        const badge = new Badge();
        badge.Variant = BadgeVariant.Numeric;

        const target = new HeadlessTarget(32, 32, badge);
        const dc = new SvgDrawingContext();

        assert.doesNotThrow(() => target.Render(dc));

        const svg = dc.ToFragment();
        assert.ok(svg.includes('>0<'), `expected the rendered pill to carry "0", got: ${svg}`);
    });
});

describe('Badge.CountText — derived string DP', () =>
{
    test('reflects Count at construction', () =>
    {
        initTestApp();
        const badge = new Badge();
        badge.Count = 42;
        assert.equal(badge.CountText, '42');
    });

    test('stays in lock-step as Count changes (reactive)', () =>
    {
        initTestApp();
        const badge = new Badge();
        assert.equal(badge.CountText, '0');

        badge.Count = 7;
        assert.equal(badge.CountText, '7');

        badge.Count = 128;
        assert.equal(badge.CountText, '128');
    });
});
