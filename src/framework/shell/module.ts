// ─── SKETCH ──────────────────────────────────────────────────────────────
// Module — a capability provider that plugs into the app shell.
//
// A ShellModule is a DECLARATION of the elements that make up the
// capabilities a provider contributes to the shell. It is the unit by which a
// shell app is composed: adding a module lights up its capabilities in the
// shell's navigation. (An editor is then "shell + a set of modules": a diagram
// module, a layers module, an outline module, …)
//
// A Capability is one such element. It carries:
//   • Name          — the label shown in the shell's ROOT navigation layer
//   • Icon          — the vector glyph shown beside it in that rail
//   • PanelTemplate — builds the object shown in the shell's LEFT panel while
//                     the capability is active (lazily, on first activation)
//
// The Name + Icon of every capability across every added module flatten into
// the root navigation layer, surfaced through the NavigationService
// (Items = the capabilities; SelectedItem = the active one). Selecting a
// capability shows its lazily-built Panel in the left navigation panel:
//
//     ShellModule
//       ├─ Name
//       └─ Capabilities: [ Capability { Name, Icon, PanelTemplate }, … ]
//
//        ┌───────────────────── shell ─────────────────────┐
//        │ rail (root nav)      │ left panel                │
//        │   ▸ Cap.Icon + Name  │   Cap.Panel  (active cap) │  ← NavigationService
//        │   ▸ …                │                           │
//        ├──────────────────────┴───────────────────────────┤
//        │ Content (fill) · Inspector (right) · Status …     │
//        └───────────────────────────────────────────────────┘
//
// ─── DECISIONS (confirmed) ────────────────────────────────────────────────
//   1. Icon = Geometry — vector, theme-tintable via a Shape, no font
//      dependency (matches DiagramTool.Icon and the diagram toolbar).
//   2. Panel — confirmed LAZY (build from a template on first activation), but
//      that needs the compiler to accept an inline template as a child value.
//      For now Capability.Panel is an EAGER Visual (the content child), built
//      at module creation and mounted by the shell on activation; the lazy
//      PanelTemplate path returns when panels grow heavy enough to warrant it.
//   3. Modules are declared with a `.modules:` block on the APPLICATION (a
//      sibling of `resources:`), so an app composes its shell declaratively.
//      The NavigationService flattens the modules' Capabilities into its root
//      layer.  ⚠ see LAYERING NOTE below.
//   4. Names: ShellModule / Capability.
//
// ─── LAYERING (resolved: runtime interface) ───────────────────────────────
//   `Application` lives in runtime; `ShellModule` lives here in framework, and
//   runtime must NOT depend on framework. Resolved by declaring minimal
//   structural contracts in RUNTIME — `IShellModule` / `ICapability`
//   (src/runtime/shell-modules.ts) — that these concrete types satisfy.
//   `Application.Modules` is typed `IShellModule[]`; the NavigationService
//   (framework) up-casts each back to the concrete ShellModule / Capability to
//   read the view-facing fields. Those view fields (Icon = Geometry,
//   PanelTemplate = DataTemplate) are above runtime's layer, so the runtime
//   contract carries only Name + the capability list — not Icon / PanelTemplate.
//
// ─── NEXT (to implement, once the above is settled) ───────────────────────
//   • runtime: the `.modules:` seam (interface + Application.Modules, or the
//     lowering target) + compiler support for the block.
//   • NavigationService: flatten Capabilities → root-layer Items; on
//     SelectedItem change, surface the active capability's Panel.
//   • shell.template.mu: a rail item template (Shape[Geometry=Icon] + Name)
//     and a left-panel host bound to the active capability's Panel.
//   • symbol table: register ShellModule / Capability for markup authoring.
// ──────────────────────────────────────────────────────────────────────────

import {
    HostKind,
    MetaData,
    MuralBase,
    ObservableCollection,
    ResourceDictionary,
    ServiceLifetime,
    type ServiceToken,
    type ServiceFactory,
    type IServiceContainer,
    type ICapability,
    type IShellModule,
} from '../../runtime/index.js';
import type { Geometry } from '../../visual-engine/index.js';
import { SettingDefinition } from './settings/setting-definition.js';
import { DocumentDefinition } from './documents/document-definition.js';
import { CommandDefinition } from './commands/command-definition.js';
import { ProjectFactoryDefinition } from './projects/project-factory-definition.js';
import { ShellControlDefinition } from './commands/shell-control-definition.js';

// One service a module contributes to the app container: the token it registers
// under (via ServiceProvider.tokenFor), the lazy factory that builds it, and the
// lifetime. Recorded by `AddRegistration` as the compiler lowers a module's
// `.services:` block, and replayed by `RegisterServices` when the module is
// composed. Module-internal — never crosses mural's published surface.
interface ServiceRegistration
{
    token:    ServiceToken<unknown>;
    factory:  ServiceFactory<unknown>;
    lifetime: ServiceLifetime;
}

