import type { Point } from '../../../runtime/index.js';
import type { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';
import type { ToolboxItem } from './toolbox-item.js';
import type { Board } from '../board.js';
import type { ContainerFigure } from '../container-figure.js';
import type { BoardMutator } from '../behaviors/attach-standard-mutations.js';

// Everything a factory needs to turn a dropped item into a canvas node.
export interface ToolboxDropContext
{
    readonly Item:       ToolboxItem;
    readonly Descriptor: ToolboxVisualDescriptor;
    readonly Position:   Point;   // canvas-local top-left (offset already applied)
    readonly Board:    Board;
    readonly Mutator:    BoardMutator;
    // The innermost container under the drop point, if any. A host factory (e.g.
    // an arch factory) inspects this to validate + nest into a model-backed
    // container; generic containers are adopted by the router instead.
    readonly TargetContainer?: ContainerFigure;
}

// Creates the selectable/movable node, mutating the document through the
// Mutator, and returns the created node (for selection) or null. May
// delegate the node's picture to the descriptor's resolver, or build
// intrinsic geometry directly (shapes).
export interface IToolboxDropFactory
{
    CreateDropped(context: ToolboxDropContext): unknown | null;
}
