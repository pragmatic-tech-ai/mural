import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, MuralBase, ObservableCollection, type Visual } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Border } from '../../../basic/border.js';
import { ItemsControl } from '../../base/items-control.js';
import { ItemsPanelTemplate } from '../../../basic/panels/items-panel-template.js';
import { StackPanel } from '../../../basic/panels/stack-panel.js';
import { EditorShell } from '../../shell/editor-shell.js';
import { ContentHostService } from '../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../shell/services/documents-content-host-service.js';
import { TabControl, TabItem } from '../tabs.js';

// A document whose IMPLICIT DataTemplate renders a control hosting SHARED Visual
// children — exactly the shape that bites the real Diagram (its ItemsSource is
// the document's node Visuals). If the document gets dispatched through its
// implicit template MORE THAN ONCE (e.g. the tab header wrongly renders the whole
// document as well as the content slot), the second attach of a shared Visual
// throws "Visual already has a visual parent".
class SharedVisualDoc extends MuralBase
{
    public readonly Id = 'seed';
    public readonly Title = 'Untitled';
    public readonly IsDirty = false;
    // Shared Visual "nodes" — can only live in ONE tree at a time.
    public readonly Nodes = new ObservableCollection<Visual>();
    constructor()
    {
        super();
        this.Nodes.Add(new Border());
        this.Nodes.Add(new Border());
    }
    public Save(): void {}
}

function collect<T>(root: Visual, ctor: new (...a: never[]) => T, out: T[] = []): T[]
{
    if (root instanceof ctor) out.push(root);
    for (const c of root.visualChildren) collect(c, ctor, out);
    return out;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('TabControl data path — tab header must NOT render the document body', () => {
    beforeEach(() => {
        initTestApp();
        Application.current.Services.register(
            ContentHostService.Key, (p) => new DocumentsContentHostService(p), 'singleton');
        // The document's implicit body template — an ItemsControl over the shared
        // node Visuals (stands in for DataTemplate[DiagramDocument] → Diagram).
        Application.current.Resources.Set(SharedVisualDoc, new DataTemplate((d) => {
            const doc = d as SharedVisualDoc;
            const ic = new ItemsControl();
            ic.ItemsPanel = new ItemsPanelTemplate(() => new StackPanel());
            ic.ItemsSource = doc.Nodes;
            return ic;
        }, SharedVisualDoc));
    });

    test('opening a shared-Visual document does not double-attach (header uses the header template)', async () => {
        const shell = new EditorShell();
        const root  = shell.visualChildren[0]!;
        await settle();
        const host = Application.current.Services.get(ContentHostService.Key) as DocumentsContentHostService;

        // This is where the bug threw: the tab header dispatched the document
        // through its implicit template, attaching the shared node Visuals, then
        // the content slot tried to attach them again.
        const doc = new SharedVisualDoc();
        assert.doesNotThrow(() => host.Open(doc));
        await settle();

        // The document's body control (the ItemsControl bound to THIS doc's shared
        // Nodes) is materialised exactly once — only the content slot renders it,
        // the tab header does NOT.
        const bodies = collect(root, ItemsControl).filter((ic) => ic.ItemsSource === doc.Nodes);
        assert.equal(bodies.length, 1, 'the document body is rendered exactly once, not in the tab header too');

        // A tab container still exists for the open document.
        assert.ok(collect(root, TabItem).length >= 1, 'a TabItem was generated');
    });
});
