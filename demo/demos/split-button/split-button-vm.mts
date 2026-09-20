// SplitButtonVM — backs the split-button demo. Exposes:
//   * SendCommand (primary action)
//   * SendCount   (click count for the primary action)
//   * MenuActionCommand + MenuActionTaken — fired by each menu-item
//     click in the dropdown
//   * IsOpen — bound to SplitButton.IsOpen for the readout
import {
    MuralBase,
    MetaData,
    RelayCommand,
    type Visual,
} from '@pragmatic-tech-ai/mural/runtime';

export class SplitButtonVM extends MuralBase
{
    static SendCountKey       = MuralBase.RegisterProperty<number>(SplitButtonVM, 'SendCount',       0,    MetaData.None);
    static MenuActionTakenKey = MuralBase.RegisterProperty<string>(SplitButtonVM, 'MenuActionTaken', '—',  MetaData.None);
    static IsOpenKey          = MuralBase.RegisterProperty<boolean>(SplitButtonVM, 'IsOpen',          false, MetaData.None);
    // The popup body. Built in the demo's .mjs entry point and
    // assigned here — the VM holds the reference but doesn't construct
    // the Visual (per the project's no-Visual-in-VM rule).
    static MenuPopupKey       = MuralBase.RegisterProperty<Visual | null>(SplitButtonVM, 'MenuPopup',       null, MetaData.None);

    static SendCommandKey         = MuralBase.RegisterProperty<RelayCommand | null>(SplitButtonVM, 'SendCommand',         null, MetaData.None);
    static SendNowCommandKey      = MuralBase.RegisterProperty<RelayCommand | null>(SplitButtonVM, 'SendNowCommand',      null, MetaData.None);
    static ScheduleSendCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(SplitButtonVM, 'ScheduleSendCommand', null, MetaData.None);
    static SaveDraftCommandKey    = MuralBase.RegisterProperty<RelayCommand | null>(SplitButtonVM, 'SaveDraftCommand',    null, MetaData.None);

    get SendCount():       number { return this.get_property_value(SplitButtonVM.SendCountKey); }
    set SendCount(v:      number) { this.set_property_value(SplitButtonVM.SendCountKey, v); }
    get MenuActionTaken(): string { return this.get_property_value(SplitButtonVM.MenuActionTakenKey); }
    set MenuActionTaken(v: string){ this.set_property_value(SplitButtonVM.MenuActionTakenKey, v); }
    get IsOpen():          boolean { return this.get_property_value(SplitButtonVM.IsOpenKey); }
    set IsOpen(v:         boolean) { this.set_property_value(SplitButtonVM.IsOpenKey, v); }
    get MenuPopup():       Visual | null { return this.get_property_value(SplitButtonVM.MenuPopupKey); }
    set MenuPopup(v:      Visual | null) { this.set_property_value(SplitButtonVM.MenuPopupKey, v); }

    get SendCommand():         RelayCommand | null { return this.get_property_value(SplitButtonVM.SendCommandKey); }
    get SendNowCommand():      RelayCommand | null { return this.get_property_value(SplitButtonVM.SendNowCommandKey); }
    get ScheduleSendCommand(): RelayCommand | null { return this.get_property_value(SplitButtonVM.ScheduleSendCommandKey); }
    get SaveDraftCommand():    RelayCommand | null { return this.get_property_value(SplitButtonVM.SaveDraftCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(SplitButtonVM.SendCommandKey,
            new RelayCommand(() => { this.SendCount += 1; }));
        this.set_property_value(SplitButtonVM.SendNowCommandKey,
            new RelayCommand(() => { this.MenuActionTaken = 'Send now';      this.IsOpen = false; }));
        this.set_property_value(SplitButtonVM.ScheduleSendCommandKey,
            new RelayCommand(() => { this.MenuActionTaken = 'Schedule send'; this.IsOpen = false; }));
        this.set_property_value(SplitButtonVM.SaveDraftCommandKey,
            new RelayCommand(() => { this.MenuActionTaken = 'Save draft';    this.IsOpen = false; }));
    }
}
