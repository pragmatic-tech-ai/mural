import { ServiceKey } from '../../../runtime/index.js';
import type { IToolboxDropFactory, ToolboxDropContext } from './toolbox-drop-factory.js';

export const ShapeDropFactoryKey = new ServiceKey<IToolboxDropFactory>('ShapeDropFactory');

// Intrinsic geometry: the shape IS its visual, so this never touches the
// resolver on the canvas — it delegates to the mutator's CreateNode, the
// same call the legacy kind-drop made.
export class ShapeDropFactory implements IToolboxDropFactory
{
    public CreateDropped(context: ToolboxDropContext): unknown | null
    {
        return context.Mutator.CreateNode(context.Descriptor.Key, context.Position.X, context.Position.Y);
    }
}
