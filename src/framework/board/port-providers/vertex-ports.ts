import { LineSegment, PathGeometry, Point } from '../../../visual-engine/index.js';
import { type IPortHost, Port, PortCoordSpace, PortSide } from '../port.js';
import type { IPortProvider } from './port-provider.js';

// Polygon-vertex provider: one port at each LineSegment corner of
// `host.Geometry`'s first figure. Optional midpoints between
// consecutive vertices (and one between the last vertex and the
// start when the figure is closed).
//
// Only LineSegment endpoints contribute — curved segments don't
// have well-defined "vertices" in the polygon sense. Used by the
// natural polygon shapes (Triangle, Diamond, Slanted, Arrow head).
//
// Position is in bbox 0..1 coords, computed by dividing the vertex's
// shape-local coordinates by ArrangedRect.Width / Height. Side is
// Auto — the bbox-mode resolver picks the closest edge per corner.
export class VertexPorts implements IPortProvider
{
    private readonly _includeMidpoints: boolean;

    constructor(options: { includeMidpoints?: boolean } = {})
    {
        this._includeMidpoints = options.includeMidpoints ?? false;
    }

    public GetPorts(host: IPortHost): readonly Port[]
    {
        const geom = host.Geometry;
        if (geom === undefined || !(geom instanceof PathGeometry)) return [];
        if (geom.Figures.length === 0) return [];
        const fig = geom.Figures[0]!;

        // Vertices = StartPoint + LineSegment endpoints. Curved
        // segments contribute their endpoint too (it's a polyline
        // corner), but interior control points are ignored.
        const vertices: Point[] = [fig.StartPoint];
        for (const seg of fig.Segments)
        {
            if (seg instanceof LineSegment) vertices.push(seg.Point);
        }

        const w = host.ArrangedRect.Width;
        const h = host.ArrangedRect.Height;
        const toBbox = (p: Point): Port => new Port({
            Side:       PortSide.Auto,
            CoordSpace: PortCoordSpace.Bbox,
            X:          w > 0 ? p.X / w : 0,
            Y:          h > 0 ? p.Y / h : 0,
        });

        const out: Port[] = vertices.map(toBbox);
        if (this._includeMidpoints && vertices.length > 1)
        {
            for (let i = 0; i < vertices.length - 1; i++)
            {
                const a = vertices[i]!, b = vertices[i + 1]!;
                out.push(toBbox(new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2)));
            }
            if (fig.IsClosed)
            {
                const a = vertices[vertices.length - 1]!, b = vertices[0]!;
                out.push(toBbox(new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2)));
            }
        }
        return out;
    }
}
