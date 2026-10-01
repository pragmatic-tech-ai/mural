import {
    MetaData,
    MuralBase,
    ObservableCollection,
    type ServiceToken,
} from '../../../runtime/index.js';
import type { Geometry } from '../../../visual-engine/index.js';
import type { ICommandContributor } from './command-contributor.js';
import { ShellRegion } from './shell-control-definition.js';

// How a command GROUP is presented on the toolbar. A group's presentation is
// declared on its LEADER command (the lowest-Order member that sets a non-Flat
// value); the remaining members ride inside that presentation. Markup-facing:
// authored as `Presentation = SplitMenu` in a module's `.commands:` block, so it
// is registered in the compiler's ENUM_MEMBERS / DEFAULT_SYMBOLS. Explicit string
// values keep the wire form stable.
export enum CommandGroupPresentation
{
    // Each command is its own inline toolbar button (today's default).
    Flat      = 'flat',
    // The group collapses to a single icon-only dropdown; members list as menu
    // rows in a vertical popup.
    SplitMenu = 'split-menu',
    // The group collapses to a single icon-only dropdown; members tile as an
    // icon grid (Columns wide) in the popup.
    SplitGrid = 'split-grid',
    // The group renders inline as a row of toggle buttons whose checked state
    // reflects the resolved command's ICheckableCommand.IsChecked, folded onto
    // the toolbar's CommandViewModel.IsChecked.
    Toggles   = 'toggles',
}

