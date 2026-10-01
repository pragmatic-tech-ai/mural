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
import {
    Application,
    MetaData,
    MuralBase,
    CheckableRelayCommand,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime';
import {
    CommandContext,
    CommandDefinition,
    CommandGroupPresentation,
    CommandMenuBuilder,
    CommandViewModel,
} from '@pragmatic-tech-ai/mural/framework';
import { DemoCommandDispatcher } from '../_shared/demo-command-dispatcher.mjs';

export class MenuVM extends MuralBase
{
    static StatusKey      = MuralBase.RegisterProperty<string>(MenuVM, 'Status',      'Ready.', MetaData.None);
    static ShowGridKey    = MuralBase.RegisterProperty<boolean>(MenuVM, 'ShowGrid',    true,     MetaData.None);
    static SnapToGridKey  = MuralBase.RegisterProperty<boolean>(MenuVM, 'SnapToGrid',  false,    MetaData.None);

    private static readonly NewId      = 'menu.new';      private static readonly NewTitle      = 'New';
    private static readonly OpenId     = 'menu.open';     private static readonly OpenTitle     = 'Open…';
    private static readonly SaveId     = 'menu.save';     private static readonly SaveTitle     = 'Save';
    private static readonly SaveAsId   = 'menu.saveAs';   private static readonly SaveAsTitle   = 'Save As…';
    private static readonly CloseId    = 'menu.close';    private static readonly CloseTitle    = 'Close';
    private static readonly UndoId     = 'menu.undo';     private static readonly UndoTitle     = 'Undo';
    private static readonly RedoId     = 'menu.redo';     private static readonly RedoTitle     = 'Redo';
    private static readonly ShowGridId   = 'menu.showGrid';   private static readonly ShowGridTitle   = 'Show Grid';
    private static readonly SnapToGridId = 'menu.snapToGrid'; private static readonly SnapToGridTitle = 'Snap to Grid';

    // id → live ICommand, resolved by the Dispatcher on every click.
    private readonly commandsById = new Map<string, ICommand>();

    public readonly Dispatcher: DemoCommandDispatcher;
    public readonly Roots: readonly CommandViewModel[];

    constructor()
    {
        super();

        // Restore the pre-migration dividers: before Save (after Open), before
        // Close (after Save As), before Undo (after Close), before Show Grid
        // (after Redo) — the four MenuSeparators the old hand-authored body had.
        const save     = this.MakeLeaf(MenuVM.SaveId,  MenuVM.SaveTitle,  'Save — written to disk.');
        const close    = this.MakeLeaf(MenuVM.CloseId, MenuVM.CloseTitle, 'Close — document closed.');
        const undo     = this.MakeLeaf(MenuVM.UndoId,  MenuVM.UndoTitle,  'Undo.');
        const showGrid = this.MakeToggle(MenuVM.ShowGridId, MenuVM.ShowGridTitle, () => this.ShowGrid, (v) => { this.ShowGrid = v; });
        save.SeparatorBefore     = true;
        close.SeparatorBefore    = true;
        undo.SeparatorBefore     = true;
        showGrid.SeparatorBefore = true;

        const defs = [
            this.MakeLeaf(MenuVM.NewId,    MenuVM.NewTitle,    'New — empty document.'),
            this.MakeLeaf(MenuVM.OpenId,   MenuVM.OpenTitle,   'Open — read from disk.'),
            save,
            this.MakeLeaf(MenuVM.SaveAsId, MenuVM.SaveAsTitle, 'Save As… — file dialog opened.'),
            close,
            undo,
            this.MakeLeaf(MenuVM.RedoId,   MenuVM.RedoTitle,   'Redo.'),
            showGrid,
            this.MakeToggle(MenuVM.SnapToGridId, MenuVM.SnapToGridTitle, () => this.SnapToGrid, (v) => { this.SnapToGrid = v; }),
        ];

        this.Dispatcher = new DemoCommandDispatcher(this.commandsById);
        const builder = new CommandMenuBuilder(this.Dispatcher, Application.current!.Services, new CommandContext());
        this.Roots = defs.map((def) => builder.Build(def));
    }

    get Status():       string  { return this.get_property_value(MenuVM.StatusKey); }
    set Status(v:       string) { this.set_property_value(MenuVM.StatusKey, v); }
    get ShowGrid():     boolean { return this.get_property_value(MenuVM.ShowGridKey); }
    set ShowGrid(v:     boolean) { this.set_property_value(MenuVM.ShowGridKey, v); }
    get SnapToGrid():   boolean { return this.get_property_value(MenuVM.SnapToGridKey); }
    set SnapToGrid(v:   boolean) { this.set_property_value(MenuVM.SnapToGridKey, v); }

    private MakeLeaf(id: string, title: string, narration: string): CommandDefinition
    {
        this.commandsById.set(id, new RelayCommand(() => { this.Status = narration; }));
        return MenuVM.MakeDef(id, title);
    }

    // A checkable row: Presentation=Toggles + a CheckableRelayCommand whose
    // `isChecked` pull reads the VM's own backing DP (`get`) and whose
    // execute flips it (`set`) then re-pulses CanExecuteChanged so
    // CommandMenuBuilder's live-sync listener (command-menu-builder.ts)
    // updates CommandViewModel.IsChecked, which the shipped
    // @CommandMenuItemTemplate's `IsChecked = $IsChecked` binding renders.
    private MakeToggle(id: string, title: string, get: () => boolean, set: (v: boolean) => void): CommandDefinition
    {
        const command: CheckableRelayCommand = new CheckableRelayCommand(
            () =>
            {
                set(!get());
                this.Status = `${title} → ${get() ? 'on' : 'off'}.`;
                command.RaiseCanExecuteChanged();
            },
            undefined,
            get,
        );
        this.commandsById.set(id, command);
        const def = MenuVM.MakeDef(id, title);
        def.Presentation = CommandGroupPresentation.Toggles;
        return def;
    }

    private static MakeDef(id: string, title: string): CommandDefinition
    {
        const def = new CommandDefinition();
        def.Id    = id;
        def.Title = title;
        return def;
    }
}
