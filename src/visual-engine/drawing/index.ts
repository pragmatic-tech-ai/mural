// Drawing — brushes, pens, effects, image sources, transforms, and the
// DrawingContext + SvgRenderer pipeline that turns Visual.Render calls
// into SVG output.
export {
    Transform,
    TranslateTransform,
    RotateTransform,
    ScaleTransform,
    SkewTransform,
    MatrixTransform,
    TransformGroup,
} from './transform.js';
export {
    Brush,
    SolidColorBrush,
    LinearGradientBrush,
    RadialGradientBrush,
    ImageBrush,
    PatternBrush,
    PatternKind,
    GradientStop,
    GradientSpreadMethod,
    AlignmentX,
    AlignmentY,
} from './brush.js';
export {
    BitmapImage,
    ImageSource,
    Stretch,
} from './image-source.js';
export { Pen, DashStyle, LineCap, LineJoin } from './pen.js';
export { Effect } from './effect.js';
export { DropShadowEffect, MaterialElevationEffect } from './drop-shadow-effect.js';
export { PragmaticShadowEffect } from './pragmatic-shadow-effect.js';
export { type DrawingContext } from './drawing-context.js';
export { SvgDrawingContext } from './svg-drawing-context.js';
export {
    SvgDomDrawingContext,
    type SvgDomDrawingContextOptions,
} from './svg-dom-drawing-context.js';
export { SvgRenderer, VISUAL_BACKREF, type SvgRendererOptions } from './svg-renderer.js';
export {
    SolidColorBrushAnimation,
    type SolidColorBrushAnimationProps,
} from './solid-color-brush-animation.js';
// Module-load side effect: registers Thickness / CornerRadius / number
// SchemeTransition animators (§ 17.3). Side-effect import — there's no
// public symbol to export; the registration runs when the module is
// first loaded, which happens via this re-export.
import './scheme-transition-animators.js';
