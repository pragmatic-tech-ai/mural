// Shared helper: read the ambient `ServiceScope` dependency property from
// any MuralBase target, structurally. Extracted from element-name-binding.ts
// so the EVD tier (effective-value.ts) can import it without creating a
// circular dependency through that file.

import { MuralBase } from '../model.js';
import { resolveKey } from '../model-internals.js';
import type { ServiceToken } from '@pragmatic-tech-ai/todl-runtime';

interface Provider { get(token: ServiceToken<unknown>): unknown; }

// Reads the target's inherited `ServiceScope` by name — structurally, so
// the runtime binding layer needn't import the Element class that owns the
// DP. Returns a provider-shaped value (anything with `get`) or undefined.
export function readServiceScope(target: MuralBase): Provider | undefined
{
    if (!MuralBase.HasProperty(target.constructor, 'ServiceScope')) return undefined;
    const v = target.get_property_value(resolveKey(target, undefined, 'ServiceScope'));
    return (v !== undefined && typeof (v as Provider).get === 'function') ? v as Provider : undefined;
}

export type { Provider as IServiceScopeProvider };
