import { type IPortHost, Port, PortCoordSpace, PortSide } from '../port.js';
import type { IPortProvider } from './port-provider.js';

// Rectangular-topology provider: `portsPerSide` evenly-spaced ports
// per cardinal side, in shape-local bbox 0..1 coordinates. Default
// portsPerSide=1 produces the canonical 4-port "one per side"
// arrangement at the edge midpoints.
//
// For N ports per side the fractional positions along the side are
// i/(N+1) for i=1..N — interior spacing, no port at the corners.
// Side=N/S place ports on the top/bottom edges (Y=0/1), Side=E/W on
// the right/left edges (X=1/0).
//
// Per § 3.8 the emitted ports are anonymous (Name="") and addressed
// positionally by (Side, Index) after the framework's resolver
// re-buckets them — this provider does NOT pre-assign indices.
export class BoundingBoxPorts implements IPortProvider
{
    private readonly _portsPerSide: number;

    constructor(options: { portsPerSide?: number } = {})
    {
        this._portsPerSide = options.portsPerSide ?? 1;
    }

    public GetPorts(_host: IPortHost): readonly Port[]
    {
        const n = this._portsPerSide;
        if (n < 1) return [];
        const out: Port[] = [];
        for (let i = 1; i <= n; i++)
        {
            const frac = i / (n + 1);
            out.push(new Port({
                Side:       PortSide.N,
                CoordSpace: PortCoordSpace.Bbox,
                X:          frac,
                Y:          0,
            }));
            out.push(new Port({
                Side:       PortSide.S,
                CoordSpace: PortCoordSpace.Bbox,
                X:          frac,
                Y:          1,
            }));
            out.push(new Port({
                Side:       PortSide.E,
                CoordSpace: PortCoordSpace.Bbox,
                X:          1,
                Y:          frac,
            }));
            out.push(new Port({
                Side:       PortSide.W,
                CoordSpace: PortCoordSpace.Bbox,
                X:          0,
                Y:          frac,
            }));
        }
        return out;
    }
}
