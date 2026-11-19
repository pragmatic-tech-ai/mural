import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    AlignmentX, AlignmentY, BitmapImage, Color, DashStyle, GradientStop, ImageBrush,
    LineCap, LineJoin, LinearGradientBrush, PatternBrush, PatternKind, Pen, Point,
    RadialGradientBrush, SolidColorBrush, Stretch,
} from '../../../../visual-engine/index.js';
import {
    deserializeBrush, deserializeStroke, isBrushVisible, serializeBrush, serializeStroke,
} from '../brush-serialization.js';

// The codec is the single fill/stroke wire form shared by every serializer.
// It must round-trip all six FillEditor brush kinds, encode None as null,
// still read legacy bare-string solids, and fold a solid's Brush.Opacity
// into the colour alpha (the Transparency-slider fix generalised).
describe('brush-serialization codec', () => {
    test('None → null → undefined', () => {
        assert.equal(serializeBrush(undefined), null);
        assert.equal(deserializeBrush(null), undefined);
        assert.equal(deserializeBrush(undefined), undefined);
    });

    test('solid → folded hex string; legacy bare string still reads', () => {
        const opaque = new SolidColorBrush(Color.FromHex('#3b82f6'));
        assert.equal(serializeBrush(opaque), '#3b82f6');
        // Transparency slider rode Brush.Opacity — folds into alpha: 255×0.5=128.
        const faded = new SolidColorBrush(Color.FromHex('#3b82f6')); faded.Opacity = 0.5;
        assert.equal(serializeBrush(faded), '#3b82f680');
        // Legacy files stored a bare 6-digit hex — must still deserialize.
        const back = deserializeBrush('#3b82f6') as SolidColorBrush;
        assert.equal(back.Color.ToHex(), '#3b82f6');
    });

    test('linear gradient round-trips stops + endpoints + opacity', () => {
        const b = new LinearGradientBrush([
            new GradientStop(Color.FromHex('#ffffff'), 0),
            new GradientStop(Color.FromHex('#1976d2'), 1),
        ]);
        b.StartPoint = new Point(0.1, 0.2); b.EndPoint = new Point(0.8, 0.9); b.Opacity = 0.7;
        const back = deserializeBrush(serializeBrush(b)) as LinearGradientBrush;
        assert.ok(back instanceof LinearGradientBrush);
        assert.equal(back.GradientStops.length, 2);
        assert.equal(back.GradientStops[0]!.Color.ToHex(), '#ffffff');
        assert.equal(back.GradientStops[1]!.Offset, 1);
        assert.deepEqual([back.StartPoint.X, back.StartPoint.Y], [0.1, 0.2]);
        assert.deepEqual([back.EndPoint.X, back.EndPoint.Y], [0.8, 0.9]);
        assert.equal(back.Opacity, 0.7);
    });

    test('radial gradient round-trips centre + radii', () => {
        const b = new RadialGradientBrush([
            new GradientStop(Color.FromHex('#ffffff'), 0),
            new GradientStop(Color.FromHex('#1976d2'), 1),
        ]);
        b.Center = new Point(0.3, 0.4); b.RadiusX = 0.6; b.RadiusY = 0.7;
        const back = deserializeBrush(serializeBrush(b)) as RadialGradientBrush;
        assert.ok(back instanceof RadialGradientBrush);
        assert.deepEqual([back.Center.X, back.Center.Y], [0.3, 0.4]);
        assert.equal(back.RadiusX, 0.6);
        assert.equal(back.RadiusY, 0.7);
    });

    test('pattern round-trips every knob', () => {
        const b = new PatternBrush(PatternKind.CrossHatch, Color.FromHex('#1976d2'));
        b.Background = Color.FromHex('#eeeeee'); b.Size = 12; b.Angle = 30; b.StrokeThickness = 2;
        const back = deserializeBrush(serializeBrush(b)) as PatternBrush;
        assert.ok(back instanceof PatternBrush);
        assert.equal(back.Kind, PatternKind.CrossHatch);
        assert.equal(back.Foreground.ToHex(), '#1976d2');
        assert.equal(back.Background.ToHex(), '#eeeeee');
        assert.equal(back.Size, 12);
        assert.equal(back.Angle, 30);
        assert.equal(back.StrokeThickness, 2);
    });

    test('image round-trips uri + stretch + alignment', () => {
        const b = new ImageBrush(new BitmapImage('img/logo.png'));
        b.Stretch = Stretch.UniformToFill; b.AlignmentX = AlignmentX.Left; b.AlignmentY = AlignmentY.Top;
        const back = deserializeBrush(serializeBrush(b)) as ImageBrush;
        assert.ok(back instanceof ImageBrush);
        assert.equal((back.ImageSource as BitmapImage).Uri, 'img/logo.png');
        assert.equal(back.Stretch, Stretch.UniformToFill);
        assert.equal(back.AlignmentX, AlignmentX.Left);
        assert.equal(back.AlignmentY, AlignmentY.Top);
    });

    test('isBrushVisible: undefined + fully-faded solid are invisible; others paint', () => {
        assert.equal(isBrushVisible(undefined), false);
        const clear = new SolidColorBrush(Color.FromHex('#00000000'));
        assert.equal(isBrushVisible(clear), false);
        const fadedToNothing = new SolidColorBrush(Color.FromHex('#3b82f6')); fadedToNothing.Opacity = 0;
        assert.equal(isBrushVisible(fadedToNothing), false);
        assert.equal(isBrushVisible(new SolidColorBrush(Color.FromHex('#3b82f6'))), true);
        assert.equal(isBrushVisible(new LinearGradientBrush([new GradientStop(Color.Black, 0)])), true);
    });

    test('stroke round-trips brush + width + dash + caps + join + miter (defaults omitted)', () => {
        const plain = serializeStroke(new Pen(new SolidColorBrush(Color.FromHex('#111111')), 2));
        assert.equal(plain.stroke, '#111111');
        assert.equal(plain.strokeWidth, 2);
        assert.equal('strokeDash' in plain, false);
        assert.equal('strokeCap' in plain, false);

        const pen = new Pen(new SolidColorBrush(Color.FromHex('#111111')), 3);
        pen.DashStyle = DashStyle.Dash; pen.LineCap = LineCap.Round; pen.LineJoin = LineJoin.Round; pen.MiterLimit = 4;
        const back = deserializeStroke(serializeStroke(pen))!;
        assert.equal((back.Brush as SolidColorBrush).Color.ToHex(), '#111111');
        assert.equal(back.Thickness, 3);
        assert.deepEqual(back.DashStyle.Dashes, DashStyle.Dash.Dashes);
        assert.equal(back.LineCap, LineCap.Round);
        assert.equal(back.LineJoin, LineJoin.Round);
        assert.equal(back.MiterLimit, 4);
    });

    test('stroke carries a gradient brush', () => {
        const pen = new Pen(new LinearGradientBrush([
            new GradientStop(Color.FromHex('#ff0000'), 0),
            new GradientStop(Color.FromHex('#0000ff'), 1),
        ]), 4);
        const back = deserializeStroke(serializeStroke(pen))!;
        assert.ok(back.Brush instanceof LinearGradientBrush);
        assert.equal((back.Brush as LinearGradientBrush).GradientStops.length, 2);
    });
});
