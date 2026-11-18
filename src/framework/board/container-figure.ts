import { MuralBase, Element, MetaData, Panel } from '../../runtime/index.js';
import { Point } from '../../visual-engine/index.js';
import { Figure, registerFigureKind } from './figure.js';

// Title-band height + inner padding of a container. The child region begins at
// (CONTAINER_PADDING, CONTAINER_TITLE_BAND + CONTAINER_PADDING) — the value the
// coordinate walk reads back as ContentOrigin.
export const CONTAINER_TITLE_BAND = 24;
export const CONTAINER_PADDING    = 8;

// Default box for a freshly-dropped empty container (bigger than a shape's
// default so there is room to drop children into it).
export const CONTAINER_DEFAULT_W = 220;
export const CONTAINER_DEFAULT_H = 160;

// A container node: a titled, styleable box that hosts child Figures as TRUE
// visual descendants inside PART_ChildContainer (a clipped Canvas below the
// title band). Being a Figure it keeps geometry, Fill/Stroke styling, the
// ShapeText title (slotted into PART_LabelHost by Figure's ctor), and connector
// endpoints; the Figure's own ClipToBounds hard-clips children to the box. The
// Figure paints its OWN box (a rounded-rect card honouring the Fill/Stroke pen —
// PaintsCardBox), so the Format Shape stroke editor takes effect; the template
// Border only lays out the title + child region and hosts the drop-candidate tint.
export class ContainerFigure extends Figure
{
    static { MuralBase.OverrideMetadata(ContainerFigure, Element.DefaultStyleKeyKey, { default_value: ContainerFigure }); }

    // Transient drag affordance: true while a drag hovers this container as its
    // drop target. Driven by ContainerPlacement.highlightCandidate; a Style
    // trigger accents the box. Not persisted (view-only state).
    public static readonly IsDropCandidateKey = MuralBase.RegisterProperty<boolean>(
        ContainerFigure, 'IsDropCandidate', false, MetaData.None);
    public get IsDropCandidate(): boolean { return this.get_property_value(ContainerFigure.IsDropCandidateKey); }
    public set IsDropCandidate(v: boolean) { this.set_property_value(ContainerFigure.IsDropCandidateKey, v); }

    private _childHost: Panel | undefined;

    constructor()
    {
        super(); // Figure ctor calls applyDefaultStyle() → resolves the ContainerFigure template
        this._childHost = this.GetTemplateChild('PART_ChildContainer') as Panel | undefined;
    }

    // The panel that hosts nested child Figures (PART_ChildContainer). The
    // ContainerPlacement collaborator adds/removes children here.
    public get ChildHost(): Panel | undefined { return this._childHost; }

    // The child host's inset from this container's own top-left: padding across,
    // title band + padding down. boardSpaceRect sums this per nesting level.
    public override get ContentOrigin(): Point
    {
        return new Point(CONTAINER_PADDING, CONTAINER_TITLE_BAND + CONTAINER_PADDING);
    }

    // A container draws its box AS the Figure (rounded-rect card honouring the
    // Fill/Stroke pen), not via a template Border — so the Format Shape stroke
    // editor takes effect. Independent of SizeToContent (a container opts OUT of
    // content-fitting but still paints its own box). Inherited by
    // ContentContainerFigure.
    protected override get PaintsCardBox(): boolean { return true; }
}

// Register 'container' so Figure.fromKind('container', …) (toolbox drop / catalog
// path) mints a ContainerFigure. Runs on module load; importing ContainerFigure
// anywhere in the board bundle wires the kind.
registerFigureKind('container', (left, top, options) =>
{
    const c = new ContainerFigure();
    c.Left   = left;
    c.Top    = top;
    c.Width  = options?.width  ?? CONTAINER_DEFAULT_W;
    c.Height = options?.height ?? CONTAINER_DEFAULT_H;
    c.BaseWidth  = c.Width;
    c.BaseHeight = c.Height;
    return c;
});
