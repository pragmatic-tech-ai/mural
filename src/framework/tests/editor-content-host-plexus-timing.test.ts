import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, MuralBase, type Visual } from '../../runtime/index.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { Border } from '../../basic/border.js';
import { EditorShell } from '../shell/editor-shell.js';
import { ContentHostService } from '../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../shell/services/documents-content-host-service.js';
import { TabControl, TabItem } from '../tabs/tabs.js';

// A document whose body renders through a registered DataTemplate — mirrors
// the Plexus DiagramDocument (DataTemplate[DiagramDocument] → a Diagram).
class DemoDoc extends MuralBase
{
    constructor(public readonly Id: string, public readonly Title: string) { super(); }
    public readonly IsDirty = false;
    public Save(): void {}
}

function findWhere(root: Visual, pred: (v: Visual) => boolean): Visual | undefined
{
    if (pred(root)) return root;
    for (const c of root.visualChildren)
    {
        const hit = findWhere(c, pred);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

function findByType<T>(root: Visual, ctor: new (...a: never[]) => T): T | undefined
{
    return findWhere(root, (v) => v instanceof ctor) as T | undefined;
}

// Drain the microtask queue. TabControl realization is multi-stage async
// (service binding → item-container generation → selection → content dispatch),
// each stage hopping a microtask; a macrotask boundary flushes them all.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('EditorShell content host — Plexus launch timing', () => {
    beforeEach(() => {
        initTestApp();
        // Register the documents host at the app ROOT as a SINGLETON — exactly
        // how app.mu compiles `DocumentsContentHostService -> ContentHostService`
        // (lifetime 'singleton'), so main.js and the shell's child scope resolve
        // the SAME instance.
        Application.current.Services.register(
            ContentHostService.Key, (p) => new DocumentsContentHostService(p), 'singleton');
        // A body template for the document (stands in for DataTemplate[DiagramDocument]),
        // registered app-global so the content slot resolves it by type.
        Application.current.Resources.Set(DemoDoc, new DataTemplate((d) => {
            const b = new Border();
            b.DataContext = d;
            return b;
        }, DemoDoc));
    });

    // Reproduces the launch order: the shell is constructed + rendered, THEN
    // main.js opens the seeded document. The tab strip AND the body must appear
    // reactively — the ItemsSource / SelectedItem bindings observe the late Open,
    // generate the tab container, resolve selection, and dispatch the body.
    test('opening a document AFTER render surfaces a tab and its body', async () => {
        const shell = new EditorShell();                 // app.initialize(target)
        const root  = shell.visualChildren[0]!;
        await settle();

        // The shell has more than one TabControl (the panel-dock region is also a
        // TabControl and comes first in the tree), so select the DOCUMENTS one by
        // its DataContext — the host presented in PART_ContentHost — rather than
        // the first TabControl found.
        const tab = findWhere(root, (v) => v instanceof TabControl
            && v.DataContext instanceof DocumentsContentHostService) as TabControl | undefined;
        assert.ok(tab !== undefined, 'documents TabControl materialised in the content region');

        // Open the seeded document, as main.js does post-initialize.
        const host = Application.current.Services.get(ContentHostService.Key) as DocumentsContentHostService;
        const doc  = new DemoDoc('seed', 'Untitled');
        host.Open(doc);                                  // main.js: host.Open(workspace.Document)
        await settle();

        // The TabControl is bound to the shared host's open-set.
        assert.equal(tab!.ItemsSource, host.OpenDocuments, 'TabControl bound to the shared host OpenDocuments');
        // A tab container was generated for the opened document.
        assert.ok(findByType(tab!, TabItem) !== undefined, 'a TabItem appeared for the opened document');
        // The active document became SelectedContent and its body rendered
        // through DataTemplate[DemoDoc] (a Border whose DataContext IS the doc).
        assert.equal(tab!.SelectedContent, doc, 'active document drives SelectedContent');
        const body = findWhere(tab!, (v) => v instanceof Border && v.DataContext === doc);
        assert.ok(body !== undefined, 'document body rendered in the content slot');
    });
});
