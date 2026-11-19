import {
    MetaData,
    MuralBase,
} from '../../runtime/index.js';
import {
    type Brush,
    type Pen,
} from '../../visual-engine/index.js';
import { type DataTemplate } from '../../basic/templates/data-template.js';

// One row in a ShapeFormatControl cap combobox. Generic by design — the
// formatting layer knows nothing about connectors or the cap catalog; it
// just renders `Label` + a `Glyph` preview and round-trips the chosen
// `Template` through ShapeFormatControl's Source/TargetCapTemplate DPs.
//
// The consumer (e.g. the board layer's connectorCapOptions() helper)
// builds the list: a `Template` to apply (undefined = "None"), a `Glyph`
// path-data silhouette for the dropdown preview, and the glyph paint —
// `GlyphFill` for filled caps, `GlyphStroke` for open (stroked) caps.
//
// A MuralBase (not a plain object) so the combobox ItemTemplate's
// `$Label` / `$Glyph` / `$GlyphFill` / `$GlyphStroke` bindings resolve
// through the DP system.
export class CapOption extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        CapOption, 'Label', '', MetaData.None);
    public static readonly GlyphKey = MuralBase.RegisterProperty<string>(
        CapOption, 'Glyph', '', MetaData.None);
    public static readonly GlyphFillKey = MuralBase.RegisterProperty<Brush | undefined>(
        CapOption, 'GlyphFill', undefined, MetaData.None);
    public static readonly GlyphStrokeKey = MuralBase.RegisterProperty<Pen | undefined>(
        CapOption, 'GlyphStroke', undefined, MetaData.None);

    // Template is intentionally NOT a DP and may be a thunk. The display
    // fields above are DPs because the dropdown ItemTemplate binds them;
    // Template is read only in code (by ShapeFormatControl). Allowing a
    // resolver lets the consumer build the option list BEFORE the cap
    // catalog is registered (e.g. in a control ctor) and resolve the real
    // DataTemplate lazily on first read — the resolver returns the shared
    // catalog instance, so identity matching against a live cap still holds.
    private readonly _template: DataTemplate | undefined | (() => DataTemplate | undefined);

    constructor(config: {
        Label:        string;
        Glyph?:       string;
        GlyphFill?:   Brush | undefined;
        GlyphStroke?: Pen | undefined;
        Template?:    DataTemplate | undefined | (() => DataTemplate | undefined);
    })
    {
        super();
        this.set_property_value(CapOption.LabelKey,       config.Label);
        this.set_property_value(CapOption.GlyphKey,       config.Glyph ?? '');
        this.set_property_value(CapOption.GlyphFillKey,   config.GlyphFill);
        this.set_property_value(CapOption.GlyphStrokeKey, config.GlyphStroke);
        this._template = config.Template;
    }

    public get Label():       string            { return this.get_property_value(CapOption.LabelKey); }
    public get Glyph():       string            { return this.get_property_value(CapOption.GlyphKey); }
    public get GlyphFill():   Brush | undefined { return this.get_property_value(CapOption.GlyphFillKey); }
    public get GlyphStroke(): Pen | undefined   { return this.get_property_value(CapOption.GlyphStrokeKey); }
    public get Template():    DataTemplate | undefined
    {
        return typeof this._template === 'function' ? this._template() : this._template;
    }
}
