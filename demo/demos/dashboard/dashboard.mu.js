import { DashboardVM } from "./dashboard-vm.mjs";
import { Border, Canvas, DataTemplate, TextBlock, TextWrapping } from "@pragmatic-tech-ai/mural/basic";
import { Color, CornerRadius, DynamicResource, PropertyTrigger, ResourceDictionary, Setter, SetterFactory, Style, Thickness } from "@pragmatic-tech-ai/mural/runtime";
import { Pen, SolidColorBrush } from "@pragmatic-tech-ai/mural/visual-engine";


const _gate_DashboardDemo = Symbol("DashboardDemo.ctor");
export class DashboardDemo extends ResourceDictionary {
    constructor(_g) {
        super();
        if (_g !== _gate_DashboardDemo) {
            throw new Error("DashboardDemo is private — use DashboardDemo.Clone()");
        }
    }
    static Clone() {
        const t = new DashboardDemo(_gate_DashboardDemo);
        const _setter0 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#4caf50')));
        const _setter1 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#1b5e20')), 2)));
        const _setter2 = new Setter(Border, "CornerRadius", new CornerRadius(8));
        const _setter3 = new Setter(Border, "Padding", new Thickness(16));
        const _setter4 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#66bb6a')));
        const _setter5 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#1b5e20')), 3)));
        const _sArr6 = [_setter4, _setter5];
        const _trigger7 = new PropertyTrigger(Border, "IsMouseOver", true, _sArr6);
        const _setter8 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#2e7d32')));
        const _setter9 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#1b5e20')), 4)));
        const _sArr10 = [_setter8, _setter9];
        const _trigger11 = new PropertyTrigger(Border, "IsPressed", true, _sArr10);
        const _style12 = new Style(Border, [_setter0, _setter1, _setter2, _setter3], undefined, [_trigger7, _trigger11], []);
        t.Set("DashboardPrimaryCard", _style12);
        const _setter13 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#d32f2f')));
        const _setter14 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#7f0000')), 2)));
        const _setter15 = new Setter(Border, "CornerRadius", new CornerRadius(8));
        const _setter16 = new Setter(Border, "Padding", new Thickness(16));
        const _setter17 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#ef5350')));
        const _setter18 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#7f0000')), 3)));
        const _sArr19 = [_setter17, _setter18];
        const _trigger20 = new PropertyTrigger(Border, "IsMouseOver", true, _sArr19);
        const _setter21 = new Setter(Border, "Fill", new SolidColorBrush(Color.FromHex('#b71c1c')));
        const _setter22 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(new SolidColorBrush(Color.FromHex('#7f0000')), 4)));
        const _sArr23 = [_setter21, _setter22];
        const _trigger24 = new PropertyTrigger(Border, "IsPressed", true, _sArr23);
        const _style25 = new Style(Border, [_setter13, _setter14, _setter15, _setter16], undefined, [_trigger20, _trigger24], []);
        t.Set("DashboardDangerCard", _style25);
        const _setter26 = new Setter(Border, "Fill", new SetterFactory((_t) => DynamicResource(_t, "Surface")));
        const _setter27 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(DynamicResource(_t, "OutlineVariant"), 1)));
        const _setter28 = new Setter(Border, "CornerRadius", new CornerRadius(6));
        const _setter29 = new Setter(Border, "Padding", new Thickness(20));
        const _setter30 = new Setter(Border, "Fill", new SetterFactory((_t) => DynamicResource(_t, "SurfaceContainerHigh")));
        const _setter31 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(DynamicResource(_t, "OutlineVariant"), 2)));
        const _sArr32 = [_setter30, _setter31];
        const _trigger33 = new PropertyTrigger(Border, "IsMouseOver", true, _sArr32);
        const _setter34 = new Setter(Border, "Fill", new SetterFactory((_t) => DynamicResource(_t, "OutlineVariant")));
        const _setter35 = new Setter(Border, "Stroke", new SetterFactory((_t) => new Pen(DynamicResource(_t, "OutlineVariant"), 3)));
        const _sArr36 = [_setter34, _setter35];
        const _trigger37 = new PropertyTrigger(Border, "IsPressed", true, _sArr36);
        const _style38 = new Style(Border, [_setter26, _setter27, _setter28, _setter29], undefined, [_trigger33, _trigger37], []);
        t.Set("DashboardPaperCard", _style38);
        const _tmpl39 = new DataTemplate((_data) => {
            const _canvas40 = new Canvas();
            const _border41 = new Border();
            _border41.set_property_value(Border.StyleKey, _style12);
            _border41.set_property_value(Canvas.LeftKey, 20);
            _border41.set_property_value(Canvas.TopKey, 20);
            _border41.set_property_value(Border.WidthKey, 200);
            _border41.set_property_value(Border.HeightKey, 80);
            const _textBlock42 = new TextBlock();
            _textBlock42.set_property_value(TextBlock.TextKey, "Hello mural");
            _textBlock42.set_property_value(TextBlock.FontSizeKey, 20);
            _textBlock42.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock42, "OnPrimary"));
            _border41.SetChild(_textBlock42);
            _canvas40.AddChild(_border41);
            const _border43 = new Border();
            _border43.set_property_value(Border.StyleKey, _style25);
            _border43.set_property_value(Canvas.LeftKey, 240);
            _border43.set_property_value(Canvas.TopKey, 20);
            _border43.set_property_value(Border.WidthKey, 200);
            _border43.set_property_value(Border.HeightKey, 80);
            const _textBlock44 = new TextBlock();
            _textBlock44.set_property_value(TextBlock.TextKey, "Danger zone");
            _textBlock44.set_property_value(TextBlock.FontSizeKey, 20);
            _textBlock44.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock44, "OnPrimary"));
            _border43.SetChild(_textBlock44);
            _canvas40.AddChild(_border43);
            const _border45 = new Border();
            _border45.set_property_value(Border.StyleKey, _style38);
            _border45.set_property_value(Canvas.LeftKey, 20);
            _border45.set_property_value(Canvas.TopKey, 140);
            _border45.set_property_value(Border.WidthKey, 420);
            _border45.set_property_value(Border.HeightKey, 160);
            const _textBlock46 = new TextBlock();
            _textBlock46.set_property_value(TextBlock.TextKey, "Hover over the cards above to see Style triggers fire on IsMouseOver. Press and hold to see the IsPressed trigger lock in.");
            _textBlock46.set_property_value(TextBlock.FontSizeKey, 14);
            _textBlock46.set_property_value(TextBlock.TextWrappingKey, TextWrapping.Wrap);
            _textBlock46.set_property_value(TextBlock.ForegroundKey, DynamicResource(_textBlock46, "OnSurface"));
            _border45.SetChild(_textBlock46);
            _canvas40.AddChild(_border45);
            return _canvas40;
        }, DashboardVM);
        t.Set(DashboardVM, _tmpl39);
        return t;
    }
    get DashboardPrimaryCard() { return this.Resolve("DashboardPrimaryCard"); }
    set DashboardPrimaryCard(v) { this.Set("DashboardPrimaryCard", v); }
    get DashboardDangerCard() { return this.Resolve("DashboardDangerCard"); }
    set DashboardDangerCard(v) { this.Set("DashboardDangerCard", v); }
    get DashboardPaperCard() { return this.Resolve("DashboardPaperCard"); }
    set DashboardPaperCard(v) { this.Set("DashboardPaperCard", v); }
}
