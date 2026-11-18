import { BoundingBoxPorts } from './bounding-box-ports.js';
import type { IPortProvider } from './port-provider.js';

// The default port topology for every figure: one port per bounding-box side.
// Figures are uniform at realization (no Kind), so there is no per-kind default
// table — a shape that needs a different topology (radial, vertex, custom) sets
// Figure.PortProvider explicitly. See § 3.8 of
// [docs/connectors.md](../../../../docs/connectors.md).
const FALLBACK_PROVIDER: IPortProvider = new BoundingBoxPorts({ portsPerSide: 1 });

export function resolveDefaultPortProvider(): IPortProvider
{
    return FALLBACK_PROVIDER;
}
