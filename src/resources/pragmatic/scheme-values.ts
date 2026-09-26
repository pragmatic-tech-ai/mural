// Parses `@Name = value` assignments out of a scheme .mu source. Used by
// the conformance test to compare authored scheme values against the
// design-system snapshot without depending on the runtime Brush shape.
// Colour tokens are authored one per line; multi-token type-scale lines
// yield only their first token, which the conformance test ignores (it
// compares colour tokens only).
export class SchemeValues
{
    private static readonly Assignment = /^\s*@([A-Za-z0-9]+)\s*=\s*(.+?)\s*$/;

    public static Parse(muSource: string): Map<string, string>
    {
        const out = new Map<string, string>();
        for (const line of muSource.split('\n'))
        {
            const m = SchemeValues.Assignment.exec(line);
            if (m !== null)
            {
                out.set(m[1], m[2].replace(/\s*\/\/.*$/, '').trim());
            }
        }
        return out;
    }
}
