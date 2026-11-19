import { MuralBase, Element } from '../../runtime/index.js';
import { Pen } from '../../visual-engine/index.js';
import { Figure, registerFigureKind } from './figure.js';
import { TextAutoFit } from './shape-text.js';
import { BoardSettings } from './board-settings.js';

// Text-node fill + outline come from BoardSettings (transparent fill + slate
// outline by default — the legacy TextNodeVM look). Default box size stays local.
const TEXT_NODE_STROKE_WIDTH = 1;
const TEXT_NODE_DEFAULT_W = 120;
const TEXT_NODE_DEFAULT_H = 44;

// A text-box node: a *shapeless* Figure (no silhouette `_source`) whose
// ShapeText grows the box to fit. The Figure paints its OWN box — a rounded-rect
// card honouring the Fill/Stroke pen (PaintsCardBox); the template just hosts the
// label in PART_LabelHost. Geometry, GrowShape auto-fit, {field} resolution and
// in-place edit are all Figure-native. Being shapeless keeps `_getSource()`
// undefined, so the 'shape' serializer (which requires a source) leaves it to the
// 'text' serializer.
export class TextNode extends Figure
{
    static { MuralBase.OverrideMetadata(TextNode, Element.DefaultStyleKeyKey, { default_value: TextNode }); }

    constructor()
    {
        // Figure's ctor installs this.Text, resolves the (TextNode) default
        // style, and slots the label into PART_LabelHost — so no applyDefaultStyle
        // call here. Fill/Stroke are template-bound ($$Fill/$$Stroke), so setting
        // them after style resolution updates the box reactively.
        super();
        this.Text.AutoFit = TextAutoFit.GrowShape;
        this.Fill   = BoardSettings.TextNodeFill();
        this.Stroke = new Pen(BoardSettings.TextNodeStroke(), TEXT_NODE_STROKE_WIDTH);
        this.Width  = TEXT_NODE_DEFAULT_W;
        this.Height = TEXT_NODE_DEFAULT_H;
    }

    // A text box draws its box AS the Figure (rounded-rect card honouring the
    // Fill/Stroke pen), not via a template Border — so the Format Shape stroke
    // editor takes effect. Inherited by Callout.
    protected override get PaintsCardBox(): boolean { return true; }
}

// Register 'text' so Figure.fromKind('text', …) (toolbox drop / tile preview)
// mints a TextNode. Runs on module load; importing TextNode wires the kind.
registerFigureKind('text', (left, top, options) =>
{
    const t = new TextNode();
    t.Left   = left;
    t.Top    = top;
    t.Width  = options?.width  ?? TEXT_NODE_DEFAULT_W;
    t.Height = options?.height ?? TEXT_NODE_DEFAULT_H;
    t.BaseWidth  = t.Width;
    t.BaseHeight = t.Height;
    return t;
});
