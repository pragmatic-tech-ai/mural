import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { FontWeight, FontStyle, RotateTransform, ScaleTransform, TextAlignment, TextDecorations, TransformGroup, VerticalAlignment } from '../../../visual-engine/index.js';
import { Key, KeyEventArgs, ModifierKeys, Point, Rect, Size } from '../../../runtime/index.js';
import { TextBlock, MeasurementFidelity } from '../../../basic/text-block.js';
import { RichTextBox } from '../../../basic/rich-text-box.js';
import { Border } from '../../../basic/border.js';
import { FlowDocument } from '../../../basic/documents/flow-document.js';
import { Paragraph } from '../../../basic/documents/paragraph.js';
import { Run } from '../../../basic/documents/inlines.js';
import { Figure } from '../figure.js';
import { TextNode } from '../text-node.js';
import { ShapeText, TextAutoFit, TextPlacement, computeTextBlockAnchor, isOutsideTextPlacement } from '../shape-text.js';
import {
    cloneFlowDocument, deserializeFlowDocument, flowDocumentFromPlainText,
    flowDocumentToPlainText, isEffectivelyPlainDocument, serializeFlowDocument,
} from '../serialization/shape-text-document.js';
import { BoardDocument, type BoardStorage } from '../board-document.js';

// A rich document: "Hello world" (world bold) + a centred italic second line.
function makeRichDoc(): FlowDocument
{
    const doc = new FlowDocument();
    const p1 = new Paragraph();
    p1.Inlines.Add(new Run('Hello '));
    const bold = new Run('world'); bold.FontWeight = FontWeight.Bold;
    p1.Inlines.Add(bold);
    doc.Blocks.Add(p1);
    const p2 = new Paragraph();
    p2.TextAlignment = TextAlignment.Center;
    const ital = new Run('second'); ital.FontStyle = FontStyle.Italic;
    p2.Inlines.Add(ital);
    doc.Blocks.Add(p2);
    return doc;
}

// § board-text Slice 1 — the ShapeText spine: a Figure owns a first-class
// text block, it renders reactively, and its text survives save/load (the
// data-loss bug the old flat LabelText string had).

class MemoryStorage implements BoardStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

describe('ShapeText — Figure ownership + sugar', () => {
    beforeEach(() => { initTestApp(); });

    test('a Figure seeds a first-class ShapeText', () => {
        const f = new Figure();
        assert.ok(f.Text instanceof ShapeText, 'Figure.Text is a ShapeText');
    });

    // An empty label (e.g. a bare connector) previously entered edit mode with a
    // zero-size, invisible RichTextBox — "no editor appears". PART_Edit now carries
    // MinWidth/MinHeight so a clickable caret box shows while editing.
    test('an empty ShapeText shows a visible (non-zero) editor while editing', () => {
        const t = new ShapeText();
        t.Content = '';
        const box = t.GetTemplateChild('PART_Edit') as RichTextBox;
        assert.ok(box instanceof RichTextBox, 'template carries a PART_Edit editor');

        t.IsEditing = true;   // the when(IsEditing) trigger reveals PART_Edit
        t.Measure(new Size(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY));

        assert.ok(box.DesiredSize.Width  >= 32, `editor width ${box.DesiredSize.Width} >= 32`);
        assert.ok(box.DesiredSize.Height >= 16, `editor height ${box.DesiredSize.Height} >= 16`);

        // The active editor draws a hairline 0.5px bounding box on PART_Bg,
        // cleared when editing ends.
        const bg = t.GetTemplateChild('PART_Bg') as Border;
        assert.ok(bg?.Stroke !== undefined, 'editing shows a bounding box');
        t.IsEditing = false;
        assert.equal(bg.Stroke, undefined, 'the bounding box clears when editing ends');
    });

    test('LabelText is sugar over Text.Content, both directions', () => {
        const f = new Figure();
        f.LabelText = 'Hello';
        assert.equal(f.Text.Content, 'Hello', 'LabelText write reaches Text.Content');
        f.Text.Content = 'World';
        assert.equal(f.LabelText, 'World', 'Text.Content read surfaces through LabelText');
    });

    test('each Figure owns its own text block (no shared instance)', () => {
        const a = new Figure();
        const b = new Figure();
        a.LabelText = 'A';
        assert.notEqual(a.Text, b.Text, 'distinct ShapeText instances');
        assert.equal(b.LabelText, '', 'setting one label does not leak to another');
    });
});

