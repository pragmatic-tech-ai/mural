// VM for the color-picker demo. Three independent hex string DPs the
// view binds to a ColorPicker each — surface, accent, ink. The .mu
// pipes those into preview swatches so the user can see the picked
// colour ride live.
import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime';

export class ColorPickerVM extends MuralBase
{
    static SurfaceHexKey = MuralBase.RegisterProperty<string>(ColorPickerVM, 'SurfaceHex', '#bbdefb',   MetaData.None);
    static AccentHexKey  = MuralBase.RegisterProperty<string>(ColorPickerVM, 'AccentHex',  '#ec407a',   MetaData.None);
    static InkHexKey     = MuralBase.RegisterProperty<string>(ColorPickerVM, 'InkHex',     '#0f172a',   MetaData.None);
    static OverlayHexKey = MuralBase.RegisterProperty<string>(ColorPickerVM, 'OverlayHex', '#ff9800a0', MetaData.None);

    get SurfaceHex():  string { return this.get_property_value(ColorPickerVM.SurfaceHexKey); }
    set SurfaceHex(v:  string) { this.set_property_value(ColorPickerVM.SurfaceHexKey, v); }
    get AccentHex():   string { return this.get_property_value(ColorPickerVM.AccentHexKey); }
    set AccentHex(v:   string) { this.set_property_value(ColorPickerVM.AccentHexKey, v); }
    get InkHex():      string { return this.get_property_value(ColorPickerVM.InkHexKey); }
    set InkHex(v:      string) { this.set_property_value(ColorPickerVM.InkHexKey, v); }
    get OverlayHex():  string { return this.get_property_value(ColorPickerVM.OverlayHexKey); }
    set OverlayHex(v:  string) { this.set_property_value(ColorPickerVM.OverlayHexKey, v); }
}
