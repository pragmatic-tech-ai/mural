import { Application, Observable } from '@pragmatic-tech-ai/mural/runtime';
import {
    Hierarchy, HierarchyContributorRegistry,
    type HierarchyItem, type IHierarchyItemHost,
} from '@pragmatic-tech-ai/mural/framework';
import { HierarchyTreeDemoKeys } from './hierarchy-tree-keys.mjs';

// HierarchyTreeVM — the demo's DataContext. Constructs a REAL
// HierarchyContributorRegistry (which reads the app's composed modules —
// including HierarchyTreeDemoModule's `Hierarchy { }` block, see
// hierarchy-tree.module.mu) and a REAL Hierarchy from it, seeded with one
// root. hierarchy-tree.mu's two TreeViews bind `ItemsSource = $Hierarchy.
// Roots` against this VM's `Hierarchy` property with no further TS-side
// wiring — the out-of-box path this task exists to prove.
//
// SeedRoot's own item is never itself rendered — Hierarchy.Realize treats
// the seeded item as the invisible canonical-name anchor and projects
// whatever its KEY's registered contributor fans out straight into `Roots`
// (hierarchy.ts: `target = parent === this.root ? this.Roots : parent.
// Children`). So `Roots` holds NotebookSectionsContributor's two sections
// ("Ideas" / "To-Do") directly, as the tree's top-level rows, with no
// wrapping "Notebook" node ever shown — each is itself expandable to reveal
// its notes (NotebookNotesContributor).
//
// Also the IHierarchyItemHost the Hierarchy is constructed with — Activate /
// CommitRename / OnItemRemoved are the only host hooks this demo needs.
// Lazy expand and the right-click menu are driven entirely by the
// Contributors plus the default `.Behaviors:` bundle (hierarchy-tree.mu);
// this host does not implement the full HierarchyHost (Delete/CanDrop/Drop)
// because the demo does not wire HierarchyDropBehavior at all — drag-SOURCE
// support is parked for Milestone C2 (hierarchy.template.mu ruling 6:
// HierarchyDropBehavior is receiver-only today, and nothing stamps a drag
// payload yet), so faking the receiver side alone here would be dishonest
// about what actually works.
//
// Registered as a service (`addInstance`) purely so hierarchy-tree.mu's two
// TreeViews can resolve this VM via `$service(HierarchyTreeVM)` for their
// OWN `DataContext` attribute, instead of relying on inherited DataContext.
// A Behavior's `OnAttached` runs the instant `.Behaviors:` is compiled —
// before its host TreeView is attached to ITS OWN parent — so inherited
// DataContext is not live yet at that point (the same timing gap
// src/framework/hierarchy/tests/hierarchy-treeview-integration.test.ts's
// `buildTreeView()` documents in its own comment #2). `$service(...)`
// resolves through the service container instead, which has no
// attach-order dependency.
export class HierarchyTreeVM extends Observable implements IHierarchyItemHost
{
    public readonly Hierarchy: Hierarchy;

    constructor()
    {
        super();
        const app = Application.current;
        if (app === null)
        {
            throw new Error('hierarchy-tree demo requires an active Application');
        }
        const registry = new HierarchyContributorRegistry(app.Services);
        this.Hierarchy = new Hierarchy(registry, this, { Services: app.Services });
        this.Hierarchy.SeedRoot(HierarchyTreeDemoKeys.NotebookRoot);
        app.Services.addInstance(this);
    }

    public Activate(_item: HierarchyItem): void
    {
        // No document to open behind a node — double-click/Enter
        // activation is a deliberate no-op in this demo.
    }

    public CommitRename(item: HierarchyItem, newName: string): void
    {
        item.Caption = newName;
    }

    public OnItemRemoved(_item: HierarchyItem): void
    {
        // Nothing external to clean up — items are never deleted here.
    }
}
