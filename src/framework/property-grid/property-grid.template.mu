// Default theme entries for the property-grid family — PropertyGrid
// (the categorised key/value editor control).
//
// Architecture
// ────────────
// PropertyGrid extends ItemsControl; its outer ItemsSource is always a
// PropertyCategory[].  The default Style wires:
//
//   • Template                — a ControlTemplate with a bare ItemsPresenter
//                               so the outer items panel renders PropertyCategory
//                               rows.
//   • ItemTemplate            — @PropertyCategoryTemplate, a DataTemplate that
//                               renders each PropertyCategory: a collapsible header
//                               (ToggleButton) + an inner ItemsControl for the
//                               PropertyItem rows inside that category.
//   • Seven editor-template DPs — one per PropertyKind (+ ReadOnly).  Each holds a
//                               keyed DataTemplate (see below) so tests and
//                               programmatic overrides can replace individual editors.
//
// Editor dispatch — real ItemTemplateSelector (structural, per-row)
// ─────────────────────────────────────────────────────────────────
// The inner ItemsControl binds `ItemTemplateSelector = $EditorSelector`, where
// EditorSelector is the grid's own `EditorTemplateSelector` resolver, injected
// onto each PropertyCategory by PropertyGrid.rebuildGroups.  (The inner control
// is authored inside a DataTemplate, so the templated parent — the grid — is not
// reachable via TemplateBinding; carrying the resolver on the data item is the
// way to thread it in this .mu dialect.)  ItemsControl.GetContainerForItemOverride
// calls the selector per item and instantiates ONLY the returned DataTemplate, so:
//
//   • Exactly ONE editor exists per row (no overlaid widgets).
//   • No hidden two-way binding can write back to $Value — a non-enum row never
//     instantiates the ComboBox, a boolean row never instantiates a Text editor.
//   • Read-only wins over kind, and unknown/non-readonly kinds fall back to the
//     read-only editor — both handled inside the resolver
//     (PropertyGrid.selectEditorTemplate), so dispatch is mutually exclusive
//     AND total.
//
// Merged into MuralFramework via an `import` clause in
// src/resources/framework.resources.mu.

