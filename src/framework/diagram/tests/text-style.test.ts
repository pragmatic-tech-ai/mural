import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    ObservableCollection, Size, Visual, ModifierKeys, RelayCommand,
    type MountableTarget,
} from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { RichTextBox } from '../../../basic/rich-text-box.js';
import { Color, FontStyle, FontWeight, SolidColorBrush, TextDecorations } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { SelectionMode } from '../../list/list-box.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { deserializeFlowDocument } from '../serialization/shape-text-document.js';
import { DocumentParagraphs } from '../../../basic/documents/text-navigation.js';

// § diagram-text text style — character formatting (font family / size / colour
// + bold / italic / underline / strikethrough). RichTextBox gains selection
// char-format setters + query getters; ShapeText routes per mode (selected text
// while editing, every run for rich, block DP for plain); the Diagram mirror
// seeds/broadcasts the Selection* char DPs and installs the decoration commands.

function twoRunPara() { return deserializeFlowDocument([{ runs: [{ t: 'hello world' }] }]); }

describe('RichTextBox — selection character formatting', () => {
    beforeEach(() => { initTestApp(); });

    test('SetSelectionBold over a selection bolds the covered run; getter reflects', () => {
        const rtb = new RichTextBox();
        rtb.Document = twoRunPara();
        rtb.SelectAll();
        assert.equal(rtb.SelectionBold, false, 'starts not bold');
        rtb.SetSelectionBold(true);
        assert.equal(rtb.SelectionBold, true, 'reflects bold after set');
        const run = DocumentParagraphs(rtb.Document!)[0]!.Inlines.Get(0) as { FontWeight: FontWeight };
        assert.equal(run.FontWeight, FontWeight.Bold);
    });

    test('font family / size / colour setters restyle the selection and read back', () => {
        const rtb = new RichTextBox();
        rtb.Document = twoRunPara();
        rtb.SelectAll();
        rtb.SetSelectionFontFamily('Georgia');
        rtb.SetSelectionFontSize(22);
        rtb.SetSelectionForeground(new SolidColorBrush(Color.FromHex('#ff0000')));
        assert.equal(rtb.SelectionFontFamily, 'Georgia');
        assert.equal(rtb.SelectionFontSize, 22);
        assert.ok(rtb.SelectionForeground instanceof SolidColorBrush);
    });

    test('ToggleStrikethrough flips the decoration bit', () => {
        const rtb = new RichTextBox();
        rtb.Document = twoRunPara();
        rtb.SelectAll();
        rtb.ToggleStrikethrough();
        assert.equal(rtb.SelectionStrikethrough, true);
        rtb.ToggleStrikethrough();
        assert.equal(rtb.SelectionStrikethrough, false);
    });

    test('a query never mutates the document (no run split on read)', () => {
        const rtb = new RichTextBox();
        rtb.Document = twoRunPara();
        rtb.SelectAll();
        const before = DocumentParagraphs(rtb.Document!)[0]!.Inlines.Count;
        void rtb.SelectionBold;
        void rtb.SelectionFontSize;
        assert.equal(DocumentParagraphs(rtb.Document!)[0]!.Inlines.Count, before, 'run count unchanged by reads');
    });
});

describe('ShapeText — character-format routing', () => {
    beforeEach(() => { initTestApp(); });

    test('plain: routes bold / family / size / colour to the block DPs', () => {
        const st = new Figure().Text;
        st.Content = 'hi';
        st.ApplyBold(true);
        st.ApplyFontFamily('Georgia');
        st.ApplyFontSize(20);
        st.ApplyForeground(new SolidColorBrush(Color.FromHex('#00ff00')));
        assert.equal(st.FontWeight, FontWeight.Bold);
        assert.equal(st.FontFamily, 'Georgia');
        assert.equal(st.FontSize, 20);
        assert.equal(st.CurrentBold(), true);
        assert.equal(st.CurrentFontFamily(), 'Georgia');
        assert.equal(st.CurrentFontSize(), 20);
    });

    test('plain: underline / strikethrough set the block TextDecorations bits', () => {
        const st = new Figure().Text;
        st.Content = 'hi';
        st.ApplyUnderline(true);
        st.ApplyStrikethrough(true);
        assert.equal((st.TextDecorations & TextDecorations.Underline) !== 0, true);
        assert.equal((st.TextDecorations & TextDecorations.Strikethrough) !== 0, true);
        assert.equal(st.CurrentUnderline(), true);
        assert.equal(st.CurrentStrikethrough(), true);
        st.ApplyUnderline(false);
        assert.equal(st.CurrentUnderline(), false);
        assert.equal(st.CurrentStrikethrough(), true, 'strike unaffected by clearing underline');
    });

    test('rich (not editing): routes italic to every run', () => {
        const st = new Figure().Text;
        st.Document = deserializeFlowDocument([{ runs: [{ t: 'a' }] }, { runs: [{ t: 'b' }] }]);
        st.ApplyItalic(true);
        for (const p of DocumentParagraphs(st.Document!))
            for (let i = 0; i < p.Inlines.Count; i++)
                assert.equal((p.Inlines.Get(i) as { FontStyle: FontStyle }).FontStyle, FontStyle.Italic);
        assert.equal(st.CurrentItalic(), true);
    });

    test('editing: routes to the editor selection, not the block', () => {
        const st = new Figure().Text;
        st.Content = 'hello';
        st.BeginEdit();                                   // BeginEdit selects all
        const blockBefore = st.FontWeight;
        st.ApplyBold(true);
        const ed = st.GetTemplateChild('PART_Edit') as RichTextBox;
        assert.equal(ed.SelectionBold, true, 'editor selection bolded');
        assert.equal(st.FontWeight, blockBefore, 'block weight untouched while editing');
        assert.equal(st.CurrentBold(), true, 'Current reads the editor while editing');
    });
});

