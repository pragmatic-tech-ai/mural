# Pragmatic theme — Wave 2 (Lists & Selection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the lists & selection control families onto Pragmatic templates — row surface-step interaction, `@SurfaceSelected` selection with a brand-ink flip, a flat auto-hiding scrollbar, brand-accent tab underline / splitter — attached to the Pragmatic theme via the existing `PragmaticControls` override dictionary, while Material and its default status stay untouched.

**Architecture:** Wave 2 adds forked templates to the same `PragmaticControls` dictionary Wave 1 established (appended after `MuralFramework` in `pragmatic.mu`, last-merged-wins). It reuses every Wave-1 pattern (surface-step, `PART_FocusRing`, density via `when (ThemeManager.Density/Pointer = …)` → absolute `@RowH*`/`@ControlH*`, Pen-form strokes, `PART_Selected`-style opaque selection layers, stroke-attribute render assertions). Two families (ScrollBar and the ComboBox popup) reuse Wave-1 input/popover chrome. One family group — the `Thumb`-derived primitives (`Splitter`, `GridSplitter`) — paints its chrome **imperatively in TS**, not through a `ControlTemplate`, so its task extends the `@Ink`/`@AccentInk` semantic-alias bridge (follow-up C) with scroll/splitter keys and switches the TS `DynamicResource` calls to them, keeping Material byte-identical.

**Tech Stack:** Mural `.mu` templates (compiled by `build:templates`), `node:test` via `tsx`, the `ControlHarness` resolution + SVG-render test harness (`src/resources/pragmatic/tests/control-harness.ts`).

**Spec:** `Mural/docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md` (see §Template fork mechanic mappings, §Density, §Shadows). Builds on Wave 1 (merged to local main) and the follow-ups (A tuple→Pen compiler fix; C `@Ink`/`@AccentInk` alias bridge; E DynamicResource Application-swap fix), all merged.

## Locked decisions (from spec + Wave-2 recon)

1. **Override dictionary, per-control files.** Each control family gets `src/framework/pragmatic/<group>/<control>.template.mu`, imported into `src/resources/pragmatic/controls.resources.mu` (the `PragmaticControls` aggregator). ListBox/TreeView/ComboBox come from one Material file (`src/framework/list/list.template.mu`) but fork into **three separate** Pragmatic files under `pragmatic/lists/` so tasks stay independent. Resolution is last-merged-wins on the control's runtime class key; un-forked controls keep falling back to Material.

2. **The M3 → Pragmatic token map** (applied throughout; no raw hex, no `@<M3-role>` token in any forked template):

   | Material 3 token(s) | Pragmatic replacement |
   | --- | --- |
   | `@Surface` (rest field/tab strip) | `@Bg1` |
   | `@SurfaceContainerLow` (scroll track) | `@Bg2` |
   | `@SurfaceContainerHigh` (popup surface) | `@Bg1` + `@ShadowMd` + `Stroke = Pen [ Brush = @Border, Thickness = 1 ]` |
   | `@SecondaryContainer` (selected row fill) | `@SurfaceSelected` |
   | `@OnSecondaryContainer` (selected ink) | `@BrandGreenInk` |
   | `@OnSurface` (rest primary ink) | `@Fg1` |
   | `@OnSurfaceVariant` (secondary ink / chevron / placeholder) | `@Fg2` |
   | `@Outline` / `@OutlineVariant` (borders, dividers, rules) | `@Border` (subtle) / `@BorderStrong` (field/group outline) |
   | `@Primary` (accent: open border, tab underline, splitter hover) | `@ControlAccent` |
   | focus | `Pen [ Brush = @BorderFocus, Thickness = 2 ]` on a dedicated `PART_FocusRing`, offset `@FocusRingOffset` |
   | `@StateHoverOverlay` / `@StatePressOverlay` | surface-step: hover `@Bg2`, press/active `@Bg3` (no overlay layers) |
   | `@ShapeExtraSmall` (4) | `@RadiusMd` (6) for rows/fields/segments; `@RadiusLg` (10) for popups; `@RadiusPill` for scroll thumb |
   | `@Elevation2` (popup) | `@ShadowMd` |
   | `@DisabledContentOpacity` | `@OpacityDisabled` on the control root |
   | `@ListRowHeightRegular/Compact/Comfortable/Touch` | `@RowHDefault` (baseline) / `@RowHCompact` (`Density = Compact`) / `@RowHTouch` (`Pointer = Coarse`) |

   Scroll-thumb ramp: rest `@BorderStrong`, hover `@Fg3`, drag `@Fg2`. Selected-row ink flip: rest `@Fg1` → `@BrandGreenInk`. Chevron glyphs (`@ChevronRight`/`@ChevronDown`) resolve from `MuralBasic` (theme-agnostic) — use as-is.

