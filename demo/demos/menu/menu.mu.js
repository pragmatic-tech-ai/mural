import { MenuVM } from "./menu-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, Orientation, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { MenuButton } from "@pragmatic-tech-ai/mural/framework/surface.js";
import { DataContextBinding, DynamicResource, ResourceDictionary, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight, Pen } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_MenuDemo = Symbol("MenuDemo.ctor");
export class MenuDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_MenuDemo) {
            throw new Error("MenuDemo is private — use MenuDemo.Clone()");
        }
    }
    static Clone() {
        const t = new MenuDemo(_gate_MenuDemo);
        const _tmpl0 = new DataTemplate((_data) => {
            const _border1 = new Border();
            _border1.set_property_value(Border.FillKey, DynamicResource(_border1, "Surface"));
            _border1.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            const _dockPanel2 = new DockPanel();
            const _border3 = new Border();
            _border3.set_property_value(DockPanel.DockKey, Dock.Top);
            _border3.set_property_value(Border.FillKey, DynamicResource(_border3, "Primary"));
            _border3.set_property_value(Border.PaddingKey, new Thickness(16, 12, 16, 12));
            const _textBlock4 = new TextBlock();
            _textBlock4.set_property_value(TextBlock.TextKey, "MenuButton — hamburger fly-out with checkable items and gesture text.");
            _textBlock4.set_property_value(TextBlock.FontSizeKey, 15);
            _textBlock4.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock4.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock4, "OnPrimary"));
            _border3.SetChild(_textBlock4);
            _dockPanel2.AddChild(_border3);
            const _stackPanel5 = new StackPanel();
            _stackPanel5.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel5.set_property_value(StackPanel.MarginKey, new Thickness(16, 16, 16, 16));
            const _textBlock6 = new TextBlock();
            _textBlock6.set_property_value(TextBlock.TextKey, "Click the button to open the menu:");
            _textBlock6.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock6.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock6, "OnSurfaceVariant"));
            _textBlock6.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel5.AddChild(_textBlock6);
            const _menuButton7 = new MenuButton();
            _menuButton7.set_property_value(MenuButton.HeaderKey, "☰  File");
            _menuButton7.set_property_value(MenuButton.ItemsSourceKey, DataContextBinding(_menuButton7, "Roots"));
            _menuButton7.set_property_value(MenuButton.ItemTemplateKey, DynamicResource(_menuButton7, "CommandMenuItemTemplate"));
            _stackPanel5.AddChild(_menuButton7);
            const _textBlock8 = new TextBlock();
            _textBlock8.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock8, "Status"));
            _textBlock8.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock8.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock8, "OnSurface"));
            _textBlock8.set_property_value(TextBlock.MarginKey, new Thickness(0, 16, 0, 0));
            _stackPanel5.AddChild(_textBlock8);
            _dockPanel2.AddChild(_stackPanel5);
            _border1.SetChild(_dockPanel2);
            return _border1;
        }, MenuVM);
        t.Set(MenuVM, _tmpl0);
        return t;
    }
}
