// BottomSheetVM — backs the bottom-sheet demo. BottomSheet ships no
// posture DP (its class doc leaves internal layout to the consumer), so
// the peek-vs-expanded posture is modelled here: Expanded is a reactive
// boolean and SheetHeight is the height the sheet's Height DP binds to.
// TogglePosture flips between the peek height and the expanded height so
// the sheet rises / settles live.
import { MuralBase, MetaData, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';

const PEEK_HEIGHT     = 96;
const EXPANDED_HEIGHT = 320;

export class BottomSheetVM extends MuralBase
{
    static ExpandedKey       = MuralBase.RegisterProperty<boolean>(BottomSheetVM, 'Expanded',   false,       MetaData.None);
    static SheetHeightKey    = MuralBase.RegisterProperty<number>(BottomSheetVM,  'SheetHeight', PEEK_HEIGHT, MetaData.None);
    static PostureLabelKey   = MuralBase.RegisterProperty<string>(BottomSheetVM,  'PostureLabel', 'Peek',     MetaData.None);
    static TogglePostureKey  = MuralBase.RegisterProperty<RelayCommand | null>(BottomSheetVM, 'TogglePosture', null, MetaData.None);

    get Expanded():     boolean { return this.get_property_value(BottomSheetVM.ExpandedKey); }
    set Expanded(v:     boolean) { this.set_property_value(BottomSheetVM.ExpandedKey, v); }
    get SheetHeight():  number { return this.get_property_value(BottomSheetVM.SheetHeightKey); }
    set SheetHeight(v:  number) { this.set_property_value(BottomSheetVM.SheetHeightKey, v); }
    get PostureLabel(): string { return this.get_property_value(BottomSheetVM.PostureLabelKey); }
    set PostureLabel(v: string) { this.set_property_value(BottomSheetVM.PostureLabelKey, v); }
    get TogglePosture(): RelayCommand | null { return this.get_property_value(BottomSheetVM.TogglePostureKey); }

    constructor()
    {
        super();
        this.set_property_value(BottomSheetVM.TogglePostureKey, new RelayCommand(() => {
            this.Expanded     = !this.Expanded;
            this.SheetHeight  = this.Expanded ? EXPANDED_HEIGHT : PEEK_HEIGHT;
            this.PostureLabel = this.Expanded ? 'Expanded' : 'Peek';
        }));
    }
}
