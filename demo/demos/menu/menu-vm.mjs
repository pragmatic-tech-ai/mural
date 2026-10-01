// MenuVM — command catalogue + status mirror for the menu demo, now
// rendered through the command-driven menu machinery. The MenuButton's
// fly-out is no longer a hand-authored `MenuItem { ... }` body: it binds
// `ItemsSource = $Roots` + `ItemTemplate = @CommandMenuItemTemplate`
// against a CommandViewModel tree this VM builds (via CommandMenuBuilder)
// from a flat CommandDefinition list, resolved through a
// DemoCommandDispatcher over this VM's own command catalogue.
//
// Two checkable items (ShowGrid / SnapToGrid) demonstrate the checkable
// menu row: their CommandDefinition.Presentation = Toggles, which drives
// CommandMenuBuilder.Build to produce a toggle CommandViewModel
// (IsToggle=true) seeded from — and kept live-synced with — a
// CheckableRelayCommand.
//
// The roots are built ONCE (in the constructor), not rebuilt per open —
// this MenuButton has no ChildrenContributor-backed submenu, so there is
// no dynamic content that would go stale between opens (contrast
// CommandContextMenu, which rebuilds fresh every open specifically to
// re-evaluate a contributor; mirrors MainMenuService's LAZY-ONCE roots).
import { Application, MetaData, MuralBase, CheckableRelayCommand, RelayCommand, } from '@pragmatic-tech-ai/mural/runtime';
import { CommandContext, CommandDefinition, CommandGroupPresentation, CommandMenuBuilder, } from '@pragmatic-tech-ai/mural/framework';
import { DemoCommandDispatcher } from '../_shared/demo-command-dispatcher.mjs';
export class MenuVM extends MuralBase {
    static StatusKey = MuralBase.RegisterProperty(MenuVM, 'Status', 'Ready.', MetaData.None);
    static ShowGridKey = MuralBase.RegisterProperty(MenuVM, 'ShowGrid', true, MetaData.None);
    static SnapToGridKey = MuralBase.RegisterProperty(MenuVM, 'SnapToGrid', false, MetaData.None);
    static NewId = 'menu.new';
    static NewTitle = 'New';
    static OpenId = 'menu.open';
    static OpenTitle = 'Open…';
    static SaveId = 'menu.save';
    static SaveTitle = 'Save';
    static SaveAsId = 'menu.saveAs';
    static SaveAsTitle = 'Save As…';
    static CloseId = 'menu.close';
    static CloseTitle = 'Close';
    static UndoId = 'menu.undo';
    static UndoTitle = 'Undo';
    static RedoId = 'menu.redo';
    static RedoTitle = 'Redo';
    static ShowGridId = 'menu.showGrid';
    static ShowGridTitle = 'Show Grid';
    static SnapToGridId = 'menu.snapToGrid';
    static SnapToGridTitle = 'Snap to Grid';
    // id → live ICommand, resolved by the Dispatcher on every click.
    commandsById = new Map();
    Dispatcher;
    Roots;
    constructor() {
        super();
        // Restore the pre-migration dividers: before Save (after Open), before
        // Close (after Save As), before Undo (after Close), before Show Grid
        // (after Redo) — the four MenuSeparators the old hand-authored body had.
        const save = this.MakeLeaf(MenuVM.SaveId, MenuVM.SaveTitle, 'Save — written to disk.');
        const close = this.MakeLeaf(MenuVM.CloseId, MenuVM.CloseTitle, 'Close — document closed.');
        const undo = this.MakeLeaf(MenuVM.UndoId, MenuVM.UndoTitle, 'Undo.');
        const showGrid = this.MakeToggle(MenuVM.ShowGridId, MenuVM.ShowGridTitle, () => this.ShowGrid, (v) => { this.ShowGrid = v; });
        save.SeparatorBefore = true;
        close.SeparatorBefore = true;
        undo.SeparatorBefore = true;
        showGrid.SeparatorBefore = true;
        const defs = [
            this.MakeLeaf(MenuVM.NewId, MenuVM.NewTitle, 'New — empty document.'),
            this.MakeLeaf(MenuVM.OpenId, MenuVM.OpenTitle, 'Open — read from disk.'),
            save,
            this.MakeLeaf(MenuVM.SaveAsId, MenuVM.SaveAsTitle, 'Save As… — file dialog opened.'),
            close,
            undo,
            this.MakeLeaf(MenuVM.RedoId, MenuVM.RedoTitle, 'Redo.'),
            showGrid,
            this.MakeToggle(MenuVM.SnapToGridId, MenuVM.SnapToGridTitle, () => this.SnapToGrid, (v) => { this.SnapToGrid = v; }),
        ];
        this.Dispatcher = new DemoCommandDispatcher(this.commandsById);
        const builder = new CommandMenuBuilder(this.Dispatcher, Application.current.Services, new CommandContext());
        this.Roots = defs.map((def) => builder.Build(def));
    }
    get Status() { return this.get_property_value(MenuVM.StatusKey); }
    set Status(v) { this.set_property_value(MenuVM.StatusKey, v); }
    get ShowGrid() { return this.get_property_value(MenuVM.ShowGridKey); }
    set ShowGrid(v) { this.set_property_value(MenuVM.ShowGridKey, v); }
    get SnapToGrid() { return this.get_property_value(MenuVM.SnapToGridKey); }
    set SnapToGrid(v) { this.set_property_value(MenuVM.SnapToGridKey, v); }
    MakeLeaf(id, title, narration) {
        this.commandsById.set(id, new RelayCommand(() => { this.Status = narration; }));
        return MenuVM.MakeDef(id, title);
    }
    // A checkable row: Presentation=Toggles + a CheckableRelayCommand whose
    // `isChecked` pull reads the VM's own backing DP (`get`) and whose
    // execute flips it (`set`) then re-pulses CanExecuteChanged so
    // CommandMenuBuilder's live-sync listener (command-menu-builder.ts)
    // updates CommandViewModel.IsChecked, which the shipped
    // @CommandMenuItemTemplate's `IsChecked = $IsChecked` binding renders.
    MakeToggle(id, title, get, set) {
        const command = new CheckableRelayCommand(() => {
            set(!get());
            this.Status = `${title} → ${get() ? 'on' : 'off'}.`;
            command.RaiseCanExecuteChanged();
        }, undefined, get);
        this.commandsById.set(id, command);
        const def = MenuVM.MakeDef(id, title);
        def.Presentation = CommandGroupPresentation.Toggles;
        return def;
    }
    static MakeDef(id, title) {
        const def = new CommandDefinition();
        def.Id = id;
        def.Title = title;
        return def;
    }
}
