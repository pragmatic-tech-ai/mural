import type { Visual } from '../../../runtime/index.js';
import type { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';

// Which surface a visual is being resolved for.
export enum VisualContext
{
    Tile   = 'tile',
    Figure = 'figure',
}

// Turns a descriptor into a fresh Visual per call (a Visual can't live in
// two places), sized/chromed for the context. Returns a placeholder during
// the not-yet-loaded window and fires the changed signal (with the
// descriptor Key) when the real visual becomes available. Resolvers whose
// data is always ready never fire it.
export interface IToolboxVisualResolver
{
    Resolve(descriptor: ToolboxVisualDescriptor, context: VisualContext): Visual;
    AddChangedListener(cb: (key: string) => void): void;
    RemoveChangedListener(cb: (key: string) => void): void;
}
