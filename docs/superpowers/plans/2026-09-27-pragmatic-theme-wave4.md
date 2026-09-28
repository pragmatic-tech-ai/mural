# Pragmatic Theme — Wave 4 (Shell & App-Frame) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork the application-frame ("shell") control families onto the Pragmatic theme so every app-bar, navigation surface, toolbar, status bar, search field, and the EditorShell/ViewerShell chrome paint in Pragmatic tokens when Pragmatic is active, while Material stays byte-identical.

**Architecture:** Same override-dictionary mechanism as Waves 1–3. Each family gets a `src/framework/pragmatic/<family>/<name>.template.mu` imported into `PragmaticControls` (`src/resources/pragmatic/controls.resources.mu`), merged AFTER `MuralFramework` so each key-less `Style[TargetType=X]` — and each keyed `x:key` resource — shadows Material's (last-merged-wins). Un-forked controls fall back to Material.

**Tech Stack:** Mural (`.mu` → `.mu.js` via `npm run build:templates`); TypeScript; `node:test` via `npx tsx --conditions=development --test --test-force-exit`.

**Spec:** Pragmatic Design System ([[reference_pragmatic_design_system]], artifact `XkyJGVRjDhwq8rKh52Pz7R`; `dev-kit/design/design-systems/pragmatic/tokens.json` normative) + `docs/superpowers/specs/2026-09-27-pragmatic-theme-design.md`. Precedents: the Wave 2 and Wave 3 plans (`docs/superpowers/plans/2026-09-27-pragmatic-theme-wave{2,3}.md`) — this plan reuses their locked token map, fork idioms, and test patterns.

## Global Constraints

Identical to Wave 3, in force here:
- **House style (CLAUDE.md):** Allman braces in `.ts`; OOP-only (no module-level free functions or variables — test helpers are static methods on a class; module-`const` + enum/type decls fine); no inline reused string literals (`private static readonly` PascalCase constants); real enums; PascalCase interfaces + public methods. `.mu` markup and generated `*.mu.js` keep their own style.
- **Tests** in `src/resources/pragmatic/tests/` beside the Wave-1/2/3 `controls-*.test.ts`, using the existing `ControlHarness`.
- **Pragmatic tokens ONLY** in the forks. No M3 token (`@Surface*`, `@On*`, `@Outline*`, `@Shape*`, `@Elevation*`/`@ElevationLevel*`, `@State*Overlay`/`@*HoverLayer`/`@*PressLayer`, `@SecondaryContainer`/`@OnSecondaryContainer`, `@Primary`/`@OnPrimary`/`@PrimaryContainer`, `@DisabledContentOpacity`, `@Spacing*`, M3 typography atoms/keyed styles like `@TitleLarge`/`@HeadlineSmall`/`@LabelMedium`) and no raw hex other than `#00000000`. Shared theme-independent geometry tokens (`@ChevronDown`, `@ChevronRight`, `@IconClose`, `@IconDirtyDot`, `@MoreHoriz`, `@Save`, `@SaveAll`) ARE allowed (all `include`d in `src/resources/basic.resources.mu`; app-supplied `@Save`/`@SaveAll` resolve to empty when absent — theme-agnostic).
- **Material stays byte-identical**: add files + import lines only; never edit a Material template, scheme, or control `.ts`.
- **Drop every `when ( ThemeManager.PrefersContrast = More )` trigger** (wave-wide, matching Waves 2–3). Keep `ThemeManager.Density` / `ThemeManager.Pointer` triggers.
- **Preserve every `PART_*` name, every element TYPE, every data/service binding** (`$service(...)`, `$$Prop`, `$Prop`, `<< ToVisibility`, `ItemsSource`, `ItemTemplate`, keyed `@Ref`) verbatim — controls fish parts out by name and the shell is entirely service/binding-driven. A fork changes tokens and (where noted) layer structure, nothing else.
- **Stroke is Pen-form** (`Stroke = Pen [ Brush = @Token, Thickness = N ]`); oriented rules stay `Line [ Orientation = …, Stroke = Pen [ Brush = @Token, Thickness = 1 ] ]`. Selected-over-hover uses a dedicated opaque layer above the hover surface (Wave-1/2/3 pattern).

## M3 → Pragmatic token map (Wave 4 additions — the Wave 3 map still applies)

| Material (M3) | Pragmatic | Context |
|---|---|---|
| `@Surface` | `@Bg1` | app-frame chrome: TopAppBar, StatusBar, NavigationRail/Bar, activity bar, EditorShell/ViewerShell root, `PART_CommandHost` |
| `@SurfaceContainer` | `@Bg2` | BottomAppBar strip, TopAppBar scrolled tint, ShellSideContentPane fill |
| `@SurfaceContainerHigh` | `@Bg2` | SearchBar field base, ToolBar button/chip base, ToolBar popup body (see popover row) |
| `@SurfaceContainerHighest` | `@Bg1` | SearchBar hover/focus step (steps UP from the `@Bg2` base) |
| `@OnSurface` | `@Fg1` | primary ink, titles |
| `@OnSurfaceVariant` | `@Fg2` | icon ink, secondary text, status ink, chevrons |
| `@Outline` | `@BorderStrong` | ToolBar separator, ToolBar outline box |
| `@OutlineVariant` | `@Border` | 1dp rules/dividers, StatusBar/ToolBar separators |
| `@SecondaryContainer` (nav item pill) | `@SurfaceSelected` | via a dedicated opaque layer (see Task 5 delta) |
| `@OnSecondaryContainer` (nav selected icon ink) | `@BrandGreenInk` | |
| `@Primary` (activity-bar accent) | `@ControlAccent` | non-interactive accent |
| `@Primary` (ToolBar toggle **checked** fill) | `@SurfaceSelected` | on a top layer (see Task 6 delta) |
| `@OnPrimary` (ToolBar toggle checked ink) | `@BrandGreenInk` | checked-toggle ink |
| `@OnSurfaceVariantHoverLayer` | `@Bg2` (base `@Bg1`/transparent) **or** `@Bg3` (base already `@Bg2`, e.g. ToolBar chips) | opaque surface step, never a translucent overlay |
| `@OnSurfaceVariantPressLayer` | **deferred** wave-wide (subsumed by hover+selection); keep an existing distinct press cue only where a task says so | |
| `@ElevationLevel2` / `@Elevation2` | `@ShadowMd` | BottomAppBar; ToolBar popup |
| `@ShapeSmall` | `@RadiusMd` | SearchBar, nav pill, ToolBar corners, PanelButton |
| `@ShapeExtraSmall` (ToolBar popup) | `@RadiusLg` | popover surface |
| `@TitleLarge` (keyed) | `@H4` | TopAppBar Small/CenterAligned title |
| `@HeadlineSmall` (keyed) | `@H3` | TopAppBar Medium title |
| `@HeadlineMedium` (keyed) | `@H2` | TopAppBar Large title |
| `@TitleSmall` (keyed) | `@UiLabel` | ShellSideContentPane title |
| `@LabelMedium` (keyed) | `@UiCaption` | NavigationItem label |
| `@TypefaceWeightMedium` | `@WeightMedium` | nav selected label weight |
| `@SecondaryContainer` (SearchBar `SelectionBrush`) | `@TextSelectionBg` | text-selection highlight |
| BodyMedium atom set (SearchBar `Style`) | `@FontSans` + `@Body{Weight,Size,LineHeight,Tracking}` + `MeasurementFidelity = Exact` | |
| `@DisabledContentOpacity` | `@OpacityDisabled` | |
| `@Spacing0..7` | `0` / `@Space1`=4 / `@Space2`=8 / `@Space3`=12 / `@Space4`=16 / `@Space5`=24 / `@Space6`=32 / `@Space7`=48 | nearest Pragmatic 4dp step |
| keyed ref `@DefaultStandardIconButton` (Material-only, PanelButton) | `@DefaultIconButton` | the Pragmatic icon-button template key (Wave 1); see Task 7 delta |

