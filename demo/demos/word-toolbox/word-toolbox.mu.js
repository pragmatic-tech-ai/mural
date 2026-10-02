import { WordToolboxVM, WordVM } from "./word-toolbox-vm.mjs";
import { Border, ContentPresenter, ControlTemplate, DataTemplate, Dock, DockPanel, ItemsPanelTemplate, Line, ListReorderBehavior, Orientation, StackPanel, TargetedSetter, TemplatePropertyTrigger, TextBlock, TextWrapping, VirtualizingStackPanel, VirtualizingWrapPanel } from "@pragmatic-tech-ai/mural/basic";
import { ItemsControl } from "@pragmatic-tech-ai/mural/framework/base/items-control.js";
import { ListBox, ListBoxItem, SelectionMode } from "@pragmatic-tech-ai/mural/framework/list/list-box.js";
import { MarqueeBoundsPolicy } from "@pragmatic-tech-ai/mural/framework/list/selector.js";
import { ScrollViewer } from "@pragmatic-tech-ai/mural/framework/surfaces/scroll-viewer.js";
import { Color, DataContextBinding, DynamicResource, HorizontalAlignment, NameScope, ResourceDictionary, Setter, SetterFactory, Style, Thickness, VerticalAlignment } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight, Pen, SolidColorBrush } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_WordToolboxDemo = Symbol("WordToolboxDemo.ctor");
export class WordToolboxDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_WordToolboxDemo) {
            throw new Error("WordToolboxDemo is private — use WordToolboxDemo.Clone()");
        }
    }
    static Clone() {
        const t = new WordToolboxDemo(_gate_WordToolboxDemo);
        const _tmpl0 = new ItemsPanelTemplate(() => {
            const _virtualizingWrapPanel1 = new VirtualizingWrapPanel();
            _virtualizingWrapPanel1.set_property_value(VirtualizingWrapPanel.HorizontalSpacingKey, 15);
            _virtualizingWrapPanel1.set_property_value(VirtualizingWrapPanel.VerticalSpacingKey, 15);
            return _virtualizingWrapPanel1;
        });
        t.Set("ListBoxItemsPanel", _tmpl0);
        const _tmpl2 = new ItemsPanelTemplate(() => {
            const _virtualizingStackPanel3 = new VirtualizingStackPanel();
            return _virtualizingStackPanel3;
        });
        t.Set("ToolboxItemsPanel", _tmpl2);
        const _tmpl4 = new DataTemplate((_data) => {
            const _border5 = new Border();
            _border5.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "Outline"); return _e; })(new Pen()));
            const _textBlock6 = new TextBlock();
            _textBlock6.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock6, "Word"));
            _textBlock6.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock6.set_property_value(TextBlock.HorizontalAlignmentKey, HorizontalAlignment.Center);
            _textBlock6.set_property_value(TextBlock.VerticalAlignmentKey, VerticalAlignment.Center);
            _textBlock6.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock6, "OnSurface"));
            _border5.SetChild(_textBlock6);
            return _border5;
        }, WordVM);
        t.Set(WordVM, _tmpl4);
        const _tmpl7 = (() => {
            const _factory = (_templatedParent) => {
                let _border8;
                _border8 = new Border();
                _border8.Name = "PART_Border";
                _border8.set_property_value(Border.PaddingKey, new Thickness(3));
                const _contentPresenter9 = new ContentPresenter();
                _border8.SetChild(_contentPresenter9);
                return _border8;
            };
            const _tplSet10 = [new TargetedSetter(Border, "Fill", new SetterFactory((_t) => DynamicResource(_t, "SecondaryContainer")), "PART_Border")];
            const _tplTrig11 = new TemplatePropertyTrigger(ListBoxItem, "IsSelected", true, _tplSet10, undefined);
            return new ControlTemplate(_factory, [_tplTrig11]);
        })();
        t.Set("WordTileItemTemplate", _tmpl7);
        const _setter12 = new Setter(ListBoxItem, "Template", _tmpl7);
        const _setter13 = new Setter(ListBoxItem, "IsDraggable", true);
        const _setter14 = new Setter(ListBoxItem, "OnDragStart", new SetterFactory((_t) => DataContextBinding(_t, "BeginDragData")));
        const _style15 = new Style(ListBoxItem, [_setter12, _setter13, _setter14], undefined, [], []);
        t.Set("WordTileItemStyle", _style15);
        const _tmpl16 = new DataTemplate((_data) => {
            let _itemsControl17, _listBox18;
            const _border19 = new Border();
            _border19.SetNameScope(new NameScope());
            _border19.set_property_value(Border.FillKey, DynamicResource(_border19, "SurfaceContainerLow"));
            _border19.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            const _rd20 = _border19.Resources;
            const _setter21 = new Setter(ContentPresenter, "IsDraggable", true);
            const _setter22 = new Setter(ContentPresenter, "OnDragStart", new SetterFactory((_t) => DataContextBinding(_t, "BeginDragData")));
            const _style23 = new Style(ContentPresenter, [_setter21, _setter22], undefined, [], []);
            _rd20.Set(ContentPresenter, _style23);
            const _dockPanel24 = new DockPanel();
            const _border25 = new Border();
            _border25.set_property_value(DockPanel.DockKey, Dock.Top);
            _border25.set_property_value(Border.FillKey, DynamicResource(_border25, "InverseSurface"));
            _border25.set_property_value(Border.PaddingKey, new Thickness(16, 12, 16, 12));
            const _stackPanel26 = new StackPanel();
            _stackPanel26.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            const _textBlock27 = new TextBlock();
            _textBlock27.set_property_value(TextBlock.TextKey, "Word toolbox — drag tiles between panes");
            _textBlock27.set_property_value(TextBlock.FontSizeKey, 15);
            _textBlock27.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock27.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock27, "InverseOnSurface"));
            _stackPanel26.AddChild(_textBlock27);
            const _textBlock28 = new TextBlock();
            _textBlock28.set_property_value(TextBlock.TextKey, DataContextBinding(_textBlock28, "Status"));
            _textBlock28.set_property_value(TextBlock.FontSizeKey, 11);
            _textBlock28.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock28, "OnSurfaceVariant"));
            _textBlock28.set_property_value(TextBlock.MarginKey, new Thickness(0, 4, 0, 0));
            _stackPanel26.AddChild(_textBlock28);
            _border25.SetChild(_stackPanel26);
            _dockPanel24.AddChild(_border25);
            const _textBlock29 = new TextBlock();
            _textBlock29.set_property_value(DockPanel.DockKey, Dock.Bottom);
            _textBlock29.set_property_value(TextBlock.MarginKey, new Thickness(20, 4, 20, 16));
            _textBlock29.set_property_value(TextBlock.FontSizeKey, 11);
            _textBlock29.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock29, "OnSurfaceVariant"));
            _textBlock29.set_property_value(TextBlock.TextWrappingKey, TextWrapping.Wrap);
            _textBlock29.set_property_value(TextBlock.TextKey, "LEFT pane is a 100-tile palette; drag any tile RIGHT to copy it into the listbox. RIGHT pane is a 2000-tile virtualizing WrapPanel; drag any tile to reorder. Both panes share the same square-tile template (100×100 with 15px gaps).");
            _dockPanel24.AddChild(_textBlock29);
            const _dockPanel30 = new DockPanel();
            _dockPanel30.set_property_value(DockPanel.LastChildFillKey, true);
            const _border31 = new Border();
            _border31.set_property_value(DockPanel.DockKey, Dock.Left);
            const _dockPanel32 = new DockPanel();
            const _border33 = new Border();
            _border33.set_property_value(DockPanel.DockKey, Dock.Top);
            _border33.set_property_value(Border.FillKey, new SolidColorBrush(Color.FromHex('#e0f2fe')));
            _border33.set_property_value(Border.PaddingKey, new Thickness(12, 8, 12, 8));
            const _textBlock34 = new TextBlock();
            _textBlock34.set_property_value(TextBlock.TextKey, "Toolbox — drag a word to the listbox");
            _textBlock34.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock34.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock34.set_property_value(TextBlock.ForegroundKey, new SolidColorBrush(Color.FromHex('#075985')));
            _border33.SetChild(_textBlock34);
            _dockPanel32.AddChild(_border33);
            const _scrollViewer35 = new ScrollViewer();
            _scrollViewer35.set_property_value(ScrollViewer.IsAutoHideScrollBarsKey, false);
            _itemsControl17 = new ItemsControl();
            _itemsControl17.Name = "toolbox";
            _itemsControl17.set_property_value(ItemsControl.ItemsSourceKey, DataContextBinding(_itemsControl17, "ToolboxWords"));
            _itemsControl17.set_property_value(ItemsControl.ItemsPanelKey, _tmpl2);
            _scrollViewer35.Content = _itemsControl17;
            _dockPanel32.AddChild(_scrollViewer35);
            _border31.SetChild(_dockPanel32);
            _dockPanel30.AddChild(_border31);
            const _line36 = new Line();
            _line36.set_property_value(DockPanel.DockKey, Dock.Left);
            _line36.set_property_value(Line.OrientationKey, Orientation.Vertical);
            _line36.set_property_value(Line.StrokeKey, new Pen(DynamicResource(_line36, "OutlineVariant"), 1));
            _dockPanel30.AddChild(_line36);
            const _border37 = new Border();
            const _dockPanel38 = new DockPanel();
            const _border39 = new Border();
            _border39.set_property_value(DockPanel.DockKey, Dock.Top);
            _border39.set_property_value(Border.FillKey, new SolidColorBrush(Color.FromHex('#dbeafe')));
            _border39.set_property_value(Border.PaddingKey, new Thickness(12, 8, 12, 8));
            const _textBlock40 = new TextBlock();
            _textBlock40.set_property_value(TextBlock.TextKey, "ListBox — drag tiles to reorder; toolbox words land here");
            _textBlock40.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock40.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock40.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock40, "PrimaryContainer"));
            _border39.SetChild(_textBlock40);
            _dockPanel38.AddChild(_border39);
            _listBox18 = new ListBox();
            _listBox18.Name = "listBox";
            _listBox18.set_property_value(ListBox.ItemsSourceKey, DataContextBinding(_listBox18, "ListBoxWords"));
            _listBox18.set_property_value(ListBox.ItemsPanelKey, _tmpl0);
            _listBox18.set_property_value(ListBox.ItemContainerStyleKey, _style15);
            _listBox18.set_property_value(ListBox.SelectionModeKey, SelectionMode.Extended);
            _listBox18.set_property_value(ListBox.MarqueeBoundsPolicyKey, MarqueeBoundsPolicy.Contained);
            _listBox18.set_property_value(ListBox.AllowMarqueeSelectionKey, true);
            const _listReorderBehavior41 = new ListReorderBehavior();
            _listReorderBehavior41.Name = "reorder";
            _listReorderBehavior41.set_property_value(ListReorderBehavior.FromIndexFormatKey, "@pragmatic-tech-ai/mural/reorder/from-index");
            _listBox18.AddBehavior(_listReorderBehavior41);
            _dockPanel38.AddChild(_listBox18);
            _border37.SetChild(_dockPanel38);
            _dockPanel30.AddChild(_border37);
            _dockPanel24.AddChild(_dockPanel30);
            _border19.SetChild(_dockPanel24);
            return _border19;
        }, WordToolboxVM);
        t.Set(WordToolboxVM, _tmpl16);
        return t;
    }
    get ListBoxItemsPanel() { return this.Resolve("ListBoxItemsPanel"); }
    set ListBoxItemsPanel(v) { this.Set("ListBoxItemsPanel", v); }
    get ToolboxItemsPanel() { return this.Resolve("ToolboxItemsPanel"); }
    set ToolboxItemsPanel(v) { this.Set("ToolboxItemsPanel", v); }
    get WordTileItemTemplate() { return this.Resolve("WordTileItemTemplate"); }
    set WordTileItemTemplate(v) { this.Set("WordTileItemTemplate", v); }
    get WordTileItemStyle() { return this.Resolve("WordTileItemStyle"); }
    set WordTileItemStyle(v) { this.Set("WordTileItemStyle", v); }
}
