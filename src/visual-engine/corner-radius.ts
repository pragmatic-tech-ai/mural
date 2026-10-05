// CornerRadius — per-corner radius value type for Border.CornerRadius.
//
// Border.CornerRadius accepts either a plain `number` (uniform radius
// applied to all four corners — backwards-compatible with `border.CornerRadius
// = 8` and `CornerRadius = 4` in markup) OR a CornerRadius instance for
// asymmetric corners (rounded outer ends, square inner ends — the
// connected-bar shape ToolBar uses).
//
// `CornerRadius.Full` is the Material 3 "fully rounded" sentinel — every
// corner radius is Number.POSITIVE_INFINITY, and Border's render path
// clamps each non-finite corner to min(width, height) / 2 at paint time
// (so a wide rect renders as a stadium, a square as a circle).
//
// Use from TS:
//     border.CornerRadius = CornerRadius.Full;
//     border.CornerRadius = new CornerRadius(8, 0, 0, 8);   // pill-left
//     border.CornerRadius = new CornerRadius(4);            // uniform (all four = 4)
//     border.CornerRadius = 4;                              // uniform
//
// Use from `.mu`:
//     CornerRadius = 4
//     CornerRadius = (4)          // uniform — a 1-element tuple IS uniform
//     CornerRadius = @ShapeFull
//     CornerRadius = CornerRadius.Full
//
// The single-argument ctor fills all four corners (mirroring `Thickness`'s
// uniform overload). The compiler lowers a 1-element markup tuple `(n)` to
// `new CornerRadius(n)`, so without this overload `(n)` set ONLY TopLeft and
// left the other three `undefined` → non-finite → folded to Full at paint,
// rendering a lopsided blob (three circular corners + one square). See the
// `resolveCorners` fold in border.ts.
export class CornerRadius
{
    public readonly TopLeft:     number;
    public readonly TopRight:    number;
    public readonly BottomRight: number;
    public readonly BottomLeft:  number;

    constructor(uniform: number);
    constructor(topLeft: number, topRight: number, bottomRight: number, bottomLeft: number);
    constructor(a: number, b?: number, c?: number, d?: number)
    {
        if (b === undefined)
        {
            this.TopLeft = this.TopRight = this.BottomRight = this.BottomLeft = a;
        }
        else
        {
            this.TopLeft     = a;
            this.TopRight    = b;
            this.BottomRight = c!;
            this.BottomLeft  = d!;
        }
    }

    public static readonly Zero: CornerRadius = new CornerRadius(0, 0, 0, 0);

    // M3 "Full" shape-family sentinel — fully rounded; Border clamps
    // each non-finite corner to min(width, height) / 2 at render time.
    public static readonly Full: CornerRadius = new CornerRadius(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
    );

    // Connected-bar caps. `LeftRounded` is the shape ToolBar's First
    // button uses (outer-left corners rounded, inner-right corners
    // square); `RightRounded` is the Last button's mirror. The right
    // place to express these in markup is via a STATIC_MEMBERS dotted
    // ref (`CornerRadius.LeftRounded`) — tuple syntax `(@ShapeFull, 0,
    // 0, @ShapeFull)` doesn't lift the @ShapeFull SetterFactory over
    // the Thickness constructor when used inside a Style trigger.
    public static readonly LeftRounded: CornerRadius = new CornerRadius(
        Number.POSITIVE_INFINITY, 0, 0, Number.POSITIVE_INFINITY,
    );
    public static readonly RightRounded: CornerRadius = new CornerRadius(
        0, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0,
    );

    public static Uniform(r: number): CornerRadius
    {
        return new CornerRadius(r, r, r, r);
    }

    public get IsUniform(): boolean
    {
        return this.TopLeft    === this.TopRight
            && this.TopRight   === this.BottomRight
            && this.BottomRight === this.BottomLeft;
    }

    public Equals(other: CornerRadius): boolean
    {
        return this.TopLeft     === other.TopLeft
            && this.TopRight    === other.TopRight
            && this.BottomRight === other.BottomRight
            && this.BottomLeft  === other.BottomLeft;
    }
}
