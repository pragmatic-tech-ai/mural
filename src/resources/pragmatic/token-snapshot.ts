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
    name:           string;
    fontSize?:      string;
    fontWeight?:    number;
    // A unitless ratio (Display/Headings/Body/Mono groups, e.g. `1.15`) or
    // an absolute px string (UI group, e.g. `"20px"`) — see
    // TokenSnapshot.lineHeightPx().
    lineHeight?:    string | number;
    letterSpacing?: string;
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
    private static readonly EmPattern    = /em$/i;

    // Scalar (non-colour) families whose tokens the schemes also carry.
    private static readonly ScalarFamilies: ReadonlyArray<string> =
        ['spacing', 'radius', 'sizing', 'density', 'duration', 'opacity', 'focus'];

    // fontWeight (JSON number) -> FontWeight enum member name, as used in
    // the scheme .mu source (`FontWeight.SemiBold`).
    private static readonly FontWeightNames: ReadonlyMap<number, string> = new Map([
        [400, 'Normal'],
        [500, 'Medium'],
        [600, 'SemiBold'],
        [700, 'Bold'],
    ]);
    private static readonly FontWeightExprPrefix = 'FontWeight.';

    private readonly colors:  Map<string, ColorTokenValue>;
    private readonly scalars: Map<string, number>;
    private readonly typeSizes: Map<string, number>;
    private readonly typeStyles: Map<string, TypeStyle>;
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

        this.typeSizes  = new Map();
        this.typeStyles = new Map();
        for (const g of this.root.type?.groups ?? [])
        {
            for (const s of g.styles ?? [])
            {
                if (s.fontSize !== undefined)
                {
                    this.typeSizes.set(s.name, TokenSnapshot.toNumber(s.fontSize));
                }
                this.typeStyles.set(s.name, s);
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

    // The `FontWeight.<Name>` expression a scheme authors for this style,
    // e.g. 'FontWeight.SemiBold' for a JSON fontWeight of 600.
    public TypeWeight(styleName: string): string
    {
        const style = this.typeStyle(styleName);
        if (style.fontWeight === undefined)
        {
            throw new Error(`Type style '${styleName}' has no fontWeight.`);
        }
        const name = TokenSnapshot.FontWeightNames.get(style.fontWeight);
        if (name === undefined)
        {
            throw new Error(`Unmapped fontWeight ${style.fontWeight} for '${styleName}'.`);
        }
        return `${TokenSnapshot.FontWeightExprPrefix}${name}`;
    }

    // lineHeight in px, matching what the scheme authors as `@<Role>LineHeight`.
    // A unitless ratio (Display/Headings/Body/Mono groups) is converted to
    // the rounded pixel value (fontSize_px * ratio); an absolute px string
    // (the UI group) is used directly.
    public TypeLineHeight(styleName: string): number
    {
        const style = this.typeStyle(styleName);
        if (style.lineHeight === undefined)
        {
            throw new Error(`Type style '${styleName}' has no lineHeight.`);
        }
        if (typeof style.lineHeight === 'string')
        {
            return TokenSnapshot.toNumber(style.lineHeight);
        }
        return Math.round(this.TypeSize(styleName) * style.lineHeight);
    }

    // letterSpacing in px, matching what the scheme authors as
    // `@<Role>Tracking`. An em string is converted via fontSize_px * em;
    // an absent letterSpacing is 0.
    public TypeTracking(styleName: string): number
    {
        const style = this.typeStyle(styleName);
        if (style.letterSpacing === undefined)
        {
            return 0;
        }
        const em = Number(style.letterSpacing.replace(TokenSnapshot.EmPattern, '').trim());
        return Math.round(this.TypeSize(styleName) * em * 100) / 100;
    }

    private typeStyle(styleName: string): TypeStyle
    {
        const style = this.typeStyles.get(styleName);
        if (style === undefined)
        {
            throw new Error(`Unknown type style '${styleName}'.`);
        }
        return style;
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