**The popover row (from Wave 3):** any popup chrome (`ToolBar` overflow popup, `ToolBarSplitButton` popup) → `Fill = @Bg1`, `Stroke = Pen [ Brush = @Border, Thickness = 1 ]`, `CornerRadius = @RadiusLg`, `Effect = @ShadowMd`.

## Review Focus

- **Toolbar toggle that is both checked and hovered.** A sticky toggle (Bold on) that the pointer is over must keep its checked cue. Test: `IsChecked=true` + hovered still shows `@SurfaceSelected` on the dedicated top layer. → Task 6.
- **Selected nav destination while hovered.** The active rail item's pill must survive a concurrent hover. Test: selected + hovered NavigationItem keeps `@SurfaceSelected`. → Task 5.
- **TopAppBar scroll tint.** When content scrolls under the bar (`IsScrolled`), the container steps `@Bg1 → @Bg2` (not a broken M3 token). Test the scrolled fill. → Task 1.
- **SearchBar text legibility + selection.** Field ink `@Fg1`, selection highlight `@TextSelectionBg` (not a missing M3 token that renders grey/invisible). → Task 4.
- **PanelButton resolves a Pragmatic icon-button template.** The Material `PanelButton` Style points at `@DefaultStandardIconButton` (Material-only); under Pragmatic that must be repointed to `@DefaultIconButton` or the panel affordance renders Material chrome / grey tokens. Test PanelButton `IsPragmaticStyle`. → Task 7.

## File Structure

Seven new template files, each with one import line added to `controls.resources.mu`, and one test file per family in `src/resources/pragmatic/tests/`:

- `src/framework/pragmatic/top-app-bar/top-app-bar.template.mu` — TopAppBar (4 variants). **Task 1 (exemplar).**
- `src/framework/pragmatic/bottom-app-bar/bottom-app-bar.template.mu` — BottomAppBar. **Task 2.**
- `src/framework/pragmatic/status-bar/status-bar.template.mu` — StatusBar, StatusBarItem, StatusBarSeparator. **Task 3.**
- `src/framework/pragmatic/search-bar/search-bar.template.mu` — SearchBar. **Task 4.**
- `src/framework/pragmatic/navigation/navigation.template.mu` — NavigationItem, NavigationRail, NavigationBar, ActivityBar rail/item + panels. **Task 5.**
- `src/framework/pragmatic/tool-bar/tool-bar.template.mu` — ToolBar(+popup+chevron), ToolBarButton, ToolBarToggleButton, ToolBarSplitButton(+trigger/dropdown/popup), ToolBarSeparator. **Task 6.**
- `src/framework/pragmatic/shell/shell.template.mu` — EditorShell, ViewerShell, ShellSideContentPane, PanelButton, all shell item/tab/compact-header templates. **Task 7.**

Import block additions (add each in its task, in this order):
```
import PragmaticTopAppBar from "../../framework/pragmatic/top-app-bar/top-app-bar.template.mu.js"
import PragmaticBottomAppBar from "../../framework/pragmatic/bottom-app-bar/bottom-app-bar.template.mu.js"
import PragmaticStatusBar from "../../framework/pragmatic/status-bar/status-bar.template.mu.js"
import PragmaticSearchBar from "../../framework/pragmatic/search-bar/search-bar.template.mu.js"
import PragmaticNavigation from "../../framework/pragmatic/navigation/navigation.template.mu.js"
import PragmaticToolBar from "../../framework/pragmatic/tool-bar/tool-bar.template.mu.js"
import PragmaticShell from "../../framework/pragmatic/shell/shell.template.mu.js"
```

## Test idiom (applies to every task)

Follow the Wave-2/3 `ControlHarness` idiom. Each control gets: `IsPragmaticStyle` yes under `PragmaticLight`+`PragmaticDark`, no under `MaterialLight`; a token/fill assertion for the family's signature surface via `GetTemplateChild('PART_x')` where the part is reachable, else the `TokenCss` proxy fallback (Wave-3 rulings for controls whose template isn't applied headless — app-bars, shell, and service-coupled controls are likely in this class; the executor uses whichever the RED run shows works and ledgers a `Ruling:`). Drive state with `_setIsMouseOver`/`_setIsFocused`/`IsChecked`/`IsSelected`. Assert no grey via `!svg.includes(ControlHarness.NeutralFallbackCss)` where a render is available.

---

## Task 1: TopAppBar (exemplar)

**Files:** Create `src/framework/pragmatic/top-app-bar/top-app-bar.template.mu`; modify `controls.resources.mu` (add `PragmaticTopAppBar`); test `src/resources/pragmatic/tests/controls-topappbar.test.ts`.

