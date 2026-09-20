// VM for the text-format demo. Holds the character-format state as pure
// runtime primitives — a family name (string), a point size (number),
// three garniture toggles (bool), and a colour hex (string). No
// visual-engine types here: the FontWeight / FontStyle / TextDecorations
// enums and the Foreground Brush live in the view layer, so the bootstrap
// behaviour maps these primitives onto the sample paragraph. The editors
// bind two-way to these DPs; the paragraph binds Family / FontSize
// directly and gets weight / style / underline / colour from the bridge.
import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import type { Visual } from '@pragmatic-tech-ai/mural/runtime';

export class TextFormatVM extends MuralBase
{
    static FamilyKey    = MuralBase.RegisterProperty<string>( TextFormatVM, 'Family',    'Georgia',      MetaData.None);
    static FontSizeKey  = MuralBase.RegisterProperty<number>( TextFormatVM, 'FontSize',  20,             MetaData.None);
    static BoldKey      = MuralBase.RegisterProperty<boolean>(TextFormatVM, 'Bold',      false,          MetaData.None);
    static ItalicKey    = MuralBase.RegisterProperty<boolean>(TextFormatVM, 'Italic',    false,          MetaData.None);
    static UnderlineKey = MuralBase.RegisterProperty<boolean>(TextFormatVM, 'Underline', false,          MetaData.None);
    static ColorHexKey  = MuralBase.RegisterProperty<string>( TextFormatVM, 'ColorHex',  '#1d4ed8',      MetaData.None);
    static SampleKey    = MuralBase.RegisterProperty<string>( TextFormatVM, 'Sample',
        'The quick brown fox jumps over the lazy dog.', MetaData.None);

    get Family():    string  { return this.get_property_value(TextFormatVM.FamilyKey); }
    set Family(v:    string)  { this.set_property_value(TextFormatVM.FamilyKey, v); }
    get FontSize():  number  { return this.get_property_value(TextFormatVM.FontSizeKey); }
    set FontSize(v:  number)  { this.set_property_value(TextFormatVM.FontSizeKey, v); }
    get Bold():      boolean { return this.get_property_value(TextFormatVM.BoldKey); }
    set Bold(v:      boolean) { this.set_property_value(TextFormatVM.BoldKey, v); }
    get Italic():    boolean { return this.get_property_value(TextFormatVM.ItalicKey); }
    set Italic(v:    boolean) { this.set_property_value(TextFormatVM.ItalicKey, v); }
    get Underline(): boolean { return this.get_property_value(TextFormatVM.UnderlineKey); }
    set Underline(v: boolean) { this.set_property_value(TextFormatVM.UnderlineKey, v); }
    get ColorHex():  string  { return this.get_property_value(TextFormatVM.ColorHexKey); }
    set ColorHex(v:  string)  { this.set_property_value(TextFormatVM.ColorHexKey, v); }
    get Sample():    string  { return this.get_property_value(TextFormatVM.SampleKey); }
    set Sample(v:    string)  { this.set_property_value(TextFormatVM.SampleKey, v); }

    /** Set by the bootstrap; the platform calls it after the view
     *  materializes so the format bridge can attach to the paragraph. */
    OnViewMounted?: (view: Visual) => void;
}
