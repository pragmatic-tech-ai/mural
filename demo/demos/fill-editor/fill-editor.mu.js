import { FillEditorDemoVM } from "./fill-editor-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, Line, Orientation, Rectangle, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { FillEditor } from "@pragmatic-tech-ai/mural/framework";
import { DataContextBinding, DynamicResource, NameScope, ResourceDictionary, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight, Pen } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_FillEditorDemo = Symbol("FillEditorDemo.ctor");
export class FillEditorDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_FillEditorDemo) {
            throw new Error("FillEditorDemo is private — use FillEditorDemo.Clone()");
        }
    }
    static Clone() {
        const t = new FillEditorDemo(_gate_FillEditorDemo);
        const _tmpl0 = new DataTemplate((_data) => {
            const _border1 = new Border();
            _border1.SetNameScope(new NameScope());
            _border1.set_property_value(Border.FillKey, DynamicResource(_border1, "Surface"));
            const _dockPanel2 = new DockPanel();
            const _border3 = new Border();
            _border3.set_property_value(DockPanel.DockKey, Dock.Top);
            _border3.set_property_value(Border.FillKey, DynamicResource(_border3, "Primary"));
            _border3.set_property_value(Border.PaddingKey, new Thickness(20, 14, 20, 14));
            const _stackPanel4 = new StackPanel();
            _stackPanel4.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock5 = new TextBlock();
            _textBlock5.set_property_value(TextBlock.TextKey, "PowerPoint-style Fill editor");
            _textBlock5.set_property_value(TextBlock.FontSizeKey, 18);
            _textBlock5.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock5.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock5, "OnPrimary"));
            _stackPanel4.AddChild(_textBlock5);
            const _textBlock6 = new TextBlock();
            _textBlock6.set_property_value(TextBlock.TextKey, "Inline panel: None / Solid / Linear / Radial / Pattern / Picture + transparency.");
            _textBlock6.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock6.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock6, "OnPrimary"));
            _textBlock6.set_property_value(TextBlock.MarginKey, new Thickness(0, 4, 0, 0));
            _stackPanel4.AddChild(_textBlock6);
            _border3.SetChild(_stackPanel4);
            _dockPanel2.AddChild(_border3);
            const _border7 = new Border();
            _border7.set_property_value(DockPanel.DockKey, Dock.Bottom);
            _border7.set_property_value(Border.FillKey, DynamicResource(_border7, "SurfaceContainerLow"));
            const _dockPanel8 = new DockPanel();
            const _line9 = new Line();
            _line9.set_property_value(DockPanel.DockKey, Dock.Top);
            _line9.set_property_value(Line.OrientationKey, Orientation.Horizontal);
            _line9.set_property_value(Line.StrokeKey, new Pen(DynamicResource(_line9, "OutlineVariant"), 1));
            _dockPanel8.AddChild(_line9);
            const _textBlock10 = new TextBlock();
            _textBlock10.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock10, "FillSummary"));
            _textBlock10.set_property_value(TextBlock.FontSizeKey, 11);
            _textBlock10.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock10, "OnSurfaceVariant"));
            _textBlock10.set_property_value(TextBlock.MarginKey, new Thickness(20, 10, 20, 10));
            _dockPanel8.AddChild(_textBlock10);
            _border7.SetChild(_dockPanel8);
            _dockPanel2.AddChild(_border7);
            const _border11 = new Border();
            _border11.set_property_value(Border.FillKey, DynamicResource(_border11, "SurfaceContainerLowest"));
            _border11.set_property_value(Border.PaddingKey, new Thickness(20, 20, 20, 20));
            const _stackPanel12 = new StackPanel();
            _stackPanel12.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            const _border13 = new Border();
            _border13.set_property_value(Border.WidthKey, 380);
            _border13.set_property_value(Border.PaddingKey, new Thickness(16, 16, 16, 16));
            _border13.set_property_value(Border.FillKey, DynamicResource(_border13, "SurfaceContainerLow"));
            _border13.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            _border13.set_property_value(Border.CornerRadiusKey, 8);
            _border13.set_property_value(Border.MarginKey, new Thickness(0, 0, 20, 0));
            const _stackPanel14 = new StackPanel();
            _stackPanel14.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock15 = new TextBlock();
            _textBlock15.set_property_value(TextBlock.TextKey, "Fill");
            _textBlock15.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock15.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock15.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock15, "OnSurface"));
            _textBlock15.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 12));
            _stackPanel14.AddChild(_textBlock15);
            const _fillEditor16 = new FillEditor();
            _fillEditor16.set_property_value(FillEditor.FillKey, DataContextBinding(_fillEditor16, "Fill"));
            _stackPanel14.AddChild(_fillEditor16);
            _border13.SetChild(_stackPanel14);
            _stackPanel12.AddChild(_border13);
            const _border17 = new Border();
            _border17.set_property_value(Border.WidthKey, 520);
            _border17.set_property_value(Border.HeightKey, 420);
            _border17.set_property_value(Border.PaddingKey, new Thickness(20));
            _border17.set_property_value(Border.FillKey, DynamicResource(_border17, "SurfaceContainer"));
            _border17.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            _border17.set_property_value(Border.CornerRadiusKey, 8);
            const _rectangle18 = new Rectangle();
            _rectangle18.set_property_value(Rectangle.WidthKey, 480);
            _rectangle18.set_property_value(Rectangle.HeightKey, 380);
            _rectangle18.set_property_value(Rectangle.FillKey, DataContextBinding(_rectangle18, "Fill"));
            _rectangle18.set_property_value(Rectangle.StrokeKey, DataContextBinding(_rectangle18, "OutlinePen"));
            _border17.SetChild(_rectangle18);
            _stackPanel12.AddChild(_border17);
            _border11.SetChild(_stackPanel12);
            _dockPanel2.AddChild(_border11);
            _border1.SetChild(_dockPanel2);
            return _border1;
        }, FillEditorDemoVM);
        t.Set(FillEditorDemoVM, _tmpl0);
        return t;
    }
}