describe('ShapeText — reactive rendering', () => {
    beforeEach(() => { initTestApp(); });

    function partText(f: Figure): TextBlock
    {
        return f.Text.GetTemplateChild('PART_Text') as TextBlock;
    }

    test('the Figure hosts its ShapeText in PART_LabelHost', () => {
        const f = new Figure();
        const host = f.GetTemplateChild('PART_LabelHost') as Border;
        assert.equal(host.child, f.Text, 'the ShapeText is the PART_LabelHost child');
    });

    test('Content flows to the template TextBlock and updates reactively', () => {
        const f = new Figure();
        f.LabelText = 'Hi';
        assert.equal(partText(f).Text, 'Hi', 'initial content rendered');
        f.LabelText = 'Bye';
        assert.equal(partText(f).Text, 'Bye', 'a Content edit repaints via TemplateBinding');
    });

    test('the label measures with Exact fidelity (node border sizes to painted text)', () => {
        // The node border sizes to this label; under the board's zoom
        // LayoutTransform a Canvas-vs-paint width gap gets magnified, so the
        // label opts into the paint-engine (SVG) measurer — same as Chip/markers.
        const f = new Figure();
        assert.equal(partText(f).MeasurementFidelity, MeasurementFidelity.Exact);
    });

    test('character formatting flows through to the TextBlock', () => {
        const f = new Figure();
        f.Text.FontSize   = 20;
        f.Text.FontWeight = FontWeight.Bold;
        f.Text.FontStyle  = FontStyle.Italic;
        f.Text.TextAlignment = TextAlignment.Left;
        const tb = partText(f);
        assert.equal(tb.FontSize, 20);
        assert.equal(tb.FontWeight, FontWeight.Bold);
        assert.equal(tb.FontStyle, FontStyle.Italic);
        assert.equal(tb.TextAlignment, TextAlignment.Left);
    });

    test('default text alignment is centred (Visio/M3 default)', () => {
        const f = new Figure();
        assert.equal(f.Text.TextAlignment, TextAlignment.Center);
    });
});

describe('ShapeText — save/load persistence', () => {
    beforeEach(() => { initTestApp(); });

    test('label text survives a Save/Load round-trip (the data-loss fix)', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; n.Left = 10; n.Top = 20; doc.Nodes.Add(n);
        n.LabelText = 'Node A';
        doc.Save();
        doc.Load();
        const reloaded = doc.Nodes.Get(0) as TextNode;
        assert.equal(reloaded.LabelText, 'Node A', 'content round-trips');
    });

    test('non-default formatting round-trips too', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.LabelText        = 'Styled';
        n.Text.FontSize    = 18;
        n.Text.FontWeight  = FontWeight.Bold;
        n.Text.FontStyle   = FontStyle.Italic;
        n.Text.TextAlignment = TextAlignment.Left;
        doc.Save();
        doc.Load();
        const st = (doc.Nodes.Get(0) as TextNode).Text;
        assert.equal(st.Content, 'Styled');
        assert.equal(st.FontSize, 18);
        assert.equal(st.FontWeight, FontWeight.Bold);
        assert.equal(st.FontStyle, FontStyle.Italic);
        assert.equal(st.TextAlignment, TextAlignment.Left);
    });

    test('an empty label round-trips as empty (no phantom text)', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        doc.Save();
        doc.Load();
        assert.equal((doc.Nodes.Get(0) as TextNode).LabelText, '', 'stays empty');
    });
});

