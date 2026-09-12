import { MetaData, MuralBase } from '../../../runtime/index.js';
import { VisualContext } from './toolbox-visual-resolver.js';

// Ambient "which presentation context am I rendering in?" for a subtree.
// A host — a toolbox tile ContentControl, a canvas figure ContentControl —
// sets it; a context-aware DataTemplateSelector reads it from the container it
// is handed (VisualContextScope.GetContext(container)) and picks the tile-vs-
// figure template accordingly. Inheritable so a host can set it once for its
// whole subtree. This is the declarative replacement for the explicit `Context`
// DP that the retired ToolboxVisualPresenter carried.
//
// Default = Figure: the canvas figure is the neutral case; a toolbox tile /
// library preview opts into Tile explicitly.
export class VisualContextScope
{
    public static readonly ContextKey = MuralBase.RegisterAttachedProperty<VisualContext>(
        VisualContextScope, 'Context', VisualContext.Figure, MetaData.Inherits);

    public static GetContext(target: MuralBase): VisualContext
    {
        return target.get_property_value(VisualContextScope.ContextKey);
    }

    public static SetContext(target: MuralBase, value: VisualContext): void
    {
        target.set_property_value(VisualContextScope.ContextKey, value);
    }
}
