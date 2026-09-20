// FabVM — backs the FAB demo. One click counter per Size variant + per
// Extended slot so the dynamic-binding chain is visible end-to-end. No
// IsChecked story because FAB is monomorphic on container colour and
// doesn't ship a toggle variant.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

export class FabVM extends MuralBase
{
    static SmallClicksKey    = MuralBase.RegisterProperty<number>(FabVM, 'SmallClicks',    0, MetaData.None);
    static DefaultClicksKey  = MuralBase.RegisterProperty<number>(FabVM, 'DefaultClicks',  0, MetaData.None);
    static LargeClicksKey    = MuralBase.RegisterProperty<number>(FabVM, 'LargeClicks',    0, MetaData.None);
    static ExtendedClicksKey = MuralBase.RegisterProperty<number>(FabVM, 'ExtendedClicks', 0, MetaData.None);
    static ComposeClicksKey  = MuralBase.RegisterProperty<number>(FabVM, 'ComposeClicks',  0, MetaData.None);

    static ClickSmallCommandKey    = MuralBase.RegisterProperty<RelayCommand | null>(FabVM, 'ClickSmallCommand',    null, MetaData.None);
    static ClickDefaultCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(FabVM, 'ClickDefaultCommand',  null, MetaData.None);
    static ClickLargeCommandKey    = MuralBase.RegisterProperty<RelayCommand | null>(FabVM, 'ClickLargeCommand',    null, MetaData.None);
    static ClickExtendedCommandKey = MuralBase.RegisterProperty<RelayCommand | null>(FabVM, 'ClickExtendedCommand', null, MetaData.None);
    static ClickComposeCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(FabVM, 'ClickComposeCommand',  null, MetaData.None);

    get SmallClicks():    number { return this.get_property_value(FabVM.SmallClicksKey); }
    set SmallClicks(v:    number) { this.set_property_value(FabVM.SmallClicksKey, v); }
    get DefaultClicks():  number { return this.get_property_value(FabVM.DefaultClicksKey); }
    set DefaultClicks(v:  number) { this.set_property_value(FabVM.DefaultClicksKey, v); }
    get LargeClicks():    number { return this.get_property_value(FabVM.LargeClicksKey); }
    set LargeClicks(v:    number) { this.set_property_value(FabVM.LargeClicksKey, v); }
    get ExtendedClicks(): number { return this.get_property_value(FabVM.ExtendedClicksKey); }
    set ExtendedClicks(v: number){ this.set_property_value(FabVM.ExtendedClicksKey, v); }
    get ComposeClicks():  number { return this.get_property_value(FabVM.ComposeClicksKey); }
    set ComposeClicks(v:  number) { this.set_property_value(FabVM.ComposeClicksKey, v); }

    get ClickSmallCommand():    RelayCommand | null { return this.get_property_value(FabVM.ClickSmallCommandKey); }
    get ClickDefaultCommand():  RelayCommand | null { return this.get_property_value(FabVM.ClickDefaultCommandKey); }
    get ClickLargeCommand():    RelayCommand | null { return this.get_property_value(FabVM.ClickLargeCommandKey); }
    get ClickExtendedCommand(): RelayCommand | null { return this.get_property_value(FabVM.ClickExtendedCommandKey); }
    get ClickComposeCommand():  RelayCommand | null { return this.get_property_value(FabVM.ClickComposeCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(FabVM.ClickSmallCommandKey,    new RelayCommand(() => { this.SmallClicks    += 1; }));
        this.set_property_value(FabVM.ClickDefaultCommandKey,  new RelayCommand(() => { this.DefaultClicks  += 1; }));
        this.set_property_value(FabVM.ClickLargeCommandKey,    new RelayCommand(() => { this.LargeClicks    += 1; }));
        this.set_property_value(FabVM.ClickExtendedCommandKey, new RelayCommand(() => { this.ExtendedClicks += 1; }));
        this.set_property_value(FabVM.ClickComposeCommandKey,  new RelayCommand(() => { this.ComposeClicks  += 1; }));
    }
}