describe('ShapeText — in-place editing (Slice 2 / 4)', () => {
    beforeEach(() => { initTestApp(); });

    // The editor is now a RichTextBox (§ Slice 4: all in-place editing is
    // rich). Its plain-text projection stands in for the old TextBox.Text.
    function editor(st: ShapeText): RichTextBox
    {
        return st.GetTemplateChild('PART_Edit') as RichTextBox;
    }
    function editorText(st: ShapeText): string
    {
        const doc = editor(st).Document;
        return doc !== undefined ? flowDocumentToPlainText(doc) : '';
    }
    function keyDown(st: ShapeText, key: Key): KeyEventArgs
    {
        const args = new KeyEventArgs('KeyDown', st, {
            Key: key, KeyText: key, Code: key, Modifiers: ModifierKeys.None, IsRepeat: false,
        });
        (st as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
        return args;
    }

    test('BeginEdit enters edit mode and seeds the editor with the content', () => {
        const st = new Figure().Text;
        st.Content = 'Alpha';
        st.BeginEdit();
        assert.equal(st.IsEditing, true, 'IsEditing flips');
        assert.equal(editorText(st), 'Alpha', 'editor seeded from Content');
    });

    test('CommitEdit writes the editor text back to Content (plain collapse)', () => {
        const st = new Figure().Text;
        st.Content = 'Alpha';
        st.BeginEdit();
        editor(st).Document = flowDocumentFromPlainText('Beta');   // simulate typing
        st.CommitEdit();
        assert.equal(st.IsEditing, false);
        assert.equal(st.Content, 'Beta', 'commit adopts the edited text');
        assert.equal(st.Document, undefined, 'a formatting-free edit collapses back to plain Content');
    });

    test('CancelEdit discards the edit; Content is unchanged', () => {
        const st = new Figure().Text;
        st.Content = 'Alpha';
        st.BeginEdit();
        editor(st).Document = flowDocumentFromPlainText('Beta');
        st.CancelEdit();
        assert.equal(st.IsEditing, false);
        assert.equal(st.Content, 'Alpha', 'cancel keeps the original');
    });

    test('Escape cancels while editing (via OnKeyDown)', () => {
        const st = new Figure().Text;
        st.Content = 'Alpha';
        st.BeginEdit();
        editor(st).Document = flowDocumentFromPlainText('Discarded');
        const esc = keyDown(st, Key.Escape);
        assert.equal(esc.Handled, true, 'Escape is handled');
        assert.equal(st.Content, 'Alpha', 'Escape kept the pre-edit value');
        assert.equal(st.IsEditing, false);
    });

    test('Enter is NOT a commit at the ShapeText level (RichTextBox owns it)', () => {
        const st = new Figure().Text;
        st.Content = 'Alpha';
        st.BeginEdit();
        const enter = keyDown(st, Key.Return);
        assert.equal(enter.Handled, false, 'ShapeText does not consume Return (it is a paragraph break)');
        assert.equal(st.IsEditing, true, 'still editing after Enter');
    });

    test('keys are ignored when not editing (pass through to super)', () => {
        const st = new Figure().Text;
        const args = keyDown(st, Key.Escape);
        assert.equal(args.Handled, false, 'Escape not consumed outside edit mode');
    });

    test('a double-click on the Figure begins editing', () => {
        const f = new Figure();
        f.LabelText = 'Node';
        // Duck-typed PointerEventArgs — OnPointerDown's double-click path only
        // reads IsDoubleClick + Handled.
        const args = { IsDoubleClick: true, Handled: false };
        (f as unknown as { OnPointerDown(a: unknown): void }).OnPointerDown(args);
        assert.equal(args.Handled, true, 'the gesture is consumed');
        assert.equal(f.Text.IsEditing, true, 'double-click entered edit mode');
        assert.equal(editorText(f.Text), 'Node', 'editor seeded from the label');
    });
});

// § board-text Slice 3 — the independent text-block transform. The block
// can be placed (9-point + outside presets), offset, resized, and rotated
// within/around the shape footprint; ShapeText lays it out itself and the
// transform survives Save/Load.

describe('ShapeText — placement geometry (pure)', () => {
    // computeTextBlockAnchor is the shared source of truth for both the
    // ArrangeOverride and the text-block adorner, so lock its math directly.
    // Footprint 100×80, block 40×20.
    const fw = 100, fh = 80, bw = 40, bh = 20;

    test('inside anchors pin the block to the right point', () => {
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Center,      fw, fh, bw, bh), { x: 30, y: 30 });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Top,         fw, fh, bw, bh), { x: 30, y: 0  });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Bottom,      fw, fh, bw, bh), { x: 30, y: 60 });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Left,        fw, fh, bw, bh), { x: 0,  y: 30 });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Right,       fw, fh, bw, bh), { x: 60, y: 30 });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.TopLeft,     fw, fh, bw, bh), { x: 0,  y: 0  });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.BottomRight, fw, fh, bw, bh), { x: 60, y: 60 });
    });

    test('outside anchors float the block beyond the named edge', () => {
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Above,   fw, fh, bw, bh), { x: 30,  y: -20 });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.Below,   fw, fh, bw, bh), { x: 30,  y: 80  });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.LeftOf,  fw, fh, bw, bh), { x: -40, y: 30  });
        assert.deepEqual(computeTextBlockAnchor(TextPlacement.RightOf, fw, fh, bw, bh), { x: 100, y: 30  });
    });

    test('isOutsideTextPlacement classifies the four outside presets', () => {
        for (const p of [TextPlacement.Above, TextPlacement.Below, TextPlacement.LeftOf, TextPlacement.RightOf])
        {
            assert.equal(isOutsideTextPlacement(p), true, `${p} is outside`);
        }
        for (const p of [TextPlacement.Center, TextPlacement.Top, TextPlacement.BottomLeft])
        {
            assert.equal(isOutsideTextPlacement(p), false, `${p} is inside`);
        }
    });
});

