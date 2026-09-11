import {
    Application,
    ServiceProvider,
} from '../../runtime/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';

// Shared skeleton for application shells. Concrete variants (EditorShell /
// ViewerShell) supply the default template that decides which regions exist
// and how the chrome is laid out. Abstract — never registered with a default
// style of its own, so it carries no DefaultStyleKey block.
//
// A shell is fully services-driven: it owns no region-routing and accepts no
// body children. Its template hosts bind their content declaratively via
// `$service(Token)` (e.g. PART_NavHost → `$service(NavigationService)`, the
// content host → the active capability's Panel), resolved against the DI
// scope this shell publishes. App content reaches the shell through the
// modules composed on the Application (their capabilities flatten into the
// NavigationService) — not through region-tagged children.
export abstract class ShellBase extends TemplatedControl
{
    // This shell's own DI scope (lazy). A child of
    // Application.current.Services: per-shell `scoped` services resolve to
    // instances unique to THIS shell here, and dispose() tears them down with
    // the shell.
    private _scope: ServiceProvider | undefined;

    // The shell's own DI scope — a child of Application.current.Services.
    // This is the `.services:` target for a `.services:` block authored on
    // the shell element (`editorShell.Services.addInstance(…)`), and it
    // backs the inherited `ServiceScope` the shell publishes so descendant
    // `$service(Token)` bindings resolve the shell's per-instance services
    // (not the app root). Creating the scope also publishes it.
    public get Services(): ServiceProvider
    {
        if (this._scope === undefined)
        {
            const root = Application.current?.Services;
            this._scope = root !== undefined ? root.createScope() : new ServiceProvider();
            // Publish for the subtree's `$service(…)` bindings. Inherits
            // down through the template.
            this.ServiceScope = this._scope;
        }
        return this._scope;
    }

    // Tear down the shell's scope — disposes the scoped services it owns.
    // Call when the shell is removed for good.
    public dispose(): void
    {
        this._scope?.dispose();
        this._scope = undefined;
    }
}
