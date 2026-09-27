// Parses `@Name = value` assignments out of a scheme .mu source. Used by
// the conformance test to compare authored scheme values against the
// design-system snapshot without depending on the runtime Brush shape.
// Colour/scalar tokens are authored one assignment per line; the 14
// type-scale rows pack 4 assignments on one line (e.g.
// `@H1Weight = FontWeight.SemiBold   @H1Size = 44   @H1LineHeight = 51
// @H1Tracking = -0.88`), so a line can yield more than one assignment.
export class SchemeValues
{
    private static readonly Assignment =
        /@([A-Za-z0-9]+)\s*=\s*(.+?)(?=\s+@[A-Za-z0-9]+\s*=|\s*$)/g;

    public static Parse(muSource: string): Map<string, string>
    {
        const out = new Map<string, string>();
        for (const line of muSource.split('\n'))
        {
            for (const m of line.matchAll(SchemeValues.Assignment))
            {
                // Assignment has two non-optional capture groups, so a match
                // always populates both m[1] (name) and m[2] (raw value).
                out.set(m[1]!, m[2]!.replace(/\s*\/\/.*$/, '').trim());
            }
        }
        return out;
    }
}
