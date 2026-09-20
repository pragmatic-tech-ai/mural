import { MetaData, MuralBase, Element, Visual, type PropertyDescriptor } from '../../runtime/index.js';
import { TextBox } from '../../basic/text-box.js';
import { Border } from '../../basic/border.js';

// M3 SearchBar — text-field with a leading search icon and an optional
// trailing slot (typically a clear button, voice-input glyph, or
// filter chip).
//
// Extends TextBox so every text-editing semantic — Text DP, caret /
// selection model, keyboard handlers, font properties — rides for free.
// Only the chrome differs from a plain TextBox: the default template
// wraps the TextEditorSurface in a DockPanel with PART_LeadingSlot
// (anchored left) and PART_TrailingSlot (anchored right) borders that
// the class populates via the Leading / Trailing DPs.
//
// The leading icon's default — a magnifying-glass glyph — is NOT
// shipped as a default Leading value because the framework doesn't
// own a Material Symbols loader at runtime. Consumers provide the
// glyph (typically a TextBlock using Material Symbols Outlined) so
// the icon font dependency stays at the consumer's host page, not
// inside the control library.
export class SearchBar extends TextBox
{
    public static readonly LeadingKey = MuralBase.RegisterProperty<Visual | undefined>(
        SearchBar, 'Leading', undefined, MetaData.Render);
    public static readonly TrailingKey = MuralBase.RegisterProperty<Visual | undefined>(
        SearchBar, 'Trailing', undefined, MetaData.Render);

    public get Leading(): Visual | undefined { return this.get_property_value(SearchBar.LeadingKey); }
    public set Leading(v: Visual | undefined) { this.set_property_value(SearchBar.LeadingKey, v); }

    public get Trailing(): Visual | undefined { return this.get_property_value(SearchBar.TrailingKey); }
    public set Trailing(v: Visual | undefined) { this.set_property_value(SearchBar.TrailingKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            SearchBar, Element.DefaultStyleKeyKey,
            { default_value: SearchBar });
    }

    private _leadingSlot:  Border | undefined;
    private _trailingSlot: Border | undefined;

    constructor()
    {
        super();
        this.adoptSearchTemplateParts();
        this.syncSlots();
    }

    private adoptSearchTemplateParts(): void
    {
        this._leadingSlot  = this.GetTemplateChild('PART_LeadingSlot')  as Border | undefined;
        this._trailingSlot = this.GetTemplateChild('PART_TrailingSlot') as Border | undefined;
    }

    private syncSlots(): void
    {
        this._leadingSlot?.SetChild(this.Leading);
        this._trailingSlot?.SetChild(this.Trailing);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Template' && newValue !== oldValue)
        {
            this.adoptSearchTemplateParts();
            this.syncSlots();
            return;
        }
        if (descriptor.Owner === SearchBar)
        {
            if (descriptor.Name === 'Leading')
            {
                this._leadingSlot?.SetChild(newValue as Visual | undefined);
            }
            else if (descriptor.Name === 'Trailing')
            {
                this._trailingSlot?.SetChild(newValue as Visual | undefined);
            }
        }
    }
}
