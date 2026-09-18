import { CompositionRoot, type HostKind, type IModule } from '@pragmatic-tech-ai/todl-runtime';
import { ObservableCollection } from './observable-collection.js';
import type { IShellModule } from './shell-modules.js';

// A CompositionRoot that understands the shell's two module flavors. A
// SHELL module (an IShellModule — capabilities + resources + a service-
// registration flag) joins `Modules`, whose subscription registers its
// services and lets a subclass fold in its shell contributions. A PLAIN
// IModule (Targets + RegisterServices only) composes straight through the
// CompositionRoot base — no shell machinery, no cast.
//
// This is the seam that lets a headless engine module (a plain IModule from a
// non-UI package) be added to the same root as the shell's UI modules without
// being force-cast to IShellModule: `ComposeModule` routes by kind. Application
// extends this so `app.AddModule(module)` admits either flavor.
export class ShellCompositionRoot extends CompositionRoot
{
    // Shell modules composed onto this root — contributed via a `.modules:`
    // block or added imperatively. Held as the runtime IShellModule contract so
    // runtime stays free of the framework where the concrete ShellModule lives;
    // a shell's NavigationService flattens their capabilities into the root
    // navigation layer. Plain IModules are NOT held here.
    public readonly Modules: ObservableCollection<IShellModule> = new ObservableCollection<IShellModule>();

    // Shell modules whose registrations are already replayed into `Provider` — so
    // each module's services register exactly once even though the Modules
    // subscription fires on every change. Add-only: ServiceProvider exposes no
    // un-register, and module services are root singletons, so a removed module's
    // registrations linger harmlessly (nothing resolves their tokens once its
    // capabilities leave the navigation layer).
    private readonly _servicedModules = new Set<IShellModule>();

    constructor(hostKind?: HostKind)
    {
        super(hostKind);
        // Fold each Modules change: the base behavior registers newly-added
        // modules' services; a subclass (Application) extends onModulesChanged to
        // also merge their resources.
        this.Modules.Subscribe(() => this.onModulesChanged());
    }

    // Route an admitted module by KIND, not by cast. A shell module joins
    // `Modules` (its subscription registers services + a subclass aggregates its
    // contributions); a plain IModule composes through the base, so its
    // RegisterServices runs directly with no shell machinery and no
    // HasServiceRegistrations gate.
    protected override ComposeModule(module: IModule): void
    {
        if (ShellCompositionRoot.isShellModule(module)) this.Modules.Add(module);
        else super.ComposeModule(module);
    }

    // Fired once per Modules change. Base behavior registers module services;
    // Application overrides to reconcile module resources first, preserving the
    // historical resources-before-services order.
    protected onModulesChanged(): void
    {
        this.registerModuleServices();
    }

    // Replay each not-yet-serviced module's registrations into the root Provider,
    // skipping modules that declare none — so the lazy provider is not realized
    // for a resource-only module (the "apps that never touch services pay
    // nothing" guarantee).
    protected registerModuleServices(): void
    {
        for (const m of this.Modules)
        {
            if (this._servicedModules.has(m)) continue;
            this._servicedModules.add(m);
            if (!m.HasServiceRegistrations) continue;
            m.RegisterServices(this.Provider);
        }
    }

    // A shell module carries capabilities + a service-registration flag; a plain
    // IModule (Targets + RegisterServices only) has neither. Structural so no
    // discriminator field has to be threaded through the module interfaces.
    private static isShellModule(module: IModule): module is IShellModule
    {
        return 'Capabilities' in module && 'HasServiceRegistrations' in module;
    }
}
