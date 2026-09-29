import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlock, RichTextBlock, RichTextBox, FlowDocument, Paragraph, Run } from '../../../basic/index.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

// The exact attribute form SvgDrawingContext.DrawText emits for a Body
// (@BodySize=15) TextBlock — confirmed against the live renderer (see
// task-7-report.md): `formatNumber` is a plain `n.toString()`, so a
// 15px font serialises as a bare integer, double-quoted.
const BodyFontSizeAttr = 'font-size="15"';

class RichTextDocuments
{
    public static SingleRunDocument(text: string): FlowDocument
    {
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.AddChild(new Run(text));
        doc.AddChild(p);
        return doc;
    }
}

describe('Pragmatic TextBlock', () =>
{
    test('resolves the Pragmatic style and renders the Body font size (15)', () =>
    {
        const { control, svg } = ControlHarness.Render(() => new TextBlock('Hello'), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'TextBlock uses the Pragmatic override style');
        assert.ok(svg.includes(BodyFontSizeAttr), 'TextBlock paints the Body font size (15)');
        ControlHarness.Reset();
    });

    test('bare TextBlock (Foreground unset) renders @Fg1 ink, not the grey fallback', () =>
    {
        const { svg } = ControlHarness.Render(() => new TextBlock('Hello'), { scheme: PragmaticLight });
        const fg1 = ControlHarness.TokenCss('Fg1');
        assert.equal(fg1, 'rgb(34,33,30)', '@Fg1 under PragmaticLight is #22211E');
        assert.ok(svg.includes(`fill="${fg1}"`), 'bare TextBlock paints @Fg1 as its render-time ink fallback');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — Theme.ink must resolve natively under Pragmatic');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @Fg1 ink', () =>
    {
        const { svg } = ControlHarness.Render(() => new TextBlock('Hello'), { scheme: PragmaticDark });
        const fg1 = ControlHarness.TokenCss('Fg1');
        assert.equal(fg1, 'rgb(232,231,226)', '@Fg1 under PragmaticDark is #E8E7E2');
        assert.ok(svg.includes(`fill="${fg1}"`), 'bare TextBlock paints the dark @Fg1 ink');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });

});

describe('Pragmatic RichTextBlock', () =>
{
    test('resolves the Pragmatic style and paints no grey fallback', () =>
    {
        const { control, svg } = ControlHarness.Render(() =>
        {
            const rtb = new RichTextBlock();
            rtb.Document = RichTextDocuments.SingleRunDocument('Hello');
            return rtb;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'RichTextBlock uses the Pragmatic override style');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — RichTextBlock ink resolves natively under Pragmatic');
        ControlHarness.Reset();
    });
});

describe('Pragmatic RichTextBox', () =>
{
    test('resolves the Pragmatic style and paints no grey fallback', () =>
    {
        const { control, svg } = ControlHarness.Render(() =>
        {
            const rtb = new RichTextBox();
            rtb.Document = RichTextDocuments.SingleRunDocument('Hello');
            return rtb;
        }, { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'RichTextBox uses the Pragmatic override style');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — RichTextBox ink resolves natively under Pragmatic');
        ControlHarness.Reset();
    });
});