describe('ShapeText — block layout + rotation', () => {
    beforeEach(() => { initTestApp(); });

    // Lay a standalone block out in an 80×80 footprint (the Figure's slot).
    function layout(st: ShapeText): void
    {
        st.Measure(new Size(80, 80));
        st.Arrange(new Rect(0, 0, 80, 80));
    }
    function bg(st: ShapeText): Border { return st.GetTemplateChild('PART_Bg') as Border; }

    test('default block fills the footprint', () => {
        const st = new ShapeText();
        st.Content = 'x';
        layout(st);
        const r = st.GetBlockRect();
        assert.deepEqual([r.X, r.Y, r.Width, r.Height], [0, 0, 80, 80]);
    });

    // Auto (NaN) block size: an inside EDGE/CORNER placement hugs its content on
    // the pinned axis and anchors there — so the 9-grid label-placement toolbar
    // visibly moves the label. (Regression guard for "placement does nothing".)
    test('auto block + TopLeft placement hugs content and pins to the corner', () => {
        const st = new ShapeText();
        st.Content = 'x';
        st.Placement = TextPlacement.TopLeft;
        layout(st);
        const r = st.GetBlockRect();
        assert.equal(r.X, 0, 'pinned to the left');
        assert.equal(r.Y, 0, 'pinned to the top');
        assert.ok(r.Width  < 80, 'hugs content width, not the footprint');
        assert.ok(r.Height < 80, 'hugs content height, not the footprint');
    });

    // A vertically-centred placement (Right) fills the HEIGHT (so vertical
    // alignment still works) but hugs the WIDTH and pins to the right edge.
    test('auto block + Right placement fills height, hugs width, pins right', () => {
        const st = new ShapeText();
        st.Content = 'x';
        st.Placement = TextPlacement.Right;
        layout(st);
        const r = st.GetBlockRect();
        assert.equal(r.Height, 80, 'fills the footprint height');
        assert.ok(r.Width < 80, 'hugs content width');
        assert.equal(r.X + r.Width, 80, 'right edge pinned to the footprint');
    });

    test('explicit block size + Bottom placement anchors to the bottom edge', () => {
        const st = new ShapeText();
        st.Content = 'x';
        st.BlockWidth  = 40;
        st.BlockHeight = 20;
        st.Placement   = TextPlacement.Bottom;
        layout(st);
        const r = st.GetBlockRect();
        assert.deepEqual([r.X, r.Y, r.Width, r.Height], [20, 60, 40, 20]);
    });

    test('Offset shifts the placed block', () => {
        const st = new ShapeText();
        st.Content     = 'x';
        st.BlockWidth  = 40;
        st.BlockHeight = 20;
        st.Placement   = TextPlacement.Center;
        st.Offset      = new Point(5, -10);
        layout(st);
        const r = st.GetBlockRect();
        // Centre anchor (20,30) + offset (5,-10).
        assert.deepEqual([r.X, r.Y], [25, 20]);
    });

    test('the template root arranges at the block rect, not filling', () => {
        const st = new ShapeText();
        st.Content     = 'x';
        st.BlockWidth  = 40;
        st.BlockHeight = 20;
        st.Placement   = TextPlacement.TopLeft;
        layout(st);
        const rect = bg(st).ArrangedRect!;
        assert.deepEqual([rect.X, rect.Y, rect.Width, rect.Height], [0, 0, 40, 20]);
    });

    test('Angle drives a centre-pivot RotateTransform in the block root transform group', () => {
        const st = new ShapeText();
        st.Content = 'x';
        layout(st);
        const root = bg(st);
        assert.ok(root.RenderTransform instanceof TransformGroup, 'root carries a scale∘rotate group');
        const group = root.RenderTransform as TransformGroup;
        const rotate = group.Children.Get(1) as RotateTransform;
        assert.ok(rotate instanceof RotateTransform, 'rotate is the second child');
        assert.equal(rotate.Angle, 0, 'starts unrotated');
        assert.deepEqual([root.RenderTransformOrigin.X, root.RenderTransformOrigin.Y], [0.5, 0.5], 'pivots about centre');
        st.Angle = 30;
        assert.equal(rotate.Angle, 30, 'Angle DP flows to the transform');
        // Mutated in place across the same group (Freezable repaint path).
        st.Angle = 45;
        assert.equal(root.RenderTransform, group, 'no new transform allocated per Angle change');
        assert.equal(rotate.Angle, 45);
    });
});

