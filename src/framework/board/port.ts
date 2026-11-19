import { MetaData, MuralBase } from '../../runtime/index.js';
import type { Rect } from '../../runtime/index.js';
import type { Geometry, Point } from '../../visual-engine/index.js';
import type { ResolvedAnchor } from './routing/router.js';
import {
    type FlattenedOutline,
    getFlattenedOutline,
    walkOutline,
} from './outline-flatten.js';

// Coordinate space a Port's X / Y / OutlineT are interpreted in.
//
// Bbox    — X and Y are shape-local 0..1 against ArrangedRect.
// Outline — OutlineT is arc-length 0..1 around the host Geometry's
//           boundary. X / Y are ignored. Step 5 of § 9 implements the
//           resolver branch; step 4 only handles Bbox.
export enum PortCoordSpace
{
    Bbox    = 'Bbox',
    Outline = 'Outline',
}

// Cardinal side at a port. `Auto` is a resolver INPUT — the resolver
// collapses it into one of the four cardinals before emitting a
// ResolvedAnchor. Routers only ever see ResolvedPortSide
// (= Exclude<PortSide, PortSide.Auto>).
export enum PortSide
{
    N    = 'N',
    S    = 'S',
    E    = 'E',
    W    = 'W',
    Auto = 'Auto',
}

// Routing-side type. Identical to PortSide minus the Auto sentinel.
// router.ts re-exports this so the routing layer keeps a single
// import surface for downstream consumers.
export type ResolvedPortSide = Exclude<PortSide, PortSide.Auto>;

// Minimal contract a PortResolver consumes from the port-bearing host
// (typically a Figure). Bbox mode only reads ArrangedRect; outline
// mode (step 5) reads Geometry too — declared optional so a bbox-only
// host can omit it.
export interface IPortHost
{
    readonly ArrangedRect: Rect;
    readonly Geometry?:    Geometry;
}

// Shorthand for the typed init-object constructor — keeps the
// authoring syntax in § 3.1 of
// [docs/connectors.md](../../../docs/connectors.md) literal:
//     new Port({ Side: PortSide.S, X: 0.25 })
export interface PortInit
{
    readonly Name?:       string;
    readonly CoordSpace?: PortCoordSpace;
    readonly X?:          number;
    readonly Y?:          number;
    readonly OutlineT?:   number;
    readonly Side?:       PortSide;
}

// A single port on a host. Lives on the Figure as part of a Ports
// collection. § 3.1 of
// [docs/connectors.md](../../../docs/connectors.md) covers
// the two addressing schemes (Name + (Side, Index)) and the construction
// ergonomics.
//
// Port is a MuralBase so observers (the PortResolver's outline-mode cache,
// downstream Connector subscribers) can react to mutations. The
// init-object constructor stays a thin sugar over the DP setters —
// any post-construction edit goes through the same MuralBase.set_property_value
// path.
export class Port extends MuralBase
{
    public static readonly NameKey       = MuralBase.RegisterProperty<string>(
        Port, 'Name',       '',                  MetaData.None);
    public static readonly CoordSpaceKey = MuralBase.RegisterProperty<PortCoordSpace>(
        Port, 'CoordSpace', PortCoordSpace.Bbox, MetaData.None);
    public static readonly XKey          = MuralBase.RegisterProperty<number>(
        Port, 'X',          0,                   MetaData.None);
    public static readonly YKey          = MuralBase.RegisterProperty<number>(
        Port, 'Y',          0,                   MetaData.None);
    public static readonly OutlineTKey   = MuralBase.RegisterProperty<number>(
        Port, 'OutlineT',   0,                   MetaData.None);
    public static readonly SideKey       = MuralBase.RegisterProperty<PortSide>(
        Port, 'Side',       PortSide.Auto,       MetaData.None);

    public get Name():       string         { return this.get_property_value(Port.NameKey); }
    public set Name(v:       string)        { this.set_property_value(Port.NameKey, v); }
    public get CoordSpace(): PortCoordSpace { return this.get_property_value(Port.CoordSpaceKey); }
    public set CoordSpace(v: PortCoordSpace){ this.set_property_value(Port.CoordSpaceKey, v); }
    public get X():          number         { return this.get_property_value(Port.XKey); }
    public set X(v:          number)        { this.set_property_value(Port.XKey, v); }
    public get Y():          number         { return this.get_property_value(Port.YKey); }
    public set Y(v:          number)        { this.set_property_value(Port.YKey, v); }
    public get OutlineT():   number         { return this.get_property_value(Port.OutlineTKey); }
    public set OutlineT(v:   number)        { this.set_property_value(Port.OutlineTKey, v); }
    public get Side():       PortSide       { return this.get_property_value(Port.SideKey); }
    public set Side(v:       PortSide)      { this.set_property_value(Port.SideKey, v); }

    constructor(init?: PortInit)
    {
        super();
        if (init === undefined) return;
        if (init.Name       !== undefined) this.Name       = init.Name;
        if (init.CoordSpace !== undefined) this.CoordSpace = init.CoordSpace;
        if (init.X          !== undefined) this.X          = init.X;
        if (init.Y          !== undefined) this.Y          = init.Y;
        if (init.OutlineT   !== undefined) this.OutlineT   = init.OutlineT;
        if (init.Side       !== undefined) this.Side       = init.Side;
    }
}