3. **Strokes are Pen-form.** `Stroke = Pen [ Brush = @Token, Thickness = N ]` in base setters and triggers. (The follow-up-A compiler fix now also accepts the tuple form, but Pen-form stays the house convention for clarity — see [[project_border_thickness_removal]].)

4. **ScrollViewer gets NO Pragmatic fork.** Its Material template (`surfaces.template.mu:127-136`) references zero colour tokens — chrome comes entirely from the nested `ScrollBar`s. Forking it would add nothing. Task 4 documents this and asserts a ScrollViewer under Pragmatic renders its (forked) scrollbars with no grey, proving the no-fork decision holds.

5. **ComboBox forks two keyed templates, not a TargetType Style.** ComboBox resolves `DefaultComboBoxSelection` and `DefaultComboBoxPopup` by `x:key` in code (`combo-box.ts:28-29,447,502`), and has **no** constructor-keyed default Style. The Pragmatic fork must define `Template x:key="DefaultComboBoxSelection"` and `x:key="DefaultComboBoxPopup"` (exact keys — confirm against the `KEY_SELECTION`/`KEY_POPUP` constants) plus the `Style [TargetType = ComboBoxItem]`. Consequently ComboBox's resolution test asserts **template identity** (`combo.resolveTemplate(KEY_SELECTION)` is the `PragmaticControls` entry), not `ControlHarness.IsPragmaticStyle` (which keys off `control.constructor` and would find nothing for ComboBox).

6. **`Thumb`-derived primitives are imperative-chrome; fix them in TS + the alias bridge.** `Thumb` (`src/basic/scroll/thumb.ts`), `Splitter` (`src/basic/splitter.ts`), and `GridSplitter` (`src/basic/grid-splitter.ts`) paint a hardcoded inline `Border` via `DynamicResource('OutlineVariant')` / `DynamicResource('Primary')` — a `.mu` fork cannot reach them. Task 5 extends the follow-up-C semantic-alias pattern: add scheme keys `@ControlTrack` (thumb/splitter rest) and reuse `@ControlAccent` (splitter hover/preview), defined in **every** scheme (Material aliases them to its current M3 values so Material stays byte-identical; Pragmatic aliases to `@BorderStrong`/`@ControlAccent`), and switch the three TS files' `DynamicResource` keys to them. ScrollBar itself is a real `ControlTemplate` and forks normally.

7. **Density = discrete triggers → absolute tokens** (unchanged from Wave 1). Baseline row height `@RowHDefault`; `when (ThemeManager.Density = Compact) → @RowHCompact`; `when (ThemeManager.Pointer = Coarse) → @RowHTouch`. Multi-line rows (`HasSupportingText`/`IsThreeLine`) keep the Material structure but bind **`MinHeight`** (not fixed `Height`) to `@RowHDefault` so supporting text grows the row by content — Pragmatic has no `TwoLine`/`ThreeLine` height token and none is added this wave (see Open Questions).

## Global Constraints

