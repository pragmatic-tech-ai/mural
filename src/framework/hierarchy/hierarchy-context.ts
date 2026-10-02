import { ServiceKey, type ServiceToken } from '../../runtime/index.js';

// Interns a node-type key string to a stable ServiceToken used as a command
// CONTEXT tag (identity, never resolved as a service). Equal key strings return
// the same instance so `def.Context === HierarchyContext.For(item.Key)` matches
// by reference — the same identity contract DiagramEditingContext relies on,
// keyed off the hierarchy node kind. Shared across modules: any module referring
// to "project" gets the one token, so a contributor can tag actions for a type
// it does not itself produce.
export class HierarchyContext
{
    private static readonly TokenNamePrefix = 'hierarchy.context:';
    private static readonly cache = new Map<string, ServiceToken<unknown>>();

    public static For(key: string): ServiceToken<unknown>
    {
        let token = HierarchyContext.cache.get(key);
        if (token === undefined)
        {
            token = new ServiceKey<unknown>(HierarchyContext.TokenNamePrefix + key);
            HierarchyContext.cache.set(key, token);
        }
        return token;
    }
}
