import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { BitmapImage } from '../../../visual-engine/index.js';
import { FlowDocument } from '../flow-document.js';
import { Paragraph } from '../paragraph.js';
import { Bold, ImageInline, Run } from '../inlines.js';
import { TextPointer, ParagraphLength } from '../text-pointer.js';
import { InsertImage, InsertText, NormalizeParagraph, RemoveImage } from '../text-editing.js';

function newApp(): void { Application.current = null; new Application(); }

function docWith(text: string): { doc: FlowDocument; p: Paragraph } {
    const doc = new FlowDocument();
    const p = new Paragraph();
    p.Inlines.Add(new Run(text));
    doc.Blocks.Add(p);
    return { doc, p };
}

const inlines = (p: Paragraph): readonly unknown[] => p.Inlines.ToArray();

describe('image editing', () => {
    test('InsertImage splits the caret run and drops the image between the halves', () => {
        newApp();
        const { doc, p } = docWith('abcd');
        InsertImage(doc, new TextPointer(p, 2), new BitmapImage('data:,'), { width: 10, height: 10 });

        const els = inlines(p);
        assert.equal(els.length, 3);
        assert.ok(els[0] instanceof Run && (els[0] as Run).Text === 'ab');
        assert.ok(els[1] instanceof ImageInline);
        assert.ok(els[2] instanceof Run && (els[2] as Run).Text === 'cd');
        // image is transparent to the text offset model
        assert.equal(ParagraphLength(p), 4);
    });

    test('the image survives text editing around it (normalize keeps it)', () => {
        newApp();
        const { doc, p } = docWith('abcd');
        InsertImage(doc, new TextPointer(p, 2), new BitmapImage('data:,'));
        // type at the end — must not drop the image
        InsertText(doc, new TextPointer(p, 4), 'X');
        NormalizeParagraph(p);
        assert.equal(inlines(p).filter((e) => e instanceof ImageInline).length, 1, 'image preserved through edit + normalize');
        const text = inlines(p).filter((e) => e instanceof Run).map((r) => (r as Run).Text).join('');
        assert.equal(text, 'abcdX');
    });

    test('NormalizeParagraph preserves an image alongside a collapsed Bold span', () => {
        newApp();
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.Inlines.Add(new Run('a'));
        p.Inlines.Add(new ImageInline(new BitmapImage('data:,')));
        const bold = new Bold(); bold.AddChild(new Run('b'));
        p.Inlines.Add(bold);
        doc.Blocks.Add(p);

        NormalizeParagraph(p);
        const els = inlines(p);
        assert.equal(els.filter((e) => e instanceof ImageInline).length, 1);
        // bold span collapsed to a styled Run; image still present between them
        assert.ok(els.some((e) => e instanceof Run && (e as Run).Text === 'b'));
    });

    test('RemoveImage takes the image back out', () => {
        newApp();
        const { doc, p } = docWith('abcd');
        InsertImage(doc, new TextPointer(p, 2), new BitmapImage('data:,'));
        const img = inlines(p).find((e) => e instanceof ImageInline) as ImageInline;
        RemoveImage(doc, img);
        assert.equal(inlines(p).filter((e) => e instanceof ImageInline).length, 0);
    });
});