describe('ShapeText — transform persistence (Slice 3)', () => {
    beforeEach(() => { initTestApp(); });

    test('offset / angle / placement / block size / vertical align round-trip', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.LabelText                    = 'Rotated';
        n.Text.Offset                  = new Point(7, -3);
        n.Text.Angle                   = 42;
        n.Text.Placement               = TextPlacement.Below;
        n.Text.BlockWidth              = 44;
        n.Text.BlockHeight             = 18;
        n.Text.VerticalTextAlignment   = VerticalAlignment.Top;
        doc.Save();
        doc.Load();
        const st = (doc.Nodes.Get(0) as TextNode).Text;
        assert.equal(st.Content, 'Rotated');
        assert.deepEqual([st.Offset.X, st.Offset.Y], [7, -3]);
        assert.equal(st.Angle, 42);
        assert.equal(st.Placement, TextPlacement.Below);
        assert.equal(st.BlockWidth, 44);
        assert.equal(st.BlockHeight, 18);
        assert.equal(st.VerticalTextAlignment, VerticalAlignment.Top);
    });

    test('a plain centred label persists no transform fields (stays compact)', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.LabelText = 'Plain';
        doc.Save();
        doc.Load();
        const st = (doc.Nodes.Get(0) as TextNode).Text;
        // Defaults intact after a round-trip that wrote no transform.
        assert.deepEqual([st.Offset.X, st.Offset.Y], [0, 0]);
        assert.equal(st.Angle, 0);
        assert.equal(st.Placement, TextPlacement.Center);
        assert.ok(Number.isNaN(st.BlockWidth), 'block width stays auto');
        assert.equal(st.VerticalTextAlignment, VerticalAlignment.Center);
    });
});

