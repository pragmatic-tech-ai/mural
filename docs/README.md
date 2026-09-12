# Mural — Library Documentation

Mural is a WPF-style retained-mode UI framework for TypeScript. It gives you a
property/binding system, a visual tree with layout + render lifecycle, brushes
and geometry, a control library with templating + styling + data-binding +
virtualization, and rendering through SVG today (Canvas / WebGL / file output
to follow).

This folder is the user-facing documentation for everything in [src/](../src/).
For the architectural design rationale see
[visual-engine-design.md](visual-engine-design.md).

## Layers

```
┌────────────────────────────────────────────────────────────────────────┐
│  basic      (src/basic/)                                                │
│  Border, TextBlock, Canvas, ContentControl + ContentPresenter,          │
│  ItemsControl + ItemsPresenter + ItemContainerGenerator,                │
│  VirtualizingStackPanel, ScrollViewer, ControlTemplate, DataTemplate    │
│                                                                         │
│       depends on ▼                                                      │
├────────────────────────────────────────────────────────────────────────┤
│  visual-engine (src/visual-engine/)                                     │
│  Brush / Pen / Geometry / Transform models, DrawingContext              │
│  augmentation (DrawRectangle / DrawText / DrawGeometry / PushClip /     │
│  PushTransform), SvgDrawingContext, PresentationTarget hierarchy,       │
│  FontMetricsMeasurer, Google Fonts loader                                │
│                                                                         │
│       depends on ▼                                                      │
├────────────────────────────────────────────────────────────────────────┤
│  runtime     (src/runtime/)                                             │
│  Model, properties, bindings + DynamicResource, Visual + tree with      │
│  visual/logical split, layout lifecycle, geometric primitives, Style    │
│  + Setter + PropertyTrigger, ResourceDictionary + NameScope,            │
│  ObservableCollection, IScrollInfo, TextMeasurer interface              │
└────────────────────────────────────────────────────────────────────────┘
```

Dependencies flow downward only. The split mirrors WPF's: `runtime` is the
WindowsBase analogue (DependencyObject layer), `visual-engine` is the
PresentationCore analogue (Visual + Drawing layer), `basic` is the
PresentationFramework analogue (the templated-control library).

## Documentation index

Start with whichever doc matches what you're trying to do.

### Foundations
- **[property-system.md](property-system.md)** — `Model`, `RegisterProperty`,
  bindings, value priority (`Coerced > Animated > Binding > Local > Trigger
  > Style > Inherited > Default`), listeners, read-only properties, attached
  / cross-class properties.
- **[visual-tree.md](visual-tree.md)** — `Visual`, `Single`, `Panel`, the
  visual vs logical tree split, attaching / detaching children, the host
  back-pointer, `TemplatedParent`, `Name` / `FindName`, `Clip`.
- **[layout.md](layout.md)** — `Measure` / `Arrange` / `Render` lifecycle,
  `MeasureOverride` / `ArrangeOverride` / `RenderOverride`, `Width` / `Height`
  / `MinWidth` / `MaxWidth` / `HorizontalAlignment` / `VerticalAlignment` /
  `Margin`, property inheritance, invalidation cascade.
- **[drawing.md](drawing.md)** — `DrawingContext` (`DrawRectangle` /
  `DrawGeometry` / `DrawText` / `PushTransform` / `PushClip` / `Pop`),
  brushes (`SolidColorBrush`, gradients, `ImageBrush`), `Pen`, `Geometry`,
  `Transform`, geometric primitives.
- **[color-routines.md](color-routines.md)** — inline color in `.mu`: `#hex`
  / `#name` literals, the `Color` runtime type (`FromHex` / `Lerp` /
  `AdjustSaturation` / `WithAlpha`), and the `<<` color-modifier pipe
  (`Lighten` / `Darken` / `Mix` / `Saturate` / `Desaturate` / `Alpha`), with
  static-fold vs. reactive `@resource` lowering and custom modifiers.
- **[targets.md](targets.md)** — `PresentationTarget` hierarchy
  (`HtmlTarget` / `FileTarget` / `HeadlessTarget`), `SvgDrawingContext`.
- **[text-measurement.md](text-measurement.md)** — `TextMeasurer` interface,
  `ApproximateTextMeasurer`, `FontMetricsMeasurer` (opentype.js),
  Google Fonts loader.
- **[fonts.md](fonts.md)** — the font system: `FontFamily` / `Typeface`
  value classes, the `FontManager` registry (register → measure + render +
  glyphs), `@font-face` embedding, the markup `fonts { … }` block, and
  `glyphs @Family` unification.