// A COMMAND's schema — what a module declares in its `.commands:` block. It is
// pure chrome + context + identity: what the command looks like (Title, Icon),
// where it sits on a toolbar (Group, Order), which command context it belongs to
// (Context), and a stable Id. The behaviour lives on the active document, NOT
// here — a command has no Execute of its own; it is dispatched to whatever
// document is active (see ICommandDispatcher.Resolve).
//
// A MuralBase so it is DP-backed, bindable, and declarable in markup — the same
// shape as SettingDefinition / DocumentDefinition:
//
//     module DiagramModule [ Name = "Diagram" ] {
//         .commands: {
//             CommandDefinition
//                 [ Id      = "diagram.align.left", Title = "Align Left",
//                   Icon    = @alignLeft, Context = DiagramEditingContext,
//                   Group   = "align", Order = 10 ]
//         }
//     }
//
// `.commands:` is a generic member-block: each entry lowers to
// `module.Commands.Add(def)` (the compiler remaps the lowercase section to the
// PascalCase `Commands` collection, exactly as `.settings:` → `Settings` and
// `.documents:` → `Documents`). CommandRegistry aggregates these across modules;
// ToolbarService adapts each into a button-bindable CommandViewModel.
//
// Why the behaviour isn't here: the target is always the active document (there
// is no handler ambiguity to route through the tree), so a command is dispatched
// as `activeDocument.Resolve(id, context)?.Execute()`. Routed commands solve handler-
// discovery-by-focus-scope — a non-problem here — so this stays a plain
// declaration and the document interprets it.
export class CommandDefinition extends MuralBase
{
    // Stable id ("diagram.align.left"). The token a document's Execute /
    // CanExecute switches on. Namespace by module.
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        CommandDefinition, 'Id', '', MetaData.None);

    // Display name — a toolbar button's tooltip / a menu item's header.
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        CommandDefinition, 'Title', '', MetaData.None);

    // Vector icon painted onto the button (Shape[Geometry=Icon]).
    public static readonly IconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        CommandDefinition, 'Icon', undefined, MetaData.None);

    // The command context this command belongs to — the join to a document's
    // live CommandContexts. The command is visible on the toolbar iff the active
    // document activates this context. A ServiceToken used purely as an identity
    // tag (never resolved), so contexts are shareable across document types and
    // authored as real references (`Context = DiagramEditingContext`).
    public static readonly ContextKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        CommandDefinition, 'Context', undefined, MetaData.None);

    // Toolbar group id — commands with the same Group cluster together (a
    // ToolBar / separator boundary is a presentation choice on top of this).
    public static readonly GroupKey = MuralBase.RegisterProperty<string>(
        CommandDefinition, 'Group', '', MetaData.None);

    // Sort order within the group (ascending). Ties break on declaration order.
    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        CommandDefinition, 'Order', 0, MetaData.None);

    // Which shell region hosts this command. Default Toolbar (the command bar).
    // `Region = EditorActions` routes it into the editor content host's tab-strip
    // action strip instead — DocumentsContentHostService collects those into its
    // ExtendedCommands. Markup-facing (registered in the compiler's ENUM_MEMBERS
    // + the `Region` → ShellRegion property map, shared with ShellControlDefinition).
    public static readonly RegionKey = MuralBase.RegisterProperty<ShellRegion>(
        CommandDefinition, 'Region', ShellRegion.Toolbar, MetaData.None);

    // ── Group presentation (leader command) ────────────────────────────────
    // These four are read off the group's LEADER — the lowest-Order member whose
    // Presentation is non-Flat. They describe how the whole Group renders; the
    // other members supply only their per-command Icon/Title/Command.

    // The group's presentation. Default Flat (inline buttons — today's behaviour,
    // so a module that declares no Presentation is unchanged).
    public static readonly PresentationKey = MuralBase.RegisterProperty<CommandGroupPresentation>(
        CommandDefinition, 'Presentation', CommandGroupPresentation.Flat, MetaData.None);

    // The dropdown FACE icon for SplitMenu / SplitGrid groups. Falls back to the
    // leader command's own Icon when unset (e.g. a centre glyph makes a better
    // placement face than the top-left member's icon).
    public static readonly GroupIconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        CommandDefinition, 'GroupIcon', undefined, MetaData.None);

    // The dropdown FACE tooltip for SplitMenu / SplitGrid. Falls back to Title.
    public static readonly GroupTitleKey = MuralBase.RegisterProperty<string>(
        CommandDefinition, 'GroupTitle', '', MetaData.None);

    // Column count for a SplitGrid popup. 0 ⇒ the presentation's default (3).
    public static readonly ColumnsKey = MuralBase.RegisterProperty<number>(
        CommandDefinition, 'Columns', 0, MetaData.None);

    // Render a divider before this command inside a SplitMenu dropdown (e.g. the
    // first Distribute item, when Distribute rides in the Align group).
    public static readonly SeparatorBeforeKey = MuralBase.RegisterProperty<boolean>(
        CommandDefinition, 'SeparatorBefore', false, MetaData.None);

    public get Id(): string  { return this.get_property_value(CommandDefinition.IdKey); }
    public set Id(v: string) { this.set_property_value(CommandDefinition.IdKey, v); }

    public get Title(): string  { return this.get_property_value(CommandDefinition.TitleKey); }
    public set Title(v: string) { this.set_property_value(CommandDefinition.TitleKey, v); }

    public get Icon(): Geometry | undefined  { return this.get_property_value(CommandDefinition.IconKey); }
    public set Icon(v: Geometry | undefined) { this.set_property_value(CommandDefinition.IconKey, v); }

    public get Context(): ServiceToken<unknown> | undefined  { return this.get_property_value(CommandDefinition.ContextKey); }
    public set Context(v: ServiceToken<unknown> | undefined) { this.set_property_value(CommandDefinition.ContextKey, v); }

    public get Group(): string  { return this.get_property_value(CommandDefinition.GroupKey); }
    public set Group(v: string) { this.set_property_value(CommandDefinition.GroupKey, v); }

    public get Order(): number  { return this.get_property_value(CommandDefinition.OrderKey); }

    public get Region(): ShellRegion  { return this.get_property_value(CommandDefinition.RegionKey); }
    public set Order(v: number) { this.set_property_value(CommandDefinition.OrderKey, v); }

    public set Region(v: ShellRegion) { this.set_property_value(CommandDefinition.RegionKey, v); }

    public get Presentation(): CommandGroupPresentation  { return this.get_property_value(CommandDefinition.PresentationKey); }
    public set Presentation(v: CommandGroupPresentation) { this.set_property_value(CommandDefinition.PresentationKey, v); }

    public get GroupIcon(): Geometry | undefined  { return this.get_property_value(CommandDefinition.GroupIconKey); }
    public set GroupIcon(v: Geometry | undefined) { this.set_property_value(CommandDefinition.GroupIconKey, v); }

    public get GroupTitle(): string  { return this.get_property_value(CommandDefinition.GroupTitleKey); }
    public set GroupTitle(v: string) { this.set_property_value(CommandDefinition.GroupTitleKey, v); }

    public get Columns(): number  { return this.get_property_value(CommandDefinition.ColumnsKey); }
    public set Columns(v: number) { this.set_property_value(CommandDefinition.ColumnsKey, v); }

    public get SeparatorBefore(): boolean  { return this.get_property_value(CommandDefinition.SeparatorBeforeKey); }
    public set SeparatorBefore(v: boolean) { this.set_property_value(CommandDefinition.SeparatorBeforeKey, v); }

    // Nested child commands — a menu/submenu tree. Populated from a `.commands:` or
    // Hierarchy-DSL body (the markup content collection) and merged at build time with
    // any ChildrenContributor output. Orthogonal to Group/Presentation (responsive
    // toolbar layout); these are structural submenu children.
    public readonly Children: ObservableCollection<CommandDefinition> =
        new ObservableCollection<CommandDefinition>();

    // The markup content collection: a `CommandDefinition { … }` body lowers to
    // AddChild per nested element (see DEFAULT_SLOT_INFO['CommandDefinition']).
    public AddChild(child: CommandDefinition): void
    {
        this.Children.Add(child);
    }

    // Names an ICommandContributor that supplies this command's children at build
    // time (merged after Children). A ServiceToken DP — same precedent as
    // HierarchyContributorDefinition.Contributor; resolved lazily on submenu expand.
    public static readonly ChildrenContributorKey = MuralBase.RegisterProperty<ServiceToken<ICommandContributor> | undefined>(
        CommandDefinition, 'ChildrenContributor', undefined, MetaData.None);

    public get ChildrenContributor(): ServiceToken<ICommandContributor> | undefined  { return this.get_property_value(CommandDefinition.ChildrenContributorKey); }
    public set ChildrenContributor(v: ServiceToken<ICommandContributor> | undefined) { this.set_property_value(CommandDefinition.ChildrenContributorKey, v); }
}
