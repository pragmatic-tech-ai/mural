import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import { Color, GradientStop, LinearGradientBrush, Pen, SolidColorBrush } from '../../../../visual-engine/index.js';
import { Figure } from '../../figure.js';
import { NodeViewModel } from '../../node-view-model.js';
import { NodeVisualStore } from '../node-visual-store.js';
import { PositionAnchor } from '../../position-anchor.js';

function fig(): Figure { Application.current = null; new Application(); return Figure.fromKind('rectangle', 10, 20, { width: 100, height: 50 }); }

describe('NodeVisualStore', () => {
    test('Read captures geometry; rotation/flags omitted when default', () => {
        const f = fig();
        const v = new NodeVisualStore().Read(f);
        assert.deepEqual(v, { left: 10, top: 20, w: 100, h: 50, baseWidth: 100, baseHeight: 50 });
    });
    test('Read includes rotation + flags when set', () => {
        const f = fig(); f.Rotation = 30; f.UserSized = true;
        const v = new NodeVisualStore().Read(f);
        assert.equal(v.rotation, 30);
        assert.equal(v.userSized, true);
    });
    test('lock aspect + position anchor: omitted at default, captured when set, round-tripped', () => {
        const store = new NodeVisualStore();
        // Defaults (lock off, Top-Left anchor) are omitted.
        const def = store.Read(fig());
        assert.equal('lockAspect' in def, false);
        assert.equal('anchor' in def, false);
        // Non-default values are captured...
        const f = fig(); f.LockAspectRatio = true; f.PositionFrom = PositionAnchor.Center;
        const v = store.Read(f);
        assert.equal(v.lockAspect, true);
        assert.equal(v.anchor, PositionAnchor.Center);
        // ...and restored onto a fresh node.
        const g = fig();
        store.Apply(v, g);
        assert.equal(g.LockAspectRatio, true);
        assert.equal(g.PositionFrom, PositionAnchor.Center);
    });
    test('Apply writes a record onto a node', () => {
        const f = fig();
        new NodeVisualStore().Apply({ left: 5, top: 6, w: 70, h: 40, rotation: 15 }, f);
        assert.equal(f.Left, 5); assert.equal(f.Top, 6);
        assert.equal(f.Width, 70); assert.equal(f.Height, 40);
        assert.equal(f.Rotation, 15);
    });
    test('content-tile card fill/stroke: visuals for VM hosts (plain + container), round-tripped, transparent omitted', () => {
        const store = new NodeVisualStore();
        const vm = (): NodeViewModel => new NodeViewModel();
        // A geometric shape (no VM content) — fill rides its node record, NOT visuals.
        const shape = fig(); shape.Fill = new SolidColorBrush(Color.FromHex('#3b82f6ff'));
        assert.equal('fill' in store.Read(shape), false);

        // A content tile (a VM host) persists a visible card fill + border...
        const tile = fig(); tile.Content = vm();
        tile.Fill   = new SolidColorBrush(Color.FromHex('#3b82f6ff'));
        tile.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#1e40afff')), 2);
        const v = store.Read(tile);
        assert.ok(typeof v.fill === 'string');
        assert.ok(typeof v.stroke === 'string');
        assert.equal(v.strokeWidth, 2);
        // ...restored onto a fresh tile.
        const g = fig(); g.Content = vm();
        store.Apply(v, g);
        assert.equal((g.Fill as SolidColorBrush).Color.ToHex(), (tile.Fill as SolidColorBrush).Color.ToHex());
        assert.equal((g.Stroke!.Brush as SolidColorBrush).Color.ToHex(), (tile.Stroke!.Brush as SolidColorBrush).Color.ToHex());
        assert.equal(g.Stroke!.Thickness, 2);

        // A CONTAINER content tile sizes to its children (SizeToContent false), yet
        // its card style still persists — regression: it was gated on SizeToContent.
        const container = fig(); container.Content = vm(); container.SizeToContent = false;
        container.Fill = new SolidColorBrush(Color.FromHex('#10b981ff'));
        assert.ok(typeof store.Read(container).fill === 'string', 'container card fill persists despite SizeToContent=false');

        // A transparent (unstyled) content tile writes nothing.
        const bare = fig(); bare.Content = vm();
        bare.Fill   = new SolidColorBrush(Color.FromHex('#00000000'));
        bare.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#00000000')), 1);
        const bv = store.Read(bare);
        assert.equal('fill' in bv, false);
        assert.equal('stroke' in bv, false);
    });
    test('content-tile card fill/stroke: Brush.Opacity folds into the saved alpha', () => {
        const store = new NodeVisualStore();
        const vm = (): NodeViewModel => new NodeViewModel();

        // An OPAQUE colour whose transparency rides Brush.Opacity (the Format
        // Shape "Transparency" slider) — the hex must carry it or it's lost on
        // save. 255 × 0.5 = 128 → 0x80.
        const tile = fig(); tile.Content = vm();
        const fill = new SolidColorBrush(Color.FromHex('#3b82f6')); fill.Opacity = 0.5;
        tile.Fill = fill;
        const stroke = new SolidColorBrush(Color.FromHex('#1e40af')); stroke.Opacity = 0.25;
        tile.Stroke = new Pen(stroke, 2);   // 255 × 0.25 = 64 → 0x40
        const v = store.Read(tile);
        assert.equal(v.fill,   '#3b82f680');
        assert.equal(v.stroke, '#1e40af40');
        // Round-trips: reload folds the transparency onto Color.A (Opacity 1).
        const g = fig(); g.Content = vm();
        store.Apply(v, g);
        assert.equal((g.Fill   as SolidColorBrush).Color.A, 128);
        assert.equal((g.Stroke!.Brush as SolidColorBrush).Color.A, 64);

        // Colour alpha AND Brush.Opacity compound: 128 × 0.5 = 64 → 0x40.
        const both = fig(); both.Content = vm();
        const b = new SolidColorBrush(Color.FromHex('#3b82f680')); b.Opacity = 0.5;
        both.Fill = b;
        assert.equal(store.Read(both).fill, '#3b82f640');

        // Fully faded (Opacity 0) omits the key, like a transparent colour.
        const faded = fig(); faded.Content = vm();
        const fb = new SolidColorBrush(Color.FromHex('#3b82f6')); fb.Opacity = 0;
        faded.Fill = fb;
        assert.equal('fill' in store.Read(faded), false);
    });
    test('content-tile card carries a gradient fill (not just solids)', () => {
        const store = new NodeVisualStore();
        const tile = fig(); tile.Content = new NodeViewModel();
        tile.Fill = new LinearGradientBrush([
            new GradientStop(Color.FromHex('#ffffff'), 0),
            new GradientStop(Color.FromHex('#1976d2'), 1),
        ]);
        const v = store.Read(tile);
        assert.equal(typeof v.fill, 'object', 'gradient card serialises as a tagged object');
        const g = fig(); g.Content = new NodeViewModel();
        store.Apply(v, g);
        assert.ok(g.Fill instanceof LinearGradientBrush);
        assert.equal((g.Fill as LinearGradientBrush).GradientStops.length, 2);
    });
    test('parentId: omitted when unset, captured + round-tripped when set', () => {
        const store = new NodeVisualStore();
        // Unset → omitted.
        const bare = fig();
        assert.equal('parentId' in store.Read(bare), false);
        // Set → captured...
        const child = fig(); child.ParentId = 'container-7';
        const v = store.Read(child);
        assert.equal(v.parentId, 'container-7');
        // ...and restored onto a fresh node.
        const g = fig();
        store.Apply(v, g);
        assert.equal(g.ParentId, 'container-7');
    });
    test('Seed → Snapshot round-trips the map', () => {
        const s = new NodeVisualStore();
        const map = { a: { left: 1, top: 2, w: 3, h: 4 } };
        s.Seed(map);
        assert.deepEqual(s.Snapshot(), map);
        assert.deepEqual(s.Get('a'), map.a);
    });
});
