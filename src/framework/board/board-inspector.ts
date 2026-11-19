import {
    MetaData,
    MuralBase,
    ObservableCollection,
} from '../../runtime/index.js';
import { Inspector } from '../shell/services/inspector.js';
import type { Board } from './board.js';
import { InspectorPage, ShapeStylePage, SizePositionPage } from './inspector-pages.js';

// The board's inspector view-model — the "Format Shape" panel a board's
// context-menu command Add()s to the InspectorService, rendered via
// DataTemplate[DataType=BoardInspector].
//
// An Inspector (Id 'board-format', Title 'Format Shape') so the host dedupes
// it by key — invoking Format Shape again re-surfaces the one panel rather than
// stacking duplicates.
//
// It carries a single reactive handle, `View`: the Board control currently
// editing the document (kept in sync with the document's ActiveView). The
// inspector is a PAGED container: `Pages` holds the tabs (Style +
// Size & Position), `SelectedPage` drives the rail + content presenter. Each
// page holds `View` (propagated below), and its body binds the Board's
// SINGLE-segment reactive selection DPs ($SelectionFormat* / $SelectedShape*)
// through that View — the same reason the old single-page template retargeted
// its DataContext to $View.
export class BoardInspector extends Inspector
{
    public static readonly ViewKey = MuralBase.RegisterProperty<Board | undefined>(
        BoardInspector, 'View', undefined, MetaData.None);
    public static readonly PagesKey = MuralBase.RegisterProperty<ObservableCollection<InspectorPage>>(
        BoardInspector, 'Pages', undefined as unknown as ObservableCollection<InspectorPage>, MetaData.None);
    public static readonly SelectedPageKey = MuralBase.RegisterProperty<InspectorPage | undefined>(
        BoardInspector, 'SelectedPage', undefined, MetaData.None | MetaData.BindsTwoWayByDefault);

    constructor()
    {
        super('board-format', 'Format Shape');
        const pages = new ObservableCollection<InspectorPage>();
        pages.Add(new ShapeStylePage());
        pages.Add(new SizePositionPage());
        this.set_property_value(BoardInspector.PagesKey, pages);
        this.set_property_value(BoardInspector.SelectedPageKey, pages.Get(0));
    }

    public get View(): Board | undefined { return this.get_property_value(BoardInspector.ViewKey); }
    public set View(v: Board | undefined)
    {
        this.set_property_value(BoardInspector.ViewKey, v);
        for (const p of this.Pages) p.View = v;
    }
    public get Pages(): ObservableCollection<InspectorPage> { return this.get_property_value(BoardInspector.PagesKey); }
    public get SelectedPage(): InspectorPage | undefined { return this.get_property_value(BoardInspector.SelectedPageKey); }
    public set SelectedPage(v: InspectorPage | undefined) { this.set_property_value(BoardInspector.SelectedPageKey, v); }
}
