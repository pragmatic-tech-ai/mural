import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { layoutInlines, renderLayout, type FlowItem, type MeasureText, type MeasureObject, type ImageFragment, type TextFragment } from '../text-layout.js';
import { ImageDisplay, ImageInline } from '../inlines.js';
import { Application } from '../../../runtime/index.js';
import { BitmapImage, Color, FontStyle, FontWeight, SolidColorBrush, Stretch, SvgDrawingContext, TextDecorations, type TextMetrics } from '../../../visual-engine/index.js';
import type { RunProps } from '../text-element.js';

function newApp(): void { Application.current = null; new Application(); }

const PROPS: RunProps = {
    family: 'stub', size: 10, weight: FontWeight.Normal, style: FontStyle.Normal,
    foreground: undefined, decorations: TextDecorations.None, link: undefined,
};
// ascent 10, descent 2 → text box 12, centre 4 above baseline.
const measure: MeasureText = (t: string): TextMetrics =>
    ({ Width: [...t].length * 10, Height: 12, Ascent: 10, Descent: 2 } as TextMetrics);
const measureObject: MeasureObject = () => ({ width: 0, height: 0 });

function imageItem(w: number, h: number, display = ImageDisplay.Inline, uri = 'data:image/png;base64,AAAA'): FlowItem {
    const src = new BitmapImage(uri);
    const el = new ImageInline(src, { width: w, height: h, display });
    return { kind: 'image', image: src, width: w, height: h, stretch: Stretch.Uniform, display, source: el };
}

function layout(items: FlowItem[], availableWidth = Number.POSITIVE_INFINITY, wrap = false) {
    return layoutInlines(items, { availableWidth, wrap, letterSpacing: 0, lineHeight: Number.NaN, measureText: measure, measureObject });
}

describe('layoutInlines — inline image', () => {
    test('an inline image flows on the same line as text, middle-aligned', () => {
        newApp();
        const r = layout([
            { kind: 'text', text: 'ab', props: PROPS, source: new ImageInline() },
            imageItem(20, 16),
        ]);
        assert.equal(r.lines.length, 1, 'text + inline image share one line');
        const frags = r.lines[0]!.frags;
        const textFrag = frags.find((f) => f.kind === 'text') as TextFragment;
        const imgFrag  = frags.find((f) => f.kind === 'image') as ImageFragment;
        assert.ok(imgFrag !== undefined, 'an image fragment was produced');
        assert.equal(imgFrag.width, 20);
        assert.equal(imgFrag.height, 16);
        // middle-aligned: image centre == text vertical centre; box preserved
        const textCentre = textFrag.y + (textFrag.ascent + textFrag.descent) / 2;
        const imgCentre  = imgFrag.y + imgFrag.height / 2;
        assert.equal(imgCentre, textCentre, 'image centred on the text middle');
        assert.equal(imgFrag.ascent + imgFrag.descent, imgFrag.height);
    });

    test('a block image occupies its own line, separate from surrounding text', () => {
        const r = layout([
            { kind: 'text', text: 'before', props: PROPS, source: new ImageInline() },
            imageItem(40, 30, ImageDisplay.Block),
            { kind: 'text', text: 'after', props: PROPS, source: new ImageInline() },
        ]);
        assert.equal(r.lines.length, 3, 'text / image / text on three lines');
        const mid = r.lines[1]!.frags;
        assert.equal(mid.length, 1);
        assert.equal(mid[0]!.kind, 'image');
    });

    test('an oversized inline image is capped to the available width, height scaled', () => {
        const r = layout([imageItem(500, 250)], 100, true);
        const imgFrag = r.lines[0]!.frags[0] as ImageFragment;
        assert.equal(imgFrag.width, 100);
        assert.equal(imgFrag.height, 50);   // 250 * (100/500)
    });
});

describe('renderLayout — image paints via DrawImage (canvas + SVG)', () => {
    test('DrawImage is called with the fragment rect + stretch', () => {
        newApp();
        const calls: Array<{ uri: string; x: number; y: number; w: number; h: number; stretch: Stretch }> = [];
        const dc = {
            DrawText: (): void => {},
            DrawImage: (src: BitmapImage, rect: { X: number; Y: number; Width: number; Height: number }, stretch: Stretch): void => {
                calls.push({ uri: src.Uri, x: rect.X, y: rect.Y, w: rect.Width, h: rect.Height, stretch });
            },
        };
        const r = layout([imageItem(20, 16, ImageDisplay.Inline, 'http://x/p.png')]);
        renderLayout(dc as never, r, { originX: 0, originY: 0, letterSpacing: 0, ink: new SolidColorBrush(Color.FromHex('#000000')), link: new SolidColorBrush(Color.FromHex('#0000ff')) });
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.uri, 'http://x/p.png');
        assert.equal(calls[0]!.w, 20);
        assert.equal(calls[0]!.h, 16);
        assert.equal(calls[0]!.stretch, Stretch.Uniform);
    });

    test('a real SvgDrawingContext emits an <image> element', () => {
        newApp();
        const dc = new SvgDrawingContext();
        const r = layout([imageItem(20, 16, ImageDisplay.Inline, 'data:image/png;base64,AAAA')]);
        renderLayout(dc as never, r, { originX: 0, originY: 0, letterSpacing: 0, ink: new SolidColorBrush(Color.FromHex('#000000')), link: new SolidColorBrush(Color.FromHex('#0000ff')) });
        const svg = dc.ToFragment();
        assert.ok(svg.includes('<image'), 'exported SVG carries an <image> element');
    });
});