// One capability a module contributes: a destination in the shell's root
// navigation rail (Icon + Name) that names — via ServiceKey — the service whose
// content is shown while the capability is active. A MuralBase so it is DP-backed,
// bindable, and declarable in markup (like DiagramTool / CommandBase).
export class Capability extends MuralBase implements ICapability
{
    public static readonly NameKey = MuralBase.RegisterProperty<string>(
        Capability, 'Name', '', MetaData.None);

    // Vector icon painted into the rail item (Shape[Geometry=Icon]).
    public static readonly IconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        Capability, 'Icon', undefined, MetaData.None);

    // The DI token (service class or ServiceKey) of the service that backs this
    // capability's content. Authored in markup as `Capability [ServiceKey =
    // SomeService]` — a real class reference, resolved through the container
    // like `$service(...)`. The shell resolves the instance while the capability
    // is active (NavigationService.ActiveService) and a `DataTemplate
    // [DataType=SomeService]` renders it in the content host. Replaces the
    // former eager Panel Visual: content is a service, not a mounted Visual.
    public static readonly ServiceKeyKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        Capability, 'ServiceKey', undefined, MetaData.None);

    public get Name(): string  { return this.get_property_value(Capability.NameKey); }
    public set Name(v: string) { this.set_property_value(Capability.NameKey, v); }

    public get Icon(): Geometry | undefined  { return this.get_property_value(Capability.IconKey); }
    public set Icon(v: Geometry | undefined) { this.set_property_value(Capability.IconKey, v); }

    public get ServiceKey(): ServiceToken<unknown> | undefined  { return this.get_property_value(Capability.ServiceKeyKey); }
    public set ServiceKey(v: ServiceToken<unknown> | undefined) { this.set_property_value(Capability.ServiceKeyKey, v); }
}

// A capability provider added to the shell — the declaration of the elements
// (Capabilities) that comprise what it provides. `Capabilities` is the content
// collection (a module block reads as `ShellModule { Capability … }` once
// registered for markup).
//
// A module also REGISTERS SERVICES: a `.services:` block in its body records
// registrations (AddRegistration) that the Application replays into its root
// container (RegisterServices) when the module is composed. A Capability's
// `ServiceKey` references one of those tokens — the module supplies the service
// pool, the capability names its entry point within it:
//
//     module DiagramModule [ Name = "Diagram" ] {
//         .services: { ShapesService  LayersService }
//         Capability [ Name = "Shapes", ServiceKey = ShapesService ]
//         Capability [ Name = "Layers", ServiceKey = LayersService ]
//     }
export class ShellModule extends MuralBase implements IShellModule
{
    public static readonly NameKey = MuralBase.RegisterProperty<string>(
        ShellModule, 'Name', '', MetaData.None);

    // Declared capabilities. ObservableCollection so a module that contributes
    // capabilities lazily updates the root nav layer reactively.
    public readonly Capabilities: ObservableCollection<Capability> =
        new ObservableCollection<Capability>();

    // Declared setting definitions — the schemas this module contributes to the
    // app's ApplicationSettings. Authored as a `.settings: { SettingDefinition …
    // }` block in the module body: `.settings:` is a generic member-block, so
    // each entry lowers to `module.Settings.Add(def)` (no bespoke compiler
    // grammar). ApplicationSettings aggregates these across all composed modules
    // (up-casting IShellModule → ShellModule, like NavigationService reads
    // Capabilities). ObservableCollection for the same reactive-composition
    // reason as Capabilities.
    public readonly Settings: ObservableCollection<SettingDefinition> =
        new ObservableCollection<SettingDefinition>();

    // Declared document types — the schemas this module contributes to the app's
    // DocumentTypeRegistry. Authored as a `.documents: { DocumentDefinition … }`
    // block in the module body: `.documents:` is a generic member-block, so each
    // entry lowers to `module.Documents.Add(def)` (the compiler remaps the
    // lowercase section to this PascalCase collection, exactly as `.settings:` →
    // `Settings`). DocumentTypeRegistry aggregates these across all composed
    // modules (up-casting IShellModule → ShellModule, like ApplicationSettings
    // reads Settings). ObservableCollection for the same reactive-composition
    // reason as Capabilities / Settings.
    public readonly Documents: ObservableCollection<DocumentDefinition> =
        new ObservableCollection<DocumentDefinition>();

