import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../../runtime/index.js';
import { BitmapImage, Stretch } from '../../../../visual-engine/index.js';
import { FlowDocument } from '../../../../basic/documents/flow-document.js';
import { Paragraph } from '../../../../basic/documents/paragraph.js';
import { ImageDisplay, ImageInline, Run } from '../../../../basic/documents/inlines.js';
import { serializeFlowDocument, deserializeFlowDocument, cloneFlowDocument, isEffectivelyPlainDocument } from '../shape-text-document.js';

function newApp(): void { Application.current = null; new Application(); }

function firstImage(doc: FlowDocument): ImageInline | undefined {
    const p = doc.Blocks.ToArray()[0] as Paragraph;
    return p.Inlines.ToArray().find((e) => e instanceof ImageInline) as ImageInline | undefined;
}

describe('image inline serialization', () => {
    test('round-trips an inline data-URI image (bytes embedded) with explicit size', () => {
        newApp();
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.Inlines.Add(new Run('see '));
        p.Inlines.Add(new ImageInline(new BitmapImage('data:image/png;base64,AAAA'), { width: 40, height: 30 }));
        doc.Blocks.Add(p);

        const back = deserializeFlowDocument(serializeFlowDocument(doc));
        const img = firstImage(back);
        assert.ok(img !== undefined, 'image round-tripped');
        assert.equal(img!.Source?.Uri, 'data:image/png;base64,AAAA');
        assert.equal(img!.Width, 40);
        assert.equal(img!.Height, 30);
        assert.equal(img!.Display, ImageDisplay.Inline);
        assert.equal(img!.Stretch, Stretch.Uniform);
        // surrounding text preserved
        const text = (back.Blocks.ToArray()[0] as Paragraph).Inlines.ToArray().filter((e) => e instanceof Run).map((r) => (r as Run).Text).join('');
        assert.equal(text, 'see ');
    });

    test('round-trips a block image with an http URI + non-default stretch', () => {
        newApp();
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.Inlines.Add(new ImageInline(new BitmapImage('http://x/y.png'), { stretch: Stretch.Fill, display: ImageDisplay.Block }));
        doc.Blocks.Add(p);

        const img = firstImage(deserializeFlowDocument(serializeFlowDocument(doc)));
        assert.equal(img!.Source?.Uri, 'http://x/y.png');
        assert.equal(img!.Stretch, Stretch.Fill);
        assert.equal(img!.Display, ImageDisplay.Block);
    });

    test('a document containing an image is NOT effectively plain (keeps its rich Document)', () => {
        newApp();
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.Inlines.Add(new Run('x'));
        p.Inlines.Add(new ImageInline(new BitmapImage('data:,')));
        doc.Blocks.Add(p);
        assert.equal(isEffectivelyPlainDocument(doc), false);
    });

    test('cloneFlowDocument preserves the image', () => {
        newApp();
        const doc = new FlowDocument();
        const p = new Paragraph();
        p.Inlines.Add(new ImageInline(new BitmapImage('data:image/png;base64,BBBB'), { width: 12 }));
        doc.Blocks.Add(p);
        const img = firstImage(cloneFlowDocument(doc));
        assert.equal(img!.Source?.Uri, 'data:image/png;base64,BBBB');
        assert.equal(img!.Width, 12);
    });
});