describe('Diagram — character-style channel + decoration commands', () => {
    class FakeTarget implements MountableTarget
    {
        public Content: Visual | undefined;
        public SetFocus(_v: Visual | undefined): void { /* noop */ }
        public GetFocusedVisual(): Visual | undefined { return undefined; }
    }

    function setup(figs: readonly Figure[]): Diagram
    {
        const diagram = new Diagram();
        diagram.SelectionMode = SelectionMode.Extended;
        diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
        diagram.ItemsSource   = new ObservableCollection<Figure>([...figs]);
        const surface = new Border();
        (surface as unknown as { Child: Visual }).Child = diagram;
        const target = new FakeTarget();
        target.Content = surface;
        (surface as Visual).Measure(new Size(800, 600));
        (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
        return diagram;
    }
    function select(d: Diagram, f: Figure): void
    {
        const c = d.Generator.ContainerFromItem(f);
        if (c === undefined) throw new Error('no container');
        d.HandleContainerClick(c, ModifierKeys.Control);
    }

    beforeEach(() => { initTestApp(); });

    test('selecting a shape seeds the char-style DPs from its label', () => {
        const f = new Figure();
        f.Text.Content = 'x';
        f.Text.FontWeight = FontWeight.Bold;
        f.Text.FontFamily = 'Georgia';
        f.Text.FontSize   = 20;
        const d = setup([f]);
        select(d, f);
        assert.equal(d.SelectionBold, true);
        assert.equal(d.SelectionFontFamily, 'Georgia');
        assert.equal(d.SelectionFontSize, 20);
    });

    test('setting a char DP broadcasts onto every selected shape', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        d.SelectionFontFamily = 'Verdana';
        d.SelectionFontSize   = 18;
        d.SelectionItalic     = true;
        assert.equal(a.Text.FontFamily, 'Verdana');
        assert.equal(b.Text.FontFamily, 'Verdana');
        assert.equal(a.Text.FontSize, 18);
        assert.equal(a.Text.FontStyle, FontStyle.Italic);
        assert.equal(b.Text.FontStyle, FontStyle.Italic);
    });

    test('font colour rides a hex string, converted to a brush per shape', () => {
        const f = new Figure();
        const d = setup([f]);
        select(d, f);
        d.SelectionFontColorHex = '#ff0000';
        assert.ok(f.Text.Foreground instanceof SolidColorBrush);
        assert.equal((f.Text.Foreground as SolidColorBrush).Color.ToHex().toLowerCase(), '#ff0000');
    });

    test('increase / decrease font-size commands step each label\'s OWN size', () => {
        const a = new Figure(); a.Text.FontSize = 12;
        const b = new Figure(); b.Text.FontSize = 20;   // different sizes
        const d = setup([a, b]);
        assert.ok(d.IncreaseFontSizeCommand instanceof RelayCommand);
        assert.ok(d.DecreaseFontSizeCommand instanceof RelayCommand);
        assert.equal(d.IncreaseFontSizeCommand?.CanExecute(), false, 'disabled with no selection');
        select(d, a);
        select(d, b);
        d.IncreaseFontSizeCommand?.Execute();
        assert.equal(a.Text.FontSize, 13, 'a grew one point');
        assert.equal(b.Text.FontSize, 21, 'b grew one point, relative sizing preserved');
        d.DecreaseFontSizeCommand?.Execute();
        d.DecreaseFontSizeCommand?.Execute();
        assert.equal(a.Text.FontSize, 11);
        assert.equal(b.Text.FontSize, 19);
        assert.equal(d.SelectionFontSize, 11, 'DP reflects the first shape');
    });

    test('the four decoration commands are installed and toggle every selected label', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        for (const c of [d.SetTextBoldCommand, d.SetTextItalicCommand, d.SetTextUnderlineCommand, d.SetTextStrikethroughCommand])
            assert.ok(c instanceof RelayCommand);
        assert.equal(d.SetTextBoldCommand?.CanExecute(), false, 'disabled with no selection');
        select(d, a);
        select(d, b);
        d.SetTextBoldCommand?.Execute();
        assert.equal(a.Text.FontWeight, FontWeight.Bold);
        assert.equal(b.Text.FontWeight, FontWeight.Bold);
        assert.equal(d.SelectionBold, true, 'DP reflects for the toggle');
        d.SetTextBoldCommand?.Execute();   // toggle off
        assert.equal(a.Text.FontWeight, FontWeight.Normal);
        assert.equal(d.SelectionBold, false);
    });
});
