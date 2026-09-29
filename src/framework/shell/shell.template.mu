// Pragmatic theme — Shell family (Wave 4 Task 7): EditorShell / ViewerShell
// / ShellSideContentPane / PanelButton, plus every DataTemplate the shell
// regions dispatch on (command bar items, document/panel tab headers, the
// compact header icon-button/menu-button chrome).
//
// Pure transcription of Material's shell.template.mu — every DockPanel /
// Grid / DataTemplate, every $service(...)/$$Prop/$Prop/<<ToVisibility
// binding, every PART_* name, and every keyed reference kept verbatim. Only
// these substitutions + deltas are applied:
//
//   * Fill = @Surface  → Fill = @Bg1  (EditorShell root Border, ViewerShell
//     root Border, PART_CommandHost).
//   * Fill = @SurfaceContainer → Fill = @Bg2 (ShellSideContentPane Style
//     default Fill).
//   * @OnSurfaceVariant → @Fg2 (every icon Fill, the side-pane title
//     Foreground, the TextBlock.Foreground cascade in
//     CompactHeaderIconButton / CompactHeaderMenuButton).
//   * Stroke = (@OutlineVariant, 1) → Stroke = Pen [ Brush = @Border,
//     Thickness = 1 ] (the command-host + side-pane header bottom rules —
//     the Pragmatic Pen-object stroke convention, see tabs/status-bar/
//     navigation/tool-bar forks).
//   * Style = @TitleSmall → Style = @UiLabel (side-pane PART_Title).
//   * @OnSurfaceVariantHoverLayer → @Bg2 on CompactHeaderIconButton's
//     PART_StateLayer hover; @OnSurfaceVariantPressLayer dropped (no press
//     cue — matches the Pragmatic icon-button/tool-bar forks' deferred
//     press).
//   * CornerRadius = @ShapeSmall → @RadiusMd (PanelButton Style).
//   * @Spacing3/@Spacing2/@Spacing1 → @Space3/@Space2/@Space1 (side-pane
//     header paddings/margins).
//   * PanelButton Style: Template = @DefaultStandardIconButton →
//     Template = @DefaultIconButton — the Pragmatic icon-button template
//     key (@DefaultStandardIconButton exists ONLY in Material's buttons
//     template and would drag Material chrome under Pragmatic). Variant =
//     Standard and CornerRadius = @RadiusMd are kept.
//
// Keyed references (@ActivityBarRail, @ActivityBarItem, @RailActionsPanel,
// @DefaultNavigationRailPanel, @DefaultNavigationBarPanel from the
// navigation fork; the ToolBar/menu keys from the tool-bar fork) resolve
// within the merged theme dictionary to their Pragmatic counterparts — not
// redefined here. @CommandControlsPanel, @CommandGridPanel,
// @CommandMenuRowTemplate, @CommandGridButtonTemplate,
// @DocumentTabHeaderTemplate, @DockTabHeader, @CompactHeaderIconButton,
// @CompactHeaderMenuButton, @DefaultShellSideContentPane,
// @DefaultEditorShell, @DefaultViewerShell are defined here as the
// framework's only definitions of these keys under this dictionary.
//
// Only Pragmatic tokens are used in every changed line — no M3 (@Surface /
// @SurfaceContainer / @OnSurfaceVariant* / @OutlineVariant / @TitleSmall /
// @ShapeSmall / @Spacing*) token, no raw hex except #00000000.

