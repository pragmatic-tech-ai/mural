import {
    MetaData,
    MuralBase,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { PathGeometry } from '../../visual-engine/index.js';
import { Shape } from './shape.js';
import { parsePathData } from '../svg-icon-parser.js';

// Data-driven Shape — the SVG-path-`d` analogue of WPF's `Path`. Hand it
// an SVG path-data string and it parses (via the shared parsePathData
// walker) into a single PathGeometry assigned to the inherited
// `Geometry` DP. Fill / Stroke / hit-testing all come from Shape; this
// subclass only owns the `Data` → Geometry translation.
//
// Layout-free by inheritance: Shape's MeasureOverride returns Size.Zero
// and RenderOverride paints the Geometry verbatim at local (0,0) — so a
// Path renders its authored coordinates as-is, including negative ones.
// That's exactly what connector caps need: author the cap's hot-point
// (arrow tip / circle centre) at local origin with the body trailing
// into −X, and the connector pipeline pins that origin to the resolved
// endpoint via Canvas.Left/Top and rotates about it.
//
// Empty / whitespace Data parses to zero figures → an empty PathGeometry
// → nothing painted. Malformed Data throws from parsePathData (ParseError)
// at set-time, surfacing the authoring mistake rather than silently
// rendering blank.
export class Path extends Shape
{
    public static readonly DataKey = MuralBase.RegisterProperty<string>(
        Path, 'Data', '', MetaData.Render);

    public get Data(): string { return this.get_property_value(Path.DataKey); }
    public set Data(v: string) { this.set_property_value(Path.DataKey, v); }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor === Path.DataKey.descriptor)
        {
            // A binding may resolve Data to undefined/null (e.g. a template
            // bound to an item field that is absent for one option) — treat
            // that as an empty path (no geometry) rather than crashing the
            // tokenizer.
            this.Geometry = new PathGeometry(parsePathData((newValue as string | undefined | null) ?? ''));
        }
    }
}
