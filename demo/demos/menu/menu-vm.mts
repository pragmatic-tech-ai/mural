// MenuVM — command catalogue + status mirror for the menu demo. The
// MenuButton hosts a vertical column of MenuItems; click an item to
// run its command. Status reflects the latest invocation.
//
// Two checkable items (ShowGrid / SnapToGrid) demonstrate IsCheckable
// + IsChecked. Their Command callbacks read IsChecked through the
// MenuItem's CommandParameter (the markup passes `$self.IsChecked`).
import {
    MetaData,
    MuralBase,
    RelayCommand,
} from '@pragmatic-tech-ai/mural/runtime';

export class MenuVM extends MuralBase
{
    static StatusKey      = MuralBase.RegisterProperty<string>(MenuVM, 'Status',      'Ready.', MetaData.None);
    static ShowGridKey    = MuralBase.RegisterProperty<boolean>(MenuVM, 'ShowGrid',    true,     MetaData.None);
    static SnapToGridKey  = MuralBase.RegisterProperty<boolean>(MenuVM, 'SnapToGrid',  false,    MetaData.None);

    // Command catalogue exposed as plain fields the menu markup binds to.
    readonly NewCommand:        RelayCommand;
    readonly OpenCommand:       RelayCommand;
    readonly SaveCommand:       RelayCommand;
    readonly SaveAsCommand:     RelayCommand;
    readonly CloseCommand:      RelayCommand;
    readonly UndoCommand:       RelayCommand;
    readonly RedoCommand:       RelayCommand;
    readonly ShowGridCommand:   RelayCommand;
    readonly SnapToGridCommand: RelayCommand;

    constructor()
    {
        super();
        const setStatus = (msg: string): void => this.set_property_value(MenuVM.StatusKey, msg);
        this.NewCommand    = new RelayCommand(() => setStatus('New — empty document.'));
        this.OpenCommand   = new RelayCommand(() => setStatus('Open — read from disk.'));
        this.SaveCommand   = new RelayCommand(() => setStatus('Save — written to disk.'));
        this.SaveAsCommand = new RelayCommand(() => setStatus('Save As… — file dialog opened.'));
        this.CloseCommand  = new RelayCommand(() => setStatus('Close — document closed.'));
        this.UndoCommand   = new RelayCommand(() => setStatus('Undo.'));
        this.RedoCommand   = new RelayCommand(() => setStatus('Redo.'));
        // Toggle commands — the MenuItem's IsCheckable+IsChecked DPs
        // flip first (Button.OnPreClick fires in the click protocol),
        // then the Command runs and reads the post-flip state.
        this.ShowGridCommand = new RelayCommand(() => {
            this.ShowGrid = !this.ShowGrid;
            setStatus(`Show Grid → ${this.ShowGrid ? 'on' : 'off'}.`);
        });
        this.SnapToGridCommand = new RelayCommand(() => {
            this.SnapToGrid = !this.SnapToGrid;
            setStatus(`Snap to Grid → ${this.SnapToGrid ? 'on' : 'off'}.`);
        });
    }

    get Status():       string  { return this.get_property_value(MenuVM.StatusKey); }
    set Status(v:       string) { this.set_property_value(MenuVM.StatusKey, v); }
    get ShowGrid():     boolean { return this.get_property_value(MenuVM.ShowGridKey); }
    set ShowGrid(v:     boolean) { this.set_property_value(MenuVM.ShowGridKey, v); }
    get SnapToGrid():   boolean { return this.get_property_value(MenuVM.SnapToGridKey); }
    set SnapToGrid(v:   boolean) { this.set_property_value(MenuVM.SnapToGridKey, v); }
}
