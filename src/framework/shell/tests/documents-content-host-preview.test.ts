import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    MetaData,
    MuralBase,
    type IServiceProvider,
} from '../../../runtime/index.js';
import { resolveKey } from '../../../runtime/model-internals.js';
import {
    DocumentsContentHostService,
    type IDocument,
} from '../services/documents-content-host-service.js';

// A plain (non-reactive) test document.
class FakeDoc implements IDocument
{
    public IsDirty = false;
    constructor(public readonly Id: string, public readonly Title: string = Id) {}
    public Save(): void { this.IsDirty = false; }
}

// A document whose IsDirty is a reactive DP so the host's dirty aggregation (and
// the auto-promote-on-edit rule) sees changes live.
class DirtyDoc extends MuralBase implements IDocument
{
    static { MuralBase.RegisterProperty(DirtyDoc, 'IsDirty', false, MetaData.None); }
    constructor(public readonly Id: string, public readonly Title: string = Id) { super(); }
    public get IsDirty(): boolean { return this.get_property_value(resolveKey(this, undefined, 'IsDirty')); }
    public markDirty(): void { this.set_property_value(resolveKey(this, undefined, 'IsDirty'), true); }
    public Save(): void { this.set_property_value(resolveKey(this, undefined, 'IsDirty'), false); }
}

function provider(): IServiceProvider { return new Application().Services; }

describe('DocumentsContentHostService — preview tabs', () => {
    test('OpenPreview() opens an ephemeral tab tracked as PreviewDocument', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');

        host.OpenPreview(a);
        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(host.ActiveDocument, a);
        assert.equal(host.PreviewDocument, a, 'a is the preview document');
    });

    test('OpenPreview() of a second doc REPLACES the preview in place (single reused tab)', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');

        host.OpenPreview(a);
        host.OpenPreview(b);

        assert.equal(host.OpenDocuments.Count, 1, 'preview tab reused, not accumulated');
        assert.equal(host.OpenDocuments.Get(0), b);
        assert.equal(host.ActiveDocument, b);
        assert.equal(host.PreviewDocument, b);
    });

    test('preview replace keeps the same tab slot (index) among permanent tabs', () => {
        const host = new DocumentsContentHostService(provider());
        const perm = new FakeDoc('perm');
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');

        host.Open(perm);          // permanent at index 0
        host.OpenPreview(a);      // preview at index 1
        assert.equal(host.OpenDocuments.IndexOf(a), 1);
        host.OpenPreview(b);      // replaces a at index 1

        assert.equal(host.OpenDocuments.Count, 2);
        assert.equal(host.OpenDocuments.IndexOf(perm), 0, 'permanent tab untouched');
        assert.equal(host.OpenDocuments.IndexOf(b), 1, 'preview stays in its slot');
    });

    test('Open() of the current preview PROMOTES it to permanent (double-click)', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');

        host.OpenPreview(a);
        assert.equal(host.PreviewDocument, a);
        host.Open(a);             // double-click / activate → permanent

        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(host.PreviewDocument, undefined, 'no longer ephemeral');
        assert.equal(host.ActiveDocument, a);
    });

    test('Promote() clears the preview slot; a subsequent OpenPreview no longer replaces it', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');

        host.OpenPreview(a);
        host.Promote(a);
        assert.equal(host.PreviewDocument, undefined);

        host.OpenPreview(b);
        assert.equal(host.OpenDocuments.Count, 2, 'promoted a survives; b is the new preview');
        assert.equal(host.PreviewDocument, b);
    });

    test('OpenPreview() of an already-permanent doc just activates it (stays permanent)', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');

        host.Open(a);             // permanent
        host.Open(b);             // permanent, active = b
        host.OpenPreview(a);      // single-click an already-open permanent tab

        assert.equal(host.OpenDocuments.Count, 2);
        assert.equal(host.ActiveDocument, a, 're-activated');
        assert.equal(host.PreviewDocument, undefined, 'permanent tab did not become a preview');
    });

    test('editing the preview (IsDirty → true) auto-promotes it to permanent', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new DirtyDoc('a');

        host.OpenPreview(a);
        assert.equal(host.PreviewDocument, a);
        a.markDirty();            // an edit

        assert.equal(host.PreviewDocument, undefined, 'a dirty preview is promoted, never discarded');

        // A later OpenPreview must NOT replace the now-permanent a.
        host.OpenPreview(new FakeDoc('b'));
        assert.equal(host.OpenDocuments.Count, 2);
    });

    test('Close() of the preview clears PreviewDocument', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');

        host.OpenPreview(a);
        host.Close(a);
        assert.equal(host.OpenDocuments.Count, 0);
        assert.equal(host.PreviewDocument, undefined);
    });
});
