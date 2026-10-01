import {
    MetaData,
    MuralBase,
    type ServiceToken,
} from '../../../runtime/index.js';
import type { DataTemplate } from '../../../basic/templates/data-template.js';

// Which shell region hosts a shell control. Markup-facing (`Region = StatusBar`),
// so it is registered in the compiler's ENUM_MEMBERS / DEFAULT_SYMBOLS.
export enum ShellRegion
{
    // The command bar (default) — interleaved with command groups by Order.
    Toolbar   = 'toolbar',
    // The bottom status bar — a status cell (e.g. a mode indicator).
    StatusBar = 'status-bar',
    // The editor content host's tab-strip action area — a compact strip of
    // command buttons pinned to the top-right corner of the document tabs.
    // DocumentsContentHostService collects the CommandDefinitions tagged with
    // this region into its ExtendedCommands, dispatched to the active document.
    EditorActions = 'editor-actions',
    // The persistent menu-bar (File/Edit/…). A CommandDefinition root tagged
    // with this region is one of MainMenuService's bar roots rather than a
    // toolbar button — it does NOT appear on the toolbar (ToolbarService's
    // filter never matches it; ToolbarService only ever shows Toolbar-region
    // commands). Its Children are the dropdown's menu rows, lazily realized on
    // first open via CommandMenuBuilder (Task 1/3), exactly like a toolbar
    // split-menu's children.
    MainMenu = 'main-menu',
}

// Which edge of a region a control pins to. Markup-facing (`Alignment = End`),
// so it is registered in the compiler's ENUM_MEMBERS / PROPERTY_TO_ENUM. In the
// StatusBar region Start docks left, End docks right (the DockPanel item panel).
export enum ShellControlAlignment
{
    Start = 'start',
    End   = 'end',
}

// A non-command shell contribution: an arbitrary editor CONTROL a module drops
// into a shell region (command bar or status bar), bound to the active document.
// Where a CommandDefinition is a button that DISPATCHES to the document, a
// ShellControlDefinition is a TEMPLATE the shell hosts with the document as its
// DataContext — the escape hatch for value editors (font pickers, a mode
// indicator, a zoom box, …) that read/write live state rather than fire a
// one-shot command.
//
// Declared in a module's `.ShellControls:` block (a generic member-block, so
// each entry lowers to `module.ShellControls.Add(def)`):
//
//     module DiagramModule [ Name = "Diagram" ] {
//         .ShellControls: {
//             ShellControlDefinition
//                 [ Template = @FontFormatEditor, Context = DiagramEditingContext, Order = 330 ]
//         }
//     }
//
// For the Toolbar region the ToolbarService filters by Context (like commands)
// and interleaves the control with the command GROUPS by Order — so a control can
// sit between two command groups. A StatusBar-region control is synced into the
// StatusService's Items instead. The template binds against the active document
// (e.g. through an IFontFormatSink the document implements); the shell stays
// domain-agnostic.
//
// UNIVERSAL (service-bound) controls: set `DataContext` to a service token and the
// control is bound to that SERVICE instead of the active document — and so is
// APP-GLOBAL (always shown in its region, no Context gate, no document needed). A
// status-bar theme picker whose DataContext is ThemeServiceKey is the canonical
// case. Leave DataContext unset for the classic document-bound, Context-gated
// behaviour.
export class ShellControlDefinition extends MuralBase
{
    // The editor UI. A keyed DataTemplate the shell applies with the active
    // document as Content/DataContext.
    public static readonly TemplateKey = MuralBase.RegisterProperty<DataTemplate | undefined>(
        ShellControlDefinition, 'Template', undefined, MetaData.None);

    // The command context that gates visibility — the control shows iff the active
    // document activates this context (same join as CommandDefinition.Context).
    public static readonly ContextKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        ShellControlDefinition, 'Context', undefined, MetaData.None);

    // Placement in the shared Order space with command groups (Toolbar region).
    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        ShellControlDefinition, 'Order', 0, MetaData.None);

    // Which shell region hosts this control — the command bar (default) or the
    // status bar.
    public static readonly RegionKey = MuralBase.RegisterProperty<ShellRegion>(
        ShellControlDefinition, 'Region', ShellRegion.Toolbar, MetaData.None);

    // Which edge of the region the control pins to (StatusBar: Start = left,
    // End = right). Default Start.
    public static readonly AlignmentKey = MuralBase.RegisterProperty<ShellControlAlignment>(
        ShellControlDefinition, 'Alignment', ShellControlAlignment.Start, MetaData.None);

    // Service token the control binds to as its DataContext. When set, the control
    // is SERVICE-bound (and app-global) — the shell resolves this token and hands
    // the instance to the template as its DataContext, rather than the active
    // document. Leave unset for the classic document-bound control.
    public static readonly DataContextKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        ShellControlDefinition, 'DataContext', undefined, MetaData.None);

    public get Template(): DataTemplate | undefined  { return this.get_property_value(ShellControlDefinition.TemplateKey); }
    public set Template(v: DataTemplate | undefined) { this.set_property_value(ShellControlDefinition.TemplateKey, v); }

    public get Context(): ServiceToken<unknown> | undefined  { return this.get_property_value(ShellControlDefinition.ContextKey); }
    public set Context(v: ServiceToken<unknown> | undefined) { this.set_property_value(ShellControlDefinition.ContextKey, v); }

    public get Order(): number  { return this.get_property_value(ShellControlDefinition.OrderKey); }
    public set Order(v: number) { this.set_property_value(ShellControlDefinition.OrderKey, v); }

    public get Region(): ShellRegion  { return this.get_property_value(ShellControlDefinition.RegionKey); }
    public set Region(v: ShellRegion) { this.set_property_value(ShellControlDefinition.RegionKey, v); }

    public get Alignment(): ShellControlAlignment  { return this.get_property_value(ShellControlDefinition.AlignmentKey); }
    public set Alignment(v: ShellControlAlignment) { this.set_property_value(ShellControlDefinition.AlignmentKey, v); }

    public get DataContext(): ServiceToken<unknown> | undefined  { return this.get_property_value(ShellControlDefinition.DataContextKey); }
    public set DataContext(v: ServiceToken<unknown> | undefined) { this.set_property_value(ShellControlDefinition.DataContextKey, v); }
}