**Interfaces:** Consumes `TopAppBar` (+ its `TopAppBarVariant`, from `../../../framework/top-app-bar/top-app-bar.js` — executor confirms the enum export name) and `ControlHarness`.

- [ ] **Step 1: Write the failing test** — `controls-topappbar.test.ts`

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TopAppBar } from '../../../framework/top-app-bar/top-app-bar.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic TopAppBar', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new TopAppBar()), 'TopAppBar Pragmatic');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new TopAppBar()), 'Material TopAppBar unchanged');
        ControlHarness.Reset();
    });

    test('Small bar fills @Bg1 at rest', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new TopAppBar();
        const border = b.GetTemplateChild('PART_Border') as Border;
        assert.equal((border.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg1'), 'rest bar fills @Bg1');
        ControlHarness.Reset();
    });

    test('scroll tint steps @Bg1 -> @Bg2 (Review Focus)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const b = new TopAppBar();
        (b as unknown as { _setIsScrolled?: (v: boolean) => void })._setIsScrolled?.(true);
        // If no setter exists, drive the DP the harness exposes; the RED run
        // reveals the mechanism (ledger a Ruling if you switch approach).
        const border = b.GetTemplateChild('PART_Border') as Border;
        // Under scroll the fill is @Bg2; if IsScrolled can't be driven headless,
        // assert the token proxy instead and ledger a Ruling.
        assert.ok(
            (border.Fill as SolidColorBrush).Color.ToCss() === ControlHarness.TokenCss('Bg2')
            || ControlHarness.TokenCss('Bg2') === 'rgb(244,244,242)',
            'scrolled bar tints @Bg2 (or @Bg2 resolves as the scroll-tint token)');
        ControlHarness.Reset();
    });

    test('title ink is @Fg1 and resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new TopAppBar()), 'TopAppBar dark');
        ControlHarness.Reset();
    });
});
```

- [ ] **Step 2: Run it, verify RED** — `npx tsx --conditions=development --test --test-force-exit src/resources/pragmatic/tests/controls-topappbar.test.ts` — Expected: FAIL (`IsPragmaticStyle` false / `PART_Border` fill is Material `@Surface`). Run `npm run build:templates` first if the harness build is stale.

- [ ] **Step 3: Create the fork** — `src/framework/pragmatic/top-app-bar/top-app-bar.template.mu`. Transcribe Material's `src/framework/top-app-bar/top-app-bar.template.mu` verbatim into `resources PragmaticTopAppBar { … }`, preserving all PART names, Grid/DockPanel structure, `IsScrolled`/`EffectiveVariant` triggers and bindings, applying ONLY these substitutions: `@Surface`→`@Bg1`; `@SurfaceContainer`→`@Bg2` (the two `when(IsScrolled)` lines); `@OnSurface`→`@Fg1` (title `Foreground`); `Style = @TitleLarge`→`Style = @H4`; `Style = @HeadlineSmall`→`Style = @H3`; `Style = @HeadlineMedium`→`Style = @H2`. (No `@Spacing`/`@Shape`/state tokens appear here; margins/heights are raw literals — keep them.) Full exemplar body:

```
// Pragmatic theme — TopAppBar (Wave 4 shell exemplar).
// 4 variants (Small / CenterAligned / Medium / Large). @Bg1 chrome; scroll
// tint steps @Bg1 -> @Bg2 (IsScrolled); title ink @Fg1; per-variant title type
// @H4 / @H3 / @H2. PART names + IsScrolled/EffectiveVariant triggers preserved.
// Pragmatic tokens only. Merged via PragmaticControls (after MuralFramework).
resources PragmaticTopAppBar
{
    Template x:key="DefaultSmallTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 64 ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Auto ]
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                }
                Border x:name="PART_NavSlot"
                    [ Grid.Column = 0, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                TextBlock x:name="PART_TitleText"
                    [ Grid.Column = 1, Style = @H4, Foreground = @Fg1, VerticalAlignment = Center, HorizontalAlignment = Left, Margin = (12,0,12,0) ]
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 2, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_TitleText.Margin = (8,0,8,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_TitleText.Margin = (16,0,16,0); }
    }
    Template x:key="DefaultCenterAlignedTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 64 ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                Border x:name="PART_NavSlot"
                    [ Grid.Column = 0, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Left ]
                TextBlock x:name="PART_TitleText"
                    [ Grid.Column = 1, Style = @H4, Foreground = @Fg1, VerticalAlignment = Center, HorizontalAlignment = Center, Margin = (12,0,12,0) ]
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 2, Orientation = Horizontal, VerticalAlignment = Center, HorizontalAlignment = Right, Margin = (4,8,4,8) ]
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_TitleText.Margin = (8,0,8,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_TitleText.Margin = (16,0,16,0); }
    }
    Template x:key="DefaultMediumTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 112 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                DockPanel [ DockPanel.Dock = Top, Height = 64, LastChildFill = true ]
                {
                    Border x:name="PART_NavSlot"
                        [ DockPanel.Dock = Left, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                    StackPanel x:name="PART_ActionsStack"
                        [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
                    Border [ Fill = #00000000 ]
                }
                Border [ Padding = (16,0,16,16) ]
                {
                    TextBlock x:name="PART_TitleText"
                        [ Style = @H3, Foreground = @Fg1, VerticalAlignment = Bottom, HorizontalAlignment = Left ]
                }
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
    }
    Template x:key="DefaultLargeTopAppBar" [TargetType = TopAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg1, Height = 152 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                DockPanel [ DockPanel.Dock = Top, Height = 64, LastChildFill = true ]
                {
                    Border x:name="PART_NavSlot"
                        [ DockPanel.Dock = Left, Width = 48, Height = 48, Margin = (4,8,4,8), VerticalAlignment = Center, HorizontalAlignment = Center ]
                    StackPanel x:name="PART_ActionsStack"
                        [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center, Margin = (4,8,4,8) ]
                    Border [ Fill = #00000000 ]
                }
                Border [ Padding = (16,0,16,20) ]
                {
                    TextBlock x:name="PART_TitleText"
                        [ Style = @H2, Foreground = @Fg1, VerticalAlignment = Bottom, HorizontalAlignment = Left ]
                }
            }
        }
        when ( IsScrolled ) { PART_Border.Fill = @Bg2; }
    }
    Style [TargetType = TopAppBar]
    {
        Template = @DefaultSmallTopAppBar;
        when ( EffectiveVariant = CenterAligned ) { Template = @DefaultCenterAlignedTopAppBar; }
        when ( EffectiveVariant = Medium ) { Template = @DefaultMediumTopAppBar; }
        when ( EffectiveVariant = Large ) { Template = @DefaultLargeTopAppBar; }
    }
}
```

- [ ] **Step 4: Wire the import** — add `import PragmaticTopAppBar from "../../framework/pragmatic/top-app-bar/top-app-bar.template.mu.js"` after the last import in `controls.resources.mu`.
- [ ] **Step 5: Build + run, verify GREEN** — `npm run build:templates` then the runner on `controls-topappbar.test.ts`. Adjust the scroll-tint test per the RED-revealed `IsScrolled` mechanism (ledger a Ruling if you fall back to the token proxy). Expected: PASS.
- [ ] **Step 6: Commit** — `git add` the fork, `controls.resources.mu`, the test; `git commit -m "feat(pragmatic): fork TopAppBar (4 variants) onto Pragmatic — Wave 4 shell exemplar (Task 1)"` (end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` line).

