import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import { Color, FontFamily, SolidColorBrush } from '../../../../visual-engine/index.js';
import { ShapeText } from '../../shape-text.js';
import { serializeShapeText, applySerializedText } from '../node-serializers-default.js';

// Shape-caption text style: size/weight/style/alignment already round-trip;
// this adds the two the editor exposes but serialization dropped — the text
// COLOUR (Foreground) and FONT FAMILY.
function shapeText(content = 'Hi'): ShapeText
{
    Application.current = null; new Application();
    const st = new ShapeText(); st.Content = content; return st;
}

describe('shape-text colour + family serialization', () => {
    test('a user colour + family round-trip', () => {
        const st = shapeText();
        st.Foreground = new SolidColorBrush(Color.FromHex('#ff8800'));
        st.FontFamily = new FontFamily('Georgia, serif');
        const data = serializeShapeText(st)!;
        assert.equal(data.color, '#ff8800');
        assert.equal(data.family, 'Georgia, serif');

        const back = shapeText('');
        applySerializedText(back, data);
        assert.equal((back.Foreground as SolidColorBrush).Color.ToHex(), '#ff8800');
        assert.equal(back.FontFamily, 'Georgia, serif');
    });

    test('a plain-string family round-trips', () => {
        const st = shapeText();
        st.FontFamily = 'Inter';
        assert.equal(serializeShapeText(st)!.family, 'Inter');
    });

    test('the theme-default ink is omitted (stays theme-reactive)', () => {
        const st = shapeText();      // ctor sets Foreground = ShapeLabelInk default
        const data = serializeShapeText(st)!;
        assert.equal('color' in data, false);
        assert.equal('family' in data, false);
    });
});
