import { PropertyGridVM } from "./property-grid-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, Orientation, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { PropertyGrid } from "@pragmatic-tech-ai/mural/framework/property-grid/property-grid.js";
import { DataContextBinding, DynamicResource, ResourceDictionary, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_PropertyGridDemo = Symbol("PropertyGridDemo.ctor");
export class PropertyGridDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_PropertyGridDemo) {
            throw new Error("PropertyGridDemo is private — use PropertyGridDemo.Clone()");
        }
    }
    static Clone() {
        const t = new PropertyGridDemo(_gate_PropertyGridDemo);
        const _tmpl0 = new DataTemplate((_data) => {
            const _border1 = new Border();
            _border1.set_property_value(Border.FillKey, DynamicResource(_border1, "Surface"));
            const _dockPanel2 = new DockPanel();
            const _border3 = new Border();
            _border3.set_property_value(DockPanel.DockKey, Dock.Top);
            _border3.set_property_value(Border.FillKey, DynamicResource(_border3, "Primary"));
            _border3.set_property_value(Border.PaddingKey, new Thickness(20, 14, 20, 14));
            const _stackPanel4 = new StackPanel();
            _stackPanel4.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock5 = new TextBlock();
            _textBlock5.set_property_value(TextBlock.TextKey, "PropertyGrid demo");
            _textBlock5.set_property_value(TextBlock.FontSizeKey, 18);
            _textBlock5.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock5.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock5, "OnPrimary"));
            _stackPanel4.AddChild(_textBlock5);
            const _textBlock6 = new TextBlock();
            _textBlock6.set_property_value(TextBlock.TextKey, "Left: DpPropertyBag over a MuralBase target.  Right: MapPropertyBag over a plain object.");
            _textBlock6.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock6.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock6, "OnPrimary"));
            _textBlock6.set_property_value(TextBlock.MarginKey, new Thickness(0, 4, 0, 0));
            _stackPanel4.AddChild(_textBlock6);
            _border3.SetChild(_stackPanel4);
            _dockPanel2.AddChild(_border3);
            const _border7 = new Border();
            _border7.set_property_value(Border.FillKey, DynamicResource(_border7, "SurfaceContainerLow"));
            _border7.set_property_value(Border.PaddingKey, new Thickness(20, 20, 20, 20));
            const _stackPanel8 = new StackPanel();
            _stackPanel8.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            const _stackPanel9 = new StackPanel();
            _stackPanel9.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel9.set_property_value(StackPanel.MarginKey, new Thickness(0, 0, 24, 0));
            const _textBlock10 = new TextBlock();
            _textBlock10.set_property_value(TextBlock.TextKey, "DpPropertyBag");
            _textBlock10.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock10.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock10.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock10, "OnSurface"));
            _textBlock10.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel9.AddChild(_textBlock10);
            const _propertyGrid11 = new PropertyGrid();
            _propertyGrid11.set_property_value(PropertyGrid.DescriptorsKey, DataContextBinding(_propertyGrid11, "DpDescriptors"));
            _propertyGrid11.set_property_value(PropertyGrid.TargetKey, DataContextBinding(_propertyGrid11, "DpTarget"));
            _propertyGrid11.set_property_value(PropertyGrid.WidthKey, 280);
            _stackPanel9.AddChild(_propertyGrid11);
            _stackPanel8.AddChild(_stackPanel9);
            const _stackPanel12 = new StackPanel();
            _stackPanel12.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock13 = new TextBlock();
            _textBlock13.set_property_value(TextBlock.TextKey, "MapPropertyBag");
            _textBlock13.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock13.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock13.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock13, "OnSurface"));
            _textBlock13.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel12.AddChild(_textBlock13);
            const _propertyGrid14 = new PropertyGrid();
            _propertyGrid14.set_property_value(PropertyGrid.DescriptorsKey, DataContextBinding(_propertyGrid14, "MapDescriptors"));
            _propertyGrid14.set_property_value(PropertyGrid.TargetKey, DataContextBinding(_propertyGrid14, "MapTarget"));
            _propertyGrid14.set_property_value(PropertyGrid.WidthKey, 280);
            _stackPanel12.AddChild(_propertyGrid14);
            _stackPanel8.AddChild(_stackPanel12);
            _border7.SetChild(_stackPanel8);
            _dockPanel2.AddChild(_border7);
            _border1.SetChild(_dockPanel2);
            return _border1;
        }, PropertyGridVM);
        t.Set(PropertyGridVM, _tmpl0);
        return t;
    }
}
