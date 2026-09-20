// TreeViewVM — two-pane TreeView showcase: a composed-markup tree on
// the left and a HierarchicalDataTemplate-driven tree on the right.
//
// The right pane carries a JS itemsSelector closure that can't be
// expressed in `.mu` markup yet, so OnViewMounted resolves the bound
// TreeView via FindName and wires its ItemTemplate / ItemsSource
// post-build.
import { type Visual, MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import { HierarchicalDataTemplate, TextBlock } from '@pragmatic-tech-ai/mural/basic';
import { TreeView } from '@pragmatic-tech-ai/mural/framework';

// A small file-tree-shaped data set. Each node has Name (consumed by
// TreeViewItem.Header via the displayString Label/Name/Text
// convention) and optional `children`.
interface FsNode
{
    Name: string;
    children?: FsNode[];
}

const FS: FsNode = {
    Name: 'project',
    children: [
        { Name: 'README.md' },
        {
            Name: 'src',
            children: [
                { Name: 'index.ts' },
                {
                    Name: 'compiler',
                    children: [
                        { Name: 'parser.ts' },
                        { Name: 'emitter.ts' },
                        { Name: 'types.ts' },
                    ],
                },
                {
                    Name: 'runtime',
                    children: [
                        { Name: 'app.ts' },
                        { Name: 'logger.ts' },
                    ],
                },
            ],
        },
        {
            Name: 'tests',
            children: [
                { Name: 'parser.test.ts' },
                { Name: 'emitter.test.ts' },
            ],
        },
        { Name: 'package.json' },
    ],
};

export class TreeViewVM extends MuralBase
{
    OnViewMounted(view: Visual): void
    {
        const tv = view.FindName('bound');
        if (!(tv instanceof TreeView)) throw new Error('tree-view.mu missing x:name="bound" TreeView');

        // The template's `factory` produces each row's header content —
        // TreeView applies it and hosts the Visual in the row. Here that's
        // a simple Name label; a real app would compose an icon + label
        // (that's exactly what per-item chrome now enables).
        const tpl = new HierarchicalDataTemplate(
            (data: unknown) => new TextBlock((data as FsNode).Name),
            // The selector receives untyped item data from the DataTemplate
            // pipeline; narrow it to the local FsNode shape to read children.
            (data: unknown) => (data && typeof data === 'object' ? (data as FsNode).children : undefined),
            // itemTemplate omitted → recursive: every level uses the same
            // HierarchicalDataTemplate.
        );

        tv.ItemTemplate = tpl;
        tv.ItemsSource  = [FS];

        // First-load convenience: expand the root so the tree isn't a
        // single line on open. The container is realized synchronously
        // when ItemsSource fires the inserted change.
        const root = tv.RootItems[0];
        if (root !== undefined) root.IsExpanded = true;
    }
}