    // Declared commands — the CommandDefinitions this module contributes to the
    // app's CommandRegistry. Authored as a `.commands: { CommandDefinition … }`
    // block: `.commands:` is a generic member-block, so each entry lowers to
    // `module.Commands.Add(def)` (the compiler remaps the lowercase section to
    // this PascalCase collection, exactly as `.settings:`/`.documents:`).
    // CommandRegistry aggregates these across all composed modules; ToolbarService
    // renders the ones whose Context the active document activates.
    public readonly Commands: ObservableCollection<CommandDefinition> =
        new ObservableCollection<CommandDefinition>();

    // Declared shell CONTROLS — non-command editor contributions (font pickers, a
    // status-bar mode indicator, …) the shell hosts in a region (command bar or
    // status bar). Authored as a `.ShellControls: { ShellControlDefinition … }`
    // block: a generic member-block, so each entry lowers to
    // `module.ShellControls.Add(def)` (the PascalCase section maps to this
    // collection verbatim, like `.Children:`). The ToolbarService interleaves the
    // Toolbar-region ones with command groups by Order and syncs the StatusBar-
    // region ones into the StatusService.
    public readonly ShellControls: ObservableCollection<ShellControlDefinition> =
        new ObservableCollection<ShellControlDefinition>();

    // Declared project types — the ProjectFactoryDefinitions this module
    // contributes to the app's ProjectFactoryRegistry. Authored as a
    // `.projectFactories: { ProjectFactoryDefinition … }` block: a generic
    // member-block, so each entry lowers to `module.ProjectFactories.Add(def)`
    // (the compiler remaps the lowercase section to this PascalCase collection,
    // exactly as `.documents:` → `Documents`). ProjectFactoryRegistry aggregates
    // these across all composed modules; a project-explorer service resolves a
    // definition's Factory to open / create / save real projects.
    public readonly ProjectFactories: ObservableCollection<ProjectFactoryDefinition> =
        new ObservableCollection<ProjectFactoryDefinition>();

    // Resources the module contributes — styles, brushes, templates, and the
    // icon geometries its capabilities paint. Authored as a `resources: { … }`
    // block inside the `module NAME { … }` body (the ordinary element-resources
    // slot lowers here). When the module is added to `Application.Modules`, the
    // Application merges this dictionary app-global via `AddMergedDictionary`,
    // so the module's rail items and panels resolve against it. Empty until the
    // module declares resources.
    public readonly Resources: ResourceDictionary = new ResourceDictionary();

    // Service registrations the module contributes, recorded from its
    // `.services:` block and replayed by RegisterServices when composed. A plain
    // field (not a DP): a build-time list read once at composition, never bound.
    private readonly _registrations: ServiceRegistration[] = [];

    // Host kinds this module composes for. Empty ⇒ universal (every kind).
    // Authored via a `.targets:` block or set from code with AddTarget; the
    // CompositionRoot admit gate reads this to decide whether to compose.
    private readonly _targets = new Set<HostKind>();

    public get Name(): string  { return this.get_property_value(ShellModule.NameKey); }
    public set Name(v: string) { this.set_property_value(ShellModule.NameKey, v); }

    public get Targets(): ReadonlySet<HostKind> { return this._targets; }

    public AddTarget(kind: HostKind): void { this._targets.add(kind); }

    public get HasServiceRegistrations(): boolean { return this._registrations.length > 0; }

    // Record one service registration declared in the module's `.services:`
    // block. The compiler emits one call per entry: the token via
    // `ServiceProvider.tokenFor`, a lazy `(p) => new Impl(p)` factory, and the
    // entry's lifetime (bare entry ⇒ 'singleton'). Held until the module is
    // composed, then replayed by RegisterServices.
    public AddRegistration(
        token:    ServiceToken<unknown>,
        factory:  ServiceFactory<unknown>,
        lifetime: ServiceLifetime,
    ): void
    {
        this._registrations.push({ token, factory, lifetime });
    }

    // Replay the recorded registrations into `container` (the app root), keeping
    // each entry's declared lifetime. Called by the Application once, when the
    // module is added to `Application.Modules`. A Capability's `ServiceKey` then
    // resolves the matching token through the container (or a shell scope below
    // it). No-op when the module declares no services.
    public RegisterServices(container: IServiceContainer): void
    {
        for (const r of this._registrations)
        {
            if (r.lifetime === ServiceLifetime.Scoped)
            {
                container.registerScoped(r.token, r.factory);
            }
            else if (r.lifetime === ServiceLifetime.Transient)
            {
                container.registerTransient(r.token, r.factory);
            }
            else
            {
                container.register(r.token, r.factory, ServiceLifetime.Singleton);
            }
        }
    }

    // Declarative markup children route here: the compiler's `list` content
    // slot emits `.AddChild(child)` for each `Capability` in a `ShellModule {
    // … }` body (the same mechanism ItemsControl uses to funnel declarative
    // children into Items). We forward into the Capabilities collection.
    public AddChild(child: Capability): void
    {
        this.Capabilities.Add(child);
    }
}
