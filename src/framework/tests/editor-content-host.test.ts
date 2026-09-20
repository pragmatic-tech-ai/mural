import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MuralBase, type Visual } from '../../runtime/index.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { EditorShell } from '../shell/editor-shell.js';
import { ContentHostService } from '../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../shell/services/documents-content-host-service.js';
import { TabControl } from '../tabs/tabs.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';

// A minimal IDocument the host can open.
class FakeDoc extends MuralBase
{
    constructor(public readonly Id: string, public readonly Title: string) { super(); }
    public readonly IsDirty = false;
    public Save(): void {}
}

function findByType<T>(root: Visual, ctor: new (...a: never[]) => T): T | undefined
{
    if (root instanceof ctor) return root;
    for (const c of root.visualChildren)
    {
        const hit = findByType(c, ctor);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

describe('EditorShell content region → documents host → TabControl', () => {
    beforeEach(() => { initTestApp(); });

    // The content region binds `Content = $service(ContentHostService)`. The
    // shell's default host is a DocumentsContentHostService, which renders
    // through `DataTemplate[DocumentsContentHostService]` as a TabControl. The
    // service binding resolves the shell scope on a microtask (the scope is
    // published after applyDefaultStyle), so the TabControl materialises once
    // the binding retry lands — assert AFTER a microtask flush.
    test('PART_ContentHost materialises a TabControl bound to OpenDocuments', async () => {
        const shell = new EditorShell();
        const host = shell.Services.get(ContentHostService.Key) as DocumentsContentHostService;
        assert.ok(host instanceof DocumentsContentHostService, 'default host is a documents host');
        host.Open(new FakeDoc('a', 'Alpha'));
        host.Open(new FakeDoc('b', 'Beta'));

        const root = shell.visualChildren[0]!;
        const contentHost = root.FindName('PART_ContentHost') as ContentPresenter;
        assert.ok(contentHost !== undefined, 'PART_ContentHost is present');

        // Let the ServiceBinding forward-ref retry resolve the published scope.
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(contentHost.Content, host, 'content region resolved the documents host');
        const tab = findByType(contentHost, TabControl);
        assert.ok(tab !== undefined, 'a TabControl materialised for the documents host');
        assert.equal(tab!.ItemsSource, host.OpenDocuments, 'TabControl bound to OpenDocuments');
    });
});
