import {
    MetaData,
    MuralBase,
} from '../../../runtime/index.js';
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/todl-runtime';

// A LIVE setting — a SettingDefinition (the schema) paired with the current,
// user-modifiable value. ApplicationSettings builds one per declared definition
// and holds them in a bindable collection; a settings pane is a data-driven
// ItemsControl over those, each row a `DataTemplate` keyed on `Kind` that binds
// $Value (a real DP, so TwoWay writeback works).
//
// `Value` is the ONLY mutable state; the definition is a fixed back-reference.
// The convenience getters (Key / Label / Kind) forward to the definition so a
// row template can bind them without a `Definition.` hop.
export class Setting extends MuralBase
{
    public static readonly ValueKey = MuralBase.RegisterProperty<unknown>(
        Setting, 'Value', undefined, MetaData.None);

    // The schema this value satisfies. A plain readonly field (identity, never
    // changes) — not a DP.
    public readonly Definition: SettingDefinition;

    constructor(definition: SettingDefinition, initialValue: unknown)
    {
        super();
        this.Definition = definition;
        this.set_property_value(Setting.ValueKey, initialValue);
    }

    public get Value(): unknown  { return this.get_property_value(Setting.ValueKey); }
    public set Value(v: unknown) { this.set_property_value(Setting.ValueKey, v); }

    public get Key():   string      { return this.Definition.Key; }
    public get Label():  string     { return this.Definition.Label; }
    public get Kind():  SettingKind { return this.Definition.Kind; }
}