### Application architecture
- **[resources.md](resources.md)** — `ResourceDictionary`,
  `Visual.Resources`, `TryFindResource` / `FindResource`,
  `MergedDictionaries`, change notifications, `DynamicResource`.
- **[styles.md](styles.md)** — `Style` + `Setter` + `BasedOn`,
  `TargetType` validation, sealing, explicit vs implicit style,
  `Setter.value` as `Binding` / `DynamicResource` via `SetterFactory`,
  `PropertyTrigger`, `Style.Resources`.
- **[templating.md](templating.md)** — `ControlTemplate`,
  `ContentControl` + `ContentPresenter`, `TemplateBinding`,
  `TemplatedParent`, per-template `NameScope` + `GetTemplateChild`,
  template-internal inheritance.
- **[items-and-scrolling.md](items-and-scrolling.md)** —
  `ObservableCollection`, `DataTemplate`, `ItemsControl` +
  `ItemsPresenter` + `ItemContainerGenerator`, `VirtualizingPanel` +
  `VirtualizingStackPanel`, `IScrollInfo`, `ScrollViewer`.
- **[dynamic-markup-ingestion.md](dynamic-markup-ingestion.md)** —
  compiling mural markup *strings* at runtime with `instantiate()`:
  the compile-time-`symbols` vs runtime-`ctx` split, converter
  instances, wrapping into a `DataTemplate`; when to prefer a static `.mu`.
- **[basic.md](basic.md)** — concrete-control reference:
  `Border`, `TextBlock`, `Canvas`, `ContentControl`, `ItemsControl`,
  `ScrollViewer`, etc.
- **[grid.md](grid.md)** — `Grid` panel: pixel / auto / star track
  sizing, `Grid.Row` / `Column` / `RowSpan` / `ColumnSpan` attached
  properties, four-pass measure / prefix-sum arrange.
- **[behaviors.md](behaviors.md)** — `Behavior` abstract base,
  `Visual.AddBehavior`, markup `Behaviors { … }` block, the
  `ListReorderBehavior` reference behavior.
- **[services-and-di.md](services-and-di.md)** — the dependency-injection
  container (`ServiceProvider` + `IServiceProvider` / `IServiceContainer`),
  `ServiceBase` services-as-view-models, lifetimes & scopes, the markup
  `.services:` composition block (with inline-config seeding / injection),
  `$service(Token)` consumption bindings, the general `.Member:` list /
  dictionary block, and shell scope integration.
- **[shell-architecture.md](shell-architecture.md)** — the services-driven
  application shell: `ShellBase` / `EditorShell` / `ViewerShell` and their
  region hosts, modules & capabilities (`ShellModule` / `Capability` /
  `ServiceKey`), the per-shell DI scope, the service catalog
  (`NavigationService`, `ContentHostService` + `DocumentsContentHostService`,
  `DocumentSelectorService`, `StatusService`, `InspectorService`),
  implicit-DataTemplate rendering, conventions & gotchas, and the demo-platform
  worked example.
- **[theme-architecture.md](theme-architecture.md)** — the theming system:
  theme dictionaries, scheme tokens, and how the active theme populates
  `Application.Resources`.
- **[marquee-selection.md](marquee-selection.md)** — Explorer-style
  rubber-band multi-select on any `Selector`. `AllowMarqueeSelection` /
  `MarqueeBoundsPolicy` DPs, modifier modes, click-on-empty-space
  semantics, adorner placement, batching.
- **[commands-and-surfaces.md](commands-and-surfaces.md)** — UI/UX
  design for the command system: layered architecture (commands stay
  pure, controls own all visual UX), ToolBar / Menu (hamburger
  fly-out) / Ribbon (core + contextual tabs) surfaces, the `commands`
  demo. ToolBar + Menu + ContextMenu shipped; Ribbon tracked in
  [backlog § 5.11](../current-backlog.md).

### Diagram
- **[diagram-api-guide.md](diagram-api-guide.md)** — developer reference for
  the diagram subsystem: `DiagramDocument`, the `Diagram` control, `Figure` /
  `Group`, the shape catalog, text (`ShapeText`, rich content, fields,
  auto-fit), `TextShape` / `Callout`, connectors (endpoints, ports, routing,
  caps), mutation wiring, persistence, and the enum / free-function indexes.
- **[diagram-user-manual.md](diagram-user-manual.md)** — end-user guide to the
  Diagrammer: adding, selecting, moving, aligning, grouping, and combining
  shapes; connectors; text and labels; formatting; save / load; and a
  keyboard / mouse reference.
- **[diagram-control.md](diagram-control.md)** — design notes for the
  `Diagram` control and its selection / drag / adorner machinery.
- **[connectors.md](connectors.md)** — the connector model: ports, routing
  (straight / orthogonal / bezier), caps, and interactive create / edit.

