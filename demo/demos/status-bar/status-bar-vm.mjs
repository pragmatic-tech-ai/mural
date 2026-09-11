// StatusBarVM — backs the status-bar demo. Holds the status text the
// strip displays, a modified flag, an item-count number, and command
// hooks that flip them.
//
// Strict MVVM: no Visual construction, no view-tree reads, no host
// globals — every piece of state the view shows is a DP, every
// interaction is a command, the only side effect is mutating DPs.
//
// Commands are registered as DPs (not plain JS properties) so the
// markup-side `$AddItemCommand` etc. resolve via DataContextBinding,
// which only walks registered DPs on Models. CounterVM uses the same
// shape for the same reason.
import { MetaData, MuralBase, RelayCommand, } from '@pragmatic-tech-ai/mural/runtime';
export class StatusBarVM extends MuralBase {
    static StatusTextKey = MuralBase.RegisterProperty(StatusBarVM, 'StatusText', 'Ready', MetaData.None);
    static IsModifiedKey = MuralBase.RegisterProperty(StatusBarVM, 'IsModified', false, MetaData.None);
    static ItemCountKey = MuralBase.RegisterProperty(StatusBarVM, 'ItemCount', 0, MetaData.None);
    static LastActionKey = MuralBase.RegisterProperty(StatusBarVM, 'LastAction', '—', MetaData.None);
    static AddItemCommandKey = MuralBase.RegisterProperty(StatusBarVM, 'AddItemCommand', undefined, MetaData.None);
    static RemoveItemCommandKey = MuralBase.RegisterProperty(StatusBarVM, 'RemoveItemCommand', undefined, MetaData.None);
    static SaveCommandKey = MuralBase.RegisterProperty(StatusBarVM, 'SaveCommand', undefined, MetaData.None);
    get StatusText() { return this.get_property_value(StatusBarVM.StatusTextKey); }
    set StatusText(v) { this.set_property_value(StatusBarVM.StatusTextKey, v); }
    get IsModified() { return this.get_property_value(StatusBarVM.IsModifiedKey); }
    set IsModified(v) { this.set_property_value(StatusBarVM.IsModifiedKey, v); }
    get ItemCount() { return this.get_property_value(StatusBarVM.ItemCountKey); }
    set ItemCount(v) { this.set_property_value(StatusBarVM.ItemCountKey, v); }
    get LastAction() { return this.get_property_value(StatusBarVM.LastActionKey); }
    set LastAction(v) { this.set_property_value(StatusBarVM.LastActionKey, v); }
    get AddItemCommand() { return this.get_property_value(StatusBarVM.AddItemCommandKey); }
    get RemoveItemCommand() { return this.get_property_value(StatusBarVM.RemoveItemCommandKey); }
    get SaveCommand() { return this.get_property_value(StatusBarVM.SaveCommandKey); }
    constructor() {
        super();
        // Three demo actions that mutate the status strip in different
        // ways so the user can see each cell react independently.
        const removeCmd = new RelayCommand(() => {
            this.ItemCount = Math.max(0, this.ItemCount - 1);
            this.IsModified = this.ItemCount > 0;
            this.StatusText = this.ItemCount === 0 ? 'Cleared' : 'Item removed';
            this.LastAction = 'Remove';
        }, 
        // Selection-gated: only when there's something to remove.
        () => this.ItemCount > 0);
        this.set_property_value(StatusBarVM.AddItemCommandKey, new RelayCommand(() => {
            this.ItemCount = this.ItemCount + 1;
            this.IsModified = true;
            this.StatusText = 'Item added';
            this.LastAction = 'Add';
        }));
        this.set_property_value(StatusBarVM.RemoveItemCommandKey, removeCmd);
        this.set_property_value(StatusBarVM.SaveCommandKey, new RelayCommand(() => {
            this.IsModified = false;
            this.StatusText = 'Saved';
            this.LastAction = 'Save';
        }));
        // Refresh Remove's CanExecute whenever the count changes so its
        // chrome dims / undims live.
        this.PropertyChanged(StatusBarVM.ItemCountKey).subscribe(() => {
            removeCmd.RaiseCanExecuteChanged();
        });
    }
}
