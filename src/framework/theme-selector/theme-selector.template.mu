// Default theme entries for the theme-selector family — the
// theme + scheme picker control.
//
// Merged into the root MuralFramework dictionary via an `import`
// clause in src/resources/framework.resources.mu.

resources ThemeSelectors {
    // ── ThemeSelector (theme + scheme picker) ──────────────────────
    // Two icon-toggle + ComboBox pairs in a horizontal row. Each icon
    // is a Text-variant Button (no chrome — paints just the glyph);
    // clicking it flips the matching IsXxxPickerOpen DP on the
    // ThemeSelector, which the template triggers below pick up to
    // expand the sibling ComboBox from Width=0 / Opacity=0 to its
    // resting width.
    //
    // The ComboBox lives wrapped in a Border whose Width is what the
    // open/closed trigger toggles. Keeping the toggle on the wrapper
    // (not the ComboBox itself) means the ComboBox's natural measure
    // pass is undisturbed when it's open — width is just the wrapper
    // clipping it down to zero when closed.
    //
    // ThemeSelector's ctor finds PART_ThemeToggle / PART_ThemeCombo /
    // PART_SchemeToggle / PART_SchemeCombo and wires click + selection
    // listeners. Items + SelectedItem on both ComboBoxes are written
    // imperatively from syncFromThemeManager — the bound list is
    // derived from ThemeManager state, not authored declaratively.
    Template x:key="DefaultThemeSelector" [TargetType = ThemeSelector] {
        StackPanel x:name="PART_Layout" [ Orientation = Horizontal ] {
            // Always-visible icon affordances. TextBlock Foreground is
            // tinted to @Fg2 — the on-Surface content tone
            // shared by the top app bar (@Surface) and the status bar
            // (@SurfaceContainerLow), both surfaces this control rides.
            // (@OnPrimary here was near-invisible dark-on-dark once the
            // app bar moved to a Surface background.)
            TextBlock
                [ Style             = @UiLabel,
                  Text              = "Aa",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (4,0,4,0) ]
            Border x:name="PART_ThemeComboWrap"
                [ Width    = 0,
                  MinWidth = 0,
                  Opacity  = 0,
                  Padding  = (4,0,4,0) ] {
                ComboBox x:name="PART_ThemeCombo" [ Width = 140, ThemeManager.Density = Compact ]
            }

            TextBlock
                [ Style             = @UiLabel,
                  Text              = "◐",
                  Foreground        = @Fg2,
                  VerticalAlignment = Center,
                  Margin            = (4,0,4,0) ]
            Border x:name="PART_SchemeComboWrap"
                [ Width    = 0,
                  MinWidth = 0,
                  Opacity  = 0,
                  Padding  = (4,0,4,0) ] {
                ComboBox x:name="PART_SchemeCombo" [ Width = 140, ThemeManager.Density = Compact ]
            }
        }

        // Slide-in reveal driven by hover. The IsMouseOver trigger
        // fires off the ThemeSelector's own hover state (each trigger's
        // default source is the templated parent). The parallel
        // PART_xxxCombo.IsDropDownOpen trigger carries the same body —
        // it keeps the combo visible while its dropdown popup is open,
        // since opening the popup moves the cursor onto the
        // OverlayLayer-mounted popup and would otherwise drop
        // IsMouseOver to false and retract the combo out from under
        // the pointer. Trigger semantics make this safe: both triggers
        // write the same property/value pair, so concurrent activation
        // is idempotent. Closed state (neither trigger active) is the
        // resting Width=0 / Opacity=0 baked into the template above.
        //
        // The compiler's ControlTemplate trigger system accepts only
        // single-term `when()` conditions today, so we duplicate the
        // body across two triggers rather than spelling `IsMouseOver or
        // PART_xxxCombo.IsDropDownOpen`.
        when ( IsMouseOver ) {
            PART_ThemeComboWrap.Width = 148;
            PART_ThemeComboWrap.Opacity = 1;
        }
        when ( PART_ThemeCombo.IsDropDownOpen ) {
            PART_ThemeComboWrap.Width = 148;
            PART_ThemeComboWrap.Opacity = 1;
        }
        when ( IsMouseOver ) {
            PART_SchemeComboWrap.Width = 148;
            PART_SchemeComboWrap.Opacity = 1;
        }
        when ( PART_SchemeCombo.IsDropDownOpen ) {
            PART_SchemeComboWrap.Width = 148;
            PART_SchemeComboWrap.Opacity = 1;
        }

        // Coarse pointer — the reveal above is hover-driven, and a touch
        // pointer has no hover, so both combos would stay collapsed (Width=0)
        // and unreachable. On coarse input, pin both wrappers permanently
        // open so the pickers are directly tappable. This is the control's
        // real coarse-pointer adaptation (the closed icons don't gate a tap
        // target — they gate a hover the device can't produce).
        when ( ThemeManager.Pointer = Coarse ) {
            PART_ThemeComboWrap.Width = 148;
            PART_ThemeComboWrap.Opacity = 1;
            PART_SchemeComboWrap.Width = 148;
            PART_SchemeComboWrap.Opacity = 1;
        }
    }

    Style [TargetType = ThemeSelector] {
        Template = @DefaultThemeSelector;
    }
}
