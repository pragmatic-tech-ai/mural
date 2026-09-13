// ─── SKETCH ──────────────────────────────────────────────────────────────
// Runtime-level contracts for the shell's Module concept.
//
// They live in runtime so `Application` can hold declared modules (via a
// forthcoming `.modules:` block, a sibling of `resources:`) WITHOUT runtime
// depending on the framework, where the concrete ShellModule / Capability
// live (src/framework/shell/module.ts).
//
// Deliberately minimal — only what the runtime + the compiler's `.modules:`
// lowering need to HOLD and ENUMERATE modules. The view-facing capability
// fields are above runtime's layer and are NOT typed here:
//   • Capability.Icon          is a Geometry   (visual-engine)
//   • Capability.PanelTemplate is a DataTemplate (basic)
// Framework consumers (NavigationService) up-cast an IShellModule /
// ICapability to the concrete ShellModule / Capability to read those.

import type { ResourceDictionary } from './resource-dictionary.js';
import type { IServiceContainer } from '@pragmatic-tech-ai/todl-runtime';

export interface ICapability
{
    readonly Name: string;
}

export interface IShellModule
{
    readonly Name: string;
    readonly Capabilities: Iterable<ICapability>;

    // The module's contributed resource dictionary. `ResourceDictionary` is a
    // runtime type, so carrying it here keeps runtime free of any framework
    // dependency. The Application merges this app-global when the module is
    // added to `Application.Modules`.
    readonly Resources: ResourceDictionary;

    // True when the module declares at least one service registration (a
    // non-empty `.services:` block). Lets the Application skip realizing its
    // lazy service provider for a module that contributes none — preserving the
    // "apps that never touch services pay nothing" guarantee.
    readonly HasServiceRegistrations: boolean;

    // Compose the module's declared service registrations into `container` (the
    // Application's root provider). Called once when the module is added to
    // `Application.Modules`. Each registration keeps the lifetime it was
    // declared with (bare entry ⇒ singleton — one instance per app root that
    // the per-shell scopes below share). A no-op when the module declares no
    // services. `IServiceContainer` is a runtime type, so this stays inside
    // runtime's layer.
    RegisterServices(container: IServiceContainer): void;
}
