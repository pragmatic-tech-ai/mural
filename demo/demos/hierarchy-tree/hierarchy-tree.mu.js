import { HierarchyTreeVM } from "./hierarchy-tree-vm.mjs";
import { Border, DataTemplate, Dock, DockPanel, HierarchicalDataTemplate, Orientation, StackPanel, TextBlock } from "@pragmatic-tech-ai/mural/basic";
import { EditableTextBlock } from "@pragmatic-tech-ai/mural/basic/editable-text-block.js";
import { HierarchyContextMenuBehavior } from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context-menu.js";
import { HierarchyItem } from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js";
import { HierarchyTreeBehavior } from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-tree-behavior.js";
import { TreeView } from "@pragmatic-tech-ai/mural/framework/list/tree-view.js";
import { DataContextBinding, DynamicResource, NameScope, ResourceDictionary, ServiceBinding, ServiceProvider, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { FontWeight, Pen } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_HierarchyTreeDemo = Symbol("HierarchyTreeDemo.ctor");
export class HierarchyTreeDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_HierarchyTreeDemo) {
            throw new Error("HierarchyTreeDemo is private — use HierarchyTreeDemo.Clone()");
        }
    }
    static Clone() {
        const t = new HierarchyTreeDemo(_gate_HierarchyTreeDemo);
        const _tmpl0 = new HierarchicalDataTemplate((_data) => {
            const _stackPanel1 = new StackPanel();
            _stackPanel1.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            const _textBlock2 = new TextBlock();
            _textBlock2.set_property_value(TextBlock.TextKey, ">");
            _textBlock2.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock2.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock2, "Primary"));
            _textBlock2.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 6, 0));
            _stackPanel1.AddChild(_textBlock2);
            const _editableTextBlock3 = new EditableTextBlock();
            _editableTextBlock3.set_property_value(EditableTextBlock.TextKey, DataContextBinding(_editableTextBlock3, "Caption"));
            _editableTextBlock3.set_property_value(EditableTextBlock.IsEditingKey, DataContextBinding(_editableTextBlock3, "IsEditing"));
            _editableTextBlock3.set_property_value(EditableTextBlock.EditingTextKey, DataContextBinding(_editableTextBlock3, "EditingName"));
            _stackPanel1.AddChild(_editableTextBlock3);
            return _stackPanel1;
        }, (data) => data?.Children, undefined, undefined, HierarchyItem);
        t.Set("HierarchyTreeDemoItemTemplate", _tmpl0);
        const _tmpl4 = new DataTemplate((_data) => {
            const _border5 = new Border();
            _border5.SetNameScope(new NameScope());
            _border5.set_property_value(Border.FillKey, DynamicResource(_border5, "Surface"));
            _border5.set_property_value(Border.StrokeKey, ((_e) => { _e.Brush = DynamicResource(_e, "OutlineVariant"); return _e; })(new Pen()));
            const _dockPanel6 = new DockPanel();
            const _border7 = new Border();
            _border7.set_property_value(DockPanel.DockKey, Dock.Top);
            _border7.set_property_value(Border.FillKey, DynamicResource(_border7, "Primary"));
            _border7.set_property_value(Border.PaddingKey, new Thickness(16, 12, 16, 12));
            const _textBlock8 = new TextBlock();
            _textBlock8.set_property_value(TextBlock.TextKey, "Hierarchy — Hierarchy{} DSL + default TreeView (left) vs. item-template override by key (right)");
            _textBlock8.set_property_value(TextBlock.FontSizeKey, 15);
            _textBlock8.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock8.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock8, "OnPrimary"));
            _border7.SetChild(_textBlock8);
            _dockPanel6.AddChild(_border7);
            const _stackPanel9 = new StackPanel();
            _stackPanel9.set_property_value(StackPanel.OrientationKey, Orientation.Horizontal);
            const _stackPanel10 = new StackPanel();
            _stackPanel10.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel10.set_property_value(StackPanel.WidthKey, 320);
            _stackPanel10.set_property_value(StackPanel.MarginKey, new Thickness(12, 12, 6, 12));
            const _textBlock11 = new TextBlock();
            _textBlock11.set_property_value(TextBlock.TextKey, "Out-of-box — Style + default .Behaviors: bundle only");
            _textBlock11.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock11.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock11.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock11, "OnSurfaceVariant"));
            _textBlock11.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel10.AddChild(_textBlock11);
            const _treeView12 = new TreeView();
            _treeView12.set_property_value(TreeView.DataContextKey, ServiceBinding(_treeView12, ServiceProvider.tokenFor(HierarchyTreeVM), ""));
            _treeView12.set_property_value(TreeView.StyleKey, DynamicResource(_treeView12, "HierarchyTreeView"));
            const _hierarchyTreeBehavior13 = new HierarchyTreeBehavior();
            _hierarchyTreeBehavior13.set_property_value(HierarchyTreeBehavior.HierarchyKey, DataContextBinding(_treeView12, "Hierarchy"));
            _treeView12.AddBehavior(_hierarchyTreeBehavior13);
            const _hierarchyContextMenuBehavior14 = new HierarchyContextMenuBehavior();
            _hierarchyContextMenuBehavior14.set_property_value(HierarchyContextMenuBehavior.HierarchyKey, DataContextBinding(_treeView12, "Hierarchy"));
            _treeView12.AddBehavior(_hierarchyContextMenuBehavior14);
            _treeView12.set_property_value(TreeView.ItemsSourceKey, DataContextBinding(_treeView12, "Hierarchy.Roots"));
            _stackPanel10.AddChild(_treeView12);
            _stackPanel9.AddChild(_stackPanel10);
            const _border15 = new Border();
            _border15.set_property_value(Border.WidthKey, 1);
            _border15.set_property_value(Border.FillKey, DynamicResource(_border15, "OutlineVariant"));
            _border15.set_property_value(Border.MarginKey, new Thickness(0, 12, 0, 12));
            _stackPanel9.AddChild(_border15);
            const _stackPanel16 = new StackPanel();
            _stackPanel16.set_property_value(StackPanel.OrientationKey, Orientation.Vertical);
            _stackPanel16.set_property_value(StackPanel.WidthKey, 320);
            _stackPanel16.set_property_value(StackPanel.MarginKey, new Thickness(6, 12, 12, 12));
            const _textBlock17 = new TextBlock();
            _textBlock17.set_property_value(TextBlock.TextKey, "Override by key — custom ItemTemplate, same default behaviors");
            _textBlock17.set_property_value(TextBlock.FontSizeKey, 12);
            _textBlock17.set_property_value(TextBlock.FontWeightKey, FontWeight.Bold);
            _textBlock17.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock17, "OnSurfaceVariant"));
            _textBlock17.set_property_value(TextBlock.MarginKey, new Thickness(0, 0, 0, 8));
            _stackPanel16.AddChild(_textBlock17);
            const _treeView18 = new TreeView();
            _treeView18.set_property_value(TreeView.DataContextKey, ServiceBinding(_treeView18, ServiceProvider.tokenFor(HierarchyTreeVM), ""));
            _treeView18.set_property_value(TreeView.StyleKey, DynamicResource(_treeView18, "HierarchyTreeView"));
            const _hierarchyTreeBehavior19 = new HierarchyTreeBehavior();
            _hierarchyTreeBehavior19.set_property_value(HierarchyTreeBehavior.HierarchyKey, DataContextBinding(_treeView18, "Hierarchy"));
            _treeView18.AddBehavior(_hierarchyTreeBehavior19);
            const _hierarchyContextMenuBehavior20 = new HierarchyContextMenuBehavior();
            _hierarchyContextMenuBehavior20.set_property_value(HierarchyContextMenuBehavior.HierarchyKey, DataContextBinding(_treeView18, "Hierarchy"));
            _treeView18.AddBehavior(_hierarchyContextMenuBehavior20);
            _treeView18.set_property_value(TreeView.ItemTemplateKey, _tmpl0);
            _treeView18.set_property_value(TreeView.ItemsSourceKey, DataContextBinding(_treeView18, "Hierarchy.Roots"));
            _stackPanel16.AddChild(_treeView18);
            _stackPanel9.AddChild(_stackPanel16);
            _dockPanel6.AddChild(_stackPanel9);
            _border5.SetChild(_dockPanel6);
            return _border5;
        }, HierarchyTreeVM);
        t.Set(HierarchyTreeVM, _tmpl4);
        return t;
    }
    get HierarchyTreeDemoItemTemplate() { return this.Resolve("HierarchyTreeDemoItemTemplate"); }
    set HierarchyTreeDemoItemTemplate(v) { this.Set("HierarchyTreeDemoItemTemplate", v); }
}
