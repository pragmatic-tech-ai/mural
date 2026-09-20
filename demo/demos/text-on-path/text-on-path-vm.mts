// VM for the text-on-path demo.
//
// State the view binds to:
//   * Text         — the text run laid along the path.
//   * PathKey      — which entry from the paths catalog is shown.
//   * FontSize     — glyph size in DIPs.
//   * IsFontLoaded — gates the result render; behavior re-runs the
//                    pipeline when this flips true.
//   * Status       — diagnostic line shown in the chrome.
//   * Paths        — read-only ObservableCollection<{ Key, Label }> for
//                    the picker.

import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime';

import { PATHS } from './paths.mjs';

// Each picker row exposes Key + Label as DPs so the binding pipeline
// can read them through the standard property path syntax in the .mu.
class PathOption extends MuralBase
{
    static KeyKey   = MuralBase.RegisterProperty(PathOption, 'Key',   '', MetaData.None);
    static LabelKey = MuralBase.RegisterProperty(PathOption, 'Label', '', MetaData.None);

    constructor(key: string, label: string)
    {
        super();
        this.set_property_value(PathOption.KeyKey,   key);
        this.set_property_value(PathOption.LabelKey, label);
    }
    get Key():    string { return this.get_property_value(PathOption.KeyKey); }
    get Label():  string { return this.get_property_value(PathOption.LabelKey); }
}

export class TextOnPathVM extends MuralBase
{
    static TextKey               = MuralBase.RegisterProperty(TextOnPathVM, 'Text',               'Text running along a curve — try a different path', MetaData.None);
    static PathKeyKey            = MuralBase.RegisterProperty(TextOnPathVM, 'PathKey',            'wave',          MetaData.None);
    static FontSizeKey           = MuralBase.RegisterProperty(TextOnPathVM, 'FontSize',           28,              MetaData.None);
    static SideOffsetKey         = MuralBase.RegisterProperty(TextOnPathVM, 'SideOffset',         0,               MetaData.None);
    static IsFontLoadedKey       = MuralBase.RegisterProperty(TextOnPathVM, 'IsFontLoaded',       false,           MetaData.None);
    static StatusKey             = MuralBase.RegisterProperty(TextOnPathVM, 'Status',             'Loading font…', MetaData.None);
    static PathsKey              = MuralBase.RegisterProperty<ObservableCollection<PathOption> | undefined>(TextOnPathVM, 'Paths',              undefined,       MetaData.None);
    static SelectedPathOptionKey = MuralBase.RegisterProperty<PathOption | undefined>(TextOnPathVM, 'SelectedPathOption', undefined,       MetaData.None);
    static ShowPathKey           = MuralBase.RegisterProperty(TextOnPathVM, 'ShowPath',           true,            MetaData.None);
    static ShowGlyphsKey         = MuralBase.RegisterProperty(TextOnPathVM, 'ShowGlyphs',         true,            MetaData.None);
    static TogglePathCommandKey  = MuralBase.RegisterProperty<ICommand | undefined>(TextOnPathVM, 'TogglePathCommand',  undefined,       MetaData.None);
    static ToggleGlyphsCommandKey= MuralBase.RegisterProperty<ICommand | undefined>(TextOnPathVM, 'ToggleGlyphsCommand',undefined,       MetaData.None);
    static PathColorHexKey       = MuralBase.RegisterProperty(TextOnPathVM, 'PathColorHex',       '#94a3b8',       MetaData.None);
    static GlyphColorHexKey      = MuralBase.RegisterProperty(TextOnPathVM, 'GlyphColorHex',      '#0f172a',       MetaData.None);

