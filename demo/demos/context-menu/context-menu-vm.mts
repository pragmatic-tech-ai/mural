// ContextMenuVM — three colored panels each with its OWN ContextMenu,
// now rendered through the command-driven menu machinery
// (CommandContextMenu / CommandMenuBuilder / CommandDefinition trees)
// instead of hand-authored nested MenuItem blocks. Right-click any panel
// to open its menu; the route-walker finds the nearest ancestor with an
// attached ContextMenu and opens it at the cursor position.
//
// Each menu is a themed capabilities showcase, built as a
// CommandDefinition tree in the constructor and resolved through a
// DemoCommandDispatcher that routes each leaf's stable Id to the VM's
// own command catalogue (commandsById):
//   * Red — "Edit"  : leaf commands, a CanExecute=false disabled leaf,
//                      a Transform ▸ submenu (nested CommandDefinitions).
//   * Green — "View": checkable items (Presentation = Toggles, backed by
//                      CheckableRelayCommand) + a Zoom ▸ submenu.
//   * Blue — "File" : leaf commands, a dynamic Recent ▸ submenu backed
//                      by RecentCommandContributor (a ChildrenContributor
//                      that re-evaluates every time the submenu opens —
//                      see its own doc comment), and a two-level
//                      Share ▸ Export ▸ submenu.
import {
    MetaData,
    MuralBase,
    CheckableRelayCommand,
    RelayCommand,
    ServiceKey,
    type ICommand,
    type ServiceToken,
} from '@pragmatic-tech-ai/mural/runtime';
import {
    CommandContext,
    CommandDefinition,
    CommandGroupPresentation,
    type ICommandContributor,
} from '@pragmatic-tech-ai/mural/framework';
import { DemoCommandDispatcher } from '../_shared/demo-command-dispatcher.mjs';

// A demo ICommandContributor — the dynamic "Recent" submenu under the Blue
// (File) menu. Contribute() runs lazily, exactly once per CommandViewModel
// instance, the first time that VM's submenu opens (CommandViewModel.
// EnsureExpanded, idempotent within one open — see command-view-model.ts).
// CommandContextMenu rebuilds its WHOLE CommandViewModel tree fresh on every
// ContextMenu open (BuildTree, command-context-menu.ts) and disposes the old
// tree on close, so each open hands "Recent" a BRAND NEW, unrealized VM —
// its first expand calls Contribute() again. Bumping openCount and folding
// the generation into each returned Title is what makes that re-evaluation
// visible: a re-open after the Red/Green/Blue panel's menu was reopened
// shows "(opened ×2)", not the stale "(opened ×1)" list.
export class RecentCommandContributor implements ICommandContributor
{
    public static readonly Token = new ServiceKey<ICommandContributor>('context-menu.recentContributor');

    public static readonly Item1Id = 'context-menu.blue.recent.1';
    public static readonly Item2Id = 'context-menu.blue.recent.2';
    public static readonly Item3Id = 'context-menu.blue.recent.3';

    private static readonly ItemIds: readonly string[] =
        [RecentCommandContributor.Item1Id, RecentCommandContributor.Item2Id, RecentCommandContributor.Item3Id];

    private static readonly FileNames: readonly string[] =
        ['diagram-draft.mu', 'architecture-v2.mu', 'notes.mu'];

    private openCount = 0;

    public Contribute(_parent: CommandDefinition, _context: CommandContext): readonly CommandDefinition[]
    {
        this.openCount++;
        const generation = this.openCount;
        return RecentCommandContributor.ItemIds.map((id, i) =>
            RecentCommandContributor.MakeDef(id, RecentCommandContributor.FileNames[i]!, generation));
    }

    private static MakeDef(id: string, fileName: string, generation: number): CommandDefinition
    {
        const def = new CommandDefinition();
        def.Id = id;
        def.Title = `${fileName} (opened ×${generation})`;
        return def;
    }
}

export class ContextMenuVM extends MuralBase
{
    static StatusKey     = MuralBase.RegisterProperty<string>(ContextMenuVM, 'Status', 'Right-click any panel — explore submenus, icons, shortcuts, and checkable items.', MetaData.None);

