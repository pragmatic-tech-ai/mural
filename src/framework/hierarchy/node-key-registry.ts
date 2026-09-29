// Thrown when two different owners declare the same node-key string — the
// compose-time collision the governance model forbids (design §17).
export class DuplicateNodeKeyError extends Error
{
    constructor(key: string, existing: string, offender: string)
    {
        super(`Node key '${key}' is already owned by '${existing}'; '${offender}' cannot also own it.`);
        this.name = 'DuplicateNodeKeyError';
    }
}

// Tracks which module owns each node-key string. DeclareOwned throws on a second,
// different owner; the same owner re-declaring is idempotent (a module composed
// twice, or a re-populate). Contributor MULTIPLICITY is unrelated — many
// contributors may register under one ParentKey (see HierarchyContributorRegistry).
export class NodeKeyRegistry
{
    private readonly owners = new Map<string, string>();

    public DeclareOwned(key: string, ownerId: string): void
    {
        const existing = this.owners.get(key);
        if (existing !== undefined && existing !== ownerId)
        {
            throw new DuplicateNodeKeyError(key, existing, ownerId);
        }
        this.owners.set(key, ownerId);
    }

    public Owners(): ReadonlyMap<string, string>
    {
        return this.owners;
    }
}
