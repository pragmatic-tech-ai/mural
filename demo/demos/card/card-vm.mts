// CardVM — backs the card demo. One RelayCommand per variant button so
// the dynamic-binding chain is visible end-to-end and the cards' action
// row has a real handler attached.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

export class CardVM extends MuralBase
{
    static FilledActionsKey   = MuralBase.RegisterProperty<number>(CardVM, 'FilledActions',   0, MetaData.None);
    static ElevatedActionsKey = MuralBase.RegisterProperty<number>(CardVM, 'ElevatedActions', 0, MetaData.None);
    static OutlinedActionsKey = MuralBase.RegisterProperty<number>(CardVM, 'OutlinedActions', 0, MetaData.None);

    static FilledActionCommandKey   = MuralBase.RegisterProperty<RelayCommand | null>(CardVM, 'FilledActionCommand',   null, MetaData.None);
    static ElevatedActionCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(CardVM, 'ElevatedActionCommand', null, MetaData.None);
    static OutlinedActionCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(CardVM, 'OutlinedActionCommand', null, MetaData.None);

    get FilledActions():    number { return this.get_property_value(CardVM.FilledActionsKey); }
    set FilledActions(v:    number) { this.set_property_value(CardVM.FilledActionsKey, v); }
    get ElevatedActions():  number { return this.get_property_value(CardVM.ElevatedActionsKey); }
    set ElevatedActions(v:  number) { this.set_property_value(CardVM.ElevatedActionsKey, v); }
    get OutlinedActions():  number { return this.get_property_value(CardVM.OutlinedActionsKey); }
    set OutlinedActions(v:  number) { this.set_property_value(CardVM.OutlinedActionsKey, v); }

    get FilledActionCommand():   RelayCommand | null { return this.get_property_value(CardVM.FilledActionCommandKey); }
    get ElevatedActionCommand(): RelayCommand | null { return this.get_property_value(CardVM.ElevatedActionCommandKey); }
    get OutlinedActionCommand(): RelayCommand | null { return this.get_property_value(CardVM.OutlinedActionCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(CardVM.FilledActionCommandKey,   new RelayCommand(() => { this.FilledActions   += 1; }));
        this.set_property_value(CardVM.ElevatedActionCommandKey, new RelayCommand(() => { this.ElevatedActions += 1; }));
        this.set_property_value(CardVM.OutlinedActionCommandKey, new RelayCommand(() => { this.OutlinedActions += 1; }));
    }
}
