import {
    MetaData,
    MuralBase,
    ObservableCollection,
    type Visual,
} from '../../../runtime/index.js';
import type { Geometry } from '../../../visual-engine/index.js';
import type { DataTemplate } from '../../../basic/templates/data-template.js';
import { CommandViewModel } from './command-view-model.js';

// One entry in the shell command bar. The ToolbarService surfaces a mixed,
// Order-ordered list of these — command GROUPS (below) and editor CONTROLS
// (ShellControlViewModel) — that the shell dispatches on by concrete type.
export abstract class ToolbarEntryViewModel extends MuralBase { }

// A GROUP of toolbar commands the ToolbarService surfaces as one presentation
// unit. The ToolbarService clusters VisibleCommands by CommandDefinition.Group,
// reads the group's presentation off its leader command, and builds the matching
// concrete subclass below. The shell template dispatches on the concrete TYPE (a
// `DataTemplate [DataType = ToolbarSplitMenuGroup]`, …) — that's why the four
// presentations are distinct classes rather than one class carrying an enum:
// DataTemplate selection is by data type, so a type per presentation gives each
// its own layout with no trigger indirection.
//
//   Flat      → ToolbarFlatGroup       (inline icon buttons)
//   SplitMenu → ToolbarSplitMenuGroup  (icon-only dropdown, menu rows)
//   SplitGrid → ToolbarSplitGridGroup  (icon-only dropdown, Columns-wide grid)
//   Toggles   → ToolbarToggleGroup     (inline toggle buttons, IsChecked-driven)
//
// Icon / Title / Columns describe the dropdown FACE and only matter for the two
// split presentations; Flat / Toggles ignore them.
export abstract class ToolbarGroupViewModel extends ToolbarEntryViewModel
{
    // The command VMs in this group, already ordered. Bound by a group template
    // as `ItemsSource = $Items`.
    public static readonly ItemsKey = MuralBase.RegisterProperty<ObservableCollection<CommandViewModel>>(
        ToolbarGroupViewModel, 'Items',
        undefined as unknown as ObservableCollection<CommandViewModel>, MetaData.None);

    // The dropdown face icon (split presentations).
    public static readonly IconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        ToolbarGroupViewModel, 'Icon', undefined, MetaData.None);

    // The dropdown face tooltip (split presentations).
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        ToolbarGroupViewModel, 'Title', '', MetaData.None);

    // Grid column count (SplitGrid); 0 falls back to the template default.
    public static readonly ColumnsKey = MuralBase.RegisterProperty<number>(
        ToolbarGroupViewModel, 'Columns', 0, MetaData.None);

    constructor(items: ObservableCollection<CommandViewModel>, icon: Geometry | undefined, title: string, columns: number)
    {
        super();
        this.set_property_value(ToolbarGroupViewModel.ItemsKey, items);
        this.set_property_value(ToolbarGroupViewModel.IconKey, icon);
        this.set_property_value(ToolbarGroupViewModel.TitleKey, title);
        this.set_property_value(ToolbarGroupViewModel.ColumnsKey, columns);
    }

    public get Items(): ObservableCollection<CommandViewModel> { return this.get_property_value(ToolbarGroupViewModel.ItemsKey); }
    public get Icon(): Geometry | undefined { return this.get_property_value(ToolbarGroupViewModel.IconKey); }
    public get Title(): string { return this.get_property_value(ToolbarGroupViewModel.TitleKey); }
    public get Columns(): number { return this.get_property_value(ToolbarGroupViewModel.ColumnsKey); }
}

// A group divider in the command bar's FLAT item stream (ToolbarService.
// ToolbarItems). Rendered as a ToolBarSeparator between adjacent top-level
// entries. It does double duty: the visible vertical divider between groups AND
// the run boundary the owning ToolBar splits its connected-pill assignment at —
// without a separator (or other non-button visual) between two Flat groups, the
// ToolBar would treat their buttons as one continuous run and round the group
// boundary into a single merged pill.
export class ToolbarSeparatorItem extends ToolbarEntryViewModel { }

// Inline row of icon buttons — the default. A Flat group with a single member is
// visually identical to today's per-command button.
export class ToolbarFlatGroup extends ToolbarGroupViewModel { }

// Icon-only dropdown; members list as menu rows in a vertical popup.
export class ToolbarSplitMenuGroup extends ToolbarGroupViewModel { }

// Icon-only dropdown; members tile as a Columns-wide icon grid in the popup.
export class ToolbarSplitGridGroup extends ToolbarGroupViewModel { }

// Inline row of toggle buttons whose IsChecked binds each item's own IsChecked.
export class ToolbarToggleGroup extends ToolbarGroupViewModel { }

// A non-command editor control (font pickers, a mode indicator, …) the shell
// hosts in a region (command bar or status bar). The shell renders it as
// `ContentPresenter [ Content = $View ]` — the module's Template applied against
// the active document, so the editor binds the document's state (e.g. an
// IFontFormatSink) directly.
//
// `View` is the template APPLIED once here (not a `ContentTemplate=$Template`
// binding in the shell markup). Presenting a Visual is deliberate: were the shell
// template to bind `Content=$Target, ContentTemplate=$Template`, the presenter
// would re-point its own DataContext to $Target (the document) when it resolves
// Content — clobbering the `$Template` DataContext binding (the document has no
// `Template`), so ContentTemplate falls to undefined and the presenter drops to
// the IMPLICIT `DataTemplate[DataType=<document>]`. For a DiagramDocument that
// implicit template is the CANVAS, whose node Visuals are shared with the content
// area → "Visual already has a visual parent". Applying the template here and
// slotting the resulting Visual sidesteps the self-clobber entirely (a Visual
// Content is slotted directly, no DataContext re-point, no implicit lookup) —
// the same class of fix as the shell content-host's service-binding workaround.
export class ShellControlViewModel extends ToolbarEntryViewModel
{
    // The editor UI (the ShellControlDefinition's Template).
    public static readonly TemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        ShellControlViewModel, 'Template', undefined, MetaData.None);

    // The DataContext the template binds — the active document.
    public static readonly TargetKey = MuralBase.RegisterProperty<unknown>(
        ShellControlViewModel, 'Target', undefined, MetaData.None);

    // The materialized editor Visual — Template applied to Target with Target as
    // its DataContext. The shell binds `Content = $View`.
    public static readonly ViewKey = MuralBase.RegisterProperty<Visual | undefined>(
        ShellControlViewModel, 'View', undefined, MetaData.None);

    constructor(template: DataTemplate | undefined, target: unknown)
    {
        super();
        this.set_property_value(ShellControlViewModel.TemplateKey, template);
        this.set_property_value(ShellControlViewModel.TargetKey, target);
        if (template !== undefined)
        {
            const view = template.Apply(target);
            // Mirror ContentPresenter: the produced subtree binds the document,
            // so its DataContext must be the target.
            (view as unknown as { DataContext: unknown }).DataContext = target;
            this.set_property_value(ShellControlViewModel.ViewKey, view);
        }
    }

    public get Template(): DataTemplate | undefined { return this.get_property_value(ShellControlViewModel.TemplateKey); }
    public get Target(): unknown { return this.get_property_value(ShellControlViewModel.TargetKey); }
    public get View(): Visual | undefined { return this.get_property_value(ShellControlViewModel.ViewKey); }
}
