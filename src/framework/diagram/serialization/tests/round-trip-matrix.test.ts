// Full-scope serialization matrix: every node kind the Mural serializers
// handle (shape / container / text / callout) driven through a real
// DiagramDocument Save → Load, across the entire Format Shape surface —
// all six fill variants + None, the full stroke (dash/caps/join), and the
// text style (size/weight/style/colour/family). This is the correctness net
// the Plexus Playwright spec mirrors in the running app.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import {
    AlignmentX, BitmapImage, Color, DashStyle, FontStyle, FontWeight, GradientStop,
    ImageBrush, LineCap, LinearGradientBrush, PatternBrush, PatternKind, Pen,
    RadialGradientBrush, SolidColorBrush, Stretch, TextAlignment,
} from '../../../../visual-engine/index.js';
import { DiagramDocument, type DiagramStorage } from '../../diagram-document.js';
import { Figure } from '../../figure.js';
import { ContainerFigure } from '../../container-figure.js';
import { TextNode } from '../../text-node.js';
import { Callout } from '../../callout.js';
import '../node-serializers-default.js';   // side-effect: register serializers

class MemoryStorage implements DiagramStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

function newDoc(storage: DiagramStorage): DiagramDocument
{
    Application.current = null; new Application();
    return new DiagramDocument(storage);
}

// Save the authored document, load a fresh one, and return its nodes keyed
// by Id so each case can assert its own node's restored style.
function roundTrip(author: (doc: DiagramDocument) => void): Map<string, unknown>
{
    const storage = new MemoryStorage();
    const doc = newDoc(storage);
    author(doc);
    doc.Save();
    const doc2 = newDoc(storage);
    doc2.Storage = storage;
    doc2.Load();
    const byId = new Map<string, unknown>();
    for (const n of doc2.Nodes.ToArray()) byId.set((n as { Id: string }).Id, n);
    return byId;
}

// A geometric shape with an Id + a size (so its visuals record is valid).
function shape(id: string, kind: string): Figure
{
    const f = Figure.fromKind(kind, 20, 30, { width: 90, height: 60 });
    f.Id = id; return f;
}

