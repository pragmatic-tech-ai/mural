import type { IPortHost, Port } from '../port.js';

// Contract every port-distribution strategy implements. Pure-function
// shape — the provider reads geometry / arrangement state off the
// host and emits a fresh array of Ports, with no per-call mutation
// or hidden state. Caching of the result lives on the consumer side
// (see § 3.8 / § 7.12 of
// [docs/connectors.md](../../../../docs/connectors.md) —
// Figure caches `Ports` keyed on `(provider, ArrangedRect, Geometry)`).
export interface IPortProvider
{
    GetPorts(host: IPortHost): readonly Port[];
}
