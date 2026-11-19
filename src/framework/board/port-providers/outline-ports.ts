import { type IPortHost, Port, PortCoordSpace, PortSide } from '../port.js';
import type { IPortProvider } from './port-provider.js';

// Arc-length-spaced ports around `host.Geometry`'s outline. Emits
// outline-coord ports the resolver lowers via the flatten / walk
// pipeline in [outline-flatten.ts](../outline-flatten.ts). Used for
// shapes whose ports MUST follow a curved boundary (Heart, Clamshell,
// Bun, Fan, etc.); bbox-mode placement would land ports inside the
// shape's bounding rectangle but off the actual outline.
//
// `startT` rotates the entire ring around the outline — handy when
// the natural figure StartPoint isn't where the consumer wants the
// first port to land.
export class OutlinePorts implements IPortProvider
{
    private readonly _count:  number;
    private readonly _startT: number;

    constructor(options: { count: number; startT?: number })
    {
        this._count  = options.count;
        this._startT = options.startT ?? 0;
    }

    public GetPorts(_host: IPortHost): readonly Port[]
    {
        if (this._count < 1) return [];
        const out: Port[] = [];
        for (let i = 0; i < this._count; i++)
        {
            // Wrap-around — startT=0.9 + step=0.5 emits an OutlineT of
            // 0.4 (rather than 1.4, which would clamp at the resolver
            // and produce a duplicate at the figure's tail vertex).
            const raw = this._startT + i / this._count;
            const t   = raw - Math.floor(raw);
            out.push(new Port({
                Side:       PortSide.Auto,
                CoordSpace: PortCoordSpace.Outline,
                OutlineT:   t,
            }));
        }
        return out;
    }
}
