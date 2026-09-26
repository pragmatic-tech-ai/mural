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

interface ScalarToken
{
    name:  string;
    value: string | number;
}

interface ScalarFamily
{
    tokens?: ScalarToken[];
}

interface TypeStyle
{
    name:      string;
    fontSize?: string;
}

interface TypeGroup
{
    styles?: TypeStyle[];
}

interface ShadowLayerSpec
{
    y:     number;
    blur:  number;
    alpha: number;
}

export class TokenSnapshot
{
    private static readonly AliasPattern = /^\{([^}]+)\}$/;

    // Scalar (non-colour) families whose tokens the schemes also carry.
    private static readonly ScalarFamilies: ReadonlyArray<string> =
        ['spacing', 'radius', 'sizing', 'density', 'duration', 'opacity', 'focus'];

    private readonly colors:  Map<string, ColorTokenValue>;
    private readonly scalars: Map<string, number>;
    private readonly typeSizes: Map<string, number>;
    private readonly root: {
        color?:  { tokens?: ColorToken[] };
        type?:   { groups?: TypeGroup[] };
        shadow?: { tokens?: { name: string; value: { light?: string; dark?: string } }[] };
    };

    constructor(json: unknown)
    {
        this.root    = json as TokenSnapshot['root'];
        const tokens = this.root.color?.tokens ?? [];
        this.colors  = new Map();
        for (const t of tokens)
        {
            this.colors.set(t.name, t.value);
        }

        this.scalars = new Map();
        const asRecord = json as Record<string, ScalarFamily>;
        for (const family of TokenSnapshot.ScalarFamilies)
        {
            for (const t of asRecord[family]?.tokens ?? [])
            {
                this.scalars.set(t.name, TokenSnapshot.toNumber(t.value));
            }
        }

        this.typeSizes = new Map();
        for (const g of this.root.type?.groups ?? [])
        {
            for (const s of g.styles ?? [])
            {
                if (s.fontSize !== undefined)
                {
                    this.typeSizes.set(s.name, TokenSnapshot.toNumber(s.fontSize));
                }
            }
        }
    }

    // Strips a px/ms/em/% unit suffix and returns the numeric part.
    private static toNumber(value: string | number): number
    {
        if (typeof value === 'number') return value;
        const n = Number(value.replace(/(px|ms|em|%)$/i, '').trim());
        if (Number.isNaN(n))
        {
            throw new Error(`Not a numeric token value: '${value}'.`);
        }
        return n;
    }

    public ScalarNames(): string[]
    {
        return [...this.scalars.keys()];
    }

    public Scalar(name: string): number
    {
        const v = this.scalars.get(name);
        if (v === undefined)
        {
            throw new Error(`Unknown scalar token '${name}'.`);
        }
        return v;
    }

    public TypeSizeNames(): string[]
    {
        return [...this.typeSizes.keys()];
    }

    public TypeSize(styleName: string): number
    {
        const v = this.typeSizes.get(styleName);
        if (v === undefined)
        {
            throw new Error(`Unknown type style '${styleName}'.`);
        }
        return v;
    }

    // The design system's shadow layers for a level ('sm'|'md'|'lg'), parsed
    // from the box-shadow strings in tokens.json `shadow`, outermost first.
    public ShadowLayers(level: string, theme: 'light' | 'dark'): ShadowLayerSpec[]
    {
        const token = this.root.shadow?.tokens?.find(t => t.name === `shadow-${level}`);
        if (token === undefined)
        {
            throw new Error(`Unknown shadow 'shadow-${level}'.`);
        }
        const raw = token.value[theme] ?? token.value.light ?? '';
        // Each layer: "0 <y>px <blur>px rgba(0, 0, 0, <alpha>)".
        const layers: ShadowLayerSpec[] = [];
        const pattern = /0\s+(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+rgba\(0,\s*0,\s*0,\s*(-?\d+(?:\.\d+)?)\)/g;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(raw)) !== null)
        {
            layers.push({ y: Number(m[1]), blur: Number(m[2]), alpha: Number(m[3]) });
        }
        return layers;
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
