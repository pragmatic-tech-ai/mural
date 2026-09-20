// ContextMenuVM — three colored panels each with its OWN ContextMenu.
// Right-click any panel to open its menu; the route-walker finds the
// nearest ancestor with an attached ContextMenu and opens it at the
// cursor position.
//
// Each menu is a themed capabilities showcase:
//   * Red — "Edit"  : icon + gesture items, a disabled item, a Transform ▸ submenu.
//   * Green — "View": checkable items (bound state) + a Zoom ▸ submenu.
//   * Blue — "File" : icon + gesture items + a Share ▸ / Export ▸ nested submenu.
//
// The per-colour RelayCommands narrate the fired item into Status via the
// menu item's CommandParameter; the checkables own boolean state + toggle
// commands (mirroring the menu demo's ShowGrid pattern).
import {
    MetaData,
    MuralBase,
    RelayCommand,
} from '@pragmatic-tech-ai/mural/runtime';

export class ContextMenuVM extends MuralBase
{
    static StatusKey     = MuralBase.RegisterProperty<string>(ContextMenuVM, 'Status', 'Right-click any panel — explore submenus, icons, shortcuts, and checkable items.', MetaData.None);

    // Checkable state the green (View) + blue (File) menus bind their
    // IsChecked to. The toggle commands flip these and narrate the change.
    static ShowGridKey   = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'ShowGrid',   true,  MetaData.None);
    static SnapToGridKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'SnapToGrid', false, MetaData.None);
    static ShowRulersKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'ShowRulers', false, MetaData.None);
    static BookmarkedKey = MuralBase.RegisterProperty<boolean>(ContextMenuVM, 'Bookmarked', false, MetaData.None);

    // Per-panel commands the leaf items bind to. The CommandParameter (the
    // item's label) arrives as the argument so one method narrates any leaf.
    readonly RedCommand:   RelayCommand;
    readonly GreenCommand: RelayCommand;
    readonly BlueCommand:  RelayCommand;

    // Checkable toggle commands.
    readonly ShowGridCommand:   RelayCommand;
    readonly SnapToGridCommand: RelayCommand;
    readonly ShowRulersCommand: RelayCommand;
    readonly BookmarkCommand:   RelayCommand;

    constructor()
    {
        super();
        const setStatus = (msg: string): void => this.set_property_value(ContextMenuVM.StatusKey, msg);

        this.RedCommand   = new RelayCommand((label: unknown) => setStatus(`Edit ▸ ${String(label)}.`));
        this.GreenCommand = new RelayCommand((label: unknown) => setStatus(`View ▸ ${String(label)}.`));
        this.BlueCommand  = new RelayCommand((label: unknown) => setStatus(`File ▸ ${String(label)}.`));

        // Toggle commands: the MenuItem's IsCheckable flips its own IsChecked
        // in the click protocol, but the VM boolean is the bound source of
        // truth — flip it here and IsChecked re-renders from the binding.
        this.ShowGridCommand   = new RelayCommand(() => { this.ShowGrid   = !this.ShowGrid;   setStatus(`View ▸ Show Grid → ${this.ShowGrid   ? 'on' : 'off'}.`); });
        this.SnapToGridCommand = new RelayCommand(() => { this.SnapToGrid = !this.SnapToGrid; setStatus(`View ▸ Snap to Grid → ${this.SnapToGrid ? 'on' : 'off'}.`); });
        this.ShowRulersCommand = new RelayCommand(() => { this.ShowRulers = !this.ShowRulers; setStatus(`View ▸ Show Rulers → ${this.ShowRulers ? 'on' : 'off'}.`); });
        this.BookmarkCommand   = new RelayCommand(() => { this.Bookmarked = !this.Bookmarked; setStatus(`File ▸ Bookmark → ${this.Bookmarked ? 'on' : 'off'}.`); });
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
}