describe('serialization round-trip matrix — full style scope', () => {
    test('shape: solid fill + opacity + full stroke + full caption style', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('solid', 'rectangle');
            const fill = new SolidColorBrush(Color.FromHex('#3b82f6')); fill.Opacity = 0.5;
            f.Fill = fill;                                          // 255×0.5 = 128 → 0x80
            const pen = new Pen(new SolidColorBrush(Color.FromHex('#1e40af')), 3);
            pen.DashStyle = DashStyle.Dash; pen.LineCap = LineCap.Round;
            f.Stroke = pen;
            f.Text!.Content = 'Hi';
            f.Text!.FontSize = 20; f.Text!.FontWeight = FontWeight.Bold;
            f.Text!.FontStyle = FontStyle.Italic; f.Text!.TextAlignment = TextAlignment.Left;
            f.Text!.Foreground = new SolidColorBrush(Color.FromHex('#ff0000'));
            f.Text!.FontFamily = 'Georgia';
            doc.Nodes.Add(f);
        });
        const f = nodes.get('solid') as Figure;
        assert.equal((f.Fill as SolidColorBrush).Color.A, 128, 'fill opacity folded into alpha');
        assert.deepEqual(f.Stroke!.DashStyle.Dashes, DashStyle.Dash.Dashes);
        assert.equal(f.Stroke!.LineCap, LineCap.Round);
        assert.equal(f.Stroke!.Thickness, 3);
        assert.equal(f.Text!.Content, 'Hi');
        assert.equal(f.Text!.FontSize, 20);
        assert.equal(f.Text!.FontWeight, FontWeight.Bold);
        assert.equal(f.Text!.FontStyle, FontStyle.Italic);
        assert.equal(f.Text!.TextAlignment, TextAlignment.Left);
        assert.equal((f.Text!.Foreground as SolidColorBrush).Color.ToHex(), '#ff0000');
        assert.equal(f.Text!.FontFamily, 'Georgia');
    });

    test('shape: linear gradient fill', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('linear', 'ellipse');
            const g = new LinearGradientBrush([
                new GradientStop(Color.FromHex('#ffffff'), 0),
                new GradientStop(Color.FromHex('#1976d2'), 1),
            ]);
            g.StartPoint = { X: 0.1, Y: 0.2 } as never; g.EndPoint = { X: 0.8, Y: 0.9 } as never;
            f.Fill = g; doc.Nodes.Add(f);
        });
        const f = nodes.get('linear') as Figure;
        assert.ok(f.Fill instanceof LinearGradientBrush);
        const g = f.Fill as LinearGradientBrush;
        assert.equal(g.GradientStops.length, 2);
        assert.equal(g.GradientStops[0]!.Color.ToHex(), '#ffffff');
        assert.deepEqual([g.EndPoint.X, g.EndPoint.Y], [0.8, 0.9]);
    });

    test('shape: radial gradient fill', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('radial', 'triangle');
            const g = new RadialGradientBrush([
                new GradientStop(Color.FromHex('#ffffff'), 0),
                new GradientStop(Color.FromHex('#1976d2'), 1),
            ]);
            g.Center = { X: 0.3, Y: 0.4 } as never; g.RadiusX = 0.6; g.RadiusY = 0.7;
            f.Fill = g; doc.Nodes.Add(f);
        });
        const g = (nodes.get('radial') as Figure).Fill as RadialGradientBrush;
        assert.ok(g instanceof RadialGradientBrush);
        assert.deepEqual([g.Center.X, g.Center.Y], [0.3, 0.4]);
        assert.equal(g.RadiusX, 0.6); assert.equal(g.RadiusY, 0.7);
    });

    test('shape: pattern fill', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('pattern', 'rectangle');
            const p = new PatternBrush(PatternKind.CrossHatch, Color.FromHex('#1976d2'));
            p.Background = Color.FromHex('#eeeeee'); p.Size = 12; p.Angle = 30; p.StrokeThickness = 2;
            f.Fill = p; doc.Nodes.Add(f);
        });
        const p = (nodes.get('pattern') as Figure).Fill as PatternBrush;
        assert.ok(p instanceof PatternBrush);
        assert.equal(p.Kind, PatternKind.CrossHatch);
        assert.equal(p.Foreground.ToHex(), '#1976d2');
        assert.equal(p.Background.ToHex(), '#eeeeee');
        assert.equal(p.Size, 12); assert.equal(p.Angle, 30); assert.equal(p.StrokeThickness, 2);
    });

    test('shape: image fill', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('image', 'rectangle');
            const img = new ImageBrush(new BitmapImage('img/logo.png'));
            img.Stretch = Stretch.UniformToFill; img.AlignmentX = AlignmentX.Left;
            f.Fill = img; doc.Nodes.Add(f);
        });
        const img = (nodes.get('image') as Figure).Fill as ImageBrush;
        assert.ok(img instanceof ImageBrush);
        assert.equal((img.ImageSource as BitmapImage).Uri, 'img/logo.png');
        assert.equal(img.Stretch, Stretch.UniformToFill);
        assert.equal(img.AlignmentX, AlignmentX.Left);
    });

    test('shape: "None" fill reloads as no fill (not the default)', () => {
        const nodes = roundTrip((doc) => {
            const f = shape('none', 'rectangle');
            f.Fill = undefined; doc.Nodes.Add(f);
        });
        assert.equal((nodes.get('none') as Figure).Fill, undefined);
    });

    test('container: gradient card + title', () => {
        const nodes = roundTrip((doc) => {
            const c = new ContainerFigure();
            c.Id = 'cont'; c.Left = 40; c.Top = 40; c.Width = 240; c.Height = 160;
            c.Text.Content = 'Group';
            c.Fill = new LinearGradientBrush([
                new GradientStop(Color.FromHex('#ffffff'), 0),
                new GradientStop(Color.FromHex('#10b981'), 1),
            ]);
            doc.Nodes.Add(c);
        });
        const c = nodes.get('cont') as ContainerFigure;
        assert.ok(c instanceof ContainerFigure);
        assert.equal(c.Text.Content, 'Group');
        assert.ok(c.Fill instanceof LinearGradientBrush);
    });

    test('text node: full text style incl. colour + family', () => {
        const nodes = roundTrip((doc) => {
            const t = new TextNode();
            t.Id = 'txt'; t.Left = 5; t.Top = 5; t.LabelText = 'note';
            t.Text.FontSize = 18; t.Text.FontWeight = FontWeight.Bold;
            t.Text.Foreground = new SolidColorBrush(Color.FromHex('#00aa00'));
            t.Text.FontFamily = 'Courier';
            doc.Nodes.Add(t);
        });
        const t = nodes.get('txt') as TextNode;
        assert.ok(t instanceof TextNode);
        assert.equal(t.Text.Content, 'note');
        assert.equal(t.Text.FontSize, 18);
        assert.equal(t.Text.FontWeight, FontWeight.Bold);
        assert.equal((t.Text.Foreground as SolidColorBrush).Color.ToHex(), '#00aa00');
        assert.equal(t.Text.FontFamily, 'Courier');
    });

    test('callout: text + leader target re-wired', () => {
        const nodes = roundTrip((doc) => {
            const tgt = new TextNode();
            tgt.Id = 'tgt'; tgt.Left = 300; tgt.Top = 200; tgt.Width = 80; tgt.Height = 60;
            tgt.LabelText = 'target';
            doc.Nodes.Add(tgt);
            const call = new Callout();
            call.Id = 'call'; call.Left = 0; call.Top = 0; call.LabelText = 'callout';
            call.LeaderTargetNode = tgt;
            doc.Nodes.Add(call);
        });
        const call = nodes.get('call') as Callout;
        const tgt = nodes.get('tgt') as TextNode;
        assert.ok(call instanceof Callout);
        assert.equal(call.Text.Content, 'callout');
        assert.equal(call.LeaderTargetNode, tgt, 'leader re-wired to reloaded target');
    });
});