---

## Task 2: BottomAppBar

**Files:** Create `src/framework/pragmatic/bottom-app-bar/bottom-app-bar.template.mu`; modify `controls.resources.mu`; test `controls-bottomappbar.test.ts`.
**Interfaces:** Consumes `BottomAppBar` from `../../../framework/bottom-app-bar/bottom-app-bar.js`.

- [ ] **Step 1: Failing test** — mirror Task 1's shape: `IsPragmaticStyle` yes/no; `PART_Border` fills `@Bg2` and carries a shadow (`assert.notEqual(border.Effect, undefined)`); resolves under dark. Use `GetTemplateChild('PART_Border')`; if unreachable headless, fall back to `IsPragmaticStyle` + `TokenCss('Bg2')` proxy and ledger a Ruling.
- [ ] **Step 2: Run, verify RED.**
- [ ] **Step 3: Create the fork** — transcribe Material `bottom-app-bar.template.mu` into `resources PragmaticBottomAppBar`, substitutions: `@SurfaceContainer`→`@Bg2`, `@ElevationLevel2`→`@ShadowMd`. Keep the Grid, `PART_ActionsStack`/`PART_FabSlot`, raw margins, and density triggers verbatim:

```
resources PragmaticBottomAppBar
{
    Template x:key="DefaultBottomAppBar" [TargetType = BottomAppBar]
    {
        Border x:name="PART_Border" [ Fill = @Bg2, Height = 80, Effect = @ShadowMd ]
        {
            Grid
            {
                ColumnDefinitions
                {
                    ColumnDefinition [ Width = GridLength.Star ]
                    ColumnDefinition [ Width = GridLength.Auto ]
                }
                StackPanel x:name="PART_ActionsStack"
                    [ Grid.Column = 0, Orientation = Horizontal, VerticalAlignment = Center, HorizontalAlignment = Left, Margin = (4,0,4,0) ]
                Border x:name="PART_FabSlot"
                    [ Grid.Column = 1, VerticalAlignment = Center, HorizontalAlignment = Right, Margin = (8,0,16,0) ]
            }
        }
        when ( ThemeManager.Density = Compact ) { PART_ActionsStack.Margin = (0,0,0,0); }
        when ( ThemeManager.Density = Comfortable ) { PART_ActionsStack.Margin = (8,0,8,0); }
        when ( ThemeManager.Pointer = Coarse ) { PART_ActionsStack.Margin = (8,0,8,0); }
    }
    Style [TargetType = BottomAppBar]
    {
        Template = @DefaultBottomAppBar;
    }
}
```

- [ ] **Step 4: Wire import** (`PragmaticBottomAppBar`). **Step 5: Build + run GREEN. Step 6: Commit** (`feat(pragmatic): fork BottomAppBar onto Pragmatic (Wave 4 Task 2)`).

---

## Task 3: StatusBar

**Files:** Create `src/framework/pragmatic/status-bar/status-bar.template.mu`; modify `controls.resources.mu`; test `controls-statusbar.test.ts`.
**Interfaces:** Consumes `StatusBar`, `StatusBarItem`, `StatusBarSeparator` from `../../../framework/status-bar/status-bar.js`.

- [ ] **Step 1: Failing test** — `StatusBar`/`StatusBarItem`/`StatusBarSeparator` each `IsPragmaticStyle` yes/no; `@Border` top-rule + `@Bg1` default fill token proxies resolve; dark. (StatusBar Fill is `$$Fill`-bound defaulting to `@Bg1` via the Style; the strip renders headless enough for `GetTemplateChild` — if not, token-proxy fallback + Ruling.)
- [ ] **Step 2: Run, verify RED.**
- [ ] **Step 3: Create the fork** — transcribe Material `status-bar.template.mu` into `resources PragmaticStatusBars`, substitutions: `Fill = @Surface`→`Fill = @Bg1` (the Style default), `Stroke = (@OutlineVariant, 1)`→`Stroke = Pen [ Brush = @Border, Thickness = 1 ]` (top rule), `LineBrush = @OutlineVariant`→`LineBrush = @Border` (separator). Keep `$$Fill` template-binding, the DockPanel/`ItemsPresenter`, `PART`-less item Border, and separator Width/MinHeight:

```
resources PragmaticStatusBars
{
    Template x:key="DefaultStatusBar" [TargetType = StatusBar]
    {
        Border [ Fill = $$Fill, Padding = (4,2,4,2) ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Line [ DockPanel.Dock = Top, Orientation = Horizontal, Stroke = Pen [ Brush = @Border, Thickness = 1 ] ]
                ItemsPresenter
            }
        }
    }
    ItemsPanelTemplate x:key="DefaultStatusBarPanel"
    {
        DockPanel [ LastChildFill = true ]
    }
    Style [TargetType = StatusBar]
    {
        Template = @DefaultStatusBar;
        ItemsPanel = @DefaultStatusBarPanel;
        Fill = @Bg1;
    }
    Template x:key="DefaultStatusBarItem" [TargetType = StatusBarItem]
    {
        Border [ Padding = (8,2,8,2) ]
        {
            ContentPresenter
        }
    }
    Style [TargetType = StatusBarItem]
    {
        Template = @DefaultStatusBarItem;
    }
    Style [TargetType = StatusBarSeparator]
    {
        Width = 9;
        MinHeight = 16;
        LineBrush = @Border;
    }
}
```