## Five-line tour

```ts
import { Color, Thickness } from '../runtime/index.js';
import { HeadlessTarget, SolidColorBrush, SvgDrawingContext } from '../visual-engine/index.js';
import { Border, TextBlock } from '../basic/index.js';

const text   = new TextBlock('Hello, Mural!');
text.FontSize = 24;
text.Foreground = new SolidColorBrush(Color.White);

const border = new Border(text);
border.Background      = new SolidColorBrush(Color.FromHex('#1e40af'));
border.BorderBrush     = new SolidColorBrush(Color.Black);
border.BorderThickness = new Thickness(3);
border.Padding         = new Thickness(20);

const target = new HeadlessTarget(400, 200, border);
const dc     = new SvgDrawingContext();
target.Render(dc);
console.log(dc.ToSvg(400, 200));
```

That's a complete scene: a 400×200 surface containing a centered TextBlock
inside a styled Border, rendered to a self-contained SVG string. The browser
flow is the same except the last three lines become a single `new HtmlTarget(host).Show(border)`
(once the renderer wiring lands).

## Running the demos

Three demos ship under [basic/tests/](../src/basic/tests/):

```bash
npm run demo:border    # 100×100 blue/black border on a 300×300 surface
npm run demo:text      # bold text inside a styled border (approximate metrics)
npm run demo:gfont     # Inter from Google Fonts (real per-glyph metrics)
npm run ge             # a small graph viz on a 1600×1200 canvas
```

Each writes an SVG to `src/basic/tests/output/` (or to the working
directory for `ge`). Open in a browser to inspect the rendering.

## Running the tests

```bash
npm test          # ~1500+ tests across runtime, visual-engine, basic
npm run typecheck # tsc --noEmit
```

See [build-targets.md](build-targets.md) for the full npm-script catalog.

## Conventions

- **Naming.** Classes and public methods are `PascalCase`; private fields are
  `snake_case`; static read-only singletons are `PascalCase` (`Color.Black`,
  `Transform.Identity`). Property accessors mirror the property name.
