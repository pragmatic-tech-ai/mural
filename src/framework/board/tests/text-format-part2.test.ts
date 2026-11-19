import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../basic/tests/test-app.js';
import { TextAlignment } from '../../../visual-engine/index.js';
import { RichTextBox } from '../../../basic/rich-text-box.js';
import { TextPointer } from '../../../basic/documents/text-pointer.js';
import { DocumentParagraphs } from '../../../basic/documents/text-navigation.js';
import { Figure } from '../figure.js';
import { deserializeFlowDocument } from '../serialization/shape-text-document.js';

// § board-text Part 2 — edit-mode paragraph alignment. RichTextBox gains
// SetSelectionAlignment / SelectionAlignment (the editor primitive), and
// ShapeText routes ApplyParagraphAlignment / CurrentParagraphAlignment per
// mode: caret paragraph while editing, all paragraphs for rich, block
// TextAlignment for plain.

function twoParas() { return deserializeFlowDocument([{ runs: [{ t: 'aa' }] }, { runs: [{ t: 'bb' }] }]); }

describe('RichTextBox — paragraph alignment', () => {
    beforeEach(() => { initTestApp(); });

    test('SetSelectionAlignment sets only the caret paragraph', () => {
        const rtb = new RichTextBox();
        const doc = twoParas();
        rtb.Document = doc;
        const paras = DocumentParagraphs(doc);
        const before0 = paras[0]!.TextAlignment;
        rtb.SetCaret(new TextPointer(paras[1]!, 0));      // collapse caret into para 2
        rtb.SetSelectionAlignment(TextAlignment.Right);
        assert.equal(paras[1]!.TextAlignment, TextAlignment.Right, 'caret paragraph aligned');
        assert.equal(paras[0]!.TextAlignment, before0, 'other paragraph untouched');
        assert.equal(rtb.SelectionAlignment, TextAlignment.Right, 'reads back at the caret');
    });

    test('SelectAll then SetSelectionAlignment aligns every paragraph', () => {
        const rtb = new RichTextBox();
        const doc = twoParas();
        rtb.Document = doc;
        rtb.SelectAll();
        rtb.SetSelectionAlignment(TextAlignment.Center);
        for (const p of DocumentParagraphs(doc)) assert.equal(p.TextAlignment, TextAlignment.Center);
    });

    test('selection-changed fires when the caret moves', () => {
        const rtb = new RichTextBox();
        const doc = twoParas();
        rtb.Document = doc;
        let fired = 0;
        rtb.AddSelectionChangedListener(() => { fired++; });
        rtb.SetCaret(new TextPointer(DocumentParagraphs(doc)[1]!, 0));
        assert.ok(fired >= 1, 'listener notified on caret move');
    });
});

describe('ShapeText — alignment routing', () => {
    beforeEach(() => { initTestApp(); });

    test('plain: routes to the block TextAlignment', () => {
        const st = new Figure().Text;
        st.Content = 'hi';
        st.ApplyParagraphAlignment(TextAlignment.Right);
        assert.equal(st.TextAlignment, TextAlignment.Right);
        assert.equal(st.CurrentParagraphAlignment(), TextAlignment.Right);
    });

    test('rich (not editing): routes to every paragraph', () => {
        const st = new Figure().Text;
        st.Document = twoParas();
        st.ApplyParagraphAlignment(TextAlignment.Center);
        for (const p of DocumentParagraphs(st.Document!)) assert.equal(p.TextAlignment, TextAlignment.Center);
        assert.equal(st.CurrentParagraphAlignment(), TextAlignment.Center);
    });

    test('editing: routes to the editor caret paragraph', () => {
        const st = new Figure().Text;
        st.Document = twoParas();
        st.BeginEdit();
        const ed = st.GetTemplateChild('PART_Edit') as RichTextBox;
        const paras = DocumentParagraphs(ed.Document!);       // the editor's working clone
        const before0 = paras[0]!.TextAlignment;
        ed.SetCaret(new TextPointer(paras[1]!, 0));
        st.ApplyParagraphAlignment(TextAlignment.Right);
        assert.equal(paras[1]!.TextAlignment, TextAlignment.Right, 'caret paragraph aligned');
        assert.equal(paras[0]!.TextAlignment, before0, 'other paragraph untouched');
        assert.equal(st.CurrentParagraphAlignment(), TextAlignment.Right);
    });
});
