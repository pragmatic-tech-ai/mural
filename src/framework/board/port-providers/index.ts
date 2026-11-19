// Barrel for the port-providers folder. The framework re-exports
// these from `src/framework/board/index.ts` so consumers can
// `import { BoundingBoxPorts, ... } from '@pragmatic-tech-ai/mural/framework/board'`.
export type { IPortProvider } from './port-provider.js';
export { BoundingBoxPorts }   from './bounding-box-ports.js';
export { RadialPorts }        from './radial-ports.js';
export { OutlinePorts }       from './outline-ports.js';
export { VertexPorts }        from './vertex-ports.js';
export { CustomPortProvider } from './custom-port-provider.js';
export { resolveDefaultPortProvider } from './default-port-providers.js';