- **Allman braces** in `.mu` and TS; object literals / block-bodied arrows / one-line blocks stay inline.
- **No inline string literals** for reused/user-facing strings (private static readonly PascalCase constants); structural `.mu` tokens and DP-registration key strings are exempt.
- **Tests** in a `tests/` subfolder beside source; `node:test` via `tsx --conditions=development`.
- **Pragmatic tokens only** in forked templates — never a raw hex, never an `@<M3-role>` token (`@Primary`, `@OnSurface`, `@Surface*`, `@Outline*`, `@Shape*`, `@Elevation*`, `@State*Overlay`, `@SecondaryContainer`). Radii ≤ `@RadiusXl` (14) except `@RadiusPill`.
- **Do not change the app default or any app/demo** this wave. Material stays default; the only edits outside `src/resources/pragmatic/` and `src/framework/pragmatic/` are: (Task 5) the three `Thumb`-family TS files' `DynamicResource` keys and the alias-key additions to the four scheme files (`material/{light,dark}.mu`, `pragmatic/{light,dark}.mu`).
- **Material stays byte-identical.** Task 5's alias keys must resolve, under Material, to the exact current M3 values; a Material render/snapshot guard proves it.
- Every forked template must resolve with **no unresolved `@token`** (grey `rgb(128,128,128)` / `#808080`); the render test guards this in Light **and** Dark.
- **Preserve control-class contracts:** keep every `PART_*` name and items-panel type the control class fishes out by `FindName` (ListBox `PART_Scroll`/`PART_Border`/slots; ComboBox selection + popup parts incl. `PART_PopupScroll`/`PART_PopupList`; TreeView `PART_Row`/`PART_Chevron`/`PART_ChildHost`/slots; ScrollBar `PART_Layout`/`PART_Track`/`PART_Thumb`; ScrollViewer `PART_ContentSite`/`PART_VerticalScrollBar`/`PART_HorizontalScrollBar`/`PART_Layout`). Renaming or dropping one silently breaks selection, popups, auto-hide, or nested virtualization.

## Review Focus

- **A forked list control under Pragmatic resolves the Pragmatic style/template, not Material's.** → each task asserts it (ComboBox via template identity per decision 5).
- **Selection reads as selected in both schemes** — `@SurfaceSelected` fill under the row ink, ink flips to `@BrandGreenInk`, and selection outranks hover (trigger ordering). → ListBox/TreeView/ComboBox/SegmentedButton tasks assert selected fill present AND `indexOf(selected) > indexOf(hover)` where both paint.
- **Scrollbar auto-hide survives the fork** — the forked ScrollBar keeps `PART_Layout` + the `when (IsFaded) { PART_Layout.Opacity = 0 }` trigger so the class-driven fade still works. → Task 4 asserts the trigger exists and the thumb paints `@BorderStrong` when shown.
- **Nested TreeView virtualization is not broken** — the fork keeps `PART_ChildHost` (ItemsPresenter → CollapsibleStack) and the items-panel type so `ItemsControl.rebuildContainers`/`VirtualizingPanel.ResetRealization` (items-control.ts:1398-1408, virtualizing-panel.ts:99-103) still fire. → Task 2 asserts a two-level TreeView realizes children (expand → child row present) with no throw.
- **Material is byte-identical after the Task-5 alias/TS change** — a Splitter/Thumb/ScrollBar under Material resolves the same colours as before. → Task 5 asserts Material `@ControlTrack` resolves to the current `@OutlineVariant` value and a Material Splitter renders unchanged.
- **No unresolved token** in any forked template, Light and Dark (grey fallback). → every task's render test asserts a Pragmatic token colour appears and `NeutralFallbackCss` does not.
- **ComboBox popup actually opens and scrolls** — the forked popup keeps `PART_PopupScroll` (`MaxHeight = 320`) + `PART_PopupList`; a long list clamps to the max height. → Task 3 mirrors `tests/combo-box.test.ts:266` (`ViewportHeight <= MaxHeight`).

---

## File Structure

