import {
    ApplicationService,
    Color,
    MetaData,
    MuralBase,
    ObservableCollection,
    ServiceBase,
    ServiceKey,
    SettingSourceAvailability,
    Signal,
    type IServiceProvider,
    type PropertyChangedEventArgs,
    type ISettingSource,
} from '../../../runtime/index.js';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { ShellModule } from '../module.js';
import { SettingDefinition, SettingKind } from '../settings/setting-definition.js';
import { Setting } from '../settings/setting.js';

// Persistence seam for ApplicationSettings — the host supplies HOW values are
// stored. Kept host-agnostic: the framework never imports a host target, so a
// desktop app backs this with a file (Plexus → FileSystemService writing
// UserDataDirectory/settings.json), a web app with localStorage, a test with an
// in-memory map. Registered under `SettingsStoreKey`; ApplicationSettings
// resolves it OPTIONALLY (no store ⇒ in-memory, values reset each session).
//
// `Load` is SYNCHRONOUS so ApplicationSettings has real values at construction
// (a host reads its store once at startup and hands over a snapshot — the same
// sync-load / async-write split EnvironmentService uses). `Save` is fire-and-
// forget; the store may debounce and write asynchronously.
export interface ISettingsStore
{
    Load(): Record<string, unknown>;
    Save(values: Record<string, unknown>): void;
}

export const SettingsStoreKey = new ServiceKey<ISettingsStore>('SettingsStore');

// The app's settings provider: aggregates every module's declared
// SettingDefinitions into live, user-modifiable Settings, and (when a store is
// registered) persists changes.
//
// Definitions flow module → service exactly as Capabilities flow into
// NavigationService: resolve the ApplicationService, iterate its Modules, and
// up-cast each IShellModule to the concrete ShellModule to read its `Settings`
// (the SettingDefinition type is above the runtime IShellModule contract, so it
// is read through the documented up-cast seam, not the runtime interface).
//
// `Settings` is a DP-backed ObservableCollection so a settings pane binds
// `ItemsSource = $Settings`; `_byKey` gives O(1) Get/Set. Auto-registered by
// EditorShell (like NavigationService), so any shell app gets it for free.
export class ApplicationSettings extends ServiceBase implements ISettingSource
{
    public static readonly Key = new ServiceKey<ApplicationSettings>('ApplicationSettings');

    public static readonly SettingsKey = MuralBase.RegisterProperty<ObservableCollection<Setting>>(
        ApplicationSettings, 'Settings',
        undefined as unknown as ObservableCollection<Setting>, MetaData.None);