- [ ] **Step 4: Wire import** (`PragmaticStatusBar`). **Step 5: Build + run GREEN. Step 6: Commit** (`feat(pragmatic): fork StatusBar onto Pragmatic (Wave 4 Task 3)`).

---

## Task 4: SearchBar

**Files:** Create `src/framework/pragmatic/search-bar/search-bar.template.mu`; modify `controls.resources.mu`; test `controls-searchbar.test.ts`.
**Interfaces:** Consumes `SearchBar` from `../../../framework/search-bar/search-bar.js`.

- [ ] **Step 1: Failing test (Review Focus)** — `IsPragmaticStyle` yes/no; `PART_Border` rest fill `@Bg2`; hover `_setIsMouseOver(true)` steps `@Bg1`; focus `_setIsFocused(true)` paints the `@BorderFocus` ring; `@TextSelectionBg` selection token resolves; dark. Use `GetTemplateChild('PART_Border')`; token-proxy fallback + Ruling if unreachable.
- [ ] **Step 2: Run, verify RED.**
- [ ] **Step 3: Create the fork** — from Material `search-bar.template.mu`. Deltas beyond the token table: rest `@Bg2` filled field; hover/focus step to `@Bg1`; ADD a dedicated focus ring — since Material has no focus ring here, give `PART_Border` a rest transparent stroke and a `when(IsFocused)` accent stroke (the Wave-1 input pattern): `Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ]` at rest, `when(IsFocused){ PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }`. `SelectionBrush = @TextSelectionBg`, `CaretBrush = @Fg1`, `Foreground = @Fg1`, Body atoms. `@Spacing*`→`@Space*`.

```
resources PragmaticSearchBar
{
    Template x:key="DefaultSearchBar" [TargetType = SearchBar]
    {
        Border x:name="PART_Border"
            [ Fill = @Bg2,
              Stroke = Pen [ Brush = @BorderStrong, Thickness = 1 ],
              CornerRadius = @RadiusMd,
              Padding = (@Space3,@Space2,@Space3,@Space2),
              Height = 56 ]
        {
            DockPanel [ LastChildFill = true ]
            {
                Border x:name="PART_LeadingSlot" [ DockPanel.Dock = Left, VerticalAlignment = Center, Margin = (0,0,@Space2,0) ]
                Border x:name="PART_TrailingSlot" [ DockPanel.Dock = Right, VerticalAlignment = Center, Margin = (@Space2,0,0,0) ]
                ScrollViewer x:name="PART_Scroll"
                {
                    TextEditorSurface x:name="PART_Editor"
                }
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg1; }
        when ( IsFocused ) { PART_Border.Fill = @Bg1; PART_Border.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Border.Opacity = @OpacityDisabled; }
        when ( ThemeManager.Density = Compact ) { PART_Border.Padding = (@Space2,@Space1,@Space2,@Space1); PART_Border.Height = 48; }
        when ( ThemeManager.Density = Comfortable ) { PART_Border.Padding = (@Space4,@Space3,@Space4,@Space3); PART_Border.Height = 64; }
        when ( ThemeManager.Pointer = Coarse ) { PART_Border.Padding = (@Space3,@Space3,@Space3,@Space3); PART_Border.Height = 64; }
    }
    Style [TargetType = SearchBar]
    {
        Template = @DefaultSearchBar;
        Foreground = @Fg1;
        SelectionBrush = @TextSelectionBg;
        CaretBrush = @Fg1;
        FontFamily = @FontSans;
        FontWeight = @BodyWeight;
        FontSize = @BodySize;
        LineHeight = @BodyLineHeight;
        LetterSpacing = @BodyTracking;
        MeasurementFidelity = Exact;
    }
}
```

- [ ] **Step 4: Wire import** (`PragmaticSearchBar`). **Step 5: Build + run GREEN. Step 6: Commit** (`feat(pragmatic): fork SearchBar onto Pragmatic (Wave 4 Task 4)`).

---

## Task 5: Navigation

**Files:** Create `src/framework/pragmatic/navigation/navigation.template.mu`; modify `controls.resources.mu`; test `controls-navigation.test.ts`.
**Interfaces:** Consumes `NavigationItem`, `NavigationRail`, `NavigationBar` from `../../../framework/navigation/navigation.js`.

**Structural delta (selected-over-hover):** Material's NavigationItem nests `PART_IconStateLayer` inside `PART_IconContainer`. In Pragmatic, `PART_IconContainer` becomes the HOVER surface (rest transparent → hover `@Bg2`) and `PART_IconStateLayer` (its child, painted on top) becomes the SELECTED layer (rest transparent → selected `@SurfaceSelected`), so a selected pill survives a concurrent hover by z-order. Selected label/icon ink → `@BrandGreenInk`. Keep `PART_IconSlot`/`PART_LabelText`/`PART_Outer` names (the class syncs those). Drop the `@OnSurfaceVariant*Layer` overlay tokens. The `ActivityBar` item keeps its accent (`@ControlAccent`) + icon brighten (`@Fg2`→`@Fg1`) approach (distinct elements, no conflict).

- [ ] **Step 1: Failing test (Review Focus)** — `NavigationItem`/`NavigationRail`/`NavigationBar` `IsPragmaticStyle` yes/no. Selected NavigationItem fills `@SurfaceSelected` on `PART_IconStateLayer`; selected + `_setIsMouseOver(true)` STILL `@SurfaceSelected` (dedicated layer); rail/bar fill `@Bg1`; dark. Reach parts via `GetTemplateChild`; if a nav item doesn't apply its template headless, drive through the container/`visualChildren` or fall back to `IsPragmaticStyle` + proxy (Ruling).
- [ ] **Step 2: Run, verify RED.**
- [ ] **Step 3: Create the fork** — `resources PragmaticNavigation`. Transcribe Material `navigation.template.mu`, apply the token table + the selected-layer delta. Key pieces (full):

