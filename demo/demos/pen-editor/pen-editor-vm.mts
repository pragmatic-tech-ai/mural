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
import {
    Color,
    Pen,
    SolidColorBrush,
    type Brush,
    type DashStyle,
} from '@pragmatic-tech-ai/mural/visual-engine';

export class PenEditorDemoVM extends MuralBase
{
    static PenKey              = MuralBase.RegisterProperty<Pen | undefined>(PenEditorDemoVM, 'Pen',              undefined, MetaData.None);
    static BrushSummaryKey     = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'BrushSummary',     '',        MetaData.None);
    static ThicknessReadoutKey = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'ThicknessReadout', '',        MetaData.None);
    static DashReadoutKey      = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'DashReadout',      '',        MetaData.None);
    static CapReadoutKey       = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'CapReadout',       '',        MetaData.None);
    static JoinReadoutKey      = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'JoinReadout',      '',        MetaData.None);
    static MiterReadoutKey     = MuralBase.RegisterProperty<string>(PenEditorDemoVM, 'MiterReadout',     '',        MetaData.None);

    constructor()
    {
        super();
        const pen = new Pen(new SolidColorBrush(Color.FromHex('#f59e0b')), 4);
        this.set_property_value(PenEditorDemoVM.PenKey, pen);
        this._installPenWatchers(pen);
        this._refreshReadouts();
    }

    get Pen():             Pen | undefined { return this.get_property_value(PenEditorDemoVM.PenKey); }
    set Pen(v:             Pen | undefined) { this.set_property_value(PenEditorDemoVM.PenKey, v); }
    get BrushSummary():    string { return this.get_property_value(PenEditorDemoVM.BrushSummaryKey); }
    get ThicknessReadout():string { return this.get_property_value(PenEditorDemoVM.ThicknessReadoutKey); }
    get DashReadout():     string { return this.get_property_value(PenEditorDemoVM.DashReadoutKey); }
    get CapReadout():      string { return this.get_property_value(PenEditorDemoVM.CapReadoutKey); }
    get JoinReadout():     string { return this.get_property_value(PenEditorDemoVM.JoinReadoutKey); }
    get MiterReadout():    string { return this.get_property_value(PenEditorDemoVM.MiterReadoutKey); }

    // Subscribe to every property on the bound Pen so the status
    // strings track live edits. Plain field for the unsubscribe thunks
    // — view-invisible state, fine to live off the DP surface.
    _installPenWatchers(pen: Pen): void
    {
        const refresh = (): void => this._refreshReadouts();
        for (const key of [Pen.BrushKey, Pen.ThicknessKey, Pen.DashStyleKey, Pen.LineCapKey, Pen.LineJoinKey, Pen.MiterLimitKey])
        {
            pen.PropertyChanged(key).subscribe(refresh);
        }
    }

    _refreshReadouts(): void
    {
        const pen = this.Pen;
        if (pen === undefined) return;
        this.set_property_value(PenEditorDemoVM.BrushSummaryKey,     describeBrush(pen.Brush));
        this.set_property_value(PenEditorDemoVM.ThicknessReadoutKey, `Thickness ${formatNum(pen.Thickness)} px`);
        this.set_property_value(PenEditorDemoVM.DashReadoutKey,      `Dash ${describeDash(pen.DashStyle)}`);
        this.set_property_value(PenEditorDemoVM.CapReadoutKey,       `Cap ${pen.LineCap}`);
        this.set_property_value(PenEditorDemoVM.JoinReadoutKey,      `Join ${pen.LineJoin}`);
        this.set_property_value(PenEditorDemoVM.MiterReadoutKey,     `Miter limit ${formatNum(pen.MiterLimit)}`);
    }
}

function formatNum(value: number): string
{
    if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
    return value.toFixed(1);
}

// Structural view over the brush-subtype members this read-only summariser
// duck-types into. Base Brush exposes only Opacity/Transform, so we cast to
// this shape; fields are optional since which exist depends on the runtime
// brush class.
interface BrushSummaryShape
{
    Color?:         { ToHex?(): string };
    GradientStops?: readonly unknown[];
    Kind?:          unknown;
}

function describeBrush(brush: Brush | undefined): string
{
    if (brush === undefined) return 'Brush: (none)';
    const name = brush.constructor?.name ?? 'Brush';
    // Duck-typed subtype reads — base Brush lacks these; cast to the shape.
    const b = brush as unknown as BrushSummaryShape;
    if (name === 'SolidColorBrush' && b.Color?.ToHex) return `Brush: Solid ${b.Color.ToHex()}`;
    if (name === 'LinearGradientBrush')               return `Brush: Linear (${b.GradientStops?.length ?? 0} stops)`;
    if (name === 'RadialGradientBrush')               return `Brush: Radial (${b.GradientStops?.length ?? 0} stops)`;
    if (name === 'PatternBrush')                      return `Brush: Pattern ${b.Kind}`;
    return `Brush: ${name}`;
}

function describeDash(dash: DashStyle | undefined): string
{
    if (dash === undefined || dash.Dashes === undefined) return 'Solid';
    const d = dash.Dashes;
    if (d.length === 0) return 'Solid';
    // Pin against the known presets so labels match the editor dropdown.
    const equals = (a: readonly number[], b: readonly number[]): boolean =>
        a.length === b.length && a.every((v, i) => v === b[i]);
    if (equals(d, [2, 2]))             return 'Dash';
    if (equals(d, [0, 2]))             return 'Dot';
    if (equals(d, [2, 2, 0, 2]))       return 'Dash-Dot';
    if (equals(d, [2, 2, 0, 2, 0, 2])) return 'Dash-Dot-Dot';
    return `Custom [${d.join(', ')}]`;
}
