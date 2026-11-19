import { ToolboxItem } from './toolbox-item.js';
import { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';
import { ShapeVisualResolverKey } from './shape-visual-resolver.js';
import { ShapeDropFactoryKey } from './shape-drop-factory.js';

// A built-in shape palette entry: descriptor keyed by catalog kind, resolved
// by the shape resolver, dropped by the shape factory.
export class ShapeToolboxItem extends ToolboxItem
{
    constructor(kind: string, label: string)
    {
        super(`shape:${kind}`, label, new ToolboxVisualDescriptor(ShapeVisualResolverKey, kind), ShapeDropFactoryKey);
    }
}
