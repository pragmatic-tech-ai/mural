// IconButtonVM — backs the icon-button demo. Tracks how many times each
// icon variant has been clicked and the checked state of the four
// IconButtonToggle variants so the UI can show a live tally + reflect
// the toggle state back into the chrome.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

export class IconButtonVM extends MuralBase
{
    static FilledClicksKey   = MuralBase.RegisterProperty<number>(IconButtonVM, 'FilledClicks',   0,     MetaData.None);
    static TonalClicksKey    = MuralBase.RegisterProperty<number>(IconButtonVM, 'TonalClicks',    0,     MetaData.None);
    static OutlinedClicksKey = MuralBase.RegisterProperty<number>(IconButtonVM, 'OutlinedClicks', 0,     MetaData.None);
    static StandardClicksKey = MuralBase.RegisterProperty<number>(IconButtonVM, 'StandardClicks', 0,     MetaData.None);

    static FilledCheckedKey   = MuralBase.RegisterProperty<boolean>(IconButtonVM, 'FilledChecked',   false, MetaData.None);
    static TonalCheckedKey    = MuralBase.RegisterProperty<boolean>(IconButtonVM, 'TonalChecked',    false, MetaData.None);
    static OutlinedCheckedKey = MuralBase.RegisterProperty<boolean>(IconButtonVM, 'OutlinedChecked', false, MetaData.None);
    static StandardCheckedKey = MuralBase.RegisterProperty<boolean>(IconButtonVM, 'StandardChecked', false, MetaData.None);

    static ClickFilledCommandKey   = MuralBase.RegisterProperty<RelayCommand | null>(IconButtonVM, 'ClickFilledCommand',   null, MetaData.None);
    static ClickTonalCommandKey    = MuralBase.RegisterProperty<RelayCommand | null>(IconButtonVM, 'ClickTonalCommand',    null, MetaData.None);
    static ClickOutlinedCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(IconButtonVM, 'ClickOutlinedCommand', null, MetaData.None);
    static ClickStandardCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(IconButtonVM, 'ClickStandardCommand', null, MetaData.None);

    get FilledClicks():   number { return this.get_property_value(IconButtonVM.FilledClicksKey); }
    set FilledClicks(v:  number) { this.set_property_value(IconButtonVM.FilledClicksKey, v); }
    get TonalClicks():    number { return this.get_property_value(IconButtonVM.TonalClicksKey); }
    set TonalClicks(v:   number) { this.set_property_value(IconButtonVM.TonalClicksKey, v); }
    get OutlinedClicks(): number { return this.get_property_value(IconButtonVM.OutlinedClicksKey); }
    set OutlinedClicks(v: number){ this.set_property_value(IconButtonVM.OutlinedClicksKey, v); }
    get StandardClicks(): number { return this.get_property_value(IconButtonVM.StandardClicksKey); }
    set StandardClicks(v: number){ this.set_property_value(IconButtonVM.StandardClicksKey, v); }

    get FilledChecked():    boolean { return this.get_property_value(IconButtonVM.FilledCheckedKey); }
    set FilledChecked(v:   boolean) { this.set_property_value(IconButtonVM.FilledCheckedKey, v); }
    get TonalChecked():     boolean { return this.get_property_value(IconButtonVM.TonalCheckedKey); }
    set TonalChecked(v:    boolean) { this.set_property_value(IconButtonVM.TonalCheckedKey, v); }
    get OutlinedChecked():  boolean { return this.get_property_value(IconButtonVM.OutlinedCheckedKey); }
    set OutlinedChecked(v: boolean) { this.set_property_value(IconButtonVM.OutlinedCheckedKey, v); }
    get StandardChecked():  boolean { return this.get_property_value(IconButtonVM.StandardCheckedKey); }
    set StandardChecked(v: boolean) { this.set_property_value(IconButtonVM.StandardCheckedKey, v); }

    get ClickFilledCommand():   RelayCommand | null { return this.get_property_value(IconButtonVM.ClickFilledCommandKey); }
    get ClickTonalCommand():    RelayCommand | null { return this.get_property_value(IconButtonVM.ClickTonalCommandKey); }
    get ClickOutlinedCommand(): RelayCommand | null { return this.get_property_value(IconButtonVM.ClickOutlinedCommandKey); }
    get ClickStandardCommand(): RelayCommand | null { return this.get_property_value(IconButtonVM.ClickStandardCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(IconButtonVM.ClickFilledCommandKey,   new RelayCommand(() => { this.FilledClicks   += 1; }));
        this.set_property_value(IconButtonVM.ClickTonalCommandKey,    new RelayCommand(() => { this.TonalClicks    += 1; }));
        this.set_property_value(IconButtonVM.ClickOutlinedCommandKey, new RelayCommand(() => { this.OutlinedClicks += 1; }));
        this.set_property_value(IconButtonVM.ClickStandardCommandKey, new RelayCommand(() => { this.StandardClicks += 1; }));
    }
}
