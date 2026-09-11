// VM for the pen-editor demo. A single Pen DP the editor edits in
// place; the .mu file binds the preview Shape's Stroke to the same Pen
// instance so user gestures repaint the preview live.
//
// We also expose the Pen's individual properties via flat DPs so the
// status read-out at the bottom of the demo can show the live values
// without binding to a Pen-typed property tree. A property-change
// listener installed on the Pen rebuilds these mirror DPs on every
// mutation.
import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import { Color, Pen, SolidColorBrush, } from '@pragmatic-tech-ai/mural/visual-engine';
export class PenEditorDemoVM extends MuralBase {
    static PenKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'Pen', undefined, MetaData.None);
    static BrushSummaryKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'BrushSummary', '', MetaData.None);
    static ThicknessReadoutKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'ThicknessReadout', '', MetaData.None);
    static DashReadoutKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'DashReadout', '', MetaData.None);
    static CapReadoutKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'CapReadout', '', MetaData.None);
    static JoinReadoutKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'JoinReadout', '', MetaData.None);
    static MiterReadoutKey = MuralBase.RegisterProperty(PenEditorDemoVM, 'MiterReadout', '', MetaData.None);
    constructor() {
        super();
        const pen = new Pen(new SolidColorBrush(Color.FromHex('#f59e0b')), 4);
        this.set_property_value(PenEditorDemoVM.PenKey, pen);
        this._installPenWatchers(pen);
        this._refreshReadouts();
    }
    get Pen() { return this.get_property_value(PenEditorDemoVM.PenKey); }
    set Pen(v) { this.set_property_value(PenEditorDemoVM.PenKey, v); }
    get BrushSummary() { return this.get_property_value(PenEditorDemoVM.BrushSummaryKey); }
    get ThicknessReadout() { return this.get_property_value(PenEditorDemoVM.ThicknessReadoutKey); }
    get DashReadout() { return this.get_property_value(PenEditorDemoVM.DashReadoutKey); }
    get CapReadout() { return this.get_property_value(PenEditorDemoVM.CapReadoutKey); }
    get JoinReadout() { return this.get_property_value(PenEditorDemoVM.JoinReadoutKey); }
    get MiterReadout() { return this.get_property_value(PenEditorDemoVM.MiterReadoutKey); }
    // Subscribe to every property on the bound Pen so the status
    // strings track live edits. Plain field for the unsubscribe thunks
    // — view-invisible state, fine to live off the DP surface.
    _installPenWatchers(pen) {
        const refresh = () => this._refreshReadouts();
        for (const key of [Pen.BrushKey, Pen.ThicknessKey, Pen.DashStyleKey, Pen.LineCapKey, Pen.LineJoinKey, Pen.MiterLimitKey]) {
            pen.PropertyChanged(key).subscribe(refresh);
        }
    }
    _refreshReadouts() {
        const pen = this.Pen;
        if (pen === undefined)
            return;
        this.set_property_value(PenEditorDemoVM.BrushSummaryKey, describeBrush(pen.Brush));
        this.set_property_value(PenEditorDemoVM.ThicknessReadoutKey, `Thickness ${formatNum(pen.Thickness)} px`);
        this.set_property_value(PenEditorDemoVM.DashReadoutKey, `Dash ${describeDash(pen.DashStyle)}`);
        this.set_property_value(PenEditorDemoVM.CapReadoutKey, `Cap ${pen.LineCap}`);
        this.set_property_value(PenEditorDemoVM.JoinReadoutKey, `Join ${pen.LineJoin}`);
        this.set_property_value(PenEditorDemoVM.MiterReadoutKey, `Miter limit ${formatNum(pen.MiterLimit)}`);
    }
}
function formatNum(value) {
    if (Math.abs(value - Math.round(value)) < 1e-6)
        return String(Math.round(value));
    return value.toFixed(1);
}
function describeBrush(brush) {
    if (brush === undefined)
        return 'Brush: (none)';
    const name = brush.constructor?.name ?? 'Brush';
    // Duck-typed subtype reads — base Brush lacks these; cast to the shape.
    const b = brush;
    if (name === 'SolidColorBrush' && b.Color?.ToHex)
        return `Brush: Solid ${b.Color.ToHex()}`;
    if (name === 'LinearGradientBrush')
        return `Brush: Linear (${b.GradientStops?.length ?? 0} stops)`;
    if (name === 'RadialGradientBrush')
        return `Brush: Radial (${b.GradientStops?.length ?? 0} stops)`;
    if (name === 'PatternBrush')
        return `Brush: Pattern ${b.Kind}`;
    return `Brush: ${name}`;
}
function describeDash(dash) {
    if (dash === undefined || dash.Dashes === undefined)
        return 'Solid';
    const d = dash.Dashes;
    if (d.length === 0)
        return 'Solid';
    // Pin against the known presets so labels match the editor dropdown.
    const equals = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (equals(d, [2, 2]))
        return 'Dash';
    if (equals(d, [0, 2]))
        return 'Dot';
    if (equals(d, [2, 2, 0, 2]))
        return 'Dash-Dot';
    if (equals(d, [2, 2, 0, 2, 0, 2]))
        return 'Dash-Dot-Dot';
    return `Custom [${d.join(', ')}]`;
}