    private readonly _byKey = new Map<string, Setting>();
    private readonly _store: ISettingsStore | undefined;
    private readonly _persisted: Record<string, unknown>;
    private readonly _emptyChanged = new Map<string, Signal<PropertyChangedEventArgs>>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        // Optional persistence — resolved from the container so the service
        // resolves its own collaborator (DI convention). No store ⇒ in-memory.
        this._store = provider.get(SettingsStoreKey);
        this._persisted = this._store ? this._store.Load() : {};
        this.set_property_value(ApplicationSettings.SettingsKey, new ObservableCollection<Setting>());
        this.PopulateFromModules();
        // This instance IS the ISettingSource. Announce availability so any
        // setting-backed DP that armed before a source existed (read during early
        // render, before this service was constructed) re-arms and picks up its
        // value. DEFERRED to a microtask: notifyAvailable re-enters get(SettingSourceKey)
        // via the waiters' re-resolve, and this factory hasn't returned yet — the
        // container would re-construct us. By the microtask, construction is
        // complete and the instance is cached.
        queueMicrotask(() => SettingSourceAvailability.notifyAvailable());
    }

    public get Settings(): ObservableCollection<Setting>
    {
        return this.get_property_value(ApplicationSettings.SettingsKey);
    }

    // Aggregate every module's declared settings into live Settings. One-shot:
    // modules are fully composed by the time a shell resolves this service (same
    // contract as NavigationService.PopulateFromModules). Idempotent — a
    // definition whose Key is already present is skipped, so a re-call after a
    // late module add only adds the new ones.
    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        for (const module of app.Modules)
        {
            for (const definition of (module as ShellModule).Settings)
            {
                this.addSetting(definition);
            }
        }
    }

    // The current value of a setting, or undefined if no such key. Already
    // reflects the persisted overlay (initialised from the store at construction).
    public Get<T = unknown>(key: string): T | undefined
    {
        return this._byKey.get(key)?.Value as T | undefined;
    }

    // Modify a setting's value (the user-facing write). Triggers persistence via
    // the Value DP listener. No-op for an unknown key.
    public Set(key: string, value: unknown): void
    {
        const setting = this._byKey.get(key);
        if (setting !== undefined) setting.Value = value;
    }

    // Restore a setting to its definition's default (also persisted).
    public Reset(key: string): void
    {
        const setting = this._byKey.get(key);
        if (setting !== undefined) setting.Value = setting.Definition.Default;
    }

    // The live Setting for a key — for a consumer that wants to bind its Value DP
    // directly rather than poll Get.
    public GetSetting(key: string): Setting | undefined
    {
        return this._byKey.get(key);
    }

    // ISettingSource: a Signal that fires whenever the named setting's Value
    // changes. Routes through the Setting's own Value DP change channel so the
    // subscriber receives exactly the same notification that a binding would.
    // For an unknown key (no Setting yet registered) returns a stable empty
    // Signal cached per key — a safety fallback, since definitions are normally
    // contributed before any bound read.
    public Changed(key: string): Signal<PropertyChangedEventArgs>
    {
        const setting = this.GetSetting(key);
        if (setting !== undefined) return setting.PropertyChanged(Setting.ValueKey);
        return this.emptyChangedFor(key);
    }

    private emptyChangedFor(key: string): Signal<PropertyChangedEventArgs>
    {
        let signal = this._emptyChanged.get(key);
        if (signal === undefined)
        {
            signal = new Signal<PropertyChangedEventArgs>();
            this._emptyChanged.set(key, signal);
        }
        return signal;
    }

    // Contribute definitions from a NON-module source — a framework component
    // that owns its own tunable constants (e.g. DiagramSettings) and publishes
    // them wherever it finds a settings host, rather than routing every default
    // through a module's `.settings:` markup. Idempotent per key (addSetting
    // skips a key already present), so a repeat call after a late resolve only
    // adds the new ones. Persisted overrides apply exactly as for module
    // settings (the same `_persisted` overlay).
    public Contribute(definitions: Iterable<SettingDefinition>): void
    {
        for (const definition of definitions) this.addSetting(definition);
        // A late-published setting may be the one a waiting DP needs; re-arm.
        // Safe to fire synchronously here — Contribute runs post-construction, so
        // a waiter's get(SettingSourceKey) resolves this already-cached instance.
        SettingSourceAvailability.notifyAvailable();
    }

    // Build a live Setting from a definition, overlaying any persisted value onto
    // the default. Wires a Value listener so a later modification write-throughs.
    private addSetting(definition: SettingDefinition): void
    {
        if (this._byKey.has(definition.Key)) return;
        const initial = Object.prototype.hasOwnProperty.call(this._persisted, definition.Key)
            ? ApplicationSettings.fromStorable(definition, this._persisted[definition.Key])
            : definition.Default;
        const setting = new Setting(definition, initial);
        setting.PropertyChanged(Setting.ValueKey).subscribe(() => this.persist());
        this._byKey.set(definition.Key, setting);
        this.Settings.Add(setting);
    }

    // Write the full current value set through the store (no-op without one).
    // The store owns any debouncing / async write. Values are lowered to
    // storable PRIMITIVES first (see toStorable) — a store may write JSON or
    // ship the snapshot over an IPC channel (Electron structured clone), neither
    // of which can carry a live object like a SolidColorBrush.
    private persist(): void
    {
        if (this._store === undefined) return;
        const values: Record<string, unknown> = {};
        for (const [key, setting] of this._byKey)
        {
            values[key] = ApplicationSettings.toStorable(setting);
        }
        this._store.Save(values);
    }

    // Lower a live setting Value to a store-safe primitive. Only Color settings
    // carry a non-primitive Value (a SolidColorBrush); everything else
    // (Boolean/Number/String/Choice/FilePath) is already a primitive and passes
    // through. A Color is stored as its hex string.
    private static toStorable(setting: Setting): unknown
    {
        const value = setting.Value;
        if (setting.Definition.Kind === SettingKind.Color)
        {
            if (value instanceof SolidColorBrush) return value.Color.ToHex();
            if (value instanceof Color)            return value.ToHex();
        }
        return value;
    }

    // Raise a persisted primitive back to a live Value for the definition's Kind —
    // the inverse of toStorable. A Color's hex string becomes a SolidColorBrush
    // again (falling back to the default on a malformed hex).
    private static fromStorable(definition: SettingDefinition, stored: unknown): unknown
    {
        if (definition.Kind === SettingKind.Color && typeof stored === 'string')
        {
            try { return new SolidColorBrush(Color.FromHex(stored)); }
            catch { return definition.Default; }
        }
        return stored;
    }
}
