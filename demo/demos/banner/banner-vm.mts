// BannerVM — backs the banner demo. Dismissed is a reactive boolean the
// template binds to (collapsing the Banner when the action fires); the
// Dismiss / Restore RelayCommands the markup wires to the trailing action
// Button and a Restore button so the in-flow Banner can be shown again.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

export class BannerVM extends MuralBase
{
    static DismissedKey = MuralBase.RegisterProperty<boolean>(BannerVM, 'Dismissed', false, MetaData.None);
    static DismissKey   = MuralBase.RegisterProperty<RelayCommand | null>(BannerVM, 'Dismiss', null, MetaData.None);
    static RestoreKey    = MuralBase.RegisterProperty<RelayCommand | null>(BannerVM, 'Restore', null, MetaData.None);

    get Dismissed(): boolean { return this.get_property_value(BannerVM.DismissedKey); }
    set Dismissed(v: boolean) { this.set_property_value(BannerVM.DismissedKey, v); }
    get Dismiss():   RelayCommand | null { return this.get_property_value(BannerVM.DismissKey); }
    get Restore():   RelayCommand | null { return this.get_property_value(BannerVM.RestoreKey); }

    constructor()
    {
        super();
        this.set_property_value(BannerVM.DismissKey, new RelayCommand(() => { this.Dismissed = true; }));
        this.set_property_value(BannerVM.RestoreKey, new RelayCommand(() => { this.Dismissed = false; }));
    }
}
