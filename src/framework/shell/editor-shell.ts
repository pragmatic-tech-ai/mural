import { Application, Element, MetaData, MuralBase } from '../../runtime/index.js';
import { ShellBase } from './shell.js';
import { NavigationService } from './services/navigation-service.js';
import { ContentHostService } from './services/content-host-service.js';
import { DocumentsContentHostService } from './services/documents-content-host-service.js';
import { PanelDockService } from './services/panel-dock-service.js';
import { DialogService } from './services/dialog-service.js';
import { StatusService } from './services/status-service.js';
import { ApplicationSettings } from './services/application-settings-service.js';
import { SettingSourceKey } from '../../runtime/index.js';
import { ThemeServiceKey, ThemeServiceInstance } from './services/theme-service.js';
import { DocumentTypeRegistry } from './documents/document-type-registry.js';
import { ProjectFactoryRegistry } from './projects/project-factory-registry.js';
import { CommandRegistry } from './commands/command-registry.js';
import { ToolbarService } from './commands/toolbar-service.js';
import { RailAction } from './rail-action.js';
import { SettingsContributionKey, SettingsLauncherService } from './settings/settings-launcher.js';

// Application shell for editing surfaces. Carries the full region set:
// a header (app bar), a command surface (menu + toolbar), a left
// navigation strip, a center editable content area, a right inspector
// panel, and a bottom status bar — see @DefaultEditorShell in
// shell.template.mu for the region → DockPanel-edge map.
//
// The skeleton only lays the regions out; the editing behaviour lives
// in whatever the consumer slots into Content and the VM behind it.
export class EditorShell extends ShellBase
{
    // Header region content — the top app-bar slot (PART_HeaderHost). A free
    // content slot like the side pane's Commands: carries a Visual (an app's
    // title-bar view), a data object rendered via a DataTemplate, or a plain
    // string. Unset leaves the region collapsed (the default template binds its
    // Visibility to this via ToVisibility), so a shell with no app bar shows no
    // empty band. Participates in layout + paint.
    public static readonly HeaderContentKey = MuralBase.RegisterProperty<unknown>(
        EditorShell, 'HeaderContent', undefined, MetaData.Measure | MetaData.Render);

    static
    {
        MuralBase.OverrideMetadata(
            EditorShell, Element.DefaultStyleKeyKey,
            { default_value: EditorShell });
    }

    public get HeaderContent(): unknown { return this.get_property_value(EditorShell.HeaderContentKey); }
    public set HeaderContent(v: unknown) { this.set_property_value(EditorShell.HeaderContentKey, v); }

