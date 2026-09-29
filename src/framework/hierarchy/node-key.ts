// Owner class for the framework's coarse node families (design §17). Coarse: the
// concrete project TYPE lives on the instance (member.Ref.type), never in the key.
// Modules that introduce new families own their own owner-prefixed NodeKey-style
// class, colocated with the concept, and declare them via NodeKeyRegistry.
export class NodeKey
{
    public static readonly Solution    = 'solution';
    public static readonly Project     = 'project';
    public static readonly Connections = 'connections';
    public static readonly References  = 'references';
}
