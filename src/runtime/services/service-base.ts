import { MuralBase } from '../model.js';
import { MetaData } from '../metadata.js';
import type { IServiceProvider } from './service-provider.js';

// Base for application services that are also bindable view-models.
//
// Extends MuralBase so a service can expose DPs that view content binds to
// directly (`$StatusText`, `$Target`, …) — the same "view-observable
// state lives on DPs" contract VMs follow. Registering one of these in
// the ServiceProvider lets the shell hand it to a region as DataContext
// and lets commands / behaviors / child VMs resolve the SAME instance.
//
// Convention (TS can't express a `static abstract`): every concrete
// service declares a `static readonly Key: ServiceKey<Self>` token and
// registers itself against it, so registration / resolution sites stay
// uniform and greppable (the no-string-type-proxies rule — tokens are
// real objects).
//
// Lifecycle: dispose() releases subscriptions / timers the service
// holds. A ServiceProvider scope calls dispose() on every ServiceBase
// it owns when the scope is disposed (see ServiceProvider.dispose), so
// a per-shell scope tears its services down with the shell.
export abstract class ServiceBase extends MuralBase
{
    // The container that built this service, narrowed to the consumer
    // contract (resolve only — no register / scope). Every concrete
    // service ctor takes an IServiceProvider and forwards it here via
    // `super(provider)`; both the `.services:` markup block and any code
    // registration construct a service as `new Impl(provider)`. A service
    // resolves its own collaborators from here — in the ctor for eager
    // wiring, or lazily, e.g. `this.Provider.getRequired(Other.Key)`.
    protected readonly Provider: IServiceProvider;

    // Optional header-action affordances the shell presents for this service
    // when it backs a content region — the right side of a ShellSideContentPane
    // header (a button row, a "…" menu, …). A view-facing slot a service sets to
    // expose its actions; the pane binds it via
    // `Commands = $service(…).ActiveService.HeaderCommands`. `unknown` (not a
    // Visual type) so runtime stays free of a visual-engine dependency — a
    // ContentPresenter resolves whatever's here (Visual, or MuralBase via
    // DataTemplate). Unset ⇒ no commands shown.
    public static readonly HeaderCommandsKey = MuralBase.RegisterProperty<unknown>(
        ServiceBase, 'HeaderCommands', undefined, MetaData.None);

    constructor(provider: IServiceProvider)
    {
        super();
        this.Provider = provider;
    }

    public get HeaderCommands(): unknown { return this.get_property_value(ServiceBase.HeaderCommandsKey); }
    public set HeaderCommands(v: unknown) { this.set_property_value(ServiceBase.HeaderCommandsKey, v); }

    // Override to release resources (event subscriptions, timers, …).
    // Default no-op. Idempotent by contract — the container calls it
    // once on scope teardown, but a defensive double-call must be safe.
    public dispose(): void { }
}
