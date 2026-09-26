// Normalizes a colour literal to a canonical "r,g,b,a" string (each 0..255)
// so values authored in different but equivalent forms compare equal:
// the schemes use hex / hex8 (the .mu grammar has no rgba() form), while
// the design-system snapshot uses hex and rgba(). Alpha is rounded to the
// nearest 0..255 the same way from both sides.
export class ColorValue
{
    private static readonly HexPattern = /^#([0-9a-fA-F]{3,8})$/;
    private static readonly RgbPattern = /^rgba?\(([^)]+)\)$/i;

    public static Normalize(value: string): string
    {
        const v = value.trim();
        const hex = ColorValue.HexPattern.exec(v);
        if (hex !== null)
        {
            return ColorValue.fromHex(hex[1]);
        }
        const rgb = ColorValue.RgbPattern.exec(v);
        if (rgb !== null)
        {
            return ColorValue.fromRgb(rgb[1]);
        }
        throw new Error(`Not a colour literal: '${value}'.`);
    }

    private static fromHex(body: string): string
    {
        let r: number;
        let g: number;
        let b: number;
        let a = 255;
        if (body.length === 3)
        {
            r = parseInt(body[0] + body[0], 16);
            g = parseInt(body[1] + body[1], 16);
            b = parseInt(body[2] + body[2], 16);
        }
        else if (body.length === 6 || body.length === 8)
        {
            r = parseInt(body.slice(0, 2), 16);
            g = parseInt(body.slice(2, 4), 16);
            b = parseInt(body.slice(4, 6), 16);
            if (body.length === 8)
            {
                a = parseInt(body.slice(6, 8), 16);
            }
        }
        else
        {
            throw new Error(`Unsupported hex length: '#${body}'.`);
        }
        return `${r},${g},${b},${a}`;
    }

    private static fromRgb(body: string): string
    {
        const parts = body.split(',').map(p => p.trim());
        const r = Math.round(Number(parts[0]));
        const g = Math.round(Number(parts[1]));
        const b = Math.round(Number(parts[2]));
        const a = parts.length > 3 ? Math.round(Number(parts[3]) * 255) : 255;
        return `${r},${g},${b},${a}`;
    }
}
