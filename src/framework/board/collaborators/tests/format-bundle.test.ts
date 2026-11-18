import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Color, Pen, SolidColorBrush, TextAlignment } from '../../../../visual-engine/index.js';
import { Figure } from '../../figure.js';
import { Connector } from '../../connector.js';
import { TextPlacement } from '../../shape-text.js';
import { captureFormat, applyFormat } from '../format-bundle.js';

function styledShape(): Figure
{
    const fig = Figure.fromKind('rectangle', 0, 0);
    fig.Fill   = new SolidColorBrush(Color.FromHex('#00ff00'));
    fig.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#ff0000')), 4);
    fig.LockAspectRatio = true;
    fig.Text.Content = 'source';
    fig.Text.ApplyFontSize(22);
    fig.Text.ApplyBold(true);
    fig.Text.ApplyParagraphAlignment(TextAlignment.Right);
    fig.Text.Placement = TextPlacement.Bottom;
    return fig;
}

describe('format-bundle — capture / apply', () => {
    beforeEach(() => { initTestApp(); });

    test('a shape`s paint + lock + text style transfer to another shape (content untouched)', () => {
        const bundle = captureFormat(styledShape());

        const target = Figure.fromKind('ellipse', 10, 10);
        target.Text.Content = 'target';           // must survive the stamp
        applyFormat(target, bundle);

        assert.equal((target.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#00ff00');
        assert.equal((target.Stroke!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#ff0000');
        assert.equal(target.Stroke!.Thickness, 4);
        assert.equal(target.LockAspectRatio, true);
        assert.equal(target.Text.CurrentFontSize(), 22);
        assert.equal(target.Text.CurrentBold(), true);
        assert.equal(target.Text.CurrentParagraphAlignment(), TextAlignment.Right);
        assert.equal(target.Text.Placement, TextPlacement.Bottom);
        assert.equal(target.Text.Content, 'target', 'content is NOT copied');
    });

    test('an explicit None fill round-trips (clears the target`s fill)', () => {
        const src = Figure.fromKind('rectangle', 0, 0);
        src.Fill = undefined;                       // None
        const bundle = captureFormat(src);

        const target = Figure.fromKind('rectangle', 0, 0);
        target.Fill = new SolidColorBrush(Color.FromHex('#123456'));
        applyFormat(target, bundle);

        assert.equal(target.Fill, undefined, 'None fill stamped over the solid');
    });

    test('a connector`s stroke + end-caps transfer to another connector', () => {
        const src = new Connector();
        src.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#0000ff')), 2);
        src.SourceCapScale = 3;
        src.TargetCapScale = 5;
        const bundle = captureFormat(src);

        const target = new Connector();
        applyFormat(target, bundle);

        assert.equal((target.Stroke!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#0000ff');
        assert.equal(target.SourceCapScale, 3);
        assert.equal(target.TargetCapScale, 5);
    });

    test('stamping a shape onto a connector copies stroke, skips fill/lock/caps (no throw)', () => {
        const bundle = captureFormat(styledShape());   // has fill + lock, no caps

        const target = new Connector();
        applyFormat(target, bundle);                    // must not throw

        assert.equal((target.Stroke!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#ff0000');
        assert.equal(target.Stroke!.Thickness, 4);
    });

    test('stamping a connector onto a shape copies stroke, leaves fill intact (caps ignored)', () => {
        const src = new Connector();
        src.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#0000ff')), 2);
        src.SourceCapScale = 9;
        const bundle = captureFormat(src);              // no fill channel

        const target = Figure.fromKind('rectangle', 0, 0);
        target.Fill = new SolidColorBrush(Color.FromHex('#abcdef'));
        applyFormat(target, bundle);

        assert.equal((target.Stroke!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#0000ff');
        assert.equal((target.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#abcdef', 'fill untouched — connector had no fill channel');
    });
});
