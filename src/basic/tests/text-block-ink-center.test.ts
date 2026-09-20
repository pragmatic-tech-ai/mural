import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Size, Rect, VerticalAlignment, type TextMetrics, type TextMeasurer } from '../../runtime/index.js';
import {
    HeadlessTarget,
    type DrawingContext,
    type FormattedText,
    type Brush,
    type Pen,
    type Geometry,
    type ImageSource,
    type Stretch,
    type Transform,
    type Point,
} from '../../visual-engine/index.js';
import { TextBlock } from '../text-block.js';

// A measurer that reports an ASYMMETRIC ink box: a single glyph 8 above the
// baseline, 0 below, in a 10/4 font line box. So the font-box centre (7) and the
// ink centre (6) differ — exactly the mismatch ink-centring corrects.
const FONT_ASCENT = 10, FONT_DESCENT = 4, INK_ASCENT = 8, INK_DESCENT = 0;
class InkMeasurer implements TextMeasurer
{
    public LoadFont(): void { /* no-op */ }
    public Measure(text: string): TextMetrics
    {
        if (text === '') return { Width: 0, Height: 0, Ascent: 0, Descent: 0 };
        return {
            Width: text.length * 6,
            Height: FONT_ASCENT + FONT_DESCENT,
            Ascent: FONT_ASCENT,
            Descent: FONT_DESCENT,
            InkAscent: INK_ASCENT,
            InkDescent: INK_DESCENT,
        };
    }
}

// Records the y-origin of every DrawText; every other primitive is a no-op.
class RecordingContext implements DrawingContext
{
    public textYs: number[] = [];
    public DrawText(_t: FormattedText, origin: Point): void { this.textYs.push(origin.Y); }
    public DrawRectangle(_b: Brush | undefined, _p: Pen | undefined, _r: Rect): void {}
    public DrawRoundedRectangle(_b: Brush | undefined, _p: Pen | undefined, _r: Rect, _x: number, _y: number): void {}
    public DrawGeometry(_b: Brush | undefined, _p: Pen | undefined, _g: Geometry): void {}
    public DrawImage(_s: ImageSource, _r: Rect, _st: Stretch): void {}
    public PushTransform(_t: Transform): void {}
    public PushClip(_g: Geometry): void {}
    public Pop(): void {}
}

function renderY(valign: VerticalAlignment): number
{
    const tb = new TextBlock('X');
    tb.VerticalAlignment = valign;
    const target = new HeadlessTarget(200, 60);
    (target as unknown as { TextMeasurer: TextMeasurer }).TextMeasurer = new InkMeasurer();
    target.Content = tb as never;
    (tb as unknown as { Measure(s: Size): void }).Measure(new Size(200, 60));
    (tb as unknown as { Arrange(r: Rect): void }).Arrange(new Rect(0, 0, 200, 60));
    const dc = new RecordingContext();
    (tb as unknown as { Render(dc: DrawingContext): void }).Render(dc);
    return dc.textYs[0]!;
}

describe('TextBlock — ink-centred vertical alignment', () => {
    test('centred single line seats the ink centre on the box centre', () => {
        // box centre = Height/2 = 7; ink centre = Ascent + (InkDescent-InkAscent)/2
        // = 10 + (0-8)/2 = 6. offset = 7 - 6 = +1 (baseline nudged DOWN 1 DIP).
        const y = renderY(VerticalAlignment.Center);
        assert.ok(Math.abs(y - 1) < 1e-6, `centred baseline nudged by the ink offset (got ${y}, want 1)`);
    });

    test('non-centred text is untouched (baseline at line origin)', () => {
        const y = renderY(VerticalAlignment.Top);
        assert.equal(y, 0, 'top-aligned text keeps its baseline-anchored y — no ink shift');
    });
});