- **Coordinate system.** Top-left origin, y-down, DIPs (device-independent
  pixels at 1/96"). Matches WPF and maps directly to SVG / Canvas.
- **Immutability.** Value types (`Point`, `Size`, `Rect`, `Color`, `Matrix`,
  `Thickness`) have `readonly` fields and no mutators — operations return
  new instances. Models are mutable through their property setters.
- **No `null`.** The library uses `undefined` consistently for absent values.
  Consumers shouldn't pass `null` where the type signature says `T | undefined`.
- **DIPs for sizes, code points for text.** `Array.from(text).length` is the
  glyph count used by the approximate measurer — surrogate pairs (emoji)
  count as one.

## What's stable vs. in-flight

**Stable** — has tests, used by demos, unlikely to change shape:
- Property / binding / inheritance system (full value-priority ladder
  with Style / Trigger / Animated tiers and `Visual.Style` apply machinery,
  attached + cross-class properties, `MultiBinding`, `PriorityBinding`,
  `AncestorBinding`, `MetaData` flag set).
- `Visual` + `Single` + `Panel` tree, visual/logical split, layout
  lifecycle with invalidation cascade.
- Brush / Pen / Geometry / Transform models.
- Drawing: `SvgDrawingContext`, `SvgRenderer` (dirty-tracking real-time
  renderer powering `HtmlTarget`), `PushClip`, `PushTransform`.
- Targets: `HeadlessTarget`, `HtmlTarget` (real-time SVG via
  `SvgRenderer`). `FileTarget` is scaffold-only — see
  [backlog § 9.2](../current-backlog.md).
- Routed events: `PointerDown/Up/Move/Wheel/Enter/Leave`, `KeyDown/Up`,
  `TextInput`, `GotFocus/LostFocus`, `Drag*`. Tunnel-then-bubble dispatch,
  `Handled` short-circuit, per-Visual `AddRoutedEventListener`.
- Drag & drop: `AllowDrop`, `IsDraggable`, `OnDragStart`, `DataObject`,
  `DragDropEffects`, three preview modes (ghost / null / DataTemplate).
- Adorners: `Adorner`, `AdornerLayer`, `AdornerDecorator`, the inner-SCP
  layer for scroll-aligned overlays.
- Behaviors: `Behavior` base + `Visual.AddBehavior` + markup `Behaviors {…}`,
  `OnDetached` lifecycle, `ListReorderBehavior`,
  `MarqueeSelectionBehavior`.
- Templating: `ControlTemplate`, `ContentControl` + `ContentPresenter`,
  `TemplateBinding`, `TemplatedParent`, per-template `NameScope`.
- Items / virtualization: `ItemsControl` + `ItemsPresenter` +
  `ItemContainerGenerator` + recycle pool, `DataTemplate`,
  `ObservableCollection` with incremental dispatch, `VirtualizingStackPanel`,
  `VirtualizingWrapPanel` (with `HorizontalSpacing` / `VerticalSpacing`),
  `IScrollInfo`, `ScrollViewer` (clip-and-translate + delegate modes),
  concrete `ScrollBar`.
- Layout panels: `Canvas`, `Single`, `Panel`, `StackPanel`, `WrapPanel`,
  `DockPanel`, `UniformGrid`, `Grid` (with shared-size groups).
- basic controls: `Border`, `TextBlock`, `Button`, `ToggleButton`, `TextBox`,
  `ComboBox`, `ListBox`, `TreeView`, `Slider`, `SpinEdit`, `Drawer`,
  `PageView`, `Diagram`, shapes (`Ellipse`, `Line`), `Thumb`,
  `Splitter`, `GridSplitter`.
- Command-surface controls (in `mural/framework/surface.js`):
  `ToolBar` + `ToolBarButton` + `ToolBarToggleButton` + `ToolBarSeparator`
  with overflow popup; `Menu` + `MenuButton` + `MenuItem` +
  `MenuSeparator` (hamburger fly-out); `ContextMenu` with the attached
  `ContextMenu` DP + auto-open on right-click.
- Selection: `Selector` base with `SelectionMode` ∈ {Single, Multiple,
  Extended}, attached `Selector.IsSelected`, marquee multi-select with
  `MarqueeBoundsPolicy`, click-on-empty-clear, anchor-relative range.
- Commands: full WPF surface — `ICommand` + `RelayCommand` +
  `RoutedCommand` (identity-only command with InputGestures metadata)
  + `CommandBinding` (`Executed` / `CanExecute` / `Relay`-to-ICommand
  sugar) + `CommandManager` (per-instance + per-class binding registry,
  tree-walking dispatch, `RequerySuggested` pulse) + `ICommandSource`
  contract (`Command` + `CommandParameter` + `CommandTarget` DPs on
  invokers) via `CommandSourceHelper` + `InputBindings` collection on
  every `Visual` with `KeyBinding` / `MouseBinding` dispatching through
  the routed-event bubble pass + named-command libraries
  (`ApplicationCommands`, `EditingCommands`, `NavigationCommands`,
  `MediaCommands`). `Button` implements `ICommandSource` today;
  `InvokeCommandAction` trigger action wires routed-event triggers into
  commands. Surface controls (Toolbar / Menu / Ribbon, [backlog
  § 5.11](../current-backlog.md)) sit on top of this stack.
- Text measurement: `ApproximateTextMeasurer`, `FontMetricsMeasurer`
  (opentype.js), Google Fonts loader.

**Roadmap and known gaps** — see [current-backlog.md](../current-backlog.md):
- § 5 — architectural gaps (Freezable, hit-pad opt-out, Visual →
  PresentationTarget lookup, non-SVG hit-testing).
- § 5.11 — Ribbon command-surface control. ToolBar, Menu / MenuButton /
  MenuItem, and ContextMenu shipped; Ribbon (5.11.3) + its demo-mode
  followup (5.11.4) remain. Underlying command infrastructure (§ 5.9)
  shipped.
- § 7 — triggers & setters (`DataTrigger`, `MultiTrigger`, `EventTrigger`,
  enter/exit actions).
- § 8 — drag & drop v2 (multi-pointer).
- § 9 — renderers & targets (`CanvasRenderer`, `FileTarget` writers).
- § 10 — items, scrolling, virtualization (variable item heights,
  horizontal virtualization, template selectors, smooth scrolling,
  marquee autoscroll).
- § 11 — templating gaps (`MultiBinding` for `TemplateBinding`,
  `Style.TargetType=TemplateType`).
- § 12 — resources / bindings (DynamicResource re-wire, MergedDictionaries
  URI source, coarse change notifications, keyed sealing).
- § 13 — concrete-control gaps (Border per-side BorderThickness +
  CornerRadius rendering, TextBlock multi-line + TextAlignment,
  Rectangle, Image).
- § 14 — Grid v3 (`ShowGridLines`, star-shrinkage policy).
- § 15 — attached-properties follow-ups.
- § 16 — animation system (the biggest missing piece; blocks several
  other items).
- Variable item heights in `VirtualizingStackPanel`
- Horizontal-orientation virtualization
- Walking visual descendants for `IScrollInfo` (ScrollViewer requires
  Content to be the IScrollInfo provider directly)
</content>
