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
import { MetaData, MuralBase, CheckableRelayCommand, RelayCommand, ServiceKey, } from '@pragmatic-tech-ai/mural/runtime';
import { CommandDefinition, CommandGroupPresentation, } from '@pragmatic-tech-ai/mural/framework';
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
export class RecentCommandContributor {
    static Token = new ServiceKey('context-menu.recentContributor');
    static Item1Id = 'context-menu.blue.recent.1';
    static Item2Id = 'context-menu.blue.recent.2';
    static Item3Id = 'context-menu.blue.recent.3';
    static ItemIds = [RecentCommandContributor.Item1Id, RecentCommandContributor.Item2Id, RecentCommandContributor.Item3Id];
    static FileNames = ['diagram-draft.mu', 'architecture-v2.mu', 'notes.mu'];
    openCount = 0;
    Contribute(_parent, _context) {
        this.openCount++;
        const generation = this.openCount;
        return RecentCommandContributor.ItemIds.map((id, i) => RecentCommandContributor.MakeDef(id, RecentCommandContributor.FileNames[i], generation));
    }
    static MakeDef(id, fileName, generation) {
        const def = new CommandDefinition();
        def.Id = id;
        def.Title = `${fileName} (opened ×${generation})`;
        return def;
    }
}
export class ContextMenuVM extends MuralBase {
    static StatusKey = MuralBase.RegisterProperty(ContextMenuVM, 'Status', 'Right-click any panel — explore submenus, icons, shortcuts, and checkable items.', MetaData.None);
    // Checkable state the green (View) + blue (File) menus bind their
    // toggle commands against.
    static ShowGridKey = MuralBase.RegisterProperty(ContextMenuVM, 'ShowGrid', true, MetaData.None);
    static SnapToGridKey = MuralBase.RegisterProperty(ContextMenuVM, 'SnapToGrid', false, MetaData.None);
    static ShowRulersKey = MuralBase.RegisterProperty(ContextMenuVM, 'ShowRulers', false, MetaData.None);
    static BookmarkedKey = MuralBase.RegisterProperty(ContextMenuVM, 'Bookmarked', false, MetaData.None);
    // ── Status-narration prefixes (reused across every leaf in a menu) ──
    static EditPrefix = 'Edit';
    static ViewPrefix = 'View';
    static FilePrefix = 'File';
    // ── Red (Edit) menu — ids + titles ───────────────────────────────────
    static RedMenuId = 'context-menu.red';
    static RedCutId = 'context-menu.red.cut';
    static RedCutTitle = 'Cut';
    static RedCopyId = 'context-menu.red.copy';
    static RedCopyTitle = 'Copy';
    static RedPasteId = 'context-menu.red.paste';
    static RedPasteTitle = 'Paste';
    static RedDeleteId = 'context-menu.red.delete';
    static RedDeleteTitle = 'Delete';
    static RedTransformId = 'context-menu.red.transform';
    static RedTransformTitle = 'Transform';
    static RedRotate90Id = 'context-menu.red.transform.rotate90';
    static RedRotate90Title = 'Rotate 90°';
    static RedFlipHorizontalId = 'context-menu.red.transform.flipHorizontal';
    static RedFlipHorizontalTitle = 'Flip Horizontal';
    static RedFlipVerticalId = 'context-menu.red.transform.flipVertical';
    static RedFlipVerticalTitle = 'Flip Vertical';
    // ── Green (View) menu — ids + titles ─────────────────────────────────
    static GreenMenuId = 'context-menu.green';
    static GreenShowGridTitle = 'Show Grid';
    static GreenSnapToGridTitle = 'Snap to Grid';
    static GreenShowRulersTitle = 'Show Rulers';
    static GreenZoomId = 'context-menu.green.zoom';
    static GreenZoomTitle = 'Zoom';
    static GreenZoom50Id = 'context-menu.green.zoom.50';
    static GreenZoom50Title = '50%';
    static GreenZoom100Id = 'context-menu.green.zoom.100';
    static GreenZoom100Title = '100%';
    static GreenZoom200Id = 'context-menu.green.zoom.200';
    static GreenZoom200Title = '200%';
    static GreenFitToWindowId = 'context-menu.green.zoom.fit';
    static GreenFitToWindowTitle = 'Fit to Window';
    // DP keys referenced by name below (GreenShowGrid etc.) — Ids derive
    // from the same string the Title does via GreenToggleId(), so the
    // Show Grid / Snap to Grid / Show Rulers family shares one id scheme
    // without three more hand-written constants.
    static GreenToggleId(title) {
        return `context-menu.green.${title.replace(/\s+/g, '').toLowerCase()}`;
    }
    // ── Blue (File) menu — ids + titles ──────────────────────────────────
    static BlueMenuId = 'context-menu.blue';
    static BlueOpenId = 'context-menu.blue.open';
    static BlueOpenTitle = 'Open…';
    static BlueSaveId = 'context-menu.blue.save';
    static BlueSaveTitle = 'Save';
    static BlueRecentId = 'context-menu.blue.recent';
    static BlueRecentTitle = 'Recent';
    static BlueShareId = 'context-menu.blue.share';
    static BlueShareTitle = 'Share';
    static BlueCopyLinkId = 'context-menu.blue.share.copyLink';
    static BlueCopyLinkTitle = 'Copy Link';
    static BlueEmailId = 'context-menu.blue.share.email';
    static BlueEmailTitle = 'Email';
    static BlueExportAsId = 'context-menu.blue.share.exportAs';
    static BlueExportAsTitle = 'Export as';
    static BlueExportPngId = 'context-menu.blue.share.exportAs.png';
    static BlueExportPngTitle = 'PNG image';
    static BlueExportSvgId = 'context-menu.blue.share.exportAs.svg';
    static BlueExportSvgTitle = 'SVG vector';
    static BlueExportPdfId = 'context-menu.blue.share.exportAs.pdf';
    static BlueExportPdfTitle = 'PDF document';
    static BlueBookmarkTitle = 'Bookmark';
    // id → live ICommand, resolved by the Dispatcher on every click. One map
    // backs all three menus — ids are namespaced per colour so they can't collide.
    commandsById = new Map();
    Dispatcher;
    RedMenuRoots;
    GreenMenuRoots;
    BlueMenuRoots;
    constructor() {
        super();
        this.RedMenuRoots = this.BuildRedMenu();
        this.GreenMenuRoots = this.BuildGreenMenu();
        this.BlueMenuRoots = this.BuildBlueMenu();
        this.Dispatcher = new DemoCommandDispatcher(this.commandsById);
    }
    get Status() { return this.get_property_value(ContextMenuVM.StatusKey); }
    set Status(v) { this.set_property_value(ContextMenuVM.StatusKey, v); }
    get ShowGrid() { return this.get_property_value(ContextMenuVM.ShowGridKey); }
    set ShowGrid(v) { this.set_property_value(ContextMenuVM.ShowGridKey, v); }
    get SnapToGrid() { return this.get_property_value(ContextMenuVM.SnapToGridKey); }
    set SnapToGrid(v) { this.set_property_value(ContextMenuVM.SnapToGridKey, v); }
    get ShowRulers() { return this.get_property_value(ContextMenuVM.ShowRulersKey); }
    set ShowRulers(v) { this.set_property_value(ContextMenuVM.ShowRulersKey, v); }
    get Bookmarked() { return this.get_property_value(ContextMenuVM.BookmarkedKey); }
    set Bookmarked(v) { this.set_property_value(ContextMenuVM.BookmarkedKey, v); }
    SetStatus(message) {
        this.Status = message;
    }
    // ── Red (Edit) ────────────────────────────────────────────────────────
    BuildRedMenu() {
        const transform = this.MakeParent(ContextMenuVM.RedTransformId, ContextMenuVM.RedTransformTitle, [
            this.MakeLeaf(ContextMenuVM.RedRotate90Id, ContextMenuVM.RedRotate90Title, ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedFlipHorizontalId, ContextMenuVM.RedFlipHorizontalTitle, ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedFlipVerticalId, ContextMenuVM.RedFlipVerticalTitle, ContextMenuVM.EditPrefix),
        ]);
        return [
            this.MakeLeaf(ContextMenuVM.RedCutId, ContextMenuVM.RedCutTitle, ContextMenuVM.EditPrefix),
            this.MakeLeaf(ContextMenuVM.RedCopyId, ContextMenuVM.RedCopyTitle, ContextMenuVM.EditPrefix),
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
    BuildGreenMenu() {
        const zoom = this.MakeParent(ContextMenuVM.GreenZoomId, ContextMenuVM.GreenZoomTitle, [
            this.MakeLeaf(ContextMenuVM.GreenZoom50Id, ContextMenuVM.GreenZoom50Title, ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenZoom100Id, ContextMenuVM.GreenZoom100Title, ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenZoom200Id, ContextMenuVM.GreenZoom200Title, ContextMenuVM.ViewPrefix),
            this.MakeLeaf(ContextMenuVM.GreenFitToWindowId, ContextMenuVM.GreenFitToWindowTitle, ContextMenuVM.ViewPrefix),
        ]);
        return [
            this.MakeToggle(ContextMenuVM.GreenToggleId(ContextMenuVM.GreenShowGridTitle), ContextMenuVM.GreenShowGridTitle, ContextMenuVM.ViewPrefix, () => this.ShowGrid, (v) => { this.ShowGrid = v; }),
            this.MakeToggle(ContextMenuVM.GreenToggleId(ContextMenuVM.GreenSnapToGridTitle), ContextMenuVM.GreenSnapToGridTitle, ContextMenuVM.ViewPrefix, () => this.SnapToGrid, (v) => { this.SnapToGrid = v; }),
            this.MakeToggle(ContextMenuVM.GreenToggleId(ContextMenuVM.GreenShowRulersTitle), ContextMenuVM.GreenShowRulersTitle, ContextMenuVM.ViewPrefix, () => this.ShowRulers, (v) => { this.ShowRulers = v; }),
            zoom,
        ];
    }
    // ── Blue (File) ───────────────────────────────────────────────────────
    BuildBlueMenu() {
        const exportAs = this.MakeParent(ContextMenuVM.BlueExportAsId, ContextMenuVM.BlueExportAsTitle, [
            this.MakeLeaf(ContextMenuVM.BlueExportPngId, ContextMenuVM.BlueExportPngTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueExportSvgId, ContextMenuVM.BlueExportSvgTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueExportPdfId, ContextMenuVM.BlueExportPdfTitle, ContextMenuVM.FilePrefix),
        ]);
        const share = this.MakeParent(ContextMenuVM.BlueShareId, ContextMenuVM.BlueShareTitle, [
            this.MakeLeaf(ContextMenuVM.BlueCopyLinkId, ContextMenuVM.BlueCopyLinkTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueEmailId, ContextMenuVM.BlueEmailTitle, ContextMenuVM.FilePrefix),
            exportAs,
        ]);
        // The dynamic submenu — no static Children, its rows come ENTIRELY
        // from RecentCommandContributor.Contribute (resolved via the
        // ChildrenContributor token) each time this node's submenu opens.
        const recent = this.MakeParent(ContextMenuVM.BlueRecentId, ContextMenuVM.BlueRecentTitle, [], RecentCommandContributor.Token);
        for (const id of [RecentCommandContributor.Item1Id, RecentCommandContributor.Item2Id, RecentCommandContributor.Item3Id]) {
            this.commandsById.set(id, new RelayCommand(() => this.SetStatus(`${ContextMenuVM.FilePrefix} ▸ Recent ▸ opened.`)));
        }
        return [
            this.MakeLeaf(ContextMenuVM.BlueOpenId, ContextMenuVM.BlueOpenTitle, ContextMenuVM.FilePrefix),
            this.MakeLeaf(ContextMenuVM.BlueSaveId, ContextMenuVM.BlueSaveTitle, ContextMenuVM.FilePrefix),
            recent,
            share,
            this.MakeToggle(`${ContextMenuVM.BlueMenuId}.bookmark`, ContextMenuVM.BlueBookmarkTitle, ContextMenuVM.FilePrefix, () => this.Bookmarked, (v) => { this.Bookmarked = v; }),
        ];
    }
    // ── CommandDefinition factories ──────────────────────────────────────
    // A leaf command: registers a dedicated RelayCommand narrating
    // "<prefix> ▸ <title>." into Status, and returns the CommandDefinition
    // the dispatcher resolves it through.
    MakeLeaf(id, title, prefix) {
        this.commandsById.set(id, new RelayCommand(() => this.SetStatus(`${prefix} ▸ ${title}.`)));
        return this.MakeDef(id, title);
    }
    // A leaf whose command never runs — CanExecute is permanently false. The
    // click gate (MenuItem.activate()) still checks CanExecute, so this stays
    // functionally non-clickable even without a visual disabled treatment.
    MakeDisabledLeaf(id, title) {
        this.commandsById.set(id, new RelayCommand(() => { }, () => false));
        return this.MakeDef(id, title);
    }
    // A checkable row — Presentation=Toggles drives CommandMenuBuilder to
    // build a toggle CommandViewModel (IsToggle=true) seeded from, and kept
    // live-synced with, the CheckableRelayCommand below (see command-menu-
    // builder.ts). `get`/`set` read and write the VM's own backing DP so the
    // rest of the demo (narration, any other binding) still sees one source
    // of truth.
    MakeToggle(id, title, prefix, get, set) {
        const command = new CheckableRelayCommand(() => {
            set(!get());
            this.SetStatus(`${prefix} ▸ ${title} → ${get() ? 'on' : 'off'}.`);
            command.RaiseCanExecuteChanged();
        }, undefined, get);
        this.commandsById.set(id, command);
        const def = this.MakeDef(id, title);
        def.Presentation = CommandGroupPresentation.Toggles;
        return def;
    }
    // A parent/header row — no command of its own (Resolve(id) misses, so it
    // dispatches to nothing and only ever toggles its submenu); static
    // children plus an optional ChildrenContributor token for a dynamic tail.
    MakeParent(id, title, children, contributor) {
        const def = this.MakeDef(id, title);
        for (const child of children)
            def.AddChild(child);
        if (contributor !== undefined)
            def.ChildrenContributor = contributor;
        return def;
    }
    MakeDef(id, title) {
        const def = new CommandDefinition();
        def.Id = id;
        def.Title = title;
        return def;
    }
}
