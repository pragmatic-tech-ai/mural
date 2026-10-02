import {
    Application,
    MetaData,
    MuralBase,
    Scheme,
    Theme,
    ThemeManager,
    Element, } from '../../runtime/index.js';
import { ContentControl } from '../base/content-control.js';
import { ComboBox } from '../list/combo-box.js';
import { ApplicationSettings } from '../shell/services/application-settings-service.js';
import { SettingDefinition, SettingKind } from '@pragmatic-tech-ai/todl-runtime';

// Persistence key (contributed as an ApplicationSettings entry so an app with
// an ISettingsStore round-trips it across launches). SCHEME_SETTING holds the
// chosen scheme name.
const SCHEME_SETTING = 'theme.scheme';

// ThemeSelector — chrome control for picking the active Theme + Scheme
// at runtime. Reads / writes the global ThemeManager directly; no VM
// state required on the host side.
//
// Layout (default template):
//
//   ┌─ PART_ThemeIcon ─┐ ┌─ PART_ThemeCombo ─┐  ┌─ PART_SchemeIcon ─┐ ┌─ PART_SchemeCombo ─┐
//   │   icon glyph     │ │  (slides in)      │  │   icon glyph      │ │   (slides in)      │
//   └──────────────────┘ └───────────────────┘  └───────────────────┘ └────────────────────┘
//
// Icons are always visible affordances. Both ComboBoxes slide in when
// the pointer enters the ThemeSelector and slide back out when the
// pointer leaves AND no dropdown popup is currently open — declared as
// `when ( IsMouseOver or PART_xxxCombo.IsDropDownOpen )` triggers in
// the default template. The control itself owns no open/closed DPs:
// hover state lives on the standard `IsMouseOver` already exposed by
// every and dropdown state lives on the inner ComboBoxes.
//
// The scheme combo lists the active theme's built-in schemes (e.g. Pragmatic ▸
// Light/Dark); selecting one applies it globally via ThemeManager and the choice
// persists through ApplicationSettings, re-applying on the next launch.
// Persistence is inert in a host without an ApplicationSettings service (the
// demos); the picker itself works anywhere the control is mounted.
//
// External theme changes (AutoScheme firing, another module calling
// ActivateTheme directly) feed back through ThemeManager.Activated so
// the picker's selected items stay in sync.
//
// Extends ContentControl purely for the Template + GetTemplateChild
// inheritance; the Content slot is unused.
export class ThemeSelector extends ContentControl
{
    // ── State DPs ─────────────────────────────────────────────────────
    //
    // Read-only mirrors of ThemeManager state, useful for hosts that
    // want to bind a label or status indicator to the active theme /
    // scheme without reaching into the singleton directly. The template
    // doesn't reference them — the inner ComboBoxes are bound
    // imperatively from syncFromThemeManager.

    private static readonly _ActiveThemeNamePriv = MuralBase.RegisterReadOnlyProperty<string | undefined>(
        ThemeSelector, 'ActiveThemeName', undefined, MetaData.None,
    );
    public  static readonly ActiveThemeNameKey  = ThemeSelector._ActiveThemeNamePriv;

    private static readonly _ActiveSchemeNamePriv = MuralBase.RegisterReadOnlyProperty<string | undefined>(
        ThemeSelector, 'ActiveSchemeName', undefined, MetaData.None,
    );
    public  static readonly ActiveSchemeNameKey  = ThemeSelector._ActiveSchemeNamePriv;

    static
    {
        MuralBase.OverrideMetadata(ThemeSelector, Element.DefaultStyleKeyKey, { default_value: ThemeSelector });
    }

    // ── Template parts ────────────────────────────────────────────────
    private _themeCombo:  ComboBox | undefined;
    private _schemeCombo: ComboBox | undefined;

    // Guard for the round-trip: setting ComboBox.SelectedItem from the
    // ThemeManager-sync path would otherwise fire the SelectionChanged
    // listener and re-activate the same theme.
    private _syncing = false;

    // One-shot guard so the persisted choice re-applies exactly once (the
    // first construction), not on every toolbar rebuild.
    private _restored = false;
    // ApplicationSettings definitions are contributed lazily, once.
    private _contributed = false;

    // ThemeManager listener kept as a field so we can detach it (tests,
    // host swap). Production chrome lives for the app's lifetime so this
    // detaches as an exercise in good hygiene rather than a hard need.
    private readonly _onThemeActivated = (_theme: Theme, _scheme: Scheme): void =>
    {
        this.syncFromThemeManager();
    };

