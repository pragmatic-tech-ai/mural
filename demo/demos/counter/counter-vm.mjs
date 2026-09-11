// CounterVM — the model the counter demo binds against. The .mu file
// (counter.mu) declares a DataTemplate parameterized by this type;
// ContentControl auto-resolves the template by matching
// CounterVM.constructor.name against the template's DataType.
import { MetaData, MuralBase, RelayCommand } from '@pragmatic-tech-ai/mural/runtime';
export class CounterVM extends MuralBase {
    static CountKey = MuralBase.RegisterProperty(CounterVM, 'Count', 0, MetaData.None);
    static StepKey = MuralBase.RegisterProperty(CounterVM, 'Step', 1, MetaData.None);
    static StepsKey = MuralBase.RegisterProperty(CounterVM, 'Steps', undefined, MetaData.None);
    static IncrementKey = MuralBase.RegisterProperty(CounterVM, 'Increment', undefined, MetaData.None);
    static ResetKey = MuralBase.RegisterProperty(CounterVM, 'Reset', undefined, MetaData.None);
    get Count() { return this.get_property_value(CounterVM.CountKey); }
    set Count(v) { this.set_property_value(CounterVM.CountKey, v); }
    get Step() { return this.get_property_value(CounterVM.StepKey); }
    set Step(v) { this.set_property_value(CounterVM.StepKey, v); }
    get Steps() { return this.get_property_value(CounterVM.StepsKey); }
    get Increment() { return this.get_property_value(CounterVM.IncrementKey); }
    get Reset() { return this.get_property_value(CounterVM.ResetKey); }
    constructor() {
        super();
        this.set_property_value(CounterVM.StepsKey, Object.freeze([1, 2, 5]));
        const inc = new RelayCommand(() => { this.Count = Math.min(10, this.Count + this.Step); }, () => this.Count < 10);
        this.set_property_value(CounterVM.IncrementKey, inc);
        this.set_property_value(CounterVM.ResetKey, new RelayCommand(() => { this.Count = 0; }));
        this.PropertyChanged(CounterVM.CountKey).subscribe(() => {
            inc.RaiseCanExecuteChanged();
        });
    }
}
