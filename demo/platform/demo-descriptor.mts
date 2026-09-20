import type { Visual } from '@pragmatic-tech-ai/mural/runtime';

// The static shape each demo contributes to its group module — the registry-free
// replacement for a runtime register({...}) call. `factory` builds the demo's root
// (a VM the content host resolves a DataTemplate for, or a Visual) on first
// activation; DemoGroupService caches the result per id.
export interface DemoDescriptor
{
    readonly id:        string;
    readonly title:     string;
    readonly subtitle?: string;
    readonly factory:   () => Visual;
}
