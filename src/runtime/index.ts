// Barrel re-exports for the runtime property/binding system.
// Consumers should import from here rather than the individual files.
export {
    MetaData,
    affectsMeasure,
    affectsArrange,
    affectsRender,
    inherits,
    bindsTwoWayByDefault,
    isNotDataBindable,
    isAnimationProhibited,
} from './metadata.js';
export {
    PropertyDescriptor,
    validateTargetTypes,
    type PropertyMetadata,
    type CoerceValue,
    type ValidateValue,
    type ValidateTarget,
} from './property-descriptor.js';
export {
    AncestorBinding,
    SelfBinding,
    Binding,
    BindingMode,
    composeConverters,
    Lighten,
    Darken,
    Mix,
    Saturate,
    Desaturate,
    Alpha,
    Is,
    ToVisibility,
    DataContextBinding,
    DynamicResource,
    EffectiveValueDescriptor,
    ElementNameBinding,
    ServiceBinding,
    MultiBinding,
    MultiTemplateBinding,
    PriorityBinding,
    PropertyValueSource,
    TemplateBinding,
    Validation,
    type BindingOptions,
    type PropertyChangedEventArgs,
    type ValidationError,
    type ValidationResult,
    type ValidationRule,
    type ValueConverter,
} from './binding/index.js';
export { Observable } from './observable.js';
// Signal / Disposable live in todl-runtime (zero-dep); re-exported here so
// consumers subscribing to a `PropertyChanged(name)` change channel can type
// the returned subscription without a second import path.
export { Signal, type Disposable } from '@pragmatic-tech-ai/todl-runtime';
// Storage IO subsystem lives in todl-runtime (zero-dep); re-exported here so
// consumers already importing '@pragmatic-tech-ai/mural/runtime' need no second
// import path. Canonical source: @pragmatic-tech-ai/todl-runtime.
export {
    type IStorage, type StorageEntry, type ILocalFileAccess,
    isLocalFileAccess, compareStorageEntries, FakeStorage, copyTree,
} from '@pragmatic-tech-ai/todl-runtime';
export { MuralBase, PropertyKey } from './model.js';
export { Freezable, cloneFreezableValue } from './freezable.js';
export { Behavior } from '../visual-engine/behavior.js';
export {
    Visual,
    HorizontalAlignment,
    VerticalAlignment,
    Visibility,
    type VisualHost,
} from '../visual-engine/visual.js';
export { Element, Single, Panel, type ElementCtor } from '../visual-engine/element.js';
export { Adorner, AdornerLayer, AdornerDecorator, DragGhostAdorner } from '../visual-engine/adorner.js';
export { NameScope } from '../visual-engine/namescope.js';
export {
    ResourceDictionary,
    SetResourceDictionaryLoader,
    GetResourceDictionaryLoader,
    type DictionaryLoader,
    type ResourceChangeListener,
    type ResourceKey,
} from './resource-dictionary.js';
export {
    Application,
    type ApplicationInitOptions,
    type AutoSchemeInitOptions,
    type MountableTarget,
} from './application.js';
export {
    ServiceProvider,
    ServiceKey,
    type IServiceProvider,
    type IServiceContainer,
    type ServiceConstructor,
    type ServiceToken,
    type ServiceFactory,
    ServiceLifetime,
} from './services/service-provider.js';
export { ServiceBase } from './services/service-base.js';
export { ApplicationService, type IApplicationService } from './services/application-service.js';
// InputManager moved to `mural/framework`.
// RoutedCommand / CommandBinding / CommandManager / InputBinding /
// KeyBinding / MouseBinding / ICommandSource + CommandSourceHelper /
// ApplicationCommands etc. moved to
// `mural/framework/commands`. The runtime barrel
// keeps only the foundational `ICommand` + `RelayCommand` from
// `./input/command.js`.
export {
    CommandBase,
    RelayCommand,
    type CommandMetadataInit,
    type ICommand,
} from './command.js';
export {
    EventTrigger,
    InvokeCommandAction,
} from './event-trigger.js';
// Re-export the input pipeline from visual-engine for backward compat —
// downstream code expects these names on the runtime barrel.
export {
    DataObject,
    DragDrop,
    DragDropEffects,
    DragEventArgs,
    DragSession,
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
    type DragDropOptions,
    type DragEventHandlers,
    type DragEventInit,
    type DragPreviewKind,
    type DragStartCallback,
    type DragStartSpec,
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
    Key,
    keyFromDom,
    MouseButton,
    MouseButtonState,
    KeyStates,
    CaptureMode,
    FocusNavigationDirection,
    KeyboardNavigationMode,
    mouseButtonFromPointer,
    Mouse,
    MouseDevice,
    Keyboard,
    KeyboardDevice,
    Stylus,
    StylusDevice,
    Touch,
    TouchDevice,
    FocusManager,
    KeyboardNavigation,
    TraversalRequest,
    ManipulationModes,
    ManipulationDelta,
    ManipulationVelocities,
    ManipulationProcessor,
    ManipulationStartingEventArgs,
    ManipulationStartedEventArgs,
    ManipulationDeltaEventArgs,
    ManipulationInertiaStartingEventArgs,
    ManipulationCompletedEventArgs,
    type ManipulationEventHandlers,
    // Font subsystem — value classes + central registry. Re-exported here
    // (riding the existing visual-engine barrel edge to avoid a new import
    // cycle) so markup-emitted code and MVVM consumers reach them through
    // `mural/runtime`.
    FontFamily,
    Typeface,
    FontWeight,
    FontStyle,
    FontManager,
    RegisteredFont,
    FontSourceKind,
    type FontSource,
    type FontRegistration,
    type FontConsumer,
} from '../visual-engine/index.js';
export {
    Style,
    CompositeStyle,
    Setter,
    SetterFactory,
    PropertyTrigger,
    MultiTrigger,
    DataTrigger,
    MultiDataTrigger,
    TriggerUnset,
    TriggerSet,
    triggerConditionMet,
    type StyleComponent,
    type DataTriggerBindingFactory,
    type DataTriggerCondition,
    type TriggerCondition,
} from './style.js';
export {
    AttachBehaviorAction,
    BeginStoryboardAction,
    DetachBehaviorAction,
    PauseStoryboardAction,
    ResumeStoryboardAction,
    StopStoryboardAction,
    TriggerAction,
} from './trigger-actions.js';
export { type IScrollInfo, isScrollInfo } from '../visual-engine/scroll-info.js';
export {
    ObservableCollection,
    type CollectionChange,
    type CollectionChangeListener,
    type IReadOnlyObservableCollection,
} from './observable-collection.js';
export { observe_array, subscribe_array, is_observed_array } from './observable-array.js';
export { type ICapability, type IShellModule } from './shell-modules.js';
export {
    findAlignmentGuides,
    type AlignmentGuide,
    type AlignmentResult,
    type AlignmentOptions,
    EdgeKind,
    AlignmentAxis,
} from './alignment-math.js';
export {
    snapGuidePosition, snapRectToGuides, chooseTickInterval, ticksInRange, guideCursorFor,
    type PersistentGuide, type GuideGlue, type GuideAxisSnap, type GuideSnap, type GuidePreview,
} from './guide-math.js';
export { Point, Size, Rect, Color, Matrix, Thickness } from '../visual-engine/primitives.js';
export { CornerRadius } from '../visual-engine/corner-radius.js';
export {
    Typography,
    type TypographyProps,
    type TypographyWeight,
} from '../visual-engine/typography.js';
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
    SchemeTransitionTokens,
    type SchemeTransition,
    type SchemeTransitionAnimatorFactory,
    type ThemeOptions,
    type TokenCatalog,
    type TokenSpec,
    type TokenType,
    type ViewportBreakpoints,
} from '../visual-engine/theme/index.js';
export { type DrawingContext } from '../visual-engine/drawing-context.js';
export {
    ApproximateTextMeasurer,
    APPROXIMATE_TEXT_MEASURER,
    type TextMeasurer,
    type TextMetrics,
} from '../visual-engine/text-measurer.js';
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
} from '../visual-engine/animation/index.js';
