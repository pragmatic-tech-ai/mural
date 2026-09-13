import type { IServiceContainer } from '@pragmatic-tech-ai/todl-runtime';
import type { HostKind } from './host-kind.js';

// The minimal composition unit a CompositionRoot depends on — no UI. A CLI
// composes plain IModules; IShellModule (framework layer) extends this with UI
// contributions. `Targets` empty ⇒ universal (composes for every host kind).
export interface IModule
{
    readonly Targets: ReadonlySet<HostKind>;
    RegisterServices(container: IServiceContainer): void;
}
