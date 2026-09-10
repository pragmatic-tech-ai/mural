import { PropertyGridVM } from "./property-grid-vm.mjs";
import { Border, ColumnDefinition, DataTemplate, Dock, DockPanel, Grid, GridLength, Orientation, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
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
            const _grid8 = new Grid();
            const _columnDefinition9 = new ColumnDefinition();
            _columnDefinition9.set_property_value(ColumnDefinition.WidthKey, GridLength.Star);
            _grid8.ColumnDefinitions.Add(_columnDefinition9);
            const _columnDefinition10 = new ColumnDefinition();
            _columnDefinition10.set_property_value(ColumnDefinition.WidthKey, GridLength.Star);
            _grid8.ColumnDefinitions.Add(_columnDefinition10);
            const _stackPanel11 = new StackPanel();
            _stackPanel11.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel11.set_property_value(Grid.ColumnKey, 0);
            _stackPanel11.set_property_value(StackPanel.MarginKey, new Thickness(0, 0, 12, 0));
            const _textBlock12 = new TextBlock();
            _textBlock12.set_property_value(TextBlock.TextKey, "DpPropertyBag");
            _textBlock12.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock12.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock12.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock12, "OnSurface"));
            _textBlock12.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel11.AddChild(_textBlock12);
            const _propertyGrid13 = new PropertyGrid();
            _propertyGrid13.set_property_value(PropertyGrid.DescriptorsKey, DataContextBinding(_propertyGrid13, "DpDescriptors"));
            _propertyGrid13.set_property_value(PropertyGrid.TargetKey, DataContextBinding(_propertyGrid13, "DpTarget"));
            _stackPanel11.AddChild(_propertyGrid13);
            _grid8.AddChild(_stackPanel11);
            const _stackPanel14 = new StackPanel();
            _stackPanel14.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel14.set_property_value(Grid.ColumnKey, 1);
            _stackPanel14.set_property_value(StackPanel.MarginKey, new Thickness(12, 0, 0, 0));
            const _textBlock15 = new TextBlock();
            _textBlock15.set_property_value(TextBlock.TextKey, "MapPropertyBag");
            _textBlock15.set_property_value(TextBlock.FontSizeKey, 13);
            _textBlock15.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock15.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock15, "OnSurface"));
            _textBlock15.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel14.AddChild(_textBlock15);
            const _propertyGrid16 = new PropertyGrid();
            _propertyGrid16.set_property_value(PropertyGrid.DescriptorsKey, DataContextBinding(_propertyGrid16, "MapDescriptors"));
            _propertyGrid16.set_property_value(PropertyGrid.TargetKey, DataContextBinding(_propertyGrid16, "MapTarget"));
            _stackPanel14.AddChild(_propertyGrid16);
            _grid8.AddChild(_stackPanel14);
            _border7.SetChild(_grid8);
            _dockPanel2.AddChild(_border7);
            _border1.SetChild(_dockPanel2);
            return _border1;
        }, PropertyGridVM);
        t.Set(PropertyGridVM, _tmpl0);
        return t;
    }
}
