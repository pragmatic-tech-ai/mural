// FabMenuVM — backs the fab-menu demo. Tracks per-action click
// counts so the user can verify each mini-FAB in the popup fires
// through to a command target, and the FAB-toggle state for the
// read-out.
import {
    MuralBase,
    MetaData,
    RelayCommand,
    ObservableCollection,
    type Visual,
} from '@pragmatic-tech-ai/mural/runtime';

export class FabMenuVM extends MuralBase
{
    static IsOpenKey         = MuralBase.RegisterProperty<boolean>(FabMenuVM, 'IsOpen',         false, MetaData.None);
    static ItemsKey          = MuralBase.RegisterProperty<ObservableCollection<Visual> | null>(FabMenuVM, 'Items',          null,  MetaData.None);

    static CreateClicksKey   = MuralBase.RegisterProperty<number>(FabMenuVM, 'CreateClicks',   0, MetaData.None);
    static UploadClicksKey   = MuralBase.RegisterProperty<number>(FabMenuVM, 'UploadClicks',   0, MetaData.None);
    static ShareClicksKey    = MuralBase.RegisterProperty<number>(FabMenuVM, 'ShareClicks',    0, MetaData.None);

    static CreateCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(FabMenuVM, 'CreateCommand',  null, MetaData.None);
    static UploadCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(FabMenuVM, 'UploadCommand',  null, MetaData.None);
    static ShareCommandKey   = MuralBase.RegisterProperty<RelayCommand | null>(FabMenuVM, 'ShareCommand',   null, MetaData.None);

    get IsOpen():         boolean { return this.get_property_value(FabMenuVM.IsOpenKey); }
    set IsOpen(v:        boolean) { this.set_property_value(FabMenuVM.IsOpenKey, v); }
    get Items():          ObservableCollection<Visual> | null { return this.get_property_value(FabMenuVM.ItemsKey); }
    set Items(v:         ObservableCollection<Visual> | null) { this.set_property_value(FabMenuVM.ItemsKey, v); }

    get CreateClicks():   number { return this.get_property_value(FabMenuVM.CreateClicksKey); }
    set CreateClicks(v:  number) { this.set_property_value(FabMenuVM.CreateClicksKey, v); }
    get UploadClicks():   number { return this.get_property_value(FabMenuVM.UploadClicksKey); }
    set UploadClicks(v:  number) { this.set_property_value(FabMenuVM.UploadClicksKey, v); }
    get ShareClicks():    number { return this.get_property_value(FabMenuVM.ShareClicksKey); }
    set ShareClicks(v:   number) { this.set_property_value(FabMenuVM.ShareClicksKey, v); }

    get CreateCommand():  RelayCommand | null { return this.get_property_value(FabMenuVM.CreateCommandKey); }
    get UploadCommand():  RelayCommand | null { return this.get_property_value(FabMenuVM.UploadCommandKey); }
    get ShareCommand():   RelayCommand | null { return this.get_property_value(FabMenuVM.ShareCommandKey); }

    constructor()
    {
        super();
        this.set_property_value(FabMenuVM.CreateCommandKey,
            new RelayCommand(() => { this.CreateClicks += 1; this.IsOpen = false; }));
        this.set_property_value(FabMenuVM.UploadCommandKey,
            new RelayCommand(() => { this.UploadClicks += 1; this.IsOpen = false; }));
        this.set_property_value(FabMenuVM.ShareCommandKey,
            new RelayCommand(() => { this.ShareClicks  += 1; this.IsOpen = false; }));
    }
}
