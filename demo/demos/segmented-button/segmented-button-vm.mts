// SegmentedButtonVM — backs the segmented-button demo. Two scenarios:
//
//   * Single-select timeframe picker (Day / Week / Month / Year). The
//     selected segment binds to SelectedTimeframe.
//   * Multi-select formatter toggles (Bold / Italic / Underline). Each
//     toggle's IsSelected mirrors the matching VM DP.
//
// Each readout below the row shows the live VM state so the bind chain
// is visible.
import { MuralBase, MetaData, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime';

export class SegmentedButtonVM extends MuralBase
{
    static TimeframesKey        = MuralBase.RegisterProperty<ObservableCollection<string> | undefined>(SegmentedButtonVM, 'Timeframes',        undefined, MetaData.None);
    static SelectedTimeframeKey = MuralBase.RegisterProperty<string | undefined>(SegmentedButtonVM, 'SelectedTimeframe', undefined, MetaData.None);

    static FormatChoicesKey     = MuralBase.RegisterProperty<ObservableCollection<string> | undefined>(SegmentedButtonVM, 'FormatChoices',     undefined, MetaData.None);
    static SelectedFormatsKey   = MuralBase.RegisterProperty<ObservableCollection<string> | undefined>(SegmentedButtonVM, 'SelectedFormats',   undefined, MetaData.None);

    static SelectedFormatsLabelKey = MuralBase.RegisterProperty<string>(SegmentedButtonVM, 'SelectedFormatsLabel', '', MetaData.None);

    get Timeframes():             ObservableCollection<string> | undefined { return this.get_property_value(SegmentedButtonVM.TimeframesKey); }
    set Timeframes(v:            ObservableCollection<string> | undefined) { this.set_property_value(SegmentedButtonVM.TimeframesKey, v); }
    get SelectedTimeframe():      string | undefined { return this.get_property_value(SegmentedButtonVM.SelectedTimeframeKey); }
    set SelectedTimeframe(v:     string | undefined) { this.set_property_value(SegmentedButtonVM.SelectedTimeframeKey, v); }

    get FormatChoices():          ObservableCollection<string> | undefined { return this.get_property_value(SegmentedButtonVM.FormatChoicesKey); }
    set FormatChoices(v:         ObservableCollection<string> | undefined) { this.set_property_value(SegmentedButtonVM.FormatChoicesKey, v); }
    get SelectedFormats():        ObservableCollection<string> | undefined { return this.get_property_value(SegmentedButtonVM.SelectedFormatsKey); }
    set SelectedFormats(v:       ObservableCollection<string> | undefined) { this.set_property_value(SegmentedButtonVM.SelectedFormatsKey, v); }

    get SelectedFormatsLabel():   string { return this.get_property_value(SegmentedButtonVM.SelectedFormatsLabelKey); }
    set SelectedFormatsLabel(v:  string) { this.set_property_value(SegmentedButtonVM.SelectedFormatsLabelKey, v); }

    constructor()
    {
        super();
        this.Timeframes = new ObservableCollection(['Day', 'Week', 'Month', 'Year']);
        this.SelectedTimeframe = 'Week';

        this.FormatChoices = new ObservableCollection(['B', 'I', 'U', 'S']);
        this.SelectedFormats = new ObservableCollection(['B']);

        this._refreshFormatsLabel();
        // Re-derive the readout whenever the SelectedFormats collection
        // changes. ObservableCollection.Subscribe fires on every mutation.
        this.SelectedFormats.Subscribe(() => this._refreshFormatsLabel());
    }

    _refreshFormatsLabel(): void
    {
        const items = this.SelectedFormats;
        if (items === undefined || items.Count === 0)
        {
            this.SelectedFormatsLabel = '(none)';
            return;
        }
        const buf: (string | undefined)[] = [];
        for (let i = 0; i < items.Count; i++) buf.push(items.Get(i));
        this.SelectedFormatsLabel = buf.join(', ');
    }
}