// § board-text Slice 7 — auto-fit. ShrinkText scales the block down to fit
// its footprint (self-contained in ShapeText); GrowShape grows the owning
// Figure to contain the label. Both round-trip.

describe('ShapeText — auto-fit (Slice 7)', () => {
    beforeEach(() => { initTestApp(); });

    function bg(st: ShapeText): Border { return st.GetTemplateChild('PART_Bg') as Border; }
    function scaleOf(st: ShapeText): number
    {
        const g = bg(st).RenderTransform as TransformGroup;
        return (g.Children.Get(0) as ScaleTransform).ScaleX;
    }
    function layoutAt(st: ShapeText, w: number, h: number): void
    {
        st.Measure(new Size(w, h));
        st.Arrange(new Rect(0, 0, w, h));
    }

    test('ShrinkText scales the block down when content overflows the footprint', () => {
        const st = new ShapeText();
        st.Content = 'wordy '.repeat(20);
        st.AutoFit = TextAutoFit.ShrinkText;
        layoutAt(st, 40, 16);
        assert.ok(scaleOf(st) < 1, 'block scaled below 1 to fit');
    });

    test('None leaves the block at natural scale', () => {
        const st = new ShapeText();
        st.Content = 'wordy '.repeat(20);
        st.AutoFit = TextAutoFit.None;
        layoutAt(st, 40, 16);
        assert.equal(scaleOf(st), 1, 'no scaling in None mode');
    });

    test('GrowShape grows the Figure to contain a long label', () => {
        const f = new Figure();   // default 80×80
        f.Text.AutoFit = TextAutoFit.GrowShape;
        f.LabelText = 'A rather long label that will not fit in eighty pixels';
        assert.ok(f.Width > 80, 'the figure widened to fit the label');
    });

    test('None does not resize the Figure', () => {
        const f = new Figure();
        f.LabelText = 'A rather long label that will not fit in eighty pixels';
        assert.equal(f.Width, 80, 'shape unchanged without GrowShape');
    });

    test('AutoFit mode round-trips through Save/Load', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.LabelText = 'x';
        n.Text.AutoFit = TextAutoFit.ShrinkText;
        doc.Save();
        doc.Load();
        assert.equal((doc.Nodes.Get(0) as TextNode).Text.AutoFit, TextAutoFit.ShrinkText);
    });
});

// § board-text Slice 4 — optional rich content. A FlowDocument rides
// alongside the plain Content string, wins for display, edits through a
// RichTextBox, round-trips its runs/formatting, and a formatting-free edit
// collapses back to a plain label.

