import type { ServiceKey } from '../../../runtime/index.js';
import type { IToolboxVisualResolver } from './toolbox-visual-resolver.js';

// Lightweight, in-memory "what to draw" handle. Cheap to construct for
// every item; no Visual is built until a resolver is asked. Never
// serialized — a canvas node rebuilds its descriptor from a persisted key.
export class ToolboxVisualDescriptor
{
    constructor(
        public readonly ResolverKey: ServiceKey<IToolboxVisualResolver>,
        public readonly Key: string,
    ) {}
}