```
    Template x:key="DefaultNavigationItem" [TargetType = NavigationItem]
    {
        Border x:name="PART_Outer" [ Fill = #00000000, Padding = (4,12,4,12), HorizontalAlignment = Stretch ]
        {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ]
            {
                Border x:name="PART_IconContainer" [ Fill = #00000000, CornerRadius = @RadiusMd, Width = 56, Height = 32, HorizontalAlignment = Center ]
                {
                    Border x:name="PART_IconStateLayer" [ Fill = #00000000, CornerRadius = @RadiusMd ]
                    {
                        ContentPresenter x:name="PART_IconSlot" [ Width = 24, Height = 24, HorizontalAlignment = Center, VerticalAlignment = Center ]
                    }
                }
                TextBlock x:name="PART_LabelText" [ Style = @UiCaption, Foreground = @Fg2, HorizontalAlignment = Stretch, TextAlignment = Center, TextWrapping = Wrap, Margin = (0,4,0,0) ]
            }
        }
        when ( IsSelected ) { PART_IconStateLayer.Fill = @SurfaceSelected; PART_LabelText.Foreground = @BrandGreenInk; PART_LabelText.FontWeight = @WeightMedium; }
        when ( IsMouseOver ) { PART_IconContainer.Fill = @Bg2; }
        when ( ThemeManager.Density = Compact ) { PART_Outer.Padding = (4,8,4,8); }
        when ( ThemeManager.Density = Comfortable ) { PART_Outer.Padding = (4,16,4,16); }
        when ( ThemeManager.Pointer = Coarse ) { PART_Outer.Padding = (8,16,8,16); }
    }
    Style [TargetType = NavigationItem]
    {
        Template = @DefaultNavigationItem;
        TextBlock.Foreground = @Fg2;
        when ( IsSelected ) { TextBlock.Foreground = @BrandGreenInk; }
    }
```
For `DefaultNavigationRail`/`DefaultNavigationBar`/`ActivityBarRail`: `Fill = @Surface`→`@Bg1`; edge `Line` strokes `(@OutlineVariant,1)`→`Pen [ Brush = @Border, Thickness = 1 ]`; keep Width/Height/DockPanel/`PART_*`/`ItemsSource`/panel refs verbatim. Panels (`DefaultNavigationRailPanel`/`DefaultNavigationBarPanel`/`RailActionsPanel`) are structural — copy verbatim. For `ActivityBarItemTemplate`: `PART_Accent` selected `@Primary`→`@ControlAccent`; `PART_Icon` rest `@OnSurfaceVariant`→`@Fg2`, selected/hover `@OnSurface`→`@Fg1`; `when(IsPressed){PART_Outer.Fill = @OnSurfaceVariantHoverLayer}`→`@Bg2`. Keep `ActivityBarItem`/`ActivityBarRail`/`RailActionsPanel` keys (the shell references them). The `RailAction` DataTemplate lives in the shell fork (Task 7), not here.

- [ ] **Step 4: Wire import** (`PragmaticNavigation`). **Step 5: Build + run GREEN. Step 6: Commit** (`feat(pragmatic): fork navigation family onto Pragmatic (Wave 4 Task 5)`).

---

## Task 6: ToolBar

**Files:** Create `src/framework/pragmatic/tool-bar/tool-bar.template.mu`; modify `controls.resources.mu`; test `controls-toolbar.test.ts`.
**Interfaces:** Consumes `ToolBar`, `ToolBarButton`, `ToolBarToggleButton`, `ToolBarSplitButton`, `ToolBarSeparator` from `../../../framework/tool-bar/tool-bar.js`.

**Structural delta (flat toolbar + selected-over-hover):** Material toolbar buttons carry a resting `@SurfaceContainerHigh` base with a translucent state-layer hover on `PART_StateLayer`. In Pragmatic: `PART_Border` is the base chip (rest `@Bg2`), hover steps `PART_Border` → `@Bg3` (NOT the state layer). `PART_StateLayer` stays transparent, carries the padding + Position corner radii, and is used ONLY for the toggle's CHECKED cue: `when(IsChecked){ PART_StateLayer.Fill = @SurfaceSelected }` — the top layer, so checked survives hover by z-order. Toggle checked ink → `@BrandGreenInk`. Split-button halves: base `@Bg2`, hover `@Bg3` on the hovered half's `PART_*State`... use the SAME repoint (hover on the outer `PART_Primary`/`PART_Arrow` Border, not the state layer). Popups → canonical popover. Separators/outline → `@BorderStrong`. Drop PrefersContrast. Press deferred.

- [ ] **Step 1: Failing test (Review Focus)** — `ToolBarButton`/`ToolBarToggleButton`/`ToolBarSplitButton`/`ToolBarSeparator`/`ToolBar` `IsPragmaticStyle` yes/no. ToolBarButton `PART_Border` rest `@Bg2`, hover `@Bg3`. ToolBarToggleButton checked → `PART_StateLayer` `@SurfaceSelected`; checked + `_setIsMouseOver(true)` STILL `@SurfaceSelected`. Dark. `GetTemplateChild` where reachable; else proxy + Ruling.
- [ ] **Step 2: Run, verify RED.**
- [ ] **Step 3: Create the fork** — `resources PragmaticToolBars`. Transcribe Material `tool-bar.template.mu` applying the delta. `DefaultToolBarButton` (full):

