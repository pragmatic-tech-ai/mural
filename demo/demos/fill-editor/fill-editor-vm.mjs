// VM for the fill-editor demo. Holds a Fill DP the editor edits; the
// view binds the preview Shape's Fill to the same brush so user
// gestures repaint live. Mirror Pen DP + the previous demo's pattern
// for a static stroke around the preview shape.
import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import { Color, Pen, SolidColorBrush, } from '@pragmatic-tech-ai/mural/visual-engine';
export class FillEditorDemoVM extends MuralBase {
    static FillKey = MuralBase.RegisterProperty(FillEditorDemoVM, 'Fill', undefined, MetaData.None);
    static OutlinePenKey = MuralBase.RegisterProperty(FillEditorDemoVM, 'OutlinePen', undefined, MetaData.None);
    static FillSummaryKey = MuralBase.RegisterProperty(FillEditorDemoVM, 'FillSummary', '', MetaData.None);
    constructor() {
        super();
        this.set_property_value(FillEditorDemoVM.FillKey, new SolidColorBrush(Color.FromHex('#1976d2')));
        this.set_property_value(FillEditorDemoVM.OutlinePenKey, new Pen(new SolidColorBrush(Color.FromHex('#0f172a')), 1.5));
        this._installFillWatcher();
        this._refreshSummary();
    }
    get Fill() { return this.get_property_value(FillEditorDemoVM.FillKey); }
    set Fill(v) { this.set_property_value(FillEditorDemoVM.FillKey, v); }
    get OutlinePen() { return this.get_property_value(FillEditorDemoVM.OutlinePenKey); }
    set OutlinePen(v) { this.set_property_value(FillEditorDemoVM.OutlinePenKey, v); }
    get FillSummary() { return this.get_property_value(FillEditorDemoVM.FillSummaryKey); }
    _installFillWatcher() {
        // Listen for Fill DP changes — when the editor swaps the brush
        // we re-summarise. We don't subscribe to brush-internal
        // properties; the editor builds a NEW Brush on every gesture
        // (variant swap, color edit) so a Fill listener is enough.
        this.PropertyChanged(FillEditorDemoVM.FillKey).subscribe(() => this._refreshSummary());
    }
    _refreshSummary() {
        const b = this.Fill;
        this.set_property_value(FillEditorDemoVM.FillSummaryKey, describe(b));
    }
}
function describe(brush) {
    if (brush === undefined)
        return 'Fill: (none)';
    const op = `${Math.round((brush.Opacity ?? 1) * 100)}% opacity`;
    const name = brush.constructor?.name ?? 'Brush';
    // Duck-typed subtype reads — base Brush lacks these; cast to the shape.
    const b = brush;
    if (name === 'SolidColorBrush' && b.Color?.ToHex)
        return `Fill: Solid ${b.Color.ToHex()} • ${op}`;
    if (name === 'LinearGradientBrush')
        return `Fill: Linear (${b.GradientStops?.length ?? 0} stops) • ${op}`;
    if (name === 'RadialGradientBrush')
        return `Fill: Radial (${b.GradientStops?.length ?? 0} stops) • ${op}`;
    if (name === 'PatternBrush')
        return `Fill: Pattern ${b.Kind} • ${op}`;
    if (name === 'ImageBrush')
        return `Fill: Picture (${b.ImageSource?.Uri ?? 'no uri'}) • ${op}`;
    return `Fill: ${name} • ${op}`;
}
