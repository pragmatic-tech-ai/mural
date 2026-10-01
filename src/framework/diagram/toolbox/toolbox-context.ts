// A document that publishes the live set of content-context tokens it activates.
// The ToolboxService reads it on ActiveDocument change and flips each page's
// visibility. Mirrors ICommandContextSource.CommandContexts, but the tokens are
// dynamic content strings (`<id>@<version>` refs, model ids) rather than static
// ServiceTokens.
export interface IToolboxContextTarget
{
    readonly ToolboxContexts: ReadonlySet<string>;
}

export function isToolboxContextTarget(x: unknown): x is IToolboxContextTarget
{
    return typeof x === 'object' && x !== null
        && (x as { ToolboxContexts?: unknown }).ToolboxContexts instanceof Set;
}