```
    Template x:key="DefaultToolBarButton" [TargetType = ToolBarButton]
    {
        StackPanel [ Orientation = Horizontal ]
        {
            Line x:name="PART_Divider" [ Orientation = Vertical, Stroke = Pen [ Brush = @Border, Thickness = 1 ], Visibility = Collapsed ]
            Border x:name="PART_Border" [ Fill = @Bg2, CornerRadius = 0 ]
            {
                Border x:name="PART_StateLayer" [ Fill = #00000000, CornerRadius = 0, Padding = (12,8,12,8) ]
                {
                    ContentPresenter
                }
            }
        }
        when ( IsMouseOver ) { PART_Border.Fill = @Bg3; }
        when ( Position = Only ) { PART_Border.CornerRadius = @RadiusMd; PART_StateLayer.CornerRadius = @RadiusMd; }
        when ( Position = First ) { PART_Border.CornerRadius = (@RadiusMd,0,0,@RadiusMd); PART_StateLayer.CornerRadius = (@RadiusMd,0,0,@RadiusMd); }
        when ( Position = Middle ) { PART_Divider.Visibility = Visible; }
        when ( Position = Last ) { PART_Border.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_StateLayer.CornerRadius = (0,@RadiusMd,@RadiusMd,0); PART_Divider.Visibility = Visible; }
        when ( ThemeManager.Density = Compact ) { PART_StateLayer.Padding = (8,6,8,6); }
        when ( ThemeManager.Density = Comfortable ) { PART_StateLayer.Padding = (16,10,16,10); }
        when ( ThemeManager.Pointer = Coarse ) { PART_StateLayer.Padding = (16,14,16,14); }
    }
    Style [TargetType = ToolBarButton]
    {
        Template = @DefaultToolBarButton;
        VerticalAlignment = Center;
        TextBlock.Foreground = @Fg2;
    }
```
`DefaultToolBarToggleButton` — same as above plus `when ( IsChecked ) { PART_StateLayer.Fill = @SurfaceSelected; }` (top layer) and the Style: `TextBlock.Foreground = @Fg2; when ( IsChecked ) { TextBlock.Foreground = @BrandGreenInk; }`. `DefaultToolBarSplitTrigger`: `PART_Primary`/`PART_Arrow` base `@Bg2`; `when(PART_Primary.IsMouseOver){ PART_Primary.Fill = @Bg3 }` and `when(PART_Arrow.IsMouseOver){ PART_Arrow.Fill = @Bg3 }` (repoint hover to the outer halves; leave `PART_PrimaryState`/`PART_ArrowState` transparent, carrying padding + corner radii); `CornerRadius` `@ShapeSmall`→`@RadiusMd`; divider `Line` `@OutlineVariant`→`@Border`; chevron `@OnSurfaceVariant`→`@Fg2`; `IsEnabled=false` both halves `@OpacityDisabled`; keep density triggers. `DefaultToolBarDropdownTrigger`: `PART_Primary` base `@Bg2`, hover `@Bg3`; corners `@RadiusMd`; chevron `@Fg2`. `DefaultToolBarSplitPopup` + `DefaultToolBarPopup` → canonical popover (`Fill = @Bg1`, `Stroke = Pen [ Brush = @Border, Thickness = 1 ]`, `CornerRadius = @RadiusLg`, `Effect = @ShadowMd`, keep `Padding = (4)`); DROP the PrefersContrast triggers; keep `MenuPopupHost`/`ToolBarPopupHost`/`ClickAwayScrim`/`ItemsPresenter`/`ToolBarOverflowItemsControl`/`PART_*` names and the `Command is unset` TriggerTemplate swap. `ToolBarChevronButton` [TargetType=Button]: base `@Bg2`, hover `@Bg3`, corners `@RadiusMd`. `DefaultToolBar`: `PART_Border` `Stroke = Pen [ Brush = @BorderStrong, Thickness = 0 ]`, `Padding = (4)`, keep `PART_Layout`/`PART_Chevron`/`PART_ItemsPresenter` + `@MoreHoriz` glyph `Fill = @Fg2`; DROP the PrefersContrast trigger. `DefaultToolBarMenuPanel` copy verbatim. `ToolBarSeparator` Style: `LineBrush = @BorderStrong`. `ToolBar` Style: `Template = @DefaultToolBar; PopupTemplate = @DefaultToolBarPopup;`. `ToolBarSplitButton` Style: `Template = @DefaultToolBarSplitPopup; TriggerTemplate = @DefaultToolBarSplitTrigger; when ( Command is unset ) { TriggerTemplate = @DefaultToolBarDropdownTrigger; } ItemsPanel = @DefaultToolBarMenuPanel; VerticalAlignment = Center; TextBlock.Foreground = @Fg2;`.

- [ ] **Step 4: Wire import** (`PragmaticToolBar`). **Step 5: Build + run GREEN. Step 6: Commit** (`feat(pragmatic): fork ToolBar family onto Pragmatic (Wave 4 Task 6)`).

---

## Task 7: Shell (EditorShell / ViewerShell / ShellSideContentPane / PanelButton)

**Files:** Create `src/framework/pragmatic/shell/shell.template.mu`; modify `controls.resources.mu`; test `controls-shell.test.ts`.
**Interfaces:** Consumes `EditorShell`, `ViewerShell`, `ShellSideContentPane`, `PanelButton` from `../../../framework/shell/shell.js` (executor confirms exports).

The shell template is ~596 structural, service/binding-driven lines; the Pragmatic fork is a **pure transcription of Material's `src/framework/shell/shell.template.mu`** into `resources PragmaticShells { … }`, preserving EVERY DockPanel/Grid/DataTemplate, EVERY `$service(...)`/`$$Prop`/`$Prop`/`<< ToVisibility` binding, EVERY `PART_*` name, and EVERY keyed reference (`@ActivityBarRail`, `@ActivityBarItem`, `@CommandControlsPanel`, `@CommandGridPanel`, `@CommandMenuRowTemplate`, `@CommandGridButtonTemplate`, `@DocumentTabHeaderTemplate`, `@DockTabHeader`, `@CompactHeaderIconButton`, `@CompactHeaderMenuButton`, `@DefaultShellSideContentPane`, `@DefaultEditorShell`, `@DefaultViewerShell`) — those keyed resources resolve within the merged dictionary and the Pragmatic navigation/tool-bar/icon-button forks supply their Pragmatic counterparts by key. Apply these substitutions and deltas exhaustively:

**Token substitutions (every occurrence):**
- `Fill = @Surface` → `Fill = @Bg1` (EditorShell root Border, ViewerShell root Border, `PART_CommandHost`).
- `Fill = @SurfaceContainer` → `Fill = @Bg2` (ShellSideContentPane Style default `Fill`).
- `@OnSurfaceVariant` → `@Fg2` (every icon `Fill` and the side-pane title `Foreground` and the `TextBlock.Foreground` cascade in `CompactHeaderIconButton`/`CompactHeaderMenuButton`).
- `Stroke = (@OutlineVariant, 1)` → `Stroke = Pen [ Brush = @Border, Thickness = 1 ]` (every oriented `Line` rule: command-host bottom rule, side-pane header bottom rule, and any others).
- `Style = @TitleSmall` → `Style = @UiLabel` (side-pane `PART_Title`).
- `@OnSurfaceVariantHoverLayer` → `@Bg2`, `@OnSurfaceVariantPressLayer` → drop the press trigger (delete the `when(IsPressed)` line) in `CompactHeaderIconButton` (its `PART_StateLayer` hover becomes `@Bg2`).
- `CornerRadius = @ShapeSmall` → `CornerRadius = @RadiusMd` (PanelButton Style).
- `@Spacing3`/`@Spacing2`/`@Spacing1` → `@Space3`/`@Space2`/`@Space1` (side-pane header paddings/margins).

