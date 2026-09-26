// Reads the committed design-system tokens.json snapshot and resolves
// a colour token to its literal value for a given theme, following
// {alias} references and falling back to the light value when a theme
// value is missing (matching the design system's own resolution rule).
interface ColorTokenValue
{
    light?: string;
    dark?:  string;
}

interface ColorToken
{
    name:  string;
    value: ColorTokenValue;
}

export class TokenSnapshot
{
    private static readonly AliasPattern = /^\{([^}]+)\}$/;

    private readonly colors: Map<string, ColorTokenValue>;

    constructor(json: unknown)
    {
        const root   = json as { color?: { tokens?: ColorToken[] } };
        const tokens = root.color?.tokens ?? [];
        this.colors  = new Map();
        for (const t of tokens)
        {
            this.colors.set(t.name, t.value);
        }
    }

    public ColorNames(): string[]
    {
        return [...this.colors.keys()];
    }

    public Resolve(name: string, theme: 'light' | 'dark'): string
    {
        const value = this.colors.get(name);
        if (value === undefined)
        {
            throw new Error(`Unknown colour token '${name}'.`);
        }
        const raw = value[theme] ?? value.light;
        if (raw === undefined)
        {
            throw new Error(`Token '${name}' has no value for '${theme}' or 'light'.`);
        }
        const alias = TokenSnapshot.AliasPattern.exec(raw.trim());
        if (alias !== null)
        {
            return this.Resolve(alias[1], theme);
        }
        return raw;
    }
}
