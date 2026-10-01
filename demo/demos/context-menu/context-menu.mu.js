import { ContextMenuVM } from "./context-menu-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, Orientation, StackPanel, TextAlignment, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { Color, DataContextBinding, DynamicResource, HorizontalAlignment, ResourceDictionary, Thickness, VerticalAlignment } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight, Pen, SolidColorBrush } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_ContextMenuDemo = Symbol("ContextMenuDemo.ctor");
export class ContextMenuDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_ContextMenuDemo) {
            throw new Error("ContextMenuDemo is private — use ContextMenuDemo.Clone()");
        }
    }
    static Clone() {
        const t = new ContextMenuDemo(_gate_ContextMenuDemo);
        const _tmpl0 = new DataTemplate((_data) => {
            let _border1, _border2, _border3;
            const _border4 = new Border();
            _border4.set_property_value(Border.FillKey, DynamicResource(_border4, "Surface"));
            _border4.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            const _dockPanel5 = new DockPanel();
            const _border6 = new Border();
            _border6.set_property_value(DockPanel.DockKey, Dock.Top);
            _border6.set_property_value(Border.FillKey, DynamicResource(_border6, "Primary"));
            _border6.set_property_value(Border.PaddingKey, new Thickness(16, 12, 16, 12));
            const _textBlock7 = new TextBlock();
            _textBlock7.set_property_value(TextBlock.TextKey, "ContextMenu — right-click a panel to open its menu at the cursor. Each shows different features: icons, shortcuts, submenus, checkables.");
            _textBlock7.set_property_value(TextBlock.FontSizeKey, 15);
            _textBlock7.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock7.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock7, "OnPrimary"));
            _border6.SetChild(_textBlock7);
            _dockPanel5.AddChild(_border6);
            const _stackPanel8 = new StackPanel();
            _stackPanel8.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel8.set_property_value(StackPanel.MarginKey, new Thickness(16, 16, 16, 16));
            const _stackPanel9 = new StackPanel();
            _stackPanel9.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            _stackPanel9.set_property_value(StackPanel.MarginKey, new Thickness(0, 0, 0, 16));
            _border1 = new Border();
            _border1.Name = "redPanel";
            _border1.set_property_value(Border.FillKey, new SolidColorBrush(Color.FromHex('#ef4444')));
            _border1.set_property_value(Border.WidthKey, 180);
            _border1.set_property_value(Border.HeightKey, 120);
            _border1.set_property_value(Border.MarginKey, new Thickness(0, 0, 12, 0));
            const _textBlock10 = new TextBlock();
            _textBlock10.set_property_value(TextBlock.TextKey, "Edit menu\ncommands · disabled · Transform submenu");
            _textBlock10.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock10, "OnPrimary"));
            _textBlock10.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock10.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock10.set_property_value(TextBlock.TextAlignmentKey, TextAlignment.Center);
            _textBlock10.set_property_value(TextBlock.HorizontalAlignmentKey, HorizontalAlignment.Center);
            _textBlock10.set_property_value(TextBlock.VerticalAlignmentKey, VerticalAlignment.Center);
            _border1.SetChild(_textBlock10);
            _stackPanel9.AddChild(_border1);
            _border2 = new Border();
            _border2.Name = "greenPanel";
            _border2.set_property_value(Border.FillKey, new SolidColorBrush(Color.FromHex('#22c55e')));
            _border2.set_property_value(Border.WidthKey, 180);
            _border2.set_property_value(Border.HeightKey, 120);
            _border2.set_property_value(Border.MarginKey, new Thickness(0, 0, 12, 0));
            const _textBlock11 = new TextBlock();
            _textBlock11.set_property_value(TextBlock.TextKey, "View menu\ncheckables · Zoom submenu");
            _textBlock11.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock11, "OnPrimary"));
            _textBlock11.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock11.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock11.set_property_value(TextBlock.TextAlignmentKey, TextAlignment.Center);
            _textBlock11.set_property_value(TextBlock.HorizontalAlignmentKey, HorizontalAlignment.Center);
            _textBlock11.set_property_value(TextBlock.VerticalAlignmentKey, VerticalAlignment.Center);
            _border2.SetChild(_textBlock11);
            _stackPanel9.AddChild(_border2);
            _border3 = new Border();
            _border3.Name = "bluePanel";
            _border3.set_property_value(Border.FillKey, new SolidColorBrush(Color.FromHex('#3b82f6')));
            _border3.set_property_value(Border.WidthKey, 180);
            _border3.set_property_value(Border.HeightKey, 120);
            const _textBlock12 = new TextBlock();
            _textBlock12.set_property_value(TextBlock.TextKey, "File menu\ndynamic Recent ▸ + Share ▸ Export ▸ submenu");
            _textBlock12.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock12, "OnPrimary"));
            _textBlock12.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock12.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock12.set_property_value(TextBlock.TextAlignmentKey, TextAlignment.Center);
            _textBlock12.set_property_value(TextBlock.HorizontalAlignmentKey, HorizontalAlignment.Center);
            _textBlock12.set_property_value(TextBlock.VerticalAlignmentKey, VerticalAlignment.Center);
            _border3.SetChild(_textBlock12);
            _stackPanel9.AddChild(_border3);
            _stackPanel8.AddChild(_stackPanel9);
            const _textBlock13 = new TextBlock();
            _textBlock13.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock13, "Status"));
            _textBlock13.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock13.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock13, "OnSurface"));
            _stackPanel8.AddChild(_textBlock13);
            _dockPanel5.AddChild(_stackPanel8);
            _border4.SetChild(_dockPanel5);
            return _border4;
        }, ContextMenuVM);
        t.Set(ContextMenuVM, _tmpl0);
        return t;
    }
}
