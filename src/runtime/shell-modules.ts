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
import type { IModule } from './composition/module.js';

export interface ICapability
{
    readonly Name: string;
}

// A UI-flavored composition unit: an IModule (Targets + RegisterServices — the
// composition half the CompositionRoot base drives) plus the shell contributions
// the Application aggregates once the module is composed.
export interface IShellModule extends IModule
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

    // `Targets` (ReadonlySet<HostKind>) and RegisterServices(container) are
    // inherited from IModule: the module names the host kinds it composes for
    // (empty ⇒ universal) and registers its services into the root provider.
}
