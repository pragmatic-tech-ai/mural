import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutInlines, type FlowItem, type MeasureText } from '../text-layout.js';
import { FontStyle, FontWeight, TextAlignment, TextDecorations, type TextMetrics } from '../../../visual-engine/index.js';
import { Run } from '../inlines.js';
import type { RunProps } from '../text-element.js';

// Justify in the inline layout engine (§ board-text). Wrapped lines have
// their inter-word gaps widened to fill the slot; the last line (and hard-
// break-terminated lines) stay natural. A deterministic stub measurer makes
// the fragment positions exact.

const PROPS: RunProps = {
    family: 'stub', size: 10, weight: FontWeight.Normal, style: FontStyle.Normal,
    foreground: undefined, decorations: TextDecorations.None, link: undefined,
};

// Every glyph is 10 wide (so 'aa' = 20, a space ' ' = 10); metrics are flat.
const measure: MeasureText = (t: string): TextMetrics =>
    ({ Width: [...t].length * 10, Height: 12, Ascent: 10, Descent: 2 } as TextMetrics);

function layout(text: string, width: number, align: TextAlignment)
{
    const items: FlowItem[] = [{ kind: 'text', text, props: PROPS, source: new Run(text) }];
    return layoutInlines(items, {
        availableWidth: width, wrap: true, letterSpacing: 0, lineHeight: Number.NaN,
        measureText: measure, measureObject: () => ({ width: 0, height: 0 }), align,
    });
}

describe('layoutInlines — Justify', () => {
    // 'aa bb cc dd' at width 60 wraps to ['aa bb', 'cc dd'] (each 50 wide).
    test('widens the gaps of a wrapped line so it fills the slot', () => {
        const r = layout('aa bb cc dd', 60, TextAlignment.Justify);
        assert.equal(r.lines.length, 2, 'wrapped into two lines');
        const l0 = r.lines[0]!;
        // aa stays at 0; bb is pushed right so the line reaches the slot edge.
        assert.equal(l0.frags[0]!.x, 0);
        assert.equal(l0.frags[1]!.x, 40);              // 20 (aa) + widened gap 20
        assert.equal(l0.frags[1]!.x + 20, 60, 'right edge meets the slot');
        assert.equal(l0.width, 60);
    });

    test('the last line stays natural (left, single spaces)', () => {
        const r = layout('aa bb cc dd', 60, TextAlignment.Justify);
        const last = r.lines[1]!;
        assert.equal(last.frags[0]!.x, 0);             // cc
        assert.equal(last.frags[1]!.x, 30);            // 20 (cc) + natural space 10
        assert.equal(last.width, 50, 'not stretched');
    });

    test('Left leaves every line packed at natural width (no justify)', () => {
        const r = layout('aa bb cc dd', 60, TextAlignment.Left);
        assert.equal(r.lines[0]!.frags[1]!.x, 30);     // natural gap only
        assert.equal(r.lines[0]!.width, 50);
    });
});
