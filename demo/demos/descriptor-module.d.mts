// Ambient type for every demo descriptor bootstrap. The `*.descriptor.mjs`
// files are thin plain-JS bootstraps (per CLAUDE.md, bootstrap entries stay
// JS), each `export default`-ing one demo descriptor. This single wildcard
// declaration crosses the JS→TS boundary so the typed `.mts` barrels can import
// them without a per-file declaration.
declare module '*.descriptor.mjs'
{
    import type { DemoDescriptor } from '../platform/demo-descriptor.mjs';
    const demo: DemoDescriptor;
    export default demo;
}
