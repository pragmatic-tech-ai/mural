import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, Size, Rect } from '../../../../runtime/index.js';
import { Orientation } from '../../../../basic/index.js';
import { RulerBar } from '../ruler-bar.js';

// A recording DrawingContext double capturing DrawRectangle / DrawText calls.
class RecordingDc
{
    public rects: Rect[] = [];
    public texts: { text: unknown; x: number; y: number }[] = [];
    public DrawRectangle(_b: unknown, _p: unknown, rect: Rect): void { this.rects.push(rect); }
    public DrawRoundedRectangle(): void {}
    public DrawGeometry(): void {}
    public DrawText(text: unknown, origin: { X: number; Y: number }): void { this.texts.push({ text, x: origin.X, y: origin.Y }); }
    public DrawImage(): void {}
    public PushTransform(): void {}
    public Pop(): void {}
}

describe('RulerBar', () => {
    test('a horizontal ruler paints its strip fill and at least one tick + label', () => {
        Application.current = null; new Application();
        const ruler = new RulerBar();
        ruler.Orientation = Orientation.Horizontal;
        ruler.Zoom = 1; ruler.Offset = 0; ruler.Extent = 400;
        ruler.Measure(new Size(400, 20));
        ruler.Arrange(new Rect(0, 0, 400, 20));

        const dc = new RecordingDc();
        (ruler as unknown as { RenderOverride(dc: unknown): void }).RenderOverride(dc);

        assert.ok(dc.rects.length >= 2, 'strip fill + at least one tick');
        assert.ok(dc.texts.length >= 1, 'at least one numeric label');
    });

    test('respects Offset (pan): ticks project through c*Zoom - Offset', () => {
        Application.current = null; new Application();
        const ruler = new RulerBar();
        ruler.Orientation = Orientation.Horizontal;
        ruler.Zoom = 1; ruler.Offset = 100; ruler.Extent = 400;
        ruler.Measure(new Size(400, 20));
        ruler.Arrange(new Rect(0, 0, 400, 20));
        const dc = new RecordingDc();
        (ruler as unknown as { RenderOverride(dc: unknown): void }).RenderOverride(dc);
        // content range with pan 100 is [100, 500]; every tick host x = c - 100 in [0,400].
        const tickXs = dc.rects.slice(1).map(r => r.X);
        assert.ok(tickXs.length >= 1);
        assert.ok(tickXs.every(x => x >= -1 && x <= 401), 'ticks projected within the strip');
    });

    test('advertises a resize cursor matching its orientation', () => {
        Application.current = null; new Application();
        const top = new RulerBar();
        top.Orientation = Orientation.Horizontal;
        assert.equal(top.Cursor, 'ns-resize', 'top ruler pulls out a horizontal guide (moves vertically)');
        const left = new RulerBar();
        left.Orientation = Orientation.Vertical;
        assert.equal(left.Cursor, 'ew-resize', 'left ruler pulls out a vertical guide (moves horizontally)');
    });

    test('paints an extra hover wash while the pointer is over the strip', () => {
        Application.current = null; new Application();
        const ruler = new RulerBar();
        ruler.Orientation = Orientation.Horizontal;
        ruler.Zoom = 1; ruler.Offset = 0; ruler.Extent = 400;
        ruler.Measure(new Size(400, 20));
        ruler.Arrange(new Rect(0, 0, 400, 20));

        const cold = new RecordingDc();
        (ruler as unknown as { RenderOverride(dc: unknown): void }).RenderOverride(cold);
        (ruler as unknown as { _setIsMouseOver(v: boolean): void })._setIsMouseOver(true);
        const hot = new RecordingDc();
        (ruler as unknown as { RenderOverride(dc: unknown): void }).RenderOverride(hot);

        assert.equal(hot.rects.length, cold.rects.length + 1, 'exactly one extra wash rect on hover');
    });

    test('a vertical ruler measures to the ruler thickness on its cross axis', () => {
        Application.current = null; new Application();
        const ruler = new RulerBar();
        ruler.Orientation = Orientation.Vertical;
        ruler.Measure(new Size(20, 300));
        assert.ok(ruler.DesiredSize.Width > 0, 'vertical ruler claims a fixed width');
    });
});