    constructor()
    {
        super();
        this.applyDefaultStyle();

        this._themeCombo  = this.GetTemplateChild('PART_ThemeCombo')  as ComboBox | undefined;
        this._schemeCombo = this.GetTemplateChild('PART_SchemeCombo') as ComboBox | undefined;

        this._themeCombo?.AddSelectionChangedListener(() =>
        {
            if (this._syncing) return;
            const name = this._themeCombo?.SelectedItem;
            if (typeof name === 'string') this.SelectTheme(name);
        });
        this._schemeCombo?.AddSelectionChangedListener(() =>
        {
            if (this._syncing) return;
            this.onSchemeSelected(this._schemeCombo?.SelectedItem);
        });

        // Initial sync from whatever's already active, plus subscribe to
        // future activations so external code paths (AutoScheme listener,
        // direct ThemeManager calls) keep the picker honest.
        this.syncFromThemeManager();
        ThemeManager.AddActivatedListener(this._onThemeActivated);
        // Re-apply a persisted scheme choice (no-op without an
        // ApplicationSettings service or a saved value).
        this.restorePersistedOnce();
    }

    // ── Public DPs ────────────────────────────────────────────────────

    public get ActiveThemeName():  string | undefined { return this.get_property_value(ThemeSelector.ActiveThemeNameKey); }
    public get ActiveSchemeName(): string | undefined { return this.get_property_value(ThemeSelector.ActiveSchemeNameKey); }

    private setActiveThemeName(v: string | undefined): void
    {
        this.set_property_value_with_key(ThemeSelector._ActiveThemeNamePriv, v);
    }
    private setActiveSchemeName(v: string | undefined): void
    {
        this.set_property_value_with_key(ThemeSelector._ActiveSchemeNamePriv, v);
    }

    // ── Public selection API ──────────────────────────────────────────
    //
    // Wired from the inner ComboBox SelectionChanged listeners but also
    // public so hosts (tests, keyboard shortcuts on the demo VM) can
    // drive the picker programmatically.

    /** Activate the named Theme on the global ThemeManager, then refresh
     *  the picker's state. No-op if the name doesn't match a registered
     *  Theme. */
    public SelectTheme(name: string): void
    {
        const tm = ThemeManager;
        if (tm.GetTheme(name) === undefined) return;
        if (tm.ActiveTheme?.name === name) return;
        tm.ActivateTheme(name);
    }

    /** Activate the named Scheme on the active Theme. No-op if no theme
     *  is active or the scheme name isn't registered on it. */
    public SelectScheme(name: string): void
    {
        const tm = ThemeManager;
        const theme = tm.ActiveTheme;
        if (theme === undefined) return;
        if (!theme.schemes.has(name)) return;
        if (tm.ActiveScheme?.name === name) return;
        tm.ActivateScheme(name);
    }

    // ── Scheme-combo selection ────────────────────────────────────────

    private onSchemeSelected(value: unknown): void
    {
        if (typeof value === 'string')
        {
            this.SelectScheme(value);
            this.persistScheme(value);
        }
    }

    // Pull the picker's full state from ThemeManager. Called on
    // construction and on every ThemeManager.Activated event so external
    // theme writers (AutoScheme, direct API calls) stay in sync.
    private syncFromThemeManager(): void
    {
        this._syncing = true;
        try
        {
            const tm     = ThemeManager;
            const theme  = tm.ActiveTheme;
            const scheme = tm.ActiveScheme;

            this.setActiveThemeName(theme?.name);
            this.setActiveSchemeName(scheme?.name);

            const themeNames = tm.RegisteredThemes.map(t => t.name);
            if (this._themeCombo !== undefined)
            {
                this._themeCombo.Items        = themeNames;
                this._themeCombo.SelectedItem = theme?.name;
            }

            const builtinSchemes = theme !== undefined
                ? [...theme.schemes.values()].map(s => s.name)
                : [];
            const activeName     = scheme?.name;

            if (this._schemeCombo !== undefined)
            {
                this._schemeCombo.Items        = builtinSchemes;
                this._schemeCombo.SelectedItem =
                    activeName !== undefined && builtinSchemes.includes(activeName) ? activeName : undefined;
            }
        }
        finally
        {
            this._syncing = false;
        }
    }

    // ── Persistence ───────────────────────────────────────────────────

    private settings(): ApplicationSettings | undefined
    {
        const settings = Application.current?.Services.get(ApplicationSettings.Key);
        if (settings !== undefined && !this._contributed)
        {
            settings.Contribute([
                this.settingDef(SCHEME_SETTING, 'Colour scheme'),
            ]);
            this._contributed = true;
        }
        return settings;
    }

    private settingDef(key: string, label: string): SettingDefinition
    {
        const d = new SettingDefinition();
        d.Key      = key;
        d.Label    = label;
        d.Kind     = SettingKind.String;
        d.Category = 'Appearance';
        d.Default  = '';
        return d;
    }

    private persistScheme(name: string): void { this.settings()?.Set(SCHEME_SETTING, name); }

    // Re-apply the persisted choice once, the first time the control builds.
    private restorePersistedOnce(): void
    {
        if (this._restored) return;
        this._restored = true;
        const settings = this.settings();
        if (settings === undefined) return;
        const saved = settings.Get<string>(SCHEME_SETTING);
        if (saved === undefined || saved === '') return;
        this.SelectScheme(saved);
    }
}
