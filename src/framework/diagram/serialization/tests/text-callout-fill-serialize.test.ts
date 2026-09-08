// A text node and a callout are paintable Figures, but their serializers used to
// persist only the caption (and the callout's leader) — the Format Shape fill/stroke
// the user set was dropped on save, so the styling was lost on reopen. Both serializers
// must now round-trip fill/stroke the way the 'shape'/'container' serializers do.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import { Color, Pen, SolidColorBrush } from '../../../../visual-engine/index.js';
import { TextNode } from '../../text-node.js';
import { Callout } from '../../callout.js';
import '../node-serializers-default.js';   // side-effect: register shape/text/callout/container
import { serializerFor } from '../node-serialization.js';

function newApp(): void { Application.current = null; new Application(); }

describe('text + callout serializers persist Format Shape fill/stroke', () => {
    test('a text node round-trips its fill and stroke (were dropped before)', () => {
        newApp();
        const t = new TextNode();
        t.Fill = new SolidColorBrush(Color.FromHex('#3b82f6'));
        t.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#1e40af')), 2);

        const ser = serializerFor(t);
        assert.ok(ser !== undefined && ser.type === 'text', 'the text serializer handles a TextNode');
        const data = ser!.serialize(t);
        assert.ok(data.fill != null, 'fill now serialized');       // absent before the fix
        assert.ok(data.stroke != null, 'stroke now serialized');

        const back = ser!.deserialize(data) as TextNode;
        assert.equal((back.Fill as SolidColorBrush).Color.ToHex(), (t.Fill as SolidColorBrush).Color.ToHex());
        assert.equal((back.Stroke!.Brush as SolidColorBrush).Color.ToHex(), '#1e40af');
        assert.equal(back.Stroke!.Thickness, 2);
    });

    test('a callout round-trips its fill and stroke while keeping its leader payload', () => {
        newApp();
        const c = new Callout();
        c.Fill = new SolidColorBrush(Color.FromHex('#22c55e'));
        c.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#15803d')), 3);

        const ser = serializerFor(c);
        assert.ok(ser !== undefined && ser.type === 'callout', 'the callout serializer handles a Callout');
        const data = ser!.serialize(c);
        assert.ok(data.fill != null, 'fill now serialized');
        assert.ok(data.stroke != null, 'stroke now serialized');
        assert.ok('leaderTargetId' in data, 'leader payload still present');

        const back = ser!.deserialize(data) as Callout;
        assert.equal((back.Fill as SolidColorBrush).Color.ToHex(), (c.Fill as SolidColorBrush).Color.ToHex());
        assert.equal((back.Stroke!.Brush as SolidColorBrush).Color.ToHex(), '#15803d');
        assert.equal(back.Stroke!.Thickness, 3);
    });

    test('an explicit "None" fill round-trips as no fill on a text node', () => {
        newApp();
        const t = new TextNode();
        assert.ok(t.Fill !== undefined, 'a fresh text node has a default fill');
        t.Fill = undefined;                                 // Format Shape → None

        const ser = serializerFor(t)!;
        const data = ser.serialize(t);
        assert.equal(data.fill, null, 'None serialises as an explicit null');
        const back = ser.deserialize(data) as TextNode;
        assert.equal(back.Fill, undefined, 'None reloads as no fill, not the default');
    });
});