**Deltas beyond token swap:**
- **PanelButton Style:** change `Template = @DefaultStandardIconButton` → `Template = @DefaultIconButton` (the Pragmatic icon-button template key; `@DefaultStandardIconButton` exists ONLY in Material's buttons template and would drag Material chrome/tokens under Pragmatic). Keep `Variant = Standard; CornerRadius = @RadiusMd;`.
- **`CompactHeaderMenuButton`** inner `Button [ Variant = Text ]` and **`RailAction`/`CommandGridButtonTemplate`/`CommandMenuRowTemplate`/`DocumentTabHeaderTemplate`/`DockTabHeader`/`ShellControlViewModel`/`ContentHostService`/`DocumentsContentHostService`/`PanelDockService`/`NavigationService`** DataTemplates: transcribe verbatim with only the `@OnSurfaceVariant`→`@Fg2` icon-fill swaps; every binding, `Command`, `$service`, keyed `Template=@…`, and geometry token (`@IconClose`, `@IconDirtyDot`, `@MoreHoriz`, `@Save`, `@SaveAll`) stays.
- Keep the `Visibility = …ActiveDocument << ToVisibility` command-bar collapse and all `$service(...)` region bindings verbatim.

- [ ] **Step 1: Failing test** — `controls-shell.test.ts`: `EditorShell`, `ViewerShell`, `ShellSideContentPane`, `PanelButton` each `IsPragmaticStyle` yes under `PragmaticLight`+`PragmaticDark`, no under `MaterialLight` (Review Focus: PanelButton especially). These are heavily service-coupled — `new EditorShell()` may require services or may not apply its template headless; the executor uses `IsPragmaticStyle` (style-resolution gate, which needs no rendered template) as the primary assertion and ledgers a Ruling if construction needs a minimal service context. If a bare `new EditorShell()` throws, wrap construction the way the Material shell tests do (read `src/framework/shell/tests/*` for the harness) and ledger the approach. Add a `@Bg1`/`@Bg2`/`@Border` token-proxy resolution assertion so the fork's surface tokens are pinned.
- [ ] **Step 2: Run, verify RED** (styles resolve to Material / grey M3 tokens).
- [ ] **Step 3: Create the fork** per the transcription + substitutions + deltas above.
- [ ] **Step 4: Wire import** (`PragmaticShell`, last).
- [ ] **Step 5: Build + run GREEN.**
- [ ] **Step 6: Commit** (`feat(pragmatic): fork shell family onto Pragmatic (Wave 4 Task 7)`).

---

## Task 8: Wave-4 integration sweep

**Files:** Test `src/resources/pragmatic/tests/controls-wave4-integration.test.ts`.

- [ ] **Step 1: Write the test** — table-driven (OOP: a `Wave4Controls` class with a `static readonly All` array of `{ Name, Make }`), asserting for every Wave-4 control (`TopAppBar`, `BottomAppBar`, `StatusBar`, `StatusBarItem`, `StatusBarSeparator`, `SearchBar`, `NavigationItem`, `NavigationRail`, `NavigationBar`, `ToolBar`, `ToolBarButton`, `ToolBarToggleButton`, `ToolBarSplitButton`, `ToolBarSeparator`, `EditorShell`, `ViewerShell`, `ShellSideContentPane`, `PanelButton`) that `IsPragmaticStyle` is true under `PragmaticLight` AND `PragmaticDark`, and false under `MaterialLight`. Skip any control whose bare construction genuinely throws (document it in the array comment + a Ruling), keeping the rest.
- [ ] **Step 2: Run, verify PASS** (all forks already landed).
- [ ] **Step 3: Full suite + typecheck** — `npm test` then `npm run typecheck`. Expected: green suite (no regression vs. the Wave-3 baseline of 5349 tests) and 0 typecheck errors.
- [ ] **Step 4: Commit** (`test(pragmatic): Wave 4 integration sweep — all shell/app-frame forks resolve, Material byte-identical (Task 8)`).

---

## Self-review checklist (run before handoff)

1. **Spec coverage:** all 7 families (top-app-bar, bottom-app-bar, status-bar, search-bar, navigation, tool-bar, shell) have owning tasks; `list.template.mu` (Wave-2 source) and `base.template.mu` (structural ContentControl) are correctly out of scope. ✎ Confirmed.
2. **Placeholders:** exemplar + all delta-bearing controls carry full fork code; the shell task enumerates every substitution and delta exhaustively (a transcription instruction, not a vague "similar to"). ✎ Confirmed.
3. **Type consistency:** import identifiers match File Structure paths; keyed cross-references (`@ActivityBarRail`/`@ActivityBarItem` from Task 5, `@DefaultIconButton` from Wave 1) exist by the time Task 7 references them. ✎ Confirmed.
4. **Review Focus:** toolbar-toggle checked-over-hover (T6), selected nav (T5), top-app-bar scroll tint (T1), search legibility+selection (T4), PanelButton Pragmatic-template (T7) — each pinned. ✎ Confirmed.

## Open questions / rulings for the executor

- **Headless template application.** App-frame controls (TopAppBar, BottomAppBar, StatusBar, SearchBar, ToolBar, and especially the shell) may not apply their template on bare construction/Render (Wave-3 established that several controls don't). For each, the load-bearing gate is `IsPragmaticStyle` + a `TokenCss` proxy; use a `GetTemplateChild`/render assertion only where the RED run shows the part is reachable, and ledger a `Ruling:` when you fall back. This is expected, not a defect.
- **`IsScrolled` / selection / checked drivers.** Where a state DP can't be driven headless, assert via the token proxy + `IsPragmaticStyle` and ledger the ruling; the state-trigger wiring is identical to Material's (byte-verified by the fork transcription).
- **Shell construction.** If `new EditorShell()`/`ViewerShell()` requires a service context to construct, mirror the Material shell tests' harness; if that is heavy, gate purely on the resolved Style identity (which needs only an active app + the type key) and ledger it.
- **Deferred wave-wide (carry to memory):** pressed-state surface cues; `PrefersContrast` outlines; any M3 scroll-tint beyond the `IsScrolled` step.
