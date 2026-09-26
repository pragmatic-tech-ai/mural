import { Effect } from './effect.js';

// The design system's three shadows (tokens.json `shadow`), expressed as
// Mural Effects. Each is one or two stacked drop-shadow() layers; alpha
// differs by theme, so the scheme installs a Dark-tuned instance in
// dark.mu and a light one in light.mu. CSS composes shadows by
// concatenating drop-shadow() functions — the same approach
// MaterialElevationEffect uses for M3 elevation.
type ShadowLevel = 'sm' | 'md' | 'lg';

interface ShadowLayer
{
    Y:          number;
    Blur:       number;
    LightAlpha: number;
    DarkAlpha:  number;
}

export class PragmaticShadowEffect extends Effect
{
    // Ordered outermost (ambient) first, to match CSS box-shadow stacking.
    private static readonly Layers: Readonly<Record<ShadowLevel, ReadonlyArray<ShadowLayer>>> =
    {
        sm: [ { Y: 1,  Blur: 2,  LightAlpha: 0.04, DarkAlpha: 0.40 } ],
        md: [ { Y: 4,  Blur: 12, LightAlpha: 0.06, DarkAlpha: 0.50 },
              { Y: 1,  Blur: 2,  LightAlpha: 0.04, DarkAlpha: 0.40 } ],
        lg: [ { Y: 12, Blur: 32, LightAlpha: 0.10, DarkAlpha: 0.60 },
              { Y: 2,  Blur: 6,  LightAlpha: 0.05, DarkAlpha: 0.40 } ],
    };

    public Level: ShadowLevel;
    public Dark:  boolean;

    constructor(level: ShadowLevel = 'md', dark: boolean = false)
    {
        super();
        this.Level = level;
        this.Dark  = dark;
    }

    // The resolved layers for a level + theme, as { y, blur, alpha } — the
    // shape the conformance test compares against the design-system snapshot.
    public static LayersFor(level: ShadowLevel, dark: boolean): ReadonlyArray<{ y: number; blur: number; alpha: number }>
    {
        return PragmaticShadowEffect.Layers[level].map(l => ({ y: l.Y, blur: l.Blur, alpha: dark ? l.DarkAlpha : l.LightAlpha }));
    }

    public override toCssFilter(): string
    {
        return PragmaticShadowEffect.LayersFor(this.Level, this.Dark)
            .map(l => `drop-shadow(0.0px ${l.y.toFixed(1)}px ${l.blur.toFixed(1)}px rgba(0, 0, 0, ${l.alpha.toFixed(3)}))`)
            .join(' ');
    }
}
