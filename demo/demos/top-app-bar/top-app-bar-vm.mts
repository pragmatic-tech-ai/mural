// TopAppBarVM — backs the top-app-bar demo. One Variant DP that toggles
// among the four M3 variants + a click counter for the nav icon and
// each action button so the dynamic-binding chain is visible.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';
import { TopAppBarVariant }              from '@pragmatic-tech-ai/mural/framework';

export class TopAppBarVM extends MuralBase
{
    static NavClicksKey      = MuralBase.RegisterProperty<number>(TopAppBarVM, 'NavClicks',      0, MetaData.None);
    static SearchClicksKey   = MuralBase.RegisterProperty<number>(TopAppBarVM, 'SearchClicks',   0, MetaData.None);
    static MoreClicksKey     = MuralBase.RegisterProperty<number>(TopAppBarVM, 'MoreClicks',     0, MetaData.None);

    static NavCommandKey     = MuralBase.RegisterProperty<RelayCommand | null>(TopAppBarVM, 'NavCommand',     null, MetaData.None);
    static SearchCommandKey  = MuralBase.RegisterProperty<RelayCommand | null>(TopAppBarVM, 'SearchCommand',  null, MetaData.None);
    static MoreCommandKey    = MuralBase.RegisterProperty<RelayCommand | null>(TopAppBarVM, 'MoreCommand',    null, MetaData.None);

    // Exposed so each preview row can pull a label corresponding to its
    // own Variant. Strings instead of an enum so the demo template
    // doesn't need to import TopAppBarVariant.
    static SmallVariantKey         = MuralBase.RegisterProperty<TopAppBarVariant>(TopAppBarVM, 'SmallVariant',         TopAppBarVariant.Small,         MetaData.None);
    static CenterAlignedVariantKey = MuralBase.RegisterProperty<TopAppBarVariant>(TopAppBarVM, 'CenterAlignedVariant', TopAppBarVariant.CenterAligned, MetaData.None);
    static MediumVariantKey        = MuralBase.RegisterProperty<TopAppBarVariant>(TopAppBarVM, 'MediumVariant',        TopAppBarVariant.Medium,        MetaData.None);
    static LargeVariantKey         = MuralBase.RegisterProperty<TopAppBarVariant>(TopAppBarVM, 'LargeVariant',         TopAppBarVariant.Large,         MetaData.None);

    get NavClicks():      number  { return this.get_property_value(TopAppBarVM.NavClicksKey); }
    set NavClicks(v:      number) { this.set_property_value(TopAppBarVM.NavClicksKey, v); }
    get SearchClicks():   number  { return this.get_property_value(TopAppBarVM.SearchClicksKey); }
    set SearchClicks(v:   number) { this.set_property_value(TopAppBarVM.SearchClicksKey, v); }
    get MoreClicks():     number  { return this.get_property_value(TopAppBarVM.MoreClicksKey); }
    set MoreClicks(v:     number) { this.set_property_value(TopAppBarVM.MoreClicksKey, v); }

    get NavCommand():     RelayCommand | null { return this.get_property_value(TopAppBarVM.NavCommandKey); }
    get SearchCommand():  RelayCommand | null { return this.get_property_value(TopAppBarVM.SearchCommandKey); }
    get MoreCommand():    RelayCommand | null { return this.get_property_value(TopAppBarVM.MoreCommandKey); }

    get SmallVariant():         TopAppBarVariant { return this.get_property_value(TopAppBarVM.SmallVariantKey); }
    get CenterAlignedVariant(): TopAppBarVariant { return this.get_property_value(TopAppBarVM.CenterAlignedVariantKey); }
    get MediumVariant():        TopAppBarVariant { return this.get_property_value(TopAppBarVM.MediumVariantKey); }
    get LargeVariant():         TopAppBarVariant { return this.get_property_value(TopAppBarVM.LargeVariantKey); }

    constructor()
    {
        super();
        this.set_property_value(TopAppBarVM.NavCommandKey,    new RelayCommand(() => { this.NavClicks    += 1; }));
        this.set_property_value(TopAppBarVM.SearchCommandKey, new RelayCommand(() => { this.SearchClicks += 1; }));
        this.set_property_value(TopAppBarVM.MoreCommandKey,   new RelayCommand(() => { this.MoreClicks   += 1; }));
    }
}
