import type { IPortHost, Port } from '../port.js';
import type { IPortProvider } from './port-provider.js';

// Escape hatch for shapes whose topology none of the built-in
// providers cover — Heart's anatomical landing points, Arrow's
// head + tail + barbs, etc. The callback receives the host and
// returns the desired Port array; the framework wraps it in this
// IPortProvider shape so it slots into Figure.PortProvider just
// like the named providers.
export class CustomPortProvider implements IPortProvider
{
    private readonly _fn: (host: IPortHost) => readonly Port[];

    constructor(fn: (host: IPortHost) => readonly Port[])
    {
        this._fn = fn;
    }

    public GetPorts(host: IPortHost): readonly Port[]
    {
        return this._fn(host);
    }
}
