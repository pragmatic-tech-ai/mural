import { type IPortHost, Port, PortCoordSpace, PortSide } from '../port.js';
import type { IPortProvider } from './port-provider.js';

// Circular-topology provider: `count` equiangular ports around the
// bbox-inscribed ellipse, in shape-local bbox 0..1 coordinates.
//
// Angle convention (screen coords, +Y is south):
//   * 0           → east  (1, 0.5)
//   * π/2         → south (0.5, 1)
//   * π           → west  (0, 0.5)
//   * 3π/2        → north (0.5, 0)
//
// So count=4 with startAngle=0 emits cardinal ports E / S / W / N in
// that order. Side is left as Auto — the bbox-mode resolver picks
// the closest edge per port, which naturally lines up with the
// quadrant.
export class RadialPorts implements IPortProvider
{
    private readonly _count:      number;
    private readonly _startAngle: number;

    constructor(options: { count: number; startAngle?: number })
    {
        this._count      = options.count;
        this._startAngle = options.startAngle ?? 0;
    }

    public GetPorts(_host: IPortHost): readonly Port[]
    {
        if (this._count < 1) return [];
        const out: Port[] = [];
        const step = (2 * Math.PI) / this._count;
        for (let i = 0; i < this._count; i++)
        {
            const angle = this._startAngle + i * step;
            out.push(new Port({
                Side:       PortSide.Auto,
                CoordSpace: PortCoordSpace.Bbox,
                X:          0.5 + 0.5 * Math.cos(angle),
                Y:          0.5 + 0.5 * Math.sin(angle),
            }));
        }
        return out;
    }
}