    // Checkable state the green (View) + blue (File) menus bind their
    // toggle commands against.
    static ShowGridKey   = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'ShowGrid',   true,  MetaData.None);
    static SnapToGridKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'SnapToGrid', false, MetaData.None);
    static ShowRulersKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'ShowRulers', false, MetaData.None);
    static BookmarkedKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'Bookmarked', false, MetaData.None);

    // ── Status-narration prefixes (reused across every leaf in a menu) ──
    private static readonly EditPrefix = 'Edit';
    private static readonly ViewPrefix = 'View';
    private static readonly FilePrefix = 'File';

    // ── Red (Edit) menu — ids + titles ───────────────────────────────────
    private static readonly RedMenuId            = 'context-menu.red';
    private static readonly RedCutId             = 'context-menu.red.cut';
    private static readonly RedCutTitle          = 'Cut';
    private static readonly RedCopyId            = 'context-menu.red.copy';
    private static readonly RedCopyTitle         = 'Copy';
    private static readonly RedPasteId           = 'context-menu.red.paste';
    private static readonly RedPasteTitle        = 'Paste';
    private static readonly RedDeleteId          = 'context-menu.red.delete';
    private static readonly RedDeleteTitle       = 'Delete';
    private static readonly RedTransformId       = 'context-menu.red.transform';
    private static readonly RedTransformTitle    = 'Transform';
    private static readonly RedRotate90Id        = 'context-menu.red.transform.rotate90';
    private static readonly RedRotate90Title     = 'Rotate 90°';
    private static readonly RedFlipHorizontalId  = 'context-menu.red.transform.flipHorizontal';
    private static readonly RedFlipHorizontalTitle = 'Flip Horizontal';
    private static readonly RedFlipVerticalId    = 'context-menu.red.transform.flipVertical';
    private static readonly RedFlipVerticalTitle = 'Flip Vertical';

    // ── Green (View) menu — ids + titles ─────────────────────────────────
    private static readonly GreenMenuId          = 'context-menu.green';
    private static readonly GreenShowGridTitle   = 'Show Grid';
    private static readonly GreenSnapToGridTitle = 'Snap to Grid';
    private static readonly GreenShowRulersTitle = 'Show Rulers';
    private static readonly GreenZoomId          = 'context-menu.green.zoom';
    private static readonly GreenZoomTitle       = 'Zoom';
    private static readonly GreenZoom50Id        = 'context-menu.green.zoom.50';
    private static readonly GreenZoom50Title     = '50%';
    private static readonly GreenZoom100Id       = 'context-menu.green.zoom.100';
    private static readonly GreenZoom100Title    = '100%';
    private static readonly GreenZoom200Id       = 'context-menu.green.zoom.200';
    private static readonly GreenZoom200Title    = '200%';
    private static readonly GreenFitToWindowId   = 'context-menu.green.zoom.fit';
    private static readonly GreenFitToWindowTitle = 'Fit to Window';

    // DP keys referenced by name below (GreenShowGrid etc.) — Ids derive
    // from the same string the Title does via GreenToggleId(), so the
    // Show Grid / Snap to Grid / Show Rulers family shares one id scheme
    // without three more hand-written constants.
    private static GreenToggleId(title: string): string
    {
        return `context-menu.green.${title.replace(/\s+/g, '').toLowerCase()}`;
    }

    // ── Blue (File) menu — ids + titles ──────────────────────────────────
    private static readonly BlueMenuId           = 'context-menu.blue';
    private static readonly BlueOpenId           = 'context-menu.blue.open';
    private static readonly BlueOpenTitle        = 'Open…';
    private static readonly BlueSaveId           = 'context-menu.blue.save';
    private static readonly BlueSaveTitle        = 'Save';
    private static readonly BlueRecentId         = 'context-menu.blue.recent';
    private static readonly BlueRecentTitle      = 'Recent';
    private static readonly BlueShareId          = 'context-menu.blue.share';
    private static readonly BlueShareTitle       = 'Share';
    private static readonly BlueCopyLinkId       = 'context-menu.blue.share.copyLink';
    private static readonly BlueCopyLinkTitle    = 'Copy Link';
    private static readonly BlueEmailId          = 'context-menu.blue.share.email';
    private static readonly BlueEmailTitle       = 'Email';
    private static readonly BlueExportAsId       = 'context-menu.blue.share.exportAs';
    private static readonly BlueExportAsTitle    = 'Export as';
    private static readonly BlueExportPngId      = 'context-menu.blue.share.exportAs.png';
    private static readonly BlueExportPngTitle   = 'PNG image';
    private static readonly BlueExportSvgId      = 'context-menu.blue.share.exportAs.svg';
    private static readonly BlueExportSvgTitle   = 'SVG vector';
    private static readonly BlueExportPdfId      = 'context-menu.blue.share.exportAs.pdf';
    private static readonly BlueExportPdfTitle   = 'PDF document';
    private static readonly BlueBookmarkTitle    = 'Bookmark';

    // id → live ICommand, resolved by the Dispatcher on every click. One map
    // backs all three menus — ids are namespaced per colour so they can't collide.
    private readonly commandsById = new Map<string, ICommand>();

    public readonly Dispatcher: DemoCommandDispatcher;
    public readonly RedMenuRoots:   readonly CommandDefinition[];
    public readonly GreenMenuRoots: readonly CommandDefinition[];
    public readonly BlueMenuRoots:  readonly CommandDefinition[];

    constructor()
    {
        super();

        this.RedMenuRoots   = this.BuildRedMenu();
        this.GreenMenuRoots = this.BuildGreenMenu();
        this.BlueMenuRoots  = this.BuildBlueMenu();
        this.Dispatcher     = new DemoCommandDispatcher(this.commandsById);
    }

    get Status():     string  { return this.get_property_value(ContextMenuVM.StatusKey); }
    set Status(v:     string) { this.set_property_value(ContextMenuVM.StatusKey, v); }
    get ShowGrid():   boolean { return this.get_property_value(ContextMenuVM.ShowGridKey); }
    set ShowGrid(v:   boolean) { this.set_property_value(ContextMenuVM.ShowGridKey, v); }
    get SnapToGrid(): boolean { return this.get_property_value(ContextMenuVM.SnapToGridKey); }
    set SnapToGrid(v: boolean) { this.set_property_value(ContextMenuVM.SnapToGridKey, v); }
    get ShowRulers(): boolean { return this.get_property_value(ContextMenuVM.ShowRulersKey); }
    set ShowRulers(v: boolean) { this.set_property_value(ContextMenuVM.ShowRulersKey, v); }
    get Bookmarked(): boolean { return this.get_property_value(ContextMenuVM.BookmarkedKey); }
    set Bookmarked(v: boolean) { this.set_property_value(ContextMenuVM.BookmarkedKey, v); }

    private SetStatus(message: string): void
    {
        this.Status = message;
    }

    // ── Red (Edit) ────────────────────────────────────────────────────────
    private BuildRedMenu(): readonly CommandDefinition[]
    {
        const transform = this.MakeParent(ContextMenuVM.RedTransformId, ContextMenuVM.RedTransformTitle, [
            this.MakeLeaf(ContextMenuVM.RedRotate90Id,       ContextMenuVM.RedRotate90Title,       ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedFlipHorizontalId, ContextMenuVM.RedFlipHorizontalTitle, ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedFlipVerticalId,   ContextMenuVM.RedFlipVerticalTitle,   ContextMenuVM.EditPrefix),
        ]);
        return [
            this.MakeLeaf(ContextMenuVM.RedCutId,   ContextMenuVM.RedCutTitle,   ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedCopyId,  ContextMenuVM.RedCopyTitle,  ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedPasteId, ContextMenuVM.RedPasteTitle, ContextMenuVM.EditPrefix),
            // Disabled: nothing to delete until something is selected — a
            // CanExecute=false leaf, same functional gate the old hand-authored
            // `IsEnabled=false` MenuItem enforced (MenuItem has no CanExecute→
            // IsEnabled visual wiring today, so this item no longer renders
            // greyed-out; it still refuses to execute on click).
            this.MakeDisabledLeaf(ContextMenuVM.RedDeleteId, ContextMenuVM.RedDeleteTitle),
            transform,
        ];
    }

    // ── Green (View) ──────────────────────────────────────────────────────
    private BuildGreenMenu(): readonly CommandDefinition[]
    {
        const zoom = this.MakeParent(ContextMenuVM.GreenZoomId, ContextMenuVM.GreenZoomTitle, [
            this.MakeLeaf(ContextMenuVM.GreenZoom50Id,      ContextMenuVM.GreenZoom50Title,      ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenZoom100Id,     ContextMenuVM.GreenZoom100Title,     ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenZoom200Id,     ContextMenuVM.GreenZoom200Title,     ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenFitToWindowId, ContextMenuVM.GreenFitToWindowTitle, ContextMenuVM.ViewPrefix),
        ]);
        return [
            this.MakeToggle(
                ContextMenuVM.GreenToggleId(ContextMenuVM.GreenShowGridTitle), ContextMenuVM.GreenShowGridTitle, ContextMenuVM.ViewPrefix,
                () => this.ShowGrid, (v) => { this.ShowGrid = v; }),
            this.MakeToggle(
                ContextMenuVM.GreenToggleId(ContextMenuVM.GreenSnapToGridTitle), ContextMenuVM.GreenSnapToGridTitle, ContextMenuVM.ViewPrefix,
                () => this.SnapToGrid, (v) => { this.SnapToGrid = v; }),
            this.MakeToggle(
                ContextMenuVM.GreenToggleId(ContextMenuVM.GreenShowRulersTitle), ContextMenuVM.GreenShowRulersTitle, ContextMenuVM.ViewPrefix,
                () => this.ShowRulers, (v) => { this.ShowRulers = v; }),
            zoom,
        ];
    }

    // ── Blue (File) ───────────────────────────────────────────────────────
    private BuildBlueMenu(): readonly CommandDefinition[]
    {
        const exportAs = this.MakeParent(ContextMenuVM.BlueExportAsId, ContextMenuVM.BlueExportAsTitle, [
            this.MakeLeaf(ContextMenuVM.BlueExportPngId, ContextMenuVM.BlueExportPngTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueExportSvgId, ContextMenuVM.BlueExportSvgTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueExportPdfId, ContextMenuVM.BlueExportPdfTitle, ContextMenuVM.FilePrefix),
        ]);
        const share = this.MakeParent(ContextMenuVM.BlueShareId, ContextMenuVM.BlueShareTitle, [
            this.MakeLeaf(ContextMenuVM.BlueCopyLinkId, ContextMenuVM.BlueCopyLinkTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueEmailId,    ContextMenuVM.BlueEmailTitle,    ContextMenuVM.FilePrefix),
            exportAs,
        ]);
        // The dynamic submenu — no static Children, its rows come ENTIRELY
        // from RecentCommandContributor.Contribute (resolved via the
        // ChildrenContributor token) each time this node's submenu opens.
        const recent = this.MakeParent(ContextMenuVM.BlueRecentId, ContextMenuVM.BlueRecentTitle, [], RecentCommandContributor.Token);
        for (const id of [RecentCommandContributor.Item1Id, RecentCommandContributor.Item2Id, RecentCommandContributor.Item3Id])
        {
            this.commandsById.set(id, new RelayCommand(() => this.SetStatus(`${ContextMenuVM.FilePrefix} ▸ Recent ▸ opened.`)));
        }
        return [
            this.MakeLeaf(ContextMenuVM.BlueOpenId, ContextMenuVM.BlueOpenTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueSaveId, ContextMenuVM.BlueSaveTitle, ContextMenuVM.FilePrefix),
            recent,
            share,
            this.MakeToggle(
                `${ContextMenuVM.BlueMenuId}.bookmark`, ContextMenuVM.BlueBookmarkTitle, ContextMenuVM.FilePrefix,
                () => this.Bookmarked, (v) => { this.Bookmarked = v; }),
        ];
    }

    // ── CommandDefinition factories ──────────────────────────────────────

    // A leaf command: registers a dedicated RelayCommand narrating
    // "<prefix> ▸ <title>." into Status, and returns the CommandDefinition
    // the dispatcher resolves it through.
    private MakeLeaf(id: string, title: string, prefix: string): CommandDefinition
    {
        this.commandsById.set(id, new RelayCommand(() => this.SetStatus(`${prefix} ▸ ${title}.`)));
        return this.MakeDef(id, title);
    }

    // A leaf whose command never runs — CanExecute is permanently false. The
    // click gate (MenuItem.activate()) still checks CanExecute, so this stays
    // functionally non-clickable even without a visual disabled treatment.
    private MakeDisabledLeaf(id: string, title: string): CommandDefinition
    {
        this.commandsById.set(id, new RelayCommand(() => { /* unreachable: CanExecute is always false */ }, () => false));
        return this.MakeDef(id, title);
    }

    // A checkable row — Presentation=Toggles drives CommandMenuBuilder to
    // build a toggle CommandViewModel (IsToggle=true) seeded from, and kept
    // live-synced with, the CheckableRelayCommand below (see command-menu-
    // builder.ts). `get`/`set` read and write the VM's own backing DP so the
    // rest of the demo (narration, any other binding) still sees one source
    // of truth.
    private MakeToggle(
        id:     string,
        title:  string,
        prefix: string,
        get:    () => boolean,
        set:    (v: boolean) => void,
    ): CommandDefinition
    {
        const command: CheckableRelayCommand = new CheckableRelayCommand(
            () =>
            {
                set(!get());
                this.SetStatus(`${prefix} ▸ ${title} → ${get() ? 'on' : 'off'}.`);
                command.RaiseCanExecuteChanged();
            },
            undefined,
            get,
        );
        this.commandsById.set(id, command);
        const def = this.MakeDef(id, title);
        def.Presentation = CommandGroupPresentation.Toggles;
        return def;
    }

    // A parent/header row — no command of its own (Resolve(id) misses, so it
    // dispatches to nothing and only ever toggles its submenu); static
    // children plus an optional ChildrenContributor token for a dynamic tail.
    private MakeParent(
        id:           string,
        title:        string,
        children:     readonly CommandDefinition[],
        contributor?: ServiceToken<ICommandContributor>,
    ): CommandDefinition
    {
        const def = this.MakeDef(id, title);
        for (const child of children) def.AddChild(child);
        if (contributor !== undefined) def.ChildrenContributor = contributor;
        return def;
    }

    private MakeDef(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition();
        def.Id    = id;
        def.Title = title;
        return def;
    }
}
