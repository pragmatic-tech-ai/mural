import { TextFormatVM } from "./text-format-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, Line, Orientation, StackPanel, TextBlock, TextWrapping } from "@pragmatic-tech-ai/mural/basic";
import { ColorPicker, FontFamilyPicker, FontSizePicker } from "@pragmatic-tech-ai/mural/framework";
import { ToggleButton } from "@pragmatic-tech-ai/mural/framework/buttons/toggle-button.js";
import { DataContextBinding, DynamicResource, NameScope, ResourceDictionary, Thickness, VerticalAlignment } from "@pragmatic-tech-ai/mural/runtime";
import { FontStyle, FontWeight, Pen, TextDecorations } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_TextFormatDemo = Symbol("TextFormatDemo.ctor");
export class TextFormatDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_TextFormatDemo) {
            throw new Error("TextFormatDemo is private — use TextFormatDemo.Clone()");
        }
    }
    static Clone() {
        const t = new TextFormatDemo(_gate_TextFormatDemo);
        const _tmpl0 = new DataTemplate((_data) => {
            let _textBlock1;
            const _border2 = new Border();
            _border2.SetNameScope(new NameScope());
            _border2.set_property_value(Border.FillKey, DynamicResource(_border2, "Surface"));
            const _dockPanel3 = new DockPanel();
            const _border4 = new Border();
            _border4.set_property_value(DockPanel.DockKey, Dock.Top);
            _border4.set_property_value(Border.FillKey, DynamicResource(_border4, "Primary"));
            _border4.set_property_value(Border.PaddingKey, new Thickness(20, 14, 20, 14));
            const _stackPanel5 = new StackPanel();
            _stackPanel5.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock6 = new TextBlock();
            _textBlock6.set_property_value(TextBlock.TextKey, "Text format editors");
            _textBlock6.set_property_value(TextBlock.FontSizeKey, 18);
            _textBlock6.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock6.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock6, "OnPrimary"));
            _stackPanel5.AddChild(_textBlock6);
            const _textBlock7 = new TextBlock();
            _textBlock7.set_property_value(TextBlock.TextKey, "Font family, size, colour, and bold / italic / underline — each an editor bound to the sample paragraph below.");
            _textBlock7.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock7.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock7, "OnPrimary"));
            _textBlock7.set_property_value(TextBlock.MarginKey, new Thickness(0, 4, 0, 0));
            _stackPanel5.AddChild(_textBlock7);
            _border4.SetChild(_stackPanel5);
            _dockPanel3.AddChild(_border4);
            const _border8 = new Border();
            _border8.set_property_value(DockPanel.DockKey, Dock.Top);
            _border8.set_property_value(Border.FillKey, DynamicResource(_border8, "SurfaceContainerLow"));
            _border8.set_property_value(Border.PaddingKey, new Thickness(16, 10, 16, 10));
            const _stackPanel9 = new StackPanel();
            _stackPanel9.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            const _fontFamilyPicker10 = new FontFamilyPicker();
            _fontFamilyPicker10.set_property_value(FontFamilyPicker.TextKey, DataContextBinding(_fontFamilyPicker10, "Family"));
            _fontFamilyPicker10.set_property_value(FontFamilyPicker.WidthKey, 190);
            _stackPanel9.AddChild(_fontFamilyPicker10);
            const _fontSizePicker11 = new FontSizePicker();
            _fontSizePicker11.set_property_value(FontSizePicker.ValueKey, DataContextBinding(_fontSizePicker11, "FontSize"));
            _fontSizePicker11.set_property_value(FontSizePicker.WidthKey, 90);
            _fontSizePicker11.set_property_value(FontSizePicker.MarginKey, new Thickness(8, 0, 0, 0));
            _stackPanel9.AddChild(_fontSizePicker11);
            const _toggleButton12 = new ToggleButton();
            _toggleButton12.set_property_value(ToggleButton.IsCheckedKey, DataContextBinding(_toggleButton12, "Bold"));
            _toggleButton12.set_property_value(ToggleButton.MarginKey, new Thickness(16, 0, 0, 0));
            const _textBlock13 = new TextBlock();
            _textBlock13.set_property_value(TextBlock.TextKey, "B");
            _textBlock13.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock13.set_property_value(TextBlock.FontSizeKey, 15);
            _toggleButton12.Content = _textBlock13;
            _stackPanel9.AddChild(_toggleButton12);
            const _toggleButton14 = new ToggleButton();
            _toggleButton14.set_property_value(ToggleButton.IsCheckedKey, DataContextBinding(_toggleButton14, "Italic"));
            _toggleButton14.set_property_value(ToggleButton.MarginKey, new Thickness(4, 0, 0, 0));
            const _textBlock15 = new TextBlock();
            _textBlock15.set_property_value(TextBlock.TextKey, "I");
            _textBlock15.set_property_value(TextBlock.FontStyleKey, FontStyle.Italic);
            _textBlock15.set_property_value(TextBlock.FontSizeKey, 15);
            _toggleButton14.Content = _textBlock15;
            _stackPanel9.AddChild(_toggleButton14);
            const _toggleButton16 = new ToggleButton();
            _toggleButton16.set_property_value(ToggleButton.IsCheckedKey, DataContextBinding(_toggleButton16, "Underline"));
            _toggleButton16.set_property_value(ToggleButton.MarginKey, new Thickness(4, 0, 0, 0));
            const _textBlock17 = new TextBlock();
            _textBlock17.set_property_value(TextBlock.TextKey, "U");
            _textBlock17.set_property_value(TextBlock.TextDecorationsKey, TextDecorations.Underline);
            _textBlock17.set_property_value(TextBlock.FontSizeKey, 15);
            _toggleButton16.Content = _textBlock17;
            _stackPanel9.AddChild(_toggleButton16);
            const _colorPicker18 = new ColorPicker();
            _colorPicker18.set_property_value(ColorPicker.ColorHexKey, DataContextBinding(_colorPicker18, "ColorHex"));
            _colorPicker18.set_property_value(ColorPicker.MarginKey, new Thickness(16, 0, 0, 0));
            _colorPicker18.set_property_value(ColorPicker.VerticalAlignmentKey, VerticalAlignment.Center);
            _stackPanel9.AddChild(_colorPicker18);
            _border8.SetChild(_stackPanel9);
            _dockPanel3.AddChild(_border8);
            const _line19 = new Line();
            _line19.set_property_value(DockPanel.DockKey, Dock.Top);
            _line19.set_property_value(Line.OrientationKey, Orientation.Horizontal);
            _line19.set_property_value(Line.StrokeKey, new Pen(DynamicResource(_line19, "OutlineVariant"), 1));
            _dockPanel3.AddChild(_line19);
            const _border20 = new Border();
            _border20.set_property_value(Border.PaddingKey, new Thickness(28, 24, 28, 24));
            _textBlock1 = new TextBlock();
            _textBlock1.Name = "SamplePara";
            _textBlock1.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock1, "Sample"));
            _textBlock1.set_property_value(TextBlock.FontFamilyKey, DataContextBinding(_textBlock1, "Family"));
            _textBlock1.set_property_value(TextBlock.FontSizeKey, DataContextBinding(_textBlock1, "FontSize"));
            _textBlock1.set_property_value(TextBlock.TextWrappingKey, TextWrapping.Wrap);
            _textBlock1.set_property_value(TextBlock.VerticalAlignmentKey, VerticalAlignment.Top);
            _border20.SetChild(_textBlock1);
            _dockPanel3.AddChild(_border20);
            _border2.SetChild(_dockPanel3);
            return _border2;
        }, TextFormatVM);
        t.Set(TextFormatVM, _tmpl0);
        return t;
    }
}
