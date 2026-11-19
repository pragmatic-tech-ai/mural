import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import {
    Color, DashStyle, GradientStop, LineCap, LinearGradientBrush, Pen, SolidColorBrush,
} from '../../../../visual-engine/index.js';
import { Figure } from '../../figure.js';
import '../node-serializers-default.js';   // side-effect: register 'shape' serializer
import { serializerFor } from '../node-serialization.js';

// The Format Shape "Transparency" slider rides Brush.Opacity, a scalar
// separate from Color.A. The default 'shape' serializer captures fill/stroke
// as a hex colour; it must fold Opacity into the saved alpha or the
// transparency is silently lost on save (a shape reloads fully opaque).
function shape(): Figure { Application.current = null; new Application(); return Figure.fromKind('rectangle', 0, 0, { width: 80, height: 40 }); }

describe('shape serializer folds Brush.Opacity into the saved alpha', () => {
    test('opaque colour + Brush.Opacity round-trips as colour alpha', () => {
        const fig = shape();
        const fill = new SolidColorBrush(Color.FromHex('#3b82f6')); fill.Opacity = 0.5;
        fig.Fill = fill;                                    // 255 × 0.5 = 128 → 0x80
        const stroke = new SolidColorBrush(Color.FromHex('#1e40af')); stroke.Opacity = 0.25;
        fig.Stroke = new Pen(stroke, 3);                    // 255 × 0.25 = 64 → 0x40

        const ser = serializerFor(fig);
        assert.ok(ser !== undefined, 'a serializer handles a Figure');
        const data = ser!.serialize(fig);
        assert.equal(data.fill,   '#3b82f680');
        assert.equal(data.stroke, '#1e40af40');

        const back = ser!.deserialize(data) as Figure;
        assert.equal((back.Fill as SolidColorBrush).Color.A, 128);
        assert.equal((back.Stroke!.Brush as SolidColorBrush).Color.A, 64);
        assert.equal(back.Stroke!.Thickness, 3);
    });

    test('a gradient fill + dashed round-cap stroke survive the shape serializer', () => {
        const fig = shape();
        fig.Fill = new LinearGradientBrush([
            new GradientStop(Color.FromHex('#ffffff'), 0),
            new GradientStop(Color.FromHex('#1976d2'), 1),
        ]);
        const pen = new Pen(new SolidColorBrush(Color.FromHex('#111111')), 2);
        pen.DashStyle = DashStyle.Dash; pen.LineCap = LineCap.Round;
        fig.Stroke = pen;

        const ser = serializerFor(fig)!;
        const back = ser.deserialize(ser.serialize(fig)) as Figure;
        assert.ok(back.Fill instanceof LinearGradientBrush, 'gradient fill kept (was dropped before)');
        assert.equal((back.Fill as LinearGradientBrush).GradientStops.length, 2);
        assert.deepEqual(back.Stroke!.DashStyle.Dashes, DashStyle.Dash.Dashes);
        assert.equal(back.Stroke!.LineCap, LineCap.Round);
    });

    test('explicit "None" fill round-trips as no fill (not the constructed default)', () => {
        const fig = shape();
        assert.ok(fig.Fill !== undefined, 'a fresh shape has a default fill');
        fig.Fill = undefined;                       // Format Shape → None

        const ser = serializerFor(fig)!;
        const data = ser.serialize(fig);
        assert.equal(data.fill, null, 'None serialises as an explicit null');
        const back = ser.deserialize(data) as Figure;
        assert.equal(back.Fill, undefined, 'None reloads as no fill, not the default');
    });
});