    constructor()
    {
        super();
        // applyDefaultStyle → @DefaultEditorShell materialises the region
        // hosts; their content binds via `$service(…)` in the template.
        this.applyDefaultStyle();
        // Provide the Navigation region's service by default: a base
        // NavigationService whose destinations flatten from the Application's
        // modules. Registered `scoped` (one per shell) into this shell's own
        // scope, and ONLY when nothing up-chain already supplies one — so an
        // app that registers its own NavigationService (at the root, or a
        // subclass) still wins. `has` walks to the app root, where any app-level
        // registration lives by the time this ctor runs.
        if (!this.Services.has(NavigationService.Key))
        {
            this.Services.registerScoped(NavigationService.Key, (p) =>
            {
                const nav = new NavigationService(p);
                nav.PopulateFromModules();
                return nav;
            });
        }
        // Provide the Content region's service by default: a
        // DocumentsContentHostService (the tabbed-document / TDI host) under
        // ContentHostService.Key. The content region presents the service
        // itself, rendered by `DataTemplate[DocumentsContentHostService]` as a
        // TabControl (tab headers + the active document's body) — the editor
        // group. Same opt-out guard as the navigation service: an app that
        // registers its own host up-chain (e.g. at the root so a bootstrap can
        // reach the same instance) wins, and this default is skipped.
        if (!this.Services.has(ContentHostService.Key))
        {
            this.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));
        }
        // Provide the right-dock region's service by default: a PanelDockService
        // (the tabbed panel host). The region presents it, rendered by
        // `DataTemplate[PanelDockService]` as a TabControl; it starts empty
        // (region collapsed) until something Add()s a panel. Same opt-out guard —
        // an app that registers its own up-chain wins.
        if (!this.Services.has(PanelDockService.Key))
        {
            this.Services.registerScoped(PanelDockService.Key, (p) => new PanelDockService(p));
        }
        // Provide the modal-dialog service by default: opens a Dialog + scrim on
        // this shell's overlay layer (settings, confirms, …). It owns no Visual, so
        // it needs an anchor to reach the overlay — hand it THIS shell. Registered
        // at the app ROOT (like ApplicationSettings / ThemeService) so a scope-less
        // consumer — e.g. a status-bar control resolving via
        // `Application.current.Services` — can open dialogs too; a shell-scoped
        // registration is unreachable from the root. Same opt-out guard; an app
        // registering its own up-chain wins (then we just SetHost on whichever
        // instance resolves).
        if (!this.Services.has(DialogService.Key))
        {
            const root = Application.current?.Services ?? this.Services;
            root.register(DialogService.Key, (p) => new DialogService(p));
        }
        this.Services.get(DialogService.Key)?.SetHost(this);
        // Provide the Status region's service by default: a StatusService whose
        // Items back the bottom StatusBar. The default template binds
        // `PART_StatusHost` to `$service(StatusService)` unconditionally, and the
        // ToolbarService syncs StatusBar-region shell controls (e.g. a diagram's
        // connector-mode cell) into its Items — both silently no-op if it's
        // absent, leaving an empty strip. Same opt-out guard: an app registering
        // its own up-chain wins.
        if (!this.Services.has(StatusService.Key))
        {
            this.Services.registerScoped(StatusService.Key, (p) => new StatusService(p));
        }
        // Provide the ApplicationSettings service by default: aggregates every
        // composed module's declared SettingDefinitions into live, modifiable
        // Settings. Same opt-out guard — an app that registers its own (e.g. to
        // inject an ISettingsStore for persistence) wins, and this base is
        // skipped. The service resolves its optional ISettingsStore from the
        // container itself, so an app enables persistence just by registering a
        // store under SettingsStoreKey — no need to replace this registration.
        //
        // Registered at the APPLICATION ROOT as a singleton (not this shell's
        // scope): settings are app-global, and a scope-less consumer — the
        // static DiagramSettings helper — resolves them via
        // `Application.current.Services`. A singleton at the root is shared by
        // the whole subtree (the shell's region hosts resolve the same
        // instance the helper does); a scoped registration would hand the
        // root-resolving helper and the shell-resolving panel two different
        // instances, breaking live change propagation.
        if (!this.Services.has(ApplicationSettings.Key))
        {
            const root = Application.current?.Services ?? this.Services;
            root.register(ApplicationSettings.Key, (p) => new ApplicationSettings(p));
            root.register(SettingSourceKey, (p) => p.getRequired(ApplicationSettings.Key));
        }
        // Provide the theme service by default: the global ThemeManager registered
        // AS the IThemeService contract (a singleton instance — ThemeManager is a
        // static class, so the same object serves every scope). Lets chrome bind a
        // control's DataContext to ThemeServiceKey (e.g. a status-bar scheme
        // picker) and drive theme/scheme changes without reaching the static
        // singleton directly. Registered at the app root — theming is app-global.
        if (!this.Services.has(ThemeServiceKey))
        {
            const root = Application.current?.Services ?? this.Services;
            root.registerInstance(ThemeServiceKey, ThemeServiceInstance);
        }
        // Provide the DocumentTypeRegistry by default: aggregates every composed
        // module's declared DocumentDefinitions (the `.documents:` blocks) into
        // one queryable set — lookup by type (→ command contexts) and by file
        // extension (→ factory). Same opt-out guard, so an app that registers its
        // own wins. Cheap to build eagerly here; a future file-open / commands
        // service resolves it by key.
        if (!this.Services.has(DocumentTypeRegistry.Key))
        {
            this.Services.registerScoped(DocumentTypeRegistry.Key, (p) => new DocumentTypeRegistry(p));
        }
        // Provide the ProjectFactoryRegistry by default: aggregates every composed
        // module's declared ProjectFactoryDefinitions (the `.projectFactories:`
        // blocks) into one queryable set — lookup by project type. Same opt-out
        // guard. A project-explorer service resolves it and routes Open/New to the
        // matching factory.
        if (!this.Services.has(ProjectFactoryRegistry.Key))
        {
            this.Services.registerScoped(ProjectFactoryRegistry.Key, (p) => new ProjectFactoryRegistry(p));
        }
        // Provide the command registry + toolbar service by default: the registry
        // aggregates every module's `.commands:` declarations; the toolbar service
        // filters them by the active document's contexts and dispatches to it.
        // Same opt-out guard. Registered registry-first so the toolbar's ctor can
        // resolve it. Both cheap; a data-driven toolbar binds
        // `$service(ToolbarService).VisibleCommands`.
        if (!this.Services.has(CommandRegistry.Key))
        {
            this.Services.registerScoped(CommandRegistry.Key, (p) => new CommandRegistry(p));
        }
        if (!this.Services.has(ToolbarService.Key))
        {
            this.Services.registerScoped(ToolbarService.Key, (p) => new ToolbarService(p));
        }
        // Settings gear (opt-in): when the app registers an ISettingsContribution
        // (the rail icon + the settings view — the framework ships neither), pin
        // a footer RailAction wired to the SettingsLauncherService, which opens
        // the contribution's view in the content host. No contribution ⇒ no gear,
        // so shells without settings (e.g. the demo platform) stay chrome-clean.
        // Resolving NavigationService here lands the action on the same instance
        // the rail binds (this shell's scoped one, or an app override up-chain).
        if (this.Services.has(SettingsContributionKey))
        {
            if (!this.Services.has(SettingsLauncherService.Key))
            {
                this.Services.registerScoped(SettingsLauncherService.Key, (p) => new SettingsLauncherService(p));
            }
            const nav          = this.Services.get(NavigationService.Key);
            const launcher     = this.Services.get(SettingsLauncherService.Key);
            const contribution = this.Services.get(SettingsContributionKey);
            if (nav !== undefined && launcher !== undefined && contribution !== undefined)
            {
                nav.FooterActions.Add(new RailAction(contribution.Icon, launcher.OpenCommand, contribution.Tooltip ?? ''));
            }
        }
        // Region hosts bind their own DataContext in the template via
        // `$service(Token)` (see @DefaultEditorShell) — those bindings resolve
        // against the ServiceScope this shell publishes, so no imperative
        // region→DataContext pass is needed here.
    }
}
