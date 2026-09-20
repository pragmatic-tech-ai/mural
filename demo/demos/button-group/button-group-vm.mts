// ButtonGroupVM — backs the button-group demo. Tracks click counts
// for each action button so the hover-expand interaction can be
// verified end-to-end (hover widens, click increments).
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

export class ButtonGroupVM extends MuralBase
{
    static UndoClicksKey   = MuralBase.RegisterProperty<number>(ButtonGroupVM, 'UndoClicks',   0, MetaData.None);
    static RedoClicksKey   = MuralBase.RegisterProperty<number>(ButtonGroupVM, 'RedoClicks',   0, MetaData.None);
    static CutClicksKey    = MuralBase.RegisterProperty<number>(ButtonGroupVM, 'CutClicks',    0, MetaData.None);
    static CopyClicksKey   = MuralBase.RegisterProperty<number>(ButtonGroupVM, 'CopyClicks',   0, MetaData.None);
    static PasteClicksKey  = MuralBase.RegisterProperty<number>(ButtonGroupVM, 'PasteClicks',  0, MetaData.None);

    static UndoCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(ButtonGroupVM, 'UndoCommand',  null, MetaData.None);
    static RedoCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(ButtonGroupVM, 'RedoCommand',  null, MetaData.None);
    static CutCommandKey   = MuralBase.RegisterProperty<RelayCommand | null>(ButtonGroupVM, 'CutCommand',   null, MetaData.None);
    static CopyCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(ButtonGroupVM, 'CopyCommand',  null, MetaData.None);
    static PasteCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(ButtonGroupVM, 'PasteCommand', null, MetaData.None);

    get UndoClicks():  number { return this.get_property_value(ButtonGroupVM.UndoClicksKey); }
    set UndoClicks(v:  number) { this.set_property_value(ButtonGroupVM.UndoClicksKey, v); }
    get RedoClicks():  number { return this.get_property_value(ButtonGroupVM.RedoClicksKey); }
    set RedoClicks(v:  number) { this.set_property_value(ButtonGroupVM.RedoClicksKey, v); }
    get CutClicks():   number { return this.get_property_value(ButtonGroupVM.CutClicksKey); }
    set CutClicks(v:   number) { this.set_property_value(ButtonGroupVM.CutClicksKey, v); }
    get CopyClicks():  number { return this.get_property_value(ButtonGroupVM.CopyClicksKey); }
    set CopyClicks(v:  number) { this.set_property_value(ButtonGroupVM.CopyClicksKey, v); }
    get PasteClicks(): number { return this.get_property_value(ButtonGroupVM.PasteClicksKey); }
    set PasteClicks(v: number){ this.set_property_value(ButtonGroupVM.PasteClicksKey, v); }

    get UndoCommand():  RelayCommand | null { return this.get_property_value(ButtonGroupVM.UndoCommandKey); }
    get RedoCommand():  RelayCommand | null { return this.get_property_value(ButtonGroupVM.RedoCommandKey); }
    get CutCommand():   RelayCommand | null { return this.get_property_value(ButtonGroupVM.CutCommandKey); }
    get CopyCommand():  RelayCommand | null { return this.get_property_value(ButtonGroupVM.CopyCommandKey); }
    get PasteCommand(): RelayCommand | null { return this.get_property_value(ButtonGroupVM.PasteCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(ButtonGroupVM.UndoCommandKey,  new RelayCommand(() => { this.UndoClicks  += 1; }));
        this.set_property_value(ButtonGroupVM.RedoCommandKey,  new RelayCommand(() => { this.RedoClicks  += 1; }));
        this.set_property_value(ButtonGroupVM.CutCommandKey,   new RelayCommand(() => { this.CutClicks   += 1; }));
        this.set_property_value(ButtonGroupVM.CopyCommandKey,  new RelayCommand(() => { this.CopyClicks  += 1; }));
        this.set_property_value(ButtonGroupVM.PasteCommandKey, new RelayCommand(() => { this.PasteClicks += 1; }));
    }
}
