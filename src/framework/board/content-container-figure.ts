import { MuralBase, Element } from '../../runtime/index.js';
import { Point } from '../../visual-engine/index.js';
import { ContainerFigure, CONTAINER_PADDING } from './container-figure.js';

// Header band tall enough to host an arch node's icon+label tile as the
// container's own identity (vs the generic ContainerFigure's 24px ShapeText
// title band). The child region sits below it.
export const CONTAINER_HEADER_BAND = 56;

// A VM-backed container: same nesting / clip / placement as ContainerFigure, but
// its header shows the bound VM's content (PART_Content → the VM's DataTemplate,
// e.g. an arch node's icon+label tile) instead of a ShapeText title. Minted by
// the Board for a VM that opts in via IsContainer.
export class ContentContainerFigure extends ContainerFigure
{
    static { MuralBase.OverrideMetadata(ContentContainerFigure, Element.DefaultStyleKeyKey, { default_value: ContentContainerFigure }); }

    public override get ContentOrigin(): Point
    {
        return new Point(CONTAINER_PADDING, CONTAINER_HEADER_BAND + CONTAINER_PADDING);
    }
}