    constructor()
    {
        super();
        // Paths collection — instantiated per-VM so Add / Remove on it
        // doesn't leak across re-mounts.
        const opts = new ObservableCollection<PathOption>();
        for (const p of PATHS) opts.Add(new PathOption(p.key, p.label));
        this.set_property_value(TextOnPathVM.PathsKey, opts);
        // Default selection — first entry (`wave`).
        this.set_property_value(TextOnPathVM.SelectedPathOptionKey, opts.Get(0));

        // Two-way bridge — when the picker assigns a new
        // SelectedPathOption, mirror its Key onto PathKey so the
        // behavior's PathKey listener wakes up.
        this.PropertyChanged(TextOnPathVM.SelectedPathOptionKey).subscribe(({ newValue: n }) => {
            if (n !== undefined)
            {
                this.set_property_value(TextOnPathVM.PathKeyKey, (n as { Key: string }).Key);
            }
        });

        // Quick toggles surface as RelayCommands so the .mu binds them
        // through the ICommand pipeline rather than two-way TextBox
        // binding gymnastics for the boolean DPs. They must live on DPs
        // — DataContextBinding only reads registered properties on a
        // MuralBase context.
        this.set_property_value(TextOnPathVM.TogglePathCommandKey, new RelayCommand(
            () => { this.ShowPath = !this.ShowPath; },
            () => true,
        ));
        this.set_property_value(TextOnPathVM.ToggleGlyphsCommandKey, new RelayCommand(
            () => { this.ShowGlyphs = !this.ShowGlyphs; },
            () => true,
        ));
    }

    get Text():                string { return this.get_property_value(TextOnPathVM.TextKey); }
    set Text(v:                string) { this.set_property_value(TextOnPathVM.TextKey, v); }
    get PathKey():             string { return this.get_property_value(TextOnPathVM.PathKeyKey); }
    set PathKey(v:             string) { this.set_property_value(TextOnPathVM.PathKeyKey, v); }
    get FontSize():            number { return this.get_property_value(TextOnPathVM.FontSizeKey); }
    set FontSize(v:            number) { this.set_property_value(TextOnPathVM.FontSizeKey, v); }
    get SideOffset():          number { return this.get_property_value(TextOnPathVM.SideOffsetKey); }
    set SideOffset(v:          number) { this.set_property_value(TextOnPathVM.SideOffsetKey, v); }
    get IsFontLoaded():        boolean { return this.get_property_value(TextOnPathVM.IsFontLoadedKey); }
    set IsFontLoaded(v:        boolean) { this.set_property_value(TextOnPathVM.IsFontLoadedKey, v); }
    get Status():              string { return this.get_property_value(TextOnPathVM.StatusKey); }
    set Status(v:              string) { this.set_property_value(TextOnPathVM.StatusKey, v); }
    get Paths():               ObservableCollection<PathOption> | undefined { return this.get_property_value(TextOnPathVM.PathsKey); }
    get SelectedPathOption():  PathOption | undefined { return this.get_property_value(TextOnPathVM.SelectedPathOptionKey); }
    set SelectedPathOption(v:  PathOption | undefined) { this.set_property_value(TextOnPathVM.SelectedPathOptionKey, v); }
    get ShowPath():            boolean { return this.get_property_value(TextOnPathVM.ShowPathKey); }
    set ShowPath(v:            boolean) { this.set_property_value(TextOnPathVM.ShowPathKey, v); }
    get ShowGlyphs():          boolean { return this.get_property_value(TextOnPathVM.ShowGlyphsKey); }
    set ShowGlyphs(v:          boolean) { this.set_property_value(TextOnPathVM.ShowGlyphsKey, v); }
    get TogglePathCommand():   ICommand | undefined { return this.get_property_value(TextOnPathVM.TogglePathCommandKey); }
    get ToggleGlyphsCommand(): ICommand | undefined { return this.get_property_value(TextOnPathVM.ToggleGlyphsCommandKey); }
    get PathColorHex():        string { return this.get_property_value(TextOnPathVM.PathColorHexKey); }
    set PathColorHex(v:        string) { this.set_property_value(TextOnPathVM.PathColorHexKey, v); }
    get GlyphColorHex():       string { return this.get_property_value(TextOnPathVM.GlyphColorHexKey); }
    set GlyphColorHex(v:       string) { this.set_property_value(TextOnPathVM.GlyphColorHexKey, v); }
}