describe('ShapeText — rich content bridge (pure)', () => {
    test('serialize → deserialize round-trips runs, formatting, and alignment', () => {
        const s = serializeFlowDocument(makeRichDoc());
        // Re-serializing the rebuilt document reproduces the same snapshot.
        assert.deepEqual(serializeFlowDocument(deserializeFlowDocument(s)), s);
        // And it captured the formatting we set.
        assert.deepEqual(s, [
            { runs: [{ t: 'Hello ' }, { t: 'world', b: true }] },
            { align: TextAlignment.Center, runs: [{ t: 'second', i: true }] },
        ]);
    });

    test('plain-text projection joins paragraphs with newlines', () => {
        assert.equal(flowDocumentToPlainText(makeRichDoc()), 'Hello world\nsecond');
    });

    test('flowDocumentFromPlainText builds one paragraph per line, carrying alignment', () => {
        const doc = flowDocumentFromPlainText('a\nb', TextAlignment.Right);
        const s = serializeFlowDocument(doc);
        assert.deepEqual(s, [
            { align: TextAlignment.Right, runs: [{ t: 'a' }] },
            { align: TextAlignment.Right, runs: [{ t: 'b' }] },
        ]);
    });

    test('isEffectivelyPlainDocument distinguishes plain from rich', () => {
        assert.equal(isEffectivelyPlainDocument(flowDocumentFromPlainText('just text')), true);
        assert.equal(isEffectivelyPlainDocument(makeRichDoc()), false, 'bold + 2 paragraphs is rich');
        const underlined = new FlowDocument();
        const p = new Paragraph();
        const r = new Run('u'); r.TextDecorations = TextDecorations.Underline;
        p.Inlines.Add(r);
        underlined.Blocks.Add(p);
        assert.equal(isEffectivelyPlainDocument(underlined), false, 'underline alone is rich');
    });

    test('cloneFlowDocument is a deep copy (independent mutation)', () => {
        const src = makeRichDoc();
        const copy = cloneFlowDocument(src);
        assert.deepEqual(serializeFlowDocument(copy), serializeFlowDocument(src));
        // Mutating the clone doesn't touch the source.
        copy.Blocks.Add(new Paragraph());
        assert.notEqual(serializeFlowDocument(copy).length, serializeFlowDocument(src).length);
    });
});

describe('ShapeText — rich content model + editing (Slice 4)', () => {
    beforeEach(() => { initTestApp(); });

    function editor(st: ShapeText): RichTextBox { return st.GetTemplateChild('PART_Edit') as RichTextBox; }

    test('setting Document flips HasRichContent for the display swap', () => {
        const st = new Figure().Text;
        assert.equal(st.HasRichContent, false);
        st.Document = makeRichDoc();
        assert.equal(st.HasRichContent, true, 'a document promotes to rich display');
        st.Document = undefined;
        assert.equal(st.HasRichContent, false, 'clearing it reverts to plain');
    });

    test('the rich display host binds the Document', () => {
        const st = new Figure().Text;
        st.Document = makeRichDoc();
        const rich = st.GetTemplateChild('PART_RichText') as { Document?: FlowDocument };
        assert.equal(rich.Document, st.Document, 'PART_RichText shows the shape Document');
    });

    test('a formatted edit commits as rich; plain Content stays the projection', () => {
        const st = new Figure().Text;
        st.Content = 'plain';
        st.BeginEdit();
        editor(st).Document = makeRichDoc();   // user typed + bolded
        st.CommitEdit();
        assert.equal(st.IsEditing, false);
        assert.ok(st.Document !== undefined, 'formatting promotes the label to rich');
        assert.equal(st.HasRichContent, true);
        assert.equal(st.Content, 'Hello world\nsecond', 'Content tracks the plain projection');
    });
});

describe('ShapeText — rich content persistence (Slice 4)', () => {
    beforeEach(() => { initTestApp(); });

    test('a rich Document round-trips through Save/Load', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.Text.Document = makeRichDoc();
        n.Text.Content  = flowDocumentToPlainText(n.Text.Document);   // mirror a real commit
        doc.Save();
        doc.Load();
        const st = (doc.Nodes.Get(0) as TextNode).Text;
        assert.ok(st.Document !== undefined, 'Document restored');
        assert.deepEqual(
            serializeFlowDocument(st.Document!),
            serializeFlowDocument(makeRichDoc()),
            'runs + formatting + alignment survive the round-trip');
        assert.equal(st.Content, 'Hello world\nsecond', 'plain projection restored too');
    });

    test('a plain label persists no doc field and reloads without a Document', () => {
        const doc = new BoardDocument(new MemoryStorage());
        // C4: TextNode serializes as type='text' and reloads as TextNode.
        const n = new TextNode(); n.Id = 'n1'; doc.Nodes.Add(n);
        n.LabelText = 'Plain';
        doc.Save();
        doc.Load();
        const st = (doc.Nodes.Get(0) as TextNode).Text;
        assert.equal(st.Document, undefined, 'stays plain');
        assert.equal(st.Content, 'Plain');
    });
});