// Stateless resolver: given a (port, host) pair, lower the port's
// shape-local description into a ResolvedAnchor the routers consume.
// Static-only API because there's no per-resolver state worth keeping
// in v1 (outline-mode arc-length cache lives on the WeakMap in
// outline-flatten.ts and auto-evicts with the Geometry it keys on).
export class PortResolver
{
    public static resolve(port: Port, host: IPortHost): ResolvedAnchor
    {
        switch (port.CoordSpace)
        {
            case PortCoordSpace.Bbox:    return resolveBbox(port, host);
            case PortCoordSpace.Outline: return resolveOutline(port, host);
        }
    }

    // Inverse of resolution path 3 (PortSide + PortIndex). Given an
    // anonymous port (Name = ''), compute the (side, index) pair that
    // identifies it positionally inside `ports` — the same locator
    // shape ConnectorEndpoint stores in its PortSide / PortIndex DPs.
    // A named port should normally be addressed by PortName instead;
    // locate() still returns the positional pair if asked, so callers
    // can use it as a uniform fallback when names aren't available.
    //
    // Returns undefined when the port isn't in `ports` or when the
    // resolved side is Auto (defensive — the resolver always collapses
    // Auto into a cardinal before emitting). Matches `lookupPositional`
    // in [connector.ts](./connector.ts) — both bucket by resolved side
    // and sort by primary axis (X for N/S, Y for E/W).
    public static locate(
        ports: readonly Port[],
        host:  IPortHost,
        port:  Port,
    ): { side: ResolvedPortSide; index: number } | undefined
    {
        const a = PortResolver.resolve(port, host);
        // The resolver always collapses Auto into a cardinal before
        // emitting, so a.side is already ResolvedPortSide at this point.
        const sideCardinal = a.side;
        const bucket: { port: Port; primary: number }[] = [];
        for (const p of ports)
        {
            const pa = PortResolver.resolve(p, host);
            if (pa.side !== sideCardinal) continue;
            const primary = (sideCardinal === PortSide.N || sideCardinal === PortSide.S) ? pa.x : pa.y;
            bucket.push({ port: p, primary });
        }
        bucket.sort((u, v) => u.primary - v.primary);
        const idx = bucket.findIndex(e => e.port === port);
        if (idx < 0) return undefined;
        return { side: sideCardinal, index: idx };
    }
}

function resolveBbox(port: Port, host: IPortHost): ResolvedAnchor
{
    const r = host.ArrangedRect;
    const x = r.X + port.X * r.Width;
    const y = r.Y + port.Y * r.Height;
    const side = port.Side === PortSide.Auto ? deriveSideBbox(port) : port.Side;
    return { x, y, side };
}

function resolveOutline(port: Port, host: IPortHost): ResolvedAnchor
{
    if (host.Geometry === undefined)
    {
        throw new Error(
            'PortResolver: outline-mode resolution requires host.Geometry, '
            + 'got undefined. Set host.Geometry or use CoordSpace = Bbox.',
        );
    }
    const flat = getFlattenedOutline(host.Geometry);
    const walked = walkOutline(flat, port.OutlineT);
    // Geometry coords are shape-local (0..Width × 0..Height for a
    // catalog-derived Figure.Geometry — see scaleGeometry in
    // [shape-catalog.ts](./shape-catalog.ts)). ArrangedRect's origin
    // anchors the shape in board-host coords, so a simple translation
    // gets us there — no scaling, in contrast with bbox mode where
    // port.X / Y are 0..1 fractions.
    const x = host.ArrangedRect.X + walked.point.X;
    const y = host.ArrangedRect.Y + walked.point.Y;
    const side = port.Side === PortSide.Auto
        ? deriveSideOutline(flat, walked.point, walked.tangentAngle)
        : port.Side;
    return { x, y, side };
}

// Auto-side derivation for bbox-mode ports. Picks the cardinal whose
// edge is closest to (X, Y) in shape-local 0..1 space; tie-break order
// W → E → N → S keeps corner / center ports horizontal-first (cleaner
// default exit for most board layouts than vertical-first would be).
function deriveSideBbox(port: Port): ResolvedPortSide
{
    const x = port.X, y = port.Y;
    const dL = x;
    const dR = 1 - x;
    const dT = y;
    const dB = 1 - y;
    const m  = Math.min(dL, dR, dT, dB);
    if (dL === m) return PortSide.W;
    if (dR === m) return PortSide.E;
    if (dT === m) return PortSide.N;
    return PortSide.S;
}

// Auto-side derivation for outline-mode ports per § 3.8 of
// [docs/connectors.md](../../../docs/connectors.md): "compute
// the outward normal at OutlineT (perpendicular to the outline tangent,
// pointing away from centroid) and quantize to the dominant axis".
//
// Tangent (tx, ty) has two perpendiculars: (-ty, tx) and (ty, -tx).
// Outward = whichever has a positive dot product with the radial
// vector (point - centroid). Quantize to the dominant axis with a
// sign that maps to N/S/E/W.
function deriveSideOutline(flat: FlattenedOutline, point: Point, tangentAngle: number): ResolvedPortSide
{
    const tx = Math.cos(tangentAngle);
    const ty = Math.sin(tangentAngle);
    const n1x = -ty, n1y =  tx;
    const n2x =  ty, n2y = -tx;
    const radialX = point.X - flat.centroid.X;
    const radialY = point.Y - flat.centroid.Y;
    const dot1 = n1x * radialX + n1y * radialY;
    const outX = dot1 >= 0 ? n1x : n2x;
    const outY = dot1 >= 0 ? n1y : n2y;
    // Dominant axis decides cardinal; screen +Y is South.
    if (Math.abs(outX) >= Math.abs(outY))
    {
        return outX >= 0 ? PortSide.E : PortSide.W;
    }
    return outY >= 0 ? PortSide.S : PortSide.N;
}
