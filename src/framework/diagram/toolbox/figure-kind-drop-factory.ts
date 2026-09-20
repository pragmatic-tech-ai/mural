import { ServiceKey } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { DiagramDocument } from '../diagram-document.js';
import type { NodeViewModel } from '../node-view-model.js';
import type { IToolboxDropFactory, ToolboxDropContext } from './toolbox-drop-factory.js';

export const FigureKindDropFactoryKey = new ServiceKey<IToolboxDropFactory>('FigureKindDropFactory');

// Drops a registered NON-silhouette figure kind (container, text, callout) — the
// kinds the standard ShapeDropFactory can't place, because its CreateNode guards
// on the shape catalog and these are registerFigureKind kinds, not catalog
// shapes. The dropped figure carries a `<kind>:<n>` id — a scheme distinct from
// the document's `n<N>` node ids, so it never collides, and (for a container)
// ContainerPlacement can register it to hold children. The id matches no model
// entity, so an app binding treats it as a pure visual: its nesting/geometry
// persist via the visual store, not the model. The kind is read from the item's
// descriptor Key, so one factory serves every registered figure kind.
export class FigureKindDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        const kind = context.Descriptor.Key;
        const doc = context.Mutator as unknown as DiagramDocument;
        const fig = Figure.fromKind(kind, context.Position.X, context.Position.Y);
        fig.Id = nextKindId(doc, kind);
        // AddNode is typed for content VMs; a plain Figure is an equally valid node.
        context.Mutator.AddNode(fig as unknown as NodeViewModel);
        return fig;
    }
}

// The next unused `<kind>:<n>` id for this document — one past the highest such
// id currently placed. Distinct from the doc's `n<N>` counter, so the two never
// collide and a reload preserves the id (the load path claims non-empty ids).
function nextKindId(doc: DiagramDocument, kind: string): string
{
    const prefix = `${kind}:`;
    let max = 0;
    for (const n of doc.Nodes.ToArray())
    {
        const id = (n as { Id?: string }).Id;
        if (id === undefined || !id.startsWith(prefix)) continue;
        const k = Number(id.slice(prefix.length));
        if (Number.isFinite(k) && k > max) max = k;
    }
    return `${prefix}${max + 1}`;
}
