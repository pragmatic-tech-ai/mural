// Barrel re-exports for the visual engine.
//
// After consolidation, visual-engine owns Visual + everything the
// display / input / animation pipeline needs (primitives, brushes,
// geometries, drawing context, routed events, drag-drop, themes,
// adorners, behaviors, name-scope, text measurement). The runtime
// package retains only MuralBase + property system + bindings + styles +
// collections + commands.

export * from './geometry/index.js';
export * from './drawing/index.js';
export * from './text/index.js';
export * from './targets/index.js';

// Display / layout primitives.
export { Point, Size, Rect, Color, Matrix, Thickness, transformBounds } from './primitives.js';
export { CornerRadius } from './corner-radius.js';
export {
    Visual,
    HorizontalAlignment,
    VerticalAlignment,
    Visibility,
    type VisualHost,
} from './visual.js';
export { Element, Single, Panel, type ElementCtor } from './element.js';
export { Adorner, AdornerLayer, AdornerDecorator, DragGhostAdorner } from './adorner.js';
export { NameScope } from './namescope.js';
export { Behavior } from './behavior.js';
export { type IScrollInfo, isScrollInfo } from './scroll-info.js';
export {
    Typography,
    type TypographyProps,
    type TypographyWeight,
} from './typography.js';
export { type DrawingContext } from './drawing-context.js';
export {
    ApproximateTextMeasurer,
    APPROXIMATE_TEXT_MEASURER,
    type TextMeasurer,
    type TextMetrics,
} from './text-measurer.js';

// Input pipeline — routed events + drag-drop. ICommand + RelayCommand
// + EventTrigger stay in runtime (data-side MVVM glue).
export {
    DataObject,
    DragDrop,
    DragDropEffects,
    DragSession,
    type DragDropOptions,
    type DragPreviewKind,
    type DragStartCallback,
    type DragStartSpec,
} from './drag-drop.js';
export {
    DragEventArgs,
    FocusEventArgs,
    KeyEventArgs,
    NoModifiers,
    PointerButton,
    PointerEventArgs,
    QueryCursorEventArgs,
    RoutedEventArgs,
    TextInputEventArgs,
    WheelEventArgs,
    buildRoute,
    dispatchDrag,
    dispatchFocus,
    dispatchKeyboardFocus,
    dispatchKey,
    dispatchPointer,
    dispatchPointerDirect,
    dispatchQueryCursor,
    dispatchTextInput,
    type DragEventHandlers,
    type DragEventInit,
    type FocusEventHandlers,
    type KeyEventInit,
    type KeyboardEventHandlers,
    type QueryCursorEventHandlers,
    ModifierKeys,
    hasModifier,
    toModifierKeys,
    type PointerEventHandlers,
    type PointerEventInit,
    type RoutedEventKind,
    type TextInputEventInit,
    WheelDeltaMode,
    type WheelEventInit,
} from './routed-event.js';

// Input enums (WPF parity).
export { Key, keyFromDom } from './input/key.js';
export {
    MouseButton,
    MouseButtonState,
    KeyStates,
    CaptureMode,
    FocusNavigationDirection,
    KeyboardNavigationMode,
    mouseButtonFromPointer,
} from './input/input-enums.js';

// Device façades (WPF Mouse / Keyboard / FocusManager parity).
export { Mouse, MouseDevice } from './input/mouse.js';
export { Keyboard, KeyboardDevice } from './input/keyboard.js';
export { Stylus, StylusDevice } from './input/stylus.js';
export { Touch, TouchDevice } from './input/touch.js';
export { FocusManager } from './input/focus-manager.js';
export { KeyboardNavigation, TraversalRequest } from './input/keyboard-navigation.js';
export {
    ManipulationModes,
    ManipulationDelta,
    ManipulationVelocities,
    ManipulationProcessor,
    ManipulationCoordinator,
    ManipulationStartingEventArgs,
    ManipulationStartedEventArgs,
    ManipulationDeltaEventArgs,
    ManipulationInertiaStartingEventArgs,
    ManipulationCompletedEventArgs,
    dispatchManipulation,
    type ManipulationEventHandlers,
} from './input/manipulation.js';

// Animation subsystem.
export {
    AnimationManager,
    AnimationTimeline,
    ColorAnimation,
    ColorAnimationUsingKeyFrames,
    ColorKeyFrame,
    DiscreteColorKeyFrame,
    DiscreteDoubleKeyFrame,
    DiscreteThicknessKeyFrame,
    DoubleAnimation,
    DoubleAnimationUsingKeyFrames,
    DoubleKeyFrame,
    EasingColorKeyFrame,
    EasingDoubleKeyFrame,
    EasingThicknessKeyFrame,
    Easings,
    FillBehavior,
    LinearColorKeyFrame,
    LinearDoubleKeyFrame,
    LinearThicknessKeyFrame,
    cubicBezier,
    ManualClock,
    PropertyTransition,
    registerImplicitTransitionBuilder,
    _resetImplicitTransitionBuildersForTests,
    type ImplicitTransitionBuilder,
    RafClock,
    Storyboard,
    StoryboardState,
    ThicknessAnimation,
    ThicknessAnimationUsingKeyFrames,
    ThicknessKeyFrame,
    interpolateColor,
    interpolateNumber,
    interpolateCornerRadius,
    interpolateThickness,
    type AnimationTimelineProps,
    type ColorAnimationProps,
    type ColorAnimationUsingKeyFramesProps,
    type DoubleAnimationProps,
    type DoubleAnimationUsingKeyFramesProps,
    type EasingFunction,
    type IClock,
    type Interpolator,
    type ThicknessAnimationProps,
    type ThicknessAnimationUsingKeyFramesProps,
    TimelinePhase,
} from './animation/index.js';

// Themes.
export {
    Density,
    M3_BREAKPOINTS,
    MediaWatcher,
    Pointer,
    PreferredScheme,
    PrefersContrast,
    Scheme,
    Theme,
    ThemeManager,
    ViewportClass,
    classifyViewport,
    defineScheme,
    defineTheme,
    addSchemeTransitionAnimator,
    _clearAllSchemeTransitionAnimators,
    getSchemeTransitionAnimator,
    registerSchemeTransitionAnimator,
    type ActivateThemeOptions,
    type AutoSchemeOptions,
    type SchemeOptions,
    type SchemeTransition,
    type SchemeTransitionAnimatorFactory,
    type ThemeOptions,
    type TokenCatalog,
    type TokenSpec,
    type TokenType,
    type ViewportBreakpoints,
} from './theme/index.js';

// Help — a framework attached property linking a control to a help scenario.
export { Help } from './help.js';
