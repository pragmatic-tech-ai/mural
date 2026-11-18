import type { ServiceProvider } from '../../../runtime/index.js';
import { ToolboxRepository } from './toolbox-repository.js';
import { ShapeVisualResolver, ShapeVisualResolverKey } from './shape-visual-resolver.js';
import { ShapeDropFactory, ShapeDropFactoryKey } from './shape-drop-factory.js';
import { ShapeToolboxItem } from './shape-toolbox-item.js';
import { ToolboxItem } from './toolbox-item.js';
import { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';
import { FigureKindDropFactory, FigureKindDropFactoryKey } from './figure-kind-drop-factory.js';
import { SHAPE_CATALOG } from '../shape-catalog.js';
// Side-effect: register the 'container' / 'text' / 'callout' figure kinds so the
// annotate page's tile previews (ShapeVisualResolver → Figure.fromKind) and drops
// (FigureKindDropFactory → Figure.fromKind) can mint them.
import '../container-figure.js';
import '../text-node.js';
import '../callout.js';

// The non-silhouette annotate tools: a generic container box, a text box, and a
// callout. All are registered figure kinds dropped via FigureKindDropFactory.
const ANNOTATE_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
    { kind: 'container', label: 'Container' },
    { kind: 'text',      label: 'Text' },
    { kind: 'callout',   label: 'Callout' },
];

// Idempotent first-init. Called from every Board ctor; guarded so N
// boards register once. A bare mural board gets a working Shapes palette
// plus an annotate palette (callouts, text, containers) with zero app wiring.
// No-op when there is no service provider (headless).
export function ensureToolboxDefaults(services: ServiceProvider | undefined): void
{
    if (services === undefined) return;

    if (!services.has(ToolboxRepository.Key))
    {
        services.registerInstance(ToolboxRepository.Key, new ToolboxRepository());
    }
    if (!services.has(ShapeVisualResolverKey))
    {
        services.registerInstance(ShapeVisualResolverKey, new ShapeVisualResolver());
    }
    if (!services.has(ShapeDropFactoryKey))
    {
        services.registerInstance(ShapeDropFactoryKey, new ShapeDropFactory());
    }
    if (!services.has(FigureKindDropFactoryKey))
    {
        services.registerInstance(FigureKindDropFactoryKey, new FigureKindDropFactory());
    }

    const repo = services.getRequired(ToolboxRepository.Key);
    // Only populate freshly-created pages (EnsurePage is get-or-create), so a
    // second call (another board) doesn't double the items.
    if (!hasPage(repo, 'shapes'))
    {
        const page = repo.EnsurePage('shapes', 'Shapes');
        for (const e of SHAPE_CATALOG) page.Items.Add(new ShapeToolboxItem(e.kind, e.label));
    }
    if (!hasPage(repo, 'annotate'))
    {
        const page = repo.EnsurePage('annotate', 'Callouts, Text & Containers');
        for (const e of ANNOTATE_KINDS)
        {
            page.Items.Add(new ToolboxItem(
                `kind:${e.kind}`,
                e.label,
                new ToolboxVisualDescriptor(ShapeVisualResolverKey, e.kind),
                FigureKindDropFactoryKey,
            ));
        }
    }
}

function hasPage(repo: ToolboxRepository, id: string): boolean
{
    for (let i = 0; i < repo.Pages.Count; i++) if (repo.Pages.Get(i)!.Id === id) return true;
    return false;
}