resources PropertyGrids {

    // ── Per-kind editor DataTemplates (keyed) ─────────────────────────
    //
    // Each template targets PropertyItem and renders a two-column row:
    //   • Left cell  — TextBlock showing Descriptor.DisplayName.
    //   • Right cell — an editor bound (two-way where applicable) to Value.
    //
    // These templates are assigned to the PropertyGrid's seven editor-template
    // DPs in the Style below.  They are also keyed so consumers can look them up
    // by name for individual substitutions.

    // Text — single-line TextBox
    DataTemplate x:key="PropertyGridTextEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            TextBox [ Text = $Value ]
        }
    }

    // Number — single-line TextBox (consumer may swap for a SpinEdit)
    DataTemplate x:key="PropertyGridNumberEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            TextBox [ Text = $Value ]
        }
    }

    // Boolean — Checkbox (IsChecked two-way to Value)
    DataTemplate x:key="PropertyGridBooleanEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            Checkbox [ IsChecked = $Value, VerticalAlignment = Center ]
        }
    }

    // Enum — ComboBox (SelectedItem two-way to Value; ItemsSource from descriptor)
    DataTemplate x:key="PropertyGridEnumEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            ComboBox
                [ ItemsSource         = $Descriptor.EnumOptions,
                  SelectedItem        = $Value ]
        }
    }

    // Multiline — multi-line TextBox
    DataTemplate x:key="PropertyGridMultilineEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Top,
                  Width               = 120 ]
            TextBox
                [ Text                = $Value,
                  AcceptsReturn       = true,
                  MinHeight           = 60 ]
        }
    }

    // Color — hex TextBox (consumer may swap for a color-picker)
    DataTemplate x:key="PropertyGridColorEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            TextBox [ Text = $Value ]
        }
    }

    // ReadOnly — plain TextBlock, no editing affordance
    DataTemplate x:key="PropertyGridReadOnlyEditorTemplate" [DataType = PropertyItem] {
        DockPanel {
            TextBlock
                [ DockPanel.Dock      = Left,
                  Text                = $Descriptor.DisplayName,
                  VerticalAlignment   = Center,
                  Width               = 120 ]
            TextBlock
                [ Text                = $Value,
                  VerticalAlignment   = Center ]
        }
    }

    // ── PropertyCategoryTemplate ──────────────────────────────────────
    //
    // Renders one PropertyCategory: a collapsible header + the PropertyItem rows.
    //
    //   • Header — a ToggleButton bound two-way to IsExpanded.  Clicking the header
    //              flips IsExpanded on the PropertyCategory (BindsTwoWayByDefault).
    //   • Body   — an ItemsControl over PropertyCategory.Items whose
    //              ItemTemplateSelector is the grid's per-row editor resolver.
    //              Collapsed when IsExpanded is false.
    DataTemplate x:key="PropertyCategoryTemplate" [DataType = PropertyCategory] {
        StackPanel [ Orientation = Vertical ] {
            // Category header — ToggleButton.IsChecked is BindsTwoWayByDefault, so
            // `$IsExpanded` binds two-way and clicking the header toggles the
            // PropertyCategory's IsExpanded field.
            ToggleButton x:name="PART_Header"
                [ IsChecked           = $IsExpanded,
                  HorizontalAlignment = Stretch ] {
                TextBlock
                    [ Text            = $Header,
                      VerticalAlignment = Center ]
            }

            // PropertyItem rows — inner ItemsControl.
            //   • ItemTemplateSelector = $EditorSelector — the grid's own
            //     resolver, injected onto this PropertyCategory by
            //     PropertyGrid.rebuildGroups.  Each row instantiates ONLY the
            //     DataTemplate the selector returns (structural per-row dispatch).
            //   • ItemsPanel is required: without it, rebuildContainers bails
            //     and no row containers are generated.
            ItemsControl x:name="PART_ItemsHost"
                [ ItemsSource          = $Items,
                  ItemTemplateSelector = $EditorSelector,
                  ItemsPanel           = @DefaultPropertyItemsPanel ]
        }

        // Collapse the body when the category is folded.
        when ( $IsExpanded = false ) {
            PART_ItemsHost.Visibility = Collapsed;
        }
    }

    // ── DefaultPropertyGrid ControlTemplate ───────────────────────────
    //
    // The outer ItemsControl body — a bare ScrollViewer wrapping the
    // ItemsPresenter so the category list can scroll vertically.
    Template x:key="DefaultPropertyGrid" [TargetType = PropertyGrid] {
        ScrollViewer {
            ItemsPresenter
        }
    }

    // Items panel for the outer category list — a vertical StackPanel.
    // Required: without an ItemsPanel, ItemsControl.rebuildContainers
    // bails early and no category containers are generated.
    ItemsPanelTemplate x:key="DefaultPropertyGridPanel" {
        StackPanel [ Orientation = Vertical ]
    }

    // Items panel for the inner PropertyItem rows within each category.
    // The inner ItemsControl (PART_ItemsHost in PropertyCategoryTemplate)
    // requires an ItemsPanel for the same reason as the outer one.
    ItemsPanelTemplate x:key="DefaultPropertyItemsPanel" {
        StackPanel [ Orientation = Vertical ]
    }

    // ── PropertyGrid default Style ────────────────────────────────────
    //
    // Wires the template + per-kind editor DPs.  The seven DataTemplate DPs
    // are set to the keyed templates above; the grid's EditorTemplateSelector
    // reads these DPs to resolve the right editor per row (EditorTemplateKey →
    // IsReadOnly → per-kind, unknown kind → ReadOnly).
    Style [TargetType = PropertyGrid] {
        Template                 = @DefaultPropertyGrid;
        ItemsPanel               = @DefaultPropertyGridPanel;
        ItemTemplate             = @PropertyCategoryTemplate;
        TextEditorTemplate       = @PropertyGridTextEditorTemplate;
        NumberEditorTemplate     = @PropertyGridNumberEditorTemplate;
        BooleanEditorTemplate    = @PropertyGridBooleanEditorTemplate;
        EnumEditorTemplate       = @PropertyGridEnumEditorTemplate;
        MultilineEditorTemplate  = @PropertyGridMultilineEditorTemplate;
        ColorEditorTemplate      = @PropertyGridColorEditorTemplate;
        ReadOnlyEditorTemplate   = @PropertyGridReadOnlyEditorTemplate;
    }
}