- `src/framework/pragmatic/lists/list-box.template.mu` — `resources PragmaticListBox { … }`: `DefaultListBox` + `DefaultListBoxItem` + Styles.
- `src/framework/pragmatic/lists/tree-view.template.mu` — `PragmaticTreeView`: `DefaultTreeView` + `DefaultTreeViewItem` + Styles.
- `src/framework/pragmatic/lists/combo-box.template.mu` — `PragmaticComboBox`: `DefaultComboBoxSelection` + `DefaultComboBoxPopup` (keyed) + `ComboBoxItem` Style.
- `src/framework/pragmatic/scroll/scroll-bar.template.mu` — `PragmaticScrollBar`: `DefaultScrollBar` + Style.
- `src/framework/pragmatic/scroll/splitter.template.mu` — `PragmaticSplitter`: `DefaultSplitter` + `DefaultGridSplitter` + `DefaultThumb` + Styles (near-inert markup; the real change is TS + alias keys).
- `src/framework/pragmatic/button-groups/segmented-button.template.mu` — `PragmaticSegmentedButton`: shell + `DefaultSegmentedItem` + Styles.
- `src/framework/pragmatic/tabs/tabs.template.mu` — `PragmaticTabs`: `DefaultTabControl` + `DefaultTabItem` + Styles.
- `src/resources/pragmatic/controls.resources.mu` — add the seven `import`s to `PragmaticControls`.
- `src/resources/{material,pragmatic}/{light,dark}.mu` — Task 5 alias keys (`@ControlTrack`).
- `src/basic/scroll/thumb.ts`, `src/basic/splitter.ts`, `src/basic/grid-splitter.ts` — Task 5 `DynamicResource` key swaps.
- `src/resources/pragmatic/tests/controls-{listbox,treeview,combobox,scrollbar,splitter,segmented,tabs}.test.ts` — per-family resolution + render tests (Light + Dark).

---

## Task 1: ListBox + ListBoxItem (the list-selection exemplar)

Establishes the row surface-step + `@SurfaceSelected` selection + brand-ink flip + `@RowH*` density + item focus-ring pattern that Tasks 2, 3, 6 copy.

**Files:**
- Create: `src/framework/pragmatic/lists/list-box.template.mu`
- Modify: `src/resources/pragmatic/controls.resources.mu` (import + list `PragmaticListBox`)
- Test: `src/resources/pragmatic/tests/controls-listbox.test.ts`

**Interfaces:**
- Consumes: `ControlHarness.Render/Activate/IsPragmaticStyle/TokenCss/Reset`, `NeutralFallbackCss` (property); `PragmaticControls` aggregator; `{ PragmaticLight, PragmaticDark }` from `../pragmatic.js`, `{ MaterialLight }` from `../../material/material.js`.
- Produces: `PragmaticListBox` dictionary (`DefaultListBox`, `DefaultListBoxItem`). Selection/row-height/focus conventions consumed by Tasks 2/3/6.

Fork source: `src/framework/list/list.template.mu` — ListBox `346-353`, ListBoxItem `372-476`. Keep PART names `PART_Scroll`, `PART_Border`, `PART_LeadingSlot`, `PART_HeadlineSlot`, `PART_SupportingText`, `PART_TrailingSlot`.

- [ ] **Step 1: Write the failing resolution test.** `controls-listbox.test.ts`: activate Pragmatic, create a `ListBox`, `assert.ok(ControlHarness.IsPragmaticStyle(control))`. Run → FAIL (no Pragmatic ListBox template yet).

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ListBox, ListBoxItem } from '../../../framework/list/list-box.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic ListBox', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new ListBox(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'ListBox uses the Pragmatic override style');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Write `list-box.template.mu`.** `resources PragmaticListBox { … }`. `DefaultListBoxItem` is the exemplar every selectable row follows:

```
Template x:key = "DefaultListBoxItem" [ TargetType = ListBoxItem ]
{
    Border x:name = "PART_FocusRing" [ Fill = #00000000, Padding = @FocusRingOffset, CornerRadius = @RadiusMd ]
    {
        Border x:name = "PART_Border" [ Fill = #00000000, CornerRadius = @RadiusMd, MinHeight = @RowHDefault ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Border x:name = "PART_LeadingSlot"  [ Dock = Left ]
                Border x:name = "PART_TrailingSlot" [ Dock = Right ]
                StackPanel
                {
                    ContentPresenter x:name = "PART_HeadlineSlot" [ Padding = (12,0,12,0) ]
                    TextBlock x:name = "PART_SupportingText" [ Foreground = @Fg2, Visibility = Collapsed ]  // supporting-text size: inherit, or bind the Pragmatic body-small type atom — confirm the exact key against pragmatic typography (Wave-1 Task 7)
                }
            }
        }
    }
    when ( IsMouseOver )               { PART_Border.Fill = @Bg2; }
    when ( IsFocused )                 { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
    when ( IsSelected )                { PART_Border.Fill = @SurfaceSelected; }
    when ( IsEnabled = false )         { PART_Border.Opacity = @OpacityDisabled; }
    when ( ThemeManager.Density = Compact ) { PART_Border.MinHeight = @RowHCompact; }
    when ( ThemeManager.Pointer = Coarse )  { PART_Border.MinHeight = @RowHTouch; }
    when ( HasSupportingText )         { PART_SupportingText.Visibility = Visible; }
}
```
Order `IsSelected` **after** `IsMouseOver` so selection outranks hover (chronological trigger precedence). The `Style [TargetType = ListBoxItem]` sets the reactive ink flip: base `TextBlock.Foreground = @Fg1`, `when (IsSelected) { TextBlock.Foreground = @BrandGreenInk; }` (mirrors Material's `list.template.mu:474-475` reactive-foreground fix for bare string items). `DefaultListBox` = a `Border [ Fill = @Bg1, CornerRadius = @RadiusMd ]` wrapping `ScrollViewer x:name = "PART_Scroll"` → `ItemsPresenter`; `Style [TargetType = ListBox]` sets `Template = @DefaultListBox`.

- [ ] **Step 3: Aggregate + wire.** In `controls.resources.mu` add `import PragmaticListBox from "../../framework/pragmatic/lists/list-box.template.mu.js"` and include it in the `PragmaticControls` merge list. `npm run build:templates` — expect no error.

- [ ] **Step 4: Run the resolution test — expect pass.** Then add and pass the render tests (each ends `ControlHarness.Reset();`):
  - (a) **selected row fill (Light):** render a `ListBox` with two items, select index 0; `const sel = ControlHarness.TokenCss('SurfaceSelected'); assert.equal(sel, 'rgb(226,243,233)'); assert.ok(svg.includes(sel));`
  - (b) **selection outranks hover:** with a hovered + selected row, `assert.ok(svg.indexOf(sel) > svg.indexOf(ControlHarness.TokenCss('Bg2')))` (only if the harness can render a hover state; otherwise assert selected fill present and drop the ordering half — see harness note).
  - (c) **no grey (Light):** `assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss))`.
  - (d) **Dark:** re-render under `PragmaticDark`; `assert.equal(ControlHarness.TokenCss('SurfaceSelected'), 'rgb(15,42,26)'); assert.ok(svg.includes(...)); assert.ok(!svg.includes(NeutralFallbackCss))`.
  - (e) **Material unaffected:** render under `MaterialLight`; `assert.ok(!ControlHarness.IsPragmaticStyle(control))`.

- [ ] **Step 5: Commit.**

```bash
git add src/framework/pragmatic/lists/list-box.template.mu src/resources/pragmatic/controls.resources.mu src/resources/pragmatic/tests/controls-listbox.test.ts
git commit -m "feat(pragmatic): fork ListBox onto Pragmatic override dictionary (Wave 2)"
```

**Harness note (applies to every task):** confirm against `control-harness.ts` whether `Render` can drive interaction pseudo-states (hover/press) or only rest+programmatic (selected/checked) state. Where hover can't be rendered, assert the rest and selected/focused states and note the hover-ordering assertion as covered structurally by trigger order (as Wave-1 toggles did). Use the resolution-only pattern (`Activate` + `GetTemplateChild('PART_Border')` → read `.Fill as SolidColorBrush`) when the SVG paint path can't reach a state.

---

## Tasks 2–7: remaining Wave-2 controls (follow the Task 1 exemplar)

Each task: fork the named Material template(s) into the file from §File Structure, applying decision-2 token map + Wave-1 patterns; keep every PART name; add the family import to `controls.resources.mu`; write `controls-<family>.test.ts` mirroring Task 1's tests (resolves Pragmatic style/template; selected/accent token colour present Light **and** Dark; no `NeutralFallbackCss`); build; commit. Each ends green.

### Task 2: TreeView + TreeViewItem
Fork from `src/framework/list/list.template.mu` — TreeView `213-220`, TreeViewItem `228-337`. Copy the ListBoxItem row pattern onto `PART_Row` (rest transparent, hover `@Bg2`, `IsSelected` → `@SurfaceSelected`, ink flip `@Fg1`→`@BrandGreenInk` via the Style at `327-337`). Keep `PART_OuterStack`, `PART_Row`, `PART_RowInner`, `PART_Spacer`, `PART_Chevron`, `PART_ChevronGlyph` (`Geometry = @ChevronRight`, fill `@Fg2`), slots, `PART_HeaderHost`, `PART_Label`, `PART_SupportingText`, and **`PART_ChildHost`** (ItemsPresenter). Do NOT change the items panel type or `IsExpanded` handling (code-driven CollapsibleStack + `refreshChevron()`). Density on `PART_Row.MinHeight`. Tests: selected `@SurfaceSelected` (Light `rgb(226,243,233)` / Dark `rgb(15,42,26)`); **virtualization intact** — build a 2-level tree, expand the root, assert a child `TreeViewItem` container exists and no throw; no grey.

### Task 3: ComboBox (selection + popup) + ComboBoxItem
Fork from `src/framework/list/list.template.mu` — `DefaultComboBoxSelection` `18-123`, `DefaultComboBoxPopup` `133-161`, `ComboBoxItem` Style `184-203`. **Register both keyed templates** (decision 5). Selection box = Wave-1 Outlined-input chrome: `PART_SelectionBox` `Fill = @Bg1`, `Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ]`, `CornerRadius = @RadiusMd`, `MinHeight = @ControlHDefault`; `PART_SelectionText` `@Fg1`, placeholder (`when (HasSelection = false)`) `@Fg2`; `PART_Chevron` (`@ChevronDown`) fill `@Fg2`; `when (IsDropDownOpen) { PART_SelectionBox.Stroke = Pen [ Brush = @ControlAccent, Thickness = 1 ]; }`; `when (PART_SelectionBox.IsFocused) { … @BorderFocus, 2 }`; density on `PART_SelectionBox.MinHeight`; disabled → `@OpacityDisabled`. Popup: `PART_Popup` `Fill = @Bg1`, `Stroke = Pen [ Brush = @Border, Thickness = 1 ]`, `CornerRadius = @RadiusLg`, `Effect = @ShadowMd`; keep `PART_PopupHost`, `PART_Scrim`, `PART_PopupScroll` (`MaxHeight = 320`, `HorizontalScrollEnabled = false`), `PART_PopupList`. `ComboBoxItem` Style: rest `Fill = #00000000`, hover `@Bg2`, `when (IsSelected) { Fill = @SurfaceSelected; }` (LAST), ink `@Fg1`→`@BrandGreenInk`, padding + density. **Resolution test asserts template identity** (decision 5), not `IsPragmaticStyle`. Tests: open-border `@ControlAccent` (`rgb(34,130,77)`); selected item `@SurfaceSelected`; popup `ViewportHeight <= MaxHeight` on a long list (mirror `tests/combo-box.test.ts:266`); no grey Light+Dark.

### Task 4: ScrollBar (+ ScrollViewer no-op)
Fork from `src/resources/basic.resources.mu:541-564` (`DefaultScrollBar`). Keep `PART_Layout` (ScrollBarLayout), `PART_Track`, `PART_Thumb` — all template Borders. Track `Fill = @Bg2`, `CornerRadius = @RadiusPill`; thumb `Fill = @BorderStrong`, `CornerRadius = @RadiusPill`; `when (PART_Thumb.IsMouseOver) { PART_Thumb.Fill = @Fg3; }`; `when (IsDragging) { PART_Thumb.Fill = @Fg2; }` (LAST, wins); **keep `when (IsFaded) { PART_Layout.Opacity = 0; }`** verbatim (class-driven auto-hide). No arrow/repeat parts (there are none). Per decision 4, **do not** fork ScrollViewer. Tests: thumb `@BorderStrong` (Light `rgb(214,213,208)` / Dark equivalent — read via TokenCss); assert the forked template contains the `IsFaded`→Opacity trigger (resolve template, or assert on a rendered ScrollViewer that its scrollbars paint `@BorderStrong` and no grey); render a `ScrollViewer` with overflowing content under Pragmatic and assert no `NeutralFallbackCss` (proves the no-fork ScrollViewer + forked ScrollBar compose correctly) Light+Dark.

### Task 5: Splitter + GridSplitter (+ Thumb) — TS chrome + alias bridge
The `Thumb`-derived primitives paint inline in TS (decision 6). Steps:
1. **Add alias key `@ControlTrack`** to all four scheme files, just after the existing `@Ink`/`@AccentInk` aliases: `material/light.mu` `@ControlTrack = <current @OutlineVariant hex>` and `dark.mu` likewise; `pragmatic/light.mu` `@ControlTrack = #D6D5D0` (= `@BorderStrong`), `dark.mu` = Pragmatic dark `@BorderStrong`. (Splitter hover/preview reuse the existing `@ControlAccent`, which every scheme already defines via the alias bridge / catalog.) Write the failing test first: `Resolve('ControlTrack')` under MaterialLight equals the current `@OutlineVariant` brush; under PragmaticLight equals `@BorderStrong` (`rgb(214,213,208)`).
2. **Switch the TS `DynamicResource` keys:** `thumb.ts:105-113` `'OutlineVariant'` → `'ControlTrack'`; `splitter.ts:refreshChrome` (`~184,191,195`) rest `'OutlineVariant'`→`'ControlTrack'`, hover/drag `'Primary'`→`'ControlAccent'`, and the `PreviewBrush = @Primary` Style default → `@ControlAccent` (in a Pragmatic `splitter.template.mu`); `grid-splitter.ts` fill `'OutlineVariant'`→`'ControlTrack'`, `PreviewBrush` `@Primary`→`@ControlAccent`. Hoist the two key strings to `private static readonly` constants per the no-inline-literal rule.
3. **Fork the near-inert templates** (`basic.resources.mu` Thumb `582-591`, GridSplitter `599-610`, Splitter `625-637`) into `pragmatic/scroll/splitter.template.mu` mainly to set the Pragmatic `PreviewBrush = @ControlAccent` Style defaults and register the keys under `PragmaticControls`.
4. Tests: **Material byte-identical** — `Resolve('ControlTrack')` under Material == the pre-change `@OutlineVariant` value, and a Material `Splitter`'s rest brush is unchanged; **Pragmatic** — a `Splitter` rest resolves `@BorderStrong` and hover/drag resolves `@ControlAccent` (`rgb(34,130,77)`) via the TS chrome (use the resolution-only pattern: construct under each scheme, invoke `refreshChrome` path, read `.Border`/`_border` fill or the `RestBrush`/preview brush); no grey.

### Task 6: SegmentedButton + SegmentedItem
Fork from `src/framework/button-groups/button-groups.template.mu` — shell `24-39`, `DefaultSegmentedItem` `57-114`. Keep `PART_GroupBorder`, `PART_Divider`, `PART_Border`, and the `Position` triggers. Group: `PART_GroupBorder` `Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ]`, `CornerRadius = @RadiusMd`, `ClipToBounds = true`. Segment: rest `Fill = @Bg1`, ink `@Fg1`; `PART_Divider` `Stroke = Pen [ Brush = @Border, Thickness = 1 ]`; `when (Position = Single | Start) { PART_Divider.Visibility = Collapsed; }`; hover `@Bg2`; `when (IsSelected) { PART_Border.Fill = @SurfaceSelected; }` (LAST) + ink `@BrandGreenInk`; focus ring; disabled `@OpacityDisabled`; density/pointer on padding/height. Selected = filled (no stroke). Tests: selected `@SurfaceSelected` present + ink `@BrandGreenInk`; no grey Light+Dark.

### Task 7: TabControl + TabItem
Fork from `src/framework/tabs/tabs.template.mu` — `DefaultTabControl` `23-52`, `DefaultTabItem` `68-126`. Keep `PART_Border`, `PART_ItemsPresenter`, `PART_ContentSlot`, `PART_Indicator`, `PART_Tab`, `PART_Header`. Strip: `PART_Border` `Fill = @Bg1`; the under-strip rule (unnamed `Line`) `Stroke = Pen [ Brush = @Border, Thickness = 1 ]`. Tab: `PART_Tab` `Fill = #00000000`; `PART_Indicator` (the underline `Line`) `Stroke = Pen [ Brush = #00000000, Thickness = 2 ]` at rest; `when (IsSelected) { PART_Indicator.Stroke = Pen [ Brush = @ControlAccent, Thickness = 2 ]; }`; hover `PART_Tab.Fill = @Bg2`; `when (IsFocused) { … dedicated focus ring or @BorderFocus underline — reuse PART_FocusRing pattern }`; disabled `@OpacityDisabled`. Ink: Style base `@Fg2`, `when (IsSelected) { TextBlock.Foreground = @ControlAccent; }`. Tests: selected underline asserts the **stroke attribute** form — `const acc = ControlHarness.TokenCss('ControlAccent'); assert.ok(svg.includes(\`stroke="${acc}"\`))` (Light `rgb(34,130,77)` / Dark `rgb(46,168,98)`); rest tab has no accent stroke; no grey Light+Dark. (This is the A-gallery tab-underline site — the compiler now paints the Pen correctly.)

---

## Done-when

- `npm run build:templates` green; the seven new dictionaries emitted and merged into `PragmaticControls`.
- `npm run typecheck` clean (0 errors).
- `npm test` green, including the seven new `controls-*.test.ts`; the full suite pass count ≥ the pre-wave baseline (no regressions).
- Every Wave-2 control under Pragmatic resolves the Pragmatic style/template and renders in Light **and** Dark with no `rgb(128,128,128)`; ScrollViewer (unforked) composes with forked ScrollBars cleanly.
- Material byte-identical: the Task-5 alias/TS change leaves Material renders and the conformance snapshot unchanged; un-forked controls still fall back to Material.
- No app or demo changed; Material still default.

## Open Questions

1. **Multi-line row heights.** Pragmatic has no `TwoLine`/`ThreeLine` height token; this plan grows `HasSupportingText`/`IsThreeLine` rows by `MinHeight = @RowHDefault` + content (decision 7). If the design system specifies exact two/three-line heights, add `@RowHTwoLine`/`@RowHThreeLine` in a Foundation follow-up and switch those triggers — out of this wave's scope.
2. **`@ControlTrack` naming.** Chosen to parallel `@ControlAccent`. Alternative: reuse `@BorderStrong` directly in the TS (no new key) — rejected because Material's rest thumb is `@OutlineVariant`, not its `@BorderStrong` equivalent, so a shared key that each scheme aliases independently is the faithful bridge. Confirm the name before Task 5 lands (renaming later touches four scheme files again).
3. **ScrollBar thumb hover in tests.** If the harness cannot drive `PART_Thumb.IsMouseOver`, the hover/drag ramp (`@Fg3`/`@Fg2`) is asserted structurally (trigger present) rather than by pixel — same accommodation as Wave-1 toggles.

## Next waves (not this plan)
Wave 3 (overlays & surfaces), Wave 4 (shell & navigation), Wave 5 (complex & app-specific) — each a plan copying the Wave-1/Wave-2 patterns. After Wave 5: default switch + app migration, then Material removal.
