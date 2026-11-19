import { Application, MetaData, MuralBase } from '../../runtime/index.js';
import type { Geometry } from '../../visual-engine/index.js';
import type { Board } from './board.js';

// A tab in the paged BoardInspector. Both pages edit the SAME Board
// selection, so a page only carries a Title (its tooltip + accessible name), an
// Icon (the rail glyph), and View (the live Board); the page body binds
// through $View. The concrete subtype is the DataTemplate key (ShapeStylePage
// vs SizePositionPage).
export abstract class InspectorPage extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        InspectorPage, 'Title', '', MetaData.None);
    // Rail glyph, resolved from the framework resource dictionary by key (same
    // Geometry-icon pattern as NavigationDestination.Icon / TreeView chevrons).
    public static readonly IconKey = MuralBase.RegisterProperty<Geometry | undefined>(
        InspectorPage, 'Icon', undefined, MetaData.None);
    public static readonly ViewKey = MuralBase.RegisterProperty<Board | undefined>(
        InspectorPage, 'View', undefined, MetaData.None);

    protected constructor(title: string, iconKey: string)
    {
        super();
        this.set_property_value(InspectorPage.TitleKey, title);
        this.set_property_value(
            InspectorPage.IconKey,
            Application.current?.Resources.Resolve(iconKey) as Geometry | undefined);
    }

    public get Title(): string { return this.get_property_value(InspectorPage.TitleKey); }
    public get Icon(): Geometry | undefined { return this.get_property_value(InspectorPage.IconKey); }
    public get View(): Board | undefined { return this.get_property_value(InspectorPage.ViewKey); }
    public set View(v: Board | undefined) { this.set_property_value(InspectorPage.ViewKey, v); }
}

export class ShapeStylePage extends InspectorPage { constructor() { super('Style', 'InspectorStyleIcon'); } }
export class SizePositionPage extends InspectorPage { constructor() { super('Size & Position', 'InspectorSizeIcon'); } }
