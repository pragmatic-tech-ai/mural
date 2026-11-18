import { Application } from '../../../runtime/index.js';
import { Pen } from '../../../visual-engine/index.js';
import { type DataTemplate } from '../../../basic/templates/data-template.js';
import { CapOption } from '../../formatting/cap-option.js';
import { BoardSettings } from '../board-settings.js';

// Builds the standard connector-cap dropdown list for a ShapeFormatControl
// (its CapOptions DP). Resolves the five built-in @…Cap DataTemplates from
// the active Application resources — the SAME instances the default-cap
// Style hands a connector — so identity matching in the editor lines a
// connector's current cap up with its dropdown row. Prepends a "None"
// row (undefined template) for clearing an end.
//
// Lives in the board layer (it knows the cap catalog keys); the
// formatting layer stays domain-agnostic and just renders whatever
// CapOption list it's handed. Call after Application.initialize so the
// theme dictionary (which merges the Caps dictionary) is resolvable;
// before that the templates resolve to undefined and the rows still
// render their glyph, just with no effect when chosen.
//
// Each glyph is authored as a single-paint silhouette in a ~24×14 box
// (centre line y≈7): filled caps carry GlyphFill, open caps GlyphStroke.
export function connectorCapOptions(): CapOption[]
{
    // Neutral ink (mid-slate) that reads on both light and dark format panes,
    // from BoardSettings.NeutralInk() — shared with the callout leader line.
    const ink = BoardSettings.NeutralInk();
    const pen = new Pen(ink, 1.5);

    // Template is a thunk so this list can be built before the cap
    // catalog is registered (the Board populates its ConnectorCapOptions
    // DP in its ctor); each resolves the shared @-keyed instance on demand.
    const filled = (label: string, glyph: string, key: string): CapOption =>
        new CapOption({ Label: label, Glyph: glyph, GlyphFill: ink, Template: () => resolveCap(key) });
    const open = (label: string, glyph: string, key: string): CapOption =>
        new CapOption({ Label: label, Glyph: glyph, GlyphStroke: pen, Template: () => resolveCap(key) });

    return [
        new CapOption({ Label: 'None', Glyph: 'M 2,7 L 22,7', GlyphStroke: pen, Template: undefined }),
        open  ('Arrow',         'M 8,2 L 18,7 L 8,12',                        'ArrowCap'),
        filled('Filled Arrow',  'M 8,2 L 18,7 L 8,12 Z',                      'FilledArrowCap'),
        open  ('Open Circle',   'M 9,7 A 5,5 0 1,0 19,7 A 5,5 0 1,0 9,7 Z',   'OpenCircleCap'),
        filled('Filled Circle', 'M 9,7 A 5,5 0 1,0 19,7 A 5,5 0 1,0 9,7 Z',   'FilledCircleCap'),
        filled('Diamond',       'M 8,7 L 14,2 L 20,7 L 14,12 Z',             'DiamondCap'),
    ];
}

function resolveCap(key: string): DataTemplate | undefined
{
    const app = Application.current;
    if (app === null) return undefined;
    const v = app.Resources.Resolve(key);
    // DataTemplate is duck-typed here (the formatting CapOption holds the
    // structural type) — a defensive instanceof would need the concrete
    // class; the resource is a DataTemplate by catalog contract, so a
    // narrow cast is enough and avoids an extra import cycle.
    return (v ?? undefined) as DataTemplate | undefined;
}