resources Shells {
    // ── EditorShell — full editing chrome ──────────────────────────
    // Region → DockPanel edge (Content fills the remainder):
    //   Header     → Top      (PART_HeaderHost,    single)
    //   Commands   → Top      (PART_CommandHost,   stacked: menu+toolbar)
    //   Status     → Bottom   (PART_StatusHost,    single)
    //   Navigation → Left     (PART_NavHost,       single, stretches)
    //   Inspector  → Right    (PART_InspectorHost, single)
    //   Content    → fill     (PART_ContentHost,   single)
    //
    // Dock order matters: edges are consumed top-down in child order,
    // and PART_ContentHost is last so LastChildFill hands it the
    // remaining rectangle. The hosts ship empty and zero-size — an
    // unused region simply collapses.

    // The activity bar's header / footer action lists live INLINE in the
    // @ActivityBarRail template (navigation.template.mu), presenting the
    // NavigationService's HeaderActions / FooterActions — so each rail
    // materialises its own (a shared keyed Visual can't parent into multiple
    // rails). This template just points the rail at that chrome + its item
    // container style.
    DataTemplate [DataType = NavigationService] {
        NavigationRail
            [ ItemsSource        = $Items,
              SelectedItem       = $SelectedItem,
              Template           = @ActivityBarRail,
              ItemContainerStyle = @ActivityBarItem ]
    }

    // One rail action → an icon-only button that invokes its Command. Icon is
    // the app-supplied Geometry the RailAction carries (the framework ships no
    // icons); empty until the app provides one.
    DataTemplate [DataType = RailAction] {
        IconButton [ Variant = Standard, Command = $Command ] {
            Shape [ Geometry = $Icon, Fill = @Fg2, Width = 22, Height = 22 ]
        }
    }

    Template x:key="DefaultEditorShell" [TargetType = EditorShell] {
        Border [ Fill = @Bg1 ] {
            AdornerDecorator {
                DockPanel [ LastChildFill = true ] {
                    // Header (app-bar) region — presents the shell's HeaderContent
                    // (an app title-bar view, a data object + DataTemplate, or a
                    // string). Unset ⇒ the ContentControl measures to zero and the
                    // Top dock claims no height, so a shell with no app bar shows no
                    // empty band (same collapse the empty Border had before).
                    ContentControl x:name="PART_HeaderHost"
                        [ DockPanel.Dock = Top,
                          Content        = $$HeaderContent ]

                    // Command toolbar — data-driven. The ToolbarService filters
                    // the app's declared CommandDefinitions by the active
                    // document's command contexts and dispatches each to that
                    // document. The whole strip collapses out of layout when no
                    // document is active: its content — the host-owned Save
                    // cluster plus the active document's commands — exists only
                    // for an active document, so ActiveDocument is the "non-empty"
                    // signal (an empty bar would otherwise leave a bare
                    // @Bg1 band under the header).
                    Border x:name="PART_CommandHost"
                        [ DockPanel.Dock  = Top,
                          Fill      = @Bg1,
                          Padding         = (8,4,8,4),
                          Visibility      = $service(ContentHostService).ActiveDocument << ToVisibility ] {
                        // Command groups fill the bar as ONE ToolBar (each group's
                        // buttons connect into a pill via ToolBar.Position, divided
                        // by ToolbarSeparatorItems; overflow collapses into the
                        // chevron when narrow). Editor CONTROLS (font pickers, …)
                        // ride a FIXED region docked right — kept OUT of the ToolBar
                        // so an interactive editor never lands in the overflow popup
                        // or gets re-parented by the overflow sync.
                        //
                        // Bottom rule: a horizontal Line docked Bottom draws the 1dp
                        // separator that used to be the Border's (0,0,0,1) bottom edge.
                        DockPanel [ LastChildFill = true ] {
                            Line [ DockPanel.Dock = Bottom, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                            // Document save cluster — host-owned Save / Save All,
                            // shown whenever a document is active (VS-style). Icons
                            // are app-supplied (@Save/@SaveAll via DynamicResource);
                            // absent → empty glyph. Enablement is command-driven
                            // (Save: active dirty; Save All: any dirty).
                            //
                            // A ToolBar (not a bare StackPanel of IconButtons), so the
                            // two buttons connect into one split-button-shaped group —
                            // @ShapeSmall capsule with a 1dp divider between Save and
                            // Save All (ToolBar assigns First/Last Position). Icons are
                            // the 16×16 + Margin (2) command-bar glyph metric so the
                            // cluster sizes identically to the adjacent command groups
                            // (was 18×18 IconButtons, which read a size larger).
                            ToolBar
                                [ DockPanel.Dock    = Left,
                                  VerticalAlignment = Center,
                                  Margin            = (0,0,8,0),
                                  Visibility        = $service(ContentHostService).ActiveDocument << ToVisibility ] {
                                ToolBarButton [ Command = $service(ContentHostService).SaveActiveCommand ] {
                                    Shape [ Geometry = @Save, Fill = @Fg2, Width = 16, Height = 16 ]
                                }
                                ToolBarButton [ Command = $service(ContentHostService).SaveAllCommand ] {
                                    Shape [ Geometry = @SaveAll, Fill = @Fg2, Width = 16, Height = 16 ]
                                }
                            }
                            ItemsControl
                                [ DockPanel.Dock   = Right,
                                  ItemsSource       = $service(ToolbarService).ToolbarControls,
                                  ItemsPanel        = @CommandControlsPanel,
                                  VerticalAlignment = Center ]
                            ToolBar [ ItemsSource = $service(ToolbarService).ToolbarItems ]
                        }
                    }

                    StatusBar x:name="PART_StatusHost"
                        [ DockPanel.Dock = Bottom,
                          DataContext    = $service(StatusService),
                          ItemsSource    = $Items ]

                    // capabilities navigation rail — the shell's activity bar.
                    // Presents the NavigationService, rendered by
                    // DataTemplate[NavigationService] as an @ActivityBarRail.
                    ContentControl x:name="PART_NavHost"
                        [ DockPanel.Dock = Left, Content = $service(NavigationService) ]

                    // Left panel for interacting with the selected capability —
                    // a titled side pane (VSCode Explorer shape). A DEFINITE Width
                    // + a Star content column (see DefaultShellSideContentPane) so
                    // capability content has a bounded width to lay out against and
                    // the drag handle below can resize it. Header = the active
                    // capability's name; Commands = the active service's
                    // HeaderCommands; Content = the active service, rendered by its
                    // DataTemplate.
                    // Visibility binds SidePaneVisible (the VSCode "toggle the
                    // sidebar" state): the header ✕ hides it via CloseCommand
                    // (= ToggleSidePaneCommand), and selecting any activity-bar
                    // capability reveals it again. Hidden ⇒ the pane AND its
                    // resize Splitter collapse out of layout so the content area
                    // reclaims the width (same shape as the right dock's
                    // HasPanels collapse).
                    ShellSideContentPane x:name="PART_SidePane"
                        [ DockPanel.Dock = Left,
                          Width          = 240,
                          Visibility     = $service(NavigationService).SidePaneVisible << ToVisibility,
                          Header         = $service(NavigationService).SelectedItem.Label,
                          Commands       = $service(NavigationService).ActiveService.HeaderCommands,
                          CloseCommand   = $service(NavigationService).ToggleSidePaneCommand,
                          Content        = $service(NavigationService).ActiveService ]

                    // Drag handle to resize the side pane. A Splitter resizes its
                    // PREVIOUS sibling, so docked Left right after the pane it
                    // rewrites the ShellSideContentPane's Width; Orientation
                    // defaults to Vertical (ew-resize). Collapses with the pane.
                    Splitter [ DockPanel.Dock = Left,
                               Width          = 6,
                               Visibility     = $service(NavigationService).SidePaneVisible << ToVisibility ]

                    // Right dock region — presents the PanelDockService, rendered
                    // by DataTemplate[PanelDockService] as a TabControl (agent chat,
                    // inspectors, … as tabs). Empty ⇒ the region + its resize
                    // Splitter collapse out of layout (Visibility off HasPanels), so
                    // the content host reclaims the full width until a panel is added.
                    // Definite Width lives HERE (the docked element the adjacent
                    // Splitter resizes as its previous sibling). Everything below
                    // fills this width.
                    ContentPresenter x:name="PART_RightDockHost"
                        [ DockPanel.Dock = Right,
                          Width          = 320,
                          Visibility     = $service(PanelDockService).HasPanels << ToVisibility,
                          Content        = $service(PanelDockService) ]
                    Splitter
                        [ DockPanel.Dock   = Right,
                          Width            = 6,
                          Orientation      = Vertical,
                          ReverseDirection = true,
                          Visibility       = $service(PanelDockService).HasPanels << ToVisibility ]

                    // Content region — presents the ContentHostService ITSELF
                    // (fill, via LastChildFill). The default host is a
                    // DocumentsContentHostService, rendered by
                    // `DataTemplate[DocumentsContentHostService]` as a TabControl
                    // (tab headers + the active document's body — the editor
                    // group). A plain ContentHostService (no matching template)
                    // falls back to presenting its Content; apps swapping in
                    // their own host supply the matching DataTemplate.
                    ContentPresenter x:name="PART_ContentHost"
                        [ Content = $service(ContentHostService) ]
                }
            }
        }
    }

    // Command bar: ONE ToolBar over the ToolbarService's flat ToolbarItems stream.
    // The service clusters the active document's commands by CommandDefinition.Group
    // and expands Flat / Toggles groups into their command VMs (rendered by type
    // below), with a ToolbarSeparatorItem between groups; split groups + editor
    // controls ride as single items. The ToolBar connects each group's buttons into
    // a pill and the separators divide the groups.
    // Horizontal row for the fixed editor-control region (docked right of the
    // command ToolBar). ItemsControl defaults to a vertical StackPanel, so the
    // controls need this to sit side by side.
    ItemsPanelTemplate x:key="CommandControlsPanel" {
        StackPanel [ Orientation = Horizontal ]
    }
    // Grid layout for a SplitGrid group's popup (label placement, etc.). Fixed
    // 3-wide; the VM's Columns is plumbed for a future per-group override.
    ItemsPanelTemplate x:key="CommandGridPanel" {
        UniformGrid [ Columns = 3 ]
    }

    // ── Per-command item templates ──────────────────────────────────────
    // The default: a CommandViewModel is one ToolBarButton — so it connects into
    // its group's pill inside the command bar's ToolBar (which assigns the
    // button's Position after layout). Fill is LEFT UNSET: the ToolBarButton Style
    // drives the icon ink through its inherited TextBlock.Foreground
    // (@OnSurfaceVariant), and a bare Shape falls back to that. No horizontal
    // margin — adjacent buttons must sit flush for the connected-pill look.
    DataTemplate [DataType = CommandViewModel] {
        ToolBarButton [ Command = $Command ] {
            Shape [ Geometry = $Definition.Icon, Width = 16, Height = 16 ]
        }
    }
    // Toggle presentation — a distinct VM TYPE (CommandToggleViewModel) so the
    // flat ToolbarItems stream resolves THIS template by type instead of the
    // button one above. IsChecked reflects the active document's IsActive. Fill is
    // LEFT UNSET: the ToolBarToggleButton Style flips the inherited
    // TextBlock.Foreground (@OnSurfaceVariant at rest, @OnPrimary while checked)
    // and a bare Shape follows it — hardcoding Fill would pin the icon dark on the
    // @Primary checked fill.
    DataTemplate [DataType = CommandToggleViewModel] {
        ToolBarToggleButton [ Command = $Command, IsChecked = $IsActive ] {
            Shape [ Geometry = $Definition.Icon, Width = 16, Height = 16 ]
        }
    }
    // Group divider in the flat stream — a ToolBarSeparator between adjacent
    // groups (also the ToolBar's connected-run boundary; see ToolbarSeparatorItem).
    DataTemplate [DataType = ToolbarSeparatorItem] {
        ToolBarSeparator
    }
    // SplitMenu dropdown row — a full menu item, with an optional leading divider
    // (a group that folds a second sub-group in, e.g. Distribute under Align, sets
    // SeparatorBefore on its first member; the trigger keeps it hidden otherwise).
    DataTemplate x:key="CommandMenuRowTemplate" [DataType = CommandViewModel] {
        StackPanel [ Orientation = Vertical ] {
            MenuSeparator x:name="Sep"
            MenuItem
                [ Header  = $Definition.Title,
                  Command = $Command,
                  Icon    = Shape [ Geometry = $Definition.Icon, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        }
        when ( $Definition.SeparatorBefore = false ) { Sep.Visibility = Collapsed; }
    }
    // SplitGrid dropdown cell — an icon-only button.
    DataTemplate x:key="CommandGridButtonTemplate" [DataType = CommandViewModel] {
        ToolBarButton [ Command = $Command ] {
            Shape [ Geometry = $Definition.Icon, Fill = @Fg2, Width = 16, Height = 16, Margin = (2) ]
        }
    }

    // ── Per-group presentation templates ────────────────────────────────
    // Flat / Toggles groups are EXPANDED into their individual command VMs in the
    // flat ToolbarItems stream (each rendered by DataTemplate[CommandViewModel] /
    // [CommandToggleViewModel] above), so those two presentations have no group-
    // level template here. Only the split presentations render as a single VM.
    // SplitMenu — an icon-only dropdown (no primary Command → single chrome) whose
    // popup lists the members as menu rows.
    DataTemplate [DataType = ToolbarSplitMenuGroup] {
        ToolBarSplitButton
            [ Content      = Shape [ Geometry = $Icon, Fill = @Fg2, Width = 16, Height = 16 ],
              ItemsSource  = $Items,
              ItemTemplate = @CommandMenuRowTemplate,
              Margin       = (1,0,1,0) ]
    }
    // SplitGrid — an icon-only dropdown whose popup tiles the members in a grid.
    DataTemplate [DataType = ToolbarSplitGridGroup] {
        ToolBarSplitButton
            [ Content      = Shape [ Geometry = $Icon, Fill = @Fg2, Width = 16, Height = 16 ],
              ItemsSource  = $Items,
              ItemsPanel   = @CommandGridPanel,
              ItemTemplate = @CommandGridButtonTemplate,
              Margin       = (1,0,1,0) ]
    }
    // Editor control — a module's arbitrary editor template applied against the
    // active document. The VM applies the template ONCE (View = Template.Apply(
    // Target) with Target as DataContext), so we present that Visual directly.
    // Presenting $View (a Visual) — NOT `Content=$Target, ContentTemplate=$Template`
    // — is deliberate: the latter makes the presenter re-point its DataContext to
    // the document, clobbering the $Template binding and dropping to the document's
    // IMPLICIT DataTemplate (e.g. a DiagramDocument's canvas, whose shared node
    // Visuals then collide → "Visual already has a visual parent"). See
    // ShellControlViewModel.
    DataTemplate [DataType = ShellControlViewModel] {
        ContentPresenter [ Content = $View, Margin = (4,0,4,0) ]
    }

    // ── Base single-content host ────────────────────────────────────────
    // The base ContentHostService presents ONE object at a time: whatever
    // View() last set, dispatched to a DataTemplate by its runtime type.
    // Without this template a base-host instance rendered through
    // `$service(ContentHostService)` falls to ContentPresenter's stringify path
    // and reads "[object Object]". DocumentsContentHostService (below) is a
    // more-specific match, so the TDI TabControl still wins for the tabbed-
    // document host; single-content consumers (e.g. the demo platform's group
    // content) resolve THIS one.
    //
    // The Content is bound with a SERVICE binding (`$service(…).Content`), not a
    // DataContext binding (`$Content`). A `$Content` here is self-defeating: the
    // presenter's DataContext is the service, but ContentPresenter re-points its
    // OWN DataContext to whatever it presents (the resolved content), so after
    // the first View() the `$Content` source is clobbered and never updates.
    // The service binding resolves through the provider instead, so it stays
    // reactive to every View() swap. (This mirrors the proven pre-TabControl
    // shell binding on PART_ContentHost.)
    DataTemplate [DataType = ContentHostService] {
        ContentPresenter [ Content = $service(ContentHostService).Content ]
    }

    // ── Documents area — the editor group ──────────────────────────────
    // The content host is a DocumentsContentHostService (the shell's default
    // under ContentHostService.Key). It renders as a TabControl: the header
    // strip lists the open documents, and the TabControl's content area shows
    // the active document's body through ITS DataTemplate (e.g. a
    // DataTemplate[DiagramDocument] painting a canvas). SelectedItem TwoWay-
    // binds to ActiveDocument so clicking a tab activates it and an
    // Open()/Close() re-selects. ItemTemplate is the TAB HEADER (WPF
    // semantics) — title + close.
    DataTemplate [DataType = DocumentsContentHostService] {
        TabControl
            [ ItemsSource  = $OpenDocuments,
              SelectedItem = $ActiveDocument,
              ItemTemplate = @DocumentTabHeaderTemplate ]
    }

    // One tab header: title + a close affordance, rendered for every IDocument
    // (each carries Title / Id). DataContext is the document. Close reaches the
    // host via `$service` and passes the document's Id. The close glyph is a
    // text "✕" (the framework ships no icons). The title leaves Foreground
    // UNSET so it inherits the TabItem's selection ink (@OnSurfaceVariant at
    // rest, @Primary when selected — see the TabItem Style).
    //
    // DataType is nominal here: the template is KEYED and applied explicitly as
    // the TabControl's ItemTemplate (never type-dispatched), so a keyed template
    // registers under its key alone — the DataType never drives resolution. The
    // compiler nonetheless requires a DataType on every DataTemplate, and the
    // framework ships no concrete IDocument class to name, so this carries the
    // structurally-compatible RailAction (also a Command-bearing row) as a
    // placeholder. See the note in the shell tests.
    DataTemplate x:key="DocumentTabHeaderTemplate" [DataType = RailAction] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            // Unsaved-changes dot — visible only while the document is dirty
            // ($IsDirty binds against the document Model, reactive).
            Shape
                [ Geometry          = @IconDirtyDot,
                  Fill              = @Fg2,
                  Width             = 6,
                  Height            = 6,
                  VerticalAlignment = Center,
                  Margin            = (0,0,4,0),
                  Visibility        = $IsDirty << ToVisibility ]
            TextBlock [ Text = $Title, VerticalAlignment = Center, Margin = (4,0,0,0) ]
            IconButton
                [ Template          = @CompactHeaderIconButton,
                  Command           = $service(ContentHostService).CloseDocumentCommand,
                  CommandParameter  = $Id,
                  VerticalAlignment = Center,
                  Margin            = (2,0,0,0) ] {
                Shape [ Geometry = @IconClose, Fill = @Fg2, Width = 8, Height = 8 ]
            }
        }
    }
    Style [TargetType = EditorShell] {
        Template = @DefaultEditorShell;
    }

    // ── ViewerShell — readonly, navigable view set ─────────────────
    // A header plus a left navigation strip switching between read-only
    // content views. No command surface, inspector, or status bar.
    //   Header     → Top   (PART_HeaderHost, single)
    //   Navigation → Left  (PART_NavHost,    single, stretches)
    //   Content    → fill  (PART_ContentHost, single)
    Template x:key="DefaultViewerShell" [TargetType = ViewerShell] {
        Border [ Fill = @Bg1 ] {
            DockPanel [ LastChildFill = true ] {
                Border x:name="PART_HeaderHost" [ DockPanel.Dock = Top ]
                Border x:name="PART_NavHost"
                    [ DockPanel.Dock = Left,
                      DataContext    = $service(NavigationService) ]
                // ReuseContentViews: the nav service resolves the SAME
                // ActiveService instance on switch-back (its scope cache), so
                // reuse hands back that capability's existing view — preserving
                // its state and skipping a rebuild — instead of rebuilding on
                // every rail switch. (A ContentControl nav host gets this by
                // default; a bare ContentPresenter must opt in.)
                ContentPresenter x:name="PART_ContentHost"
                    [ Content = $service(NavigationService).ActiveService,
                      ReuseContentViews = true ]
            }
        }
    }
    Style [TargetType = ViewerShell] {
        Template = @DefaultViewerShell;
    }

    // ── Right dock region — a tabbed panel host ─────────────────────────────
    // The PanelDockService hosts a dynamic set of panels (agent chat, inspectors,
    // …); the region renders it as a TabControl. The header strip lists the hosted
    // panels; the body shows SelectedPanel through ITS own DataTemplate (type
    // dispatch, like the documents TabControl). ItemTemplate is the TAB HEADER
    // (title + close).
    DataTemplate [DataType = PanelDockService] {
        TabControl
            [ ItemsSource  = $Panels,
              SelectedItem = $SelectedPanel,
              ItemTemplate = @DockTabHeader ]
    }

    // One dock tab header: title + a close affordance. Reaches the host via
    // `$service` and passes the panel's Id. Keyed + applied as the TabControl's
    // ItemTemplate, so its DataType is nominal (mirrors @DocumentTabHeaderTemplate,
    // which carries RailAction as the structurally-compatible Title/Id placeholder).
    DataTemplate x:key="DockTabHeader" [DataType = RailAction] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            TextBlock [ Text = $Title, VerticalAlignment = Center, Margin = (4,0,0,0) ]
            IconButton
                [ Template          = @CompactHeaderIconButton,
                  Command           = $service(PanelDockService).ClosePanelCommand,
                  CommandParameter  = $Id,
                  VerticalAlignment = Center,
                  Margin            = (2,0,0,0) ] {
                Shape [ Geometry = @IconClose, Fill = @Fg2, Width = 8, Height = 8 ]
            }
        }
    }

    // Compact 16×16 chrome-less icon button — for the inspector header's
    // collapse (chevron) and close affordances, and the document tab close
    // button. The M3 IconButton variants hardcode a 40×40 PART_Border, too
    // large for a dense header row; this template sizes to a tight 16×16 with
    // a transparent hover/press layer. Press is deferred (matches the other
    // Pragmatic icon-button forks), so only the hover trigger remains.
    Template x:key="CompactHeaderIconButton" [TargetType = IconButton] {
        Border x:name="PART_Border"
            [ Fill           = #00000000,
              CornerRadius         = (2),
              Width                = 16,
              Height               = 16,
              TextBlock.Foreground = @Fg2 ] {
            Border x:name="PART_StateLayer"
                [ Fill = #00000000, CornerRadius = (2) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @Bg2; }
    }

    // Compact icon-only MenuButton trigger — the header overflow (…) affordance.
    // The MenuButton ctor injects the Icon Visual into PART_TriggerStack and
    // keeps PART_HeaderText synced to the (empty) Header, so this trigger just
    // supplies the same chrome-less 16×16 hover/press box the CompactHeaderIcon
    // button uses. PART_Trigger MUST be a Button (MenuButton wires Click on it).
    Template x:key="CompactHeaderMenuButton" [TargetType = MenuButton] {
        Button x:name="PART_Trigger" [ Variant = Text ] {
            Border x:name="PART_Border"
                [ Fill                 = #00000000,
                  CornerRadius         = (2),
                  Width                = 16,
                  Height               = 16,
                  TextBlock.Foreground = @Fg2 ] {
                StackPanel x:name="PART_TriggerStack"
                    [ Orientation        = Horizontal,
                      HorizontalAlignment = Center,
                      VerticalAlignment   = Center ] {
                    TextBlock x:name="PART_HeaderText"
                }
            }
        }
    }

    // ── PanelButton — rounded-rectangle icon button for panel headers ───────
    // The shell-panel affordance (pop-out / collapse / add): an IconButton
    // subclass whose default Style keeps the Standard (chrome-less) fill but
    // trades IconButton's @RadiusPill circle for a small @RadiusMd corner —
    // the rounded-square look. Reuses the Pragmatic Standard IconButton
    // template verbatim (@DefaultIconButton, icon-buttons.template.mu):
    // PanelButton IS an IconButton, so the [TargetType=IconButton] template
    // applies, and its PART_FocusRing / PART_Root `$$CornerRadius`
    // TemplateBinding picks up the radius set here.
    Style [TargetType = PanelButton] {
        Variant      = Standard;
        Template     = @DefaultIconButton;
        CornerRadius = @RadiusMd;
    }

    // ── ShellSideContentPane — a titled side pane (VSCode Explorer shape) ──
    // A header bar pairing a title (Header, left) with a Commands block (right),
    // over the pane's Content. Header = the title STRING; Commands = a free
    // content slot (a button row, a "…" menu); Content = the pane body.
    //
    // Layout is a two-row Grid — NOT a DockPanel — for one reason: ContentControl
    // binds Content to the FIRST ContentPresenter in the template's depth-first
    // walk. Declaring the content presenter FIRST (positioned into row 1 by
    // Grid.Row) makes it that presenter; PART_Commands is a second, independent
    // ContentPresenter the base ignores. In a DockPanel the fill child must be
    // last, which would put the content presenter after Commands and mis-bind.
    Template x:key="DefaultShellSideContentPane" [TargetType = ShellSideContentPane] {
        Border
            [ Fill      = $$Fill,
              Stroke          = $$Stroke,
              CornerRadius    = $$CornerRadius,
              ClipToBounds    = true ] {
            Grid {
                // Star column: the content fills the pane's definite Width (set
                // on the pane instance in DefaultEditorShell), so capability
                // content has a bounded width to lay out against (a WrapPanel
                // wraps to it) and reflows live as the resize Splitter rewrites
                // that Width. The pane is docked (not in the fill region), so
                // Star fills the pane's own width, not the shell's content area.
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                RowDefinitions {
                    RowDefinition [ Height = GridLength.Auto ] // header bar
                    RowDefinition [ Height = GridLength.Star ] // content body
                }

                // Content body FIRST → the ContentPresenter ContentControl uses.
                ContentPresenter x:name="PART_ContentHost" [ Grid.Row = 1 ]

                // Header bar: title fills, commands docked right. A DockPanel
                // (not a Grid) so it sizes to content without needing row defs.
                // A 1dp bottom rule separates the title/commands from the pane
                // body (the same delineation the right dock's rail carries).
                Border x:name="PART_Header"
                    [ Grid.Row       = 0,
                      Padding         = (@Space3,@Space2,@Space2,@Space2) ] {
                    DockPanel [ LastChildFill = true ] {
                        // 1dp bottom rule (was the Border's (0,0,0,1) bottom edge):
                        // a horizontal Line docked Bottom separates header from body.
                        Line [ DockPanel.Dock = Bottom, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                        // VSCode-style header button bar, pinned rightmost (declared
                        // before PART_Commands so it takes the outer Right edge):
                        // an overflow menu (…) for future per-panel actions + a
                        // close (✕) firing CloseCommand (the shell wires it to hide
                        // the pane). Command is $$CloseCommand — a null command just
                        // no-ops, so a generic pane without one shows an inert ✕.
                        StackPanel x:name="PART_HeaderBar"
                            [ DockPanel.Dock  = Right,
                              Orientation       = Horizontal,
                              VerticalAlignment = Center,
                              Margin            = (@Space2,0,0,0) ] {
                            MenuButton x:name="PART_Overflow"
                                [ TriggerTemplate = @CompactHeaderMenuButton,
                                  Icon            = Shape [ Geometry = @MoreHoriz, Fill = @Fg2, Width = 12, Height = 12 ] ]
                            IconButton x:name="PART_Close"
                                [ Template          = @CompactHeaderIconButton,
                                  Command           = $$CloseCommand,
                                  VerticalAlignment = Center,
                                  Margin            = (@Space1,0,0,0) ] {
                                Shape [ Geometry = @IconClose, Fill = @Fg2, Width = 12, Height = 12 ]
                            }
                        }
                        ContentPresenter x:name="PART_Commands"
                            [ DockPanel.Dock    = Right,
                              Content           = $$Commands,
                              VerticalAlignment = Center ]
                        TextBlock x:name="PART_Title"
                            [ Style             = @UiLabel,
                              Text              = $$Header,
                              Foreground        = @Fg2,
                              VerticalAlignment = Center ]
                    }
                }
            }
        }
    }
    Style [TargetType = ShellSideContentPane] {
        Template = @DefaultShellSideContentPane;
        Fill = @Bg2;
    }
}
