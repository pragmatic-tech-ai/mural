import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Ribbon, RibbonTabHeader } from '../../../framework/ribbon/ribbon.js';
import { RibbonTab } from '../../../framework/ribbon/ribbon-tab.js';
import { RibbonGroup, RibbonSmallButtonColumn } from '../../../framework/ribbon/ribbon-group.js';
import { RibbonButton, RibbonToggleButton } from '../../../framework/ribbon/ribbon-buttons.js';
import { RibbonDropDownButton, RibbonSplitButton } from '../../../framework/ribbon/ribbon-popup-buttons.js';
import { RibbonGallery } from '../../../framework/ribbon/ribbon-gallery.js';
import { DatePicker } from '../../../framework/pickers/date-picker.js';
import { TimePicker } from '../../../framework/pickers/time-picker.js';
import { Carousel } from '../../../framework/carousel/carousel.js';
import { ThemeSelector } from '../../../framework/theme-selector/theme-selector.js';
import { ColorPicker } from '../../../framework/formatting/color-picker.js';
import { BrushPicker } from '../../../framework/formatting/brush-picker.js';
import { FillEditor } from '../../../framework/formatting/fill-editor.js';
import { PenEditor } from '../../../framework/formatting/pen-editor.js';
import { ShapeFormatControl } from '../../../framework/formatting/shape-format-control.js';
import { Diagram } from '../../../framework/diagram/diagram.js';
import { Group } from '../../../framework/diagram/group.js';
import { ContainerFigure } from '../../../framework/diagram/container-figure.js';
import { SizePositionControl } from '../../../framework/diagram/size-position-control.js';
import { PropertyGrid } from '../../../framework/property-grid/property-grid.js';
import { Gallery } from '../../../framework/gallery/gallery.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

// Wave 5 Task 12 — integration sweep. Every Complex & app-specific control the
// wave forks resolves the Pragmatic override under light + dark and keeps the
// Material style under Material. OOP: the table is a class-held static array,
// not a module-level array of free constructors.
class Wave5Controls
{
    public static readonly All: ReadonlyArray<{ readonly Name: string; readonly Make: () => object }> =
    [
        { Name: 'Ribbon', Make: () => new Ribbon() },
        { Name: 'RibbonTabHeader', Make: () => new RibbonTabHeader() },
        { Name: 'RibbonTab', Make: () => new RibbonTab() },
        { Name: 'RibbonGroup', Make: () => new RibbonGroup() },
        { Name: 'RibbonSmallButtonColumn', Make: () => new RibbonSmallButtonColumn() },
        { Name: 'RibbonButton', Make: () => new RibbonButton() },
        { Name: 'RibbonToggleButton', Make: () => new RibbonToggleButton() },
        { Name: 'RibbonDropDownButton', Make: () => new RibbonDropDownButton() },
        { Name: 'RibbonSplitButton', Make: () => new RibbonSplitButton() },
        { Name: 'RibbonGallery', Make: () => new RibbonGallery() },
        { Name: 'DatePicker', Make: () => new DatePicker() },
        { Name: 'TimePicker', Make: () => new TimePicker() },
        { Name: 'Carousel', Make: () => new Carousel() },
        { Name: 'ThemeSelector', Make: () => new ThemeSelector() },
        { Name: 'ColorPicker', Make: () => new ColorPicker() },
        { Name: 'BrushPicker', Make: () => new BrushPicker() },
        { Name: 'FillEditor', Make: () => new FillEditor() },
        { Name: 'PenEditor', Make: () => new PenEditor() },
        { Name: 'ShapeFormatControl', Make: () => new ShapeFormatControl() },
        { Name: 'Diagram', Make: () => new Diagram() },
        { Name: 'Group', Make: () => new Group() },
        { Name: 'ContainerFigure', Make: () => new ContainerFigure() },
        { Name: 'SizePositionControl', Make: () => new SizePositionControl() },
    ];
}

describe('Wave 5 integration — every complex/app-specific fork resolves, Material byte-identical', () =>
{
    for (const entry of Wave5Controls.All)
    {
        test(`${entry.Name}: Pragmatic (light + dark) yes, Material no`, () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under light`);
            ControlHarness.Reset();

            ControlHarness.Activate(PragmaticDark);
            assert.ok(ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} resolves the Pragmatic style under dark`);
            ControlHarness.Reset();

            ControlHarness.Activate(MaterialLight);
            assert.ok(!ControlHarness.IsPragmaticStyle(entry.Make()), `${entry.Name} keeps the Material style under Material`);
            ControlHarness.Reset();
        });
    }
});

// Task 11 — PropertyGrid and Gallery need NO fork: property-grid.template.mu is
// token-clean (zero @ refs) and Gallery has no template (it renders through its
// MenuItem/Button item containers, already forked). Verify both construct under
// Pragmatic and Material without error (no M3 leakage to retint).
describe('Wave 5 — token-clean families need no fork', () =>
{
    for (const entry of [{ Name: 'PropertyGrid', Make: () => new PropertyGrid() }, { Name: 'Gallery', Make: () => new Gallery() }])
    {
        test(`${entry.Name} constructs under Pragmatic and Material without error`, () =>
        {
            ControlHarness.Activate(PragmaticLight);
            assert.doesNotThrow(() => entry.Make(), `${entry.Name} constructs under Pragmatic`);
            ControlHarness.Reset();
            ControlHarness.Activate(MaterialLight);
            assert.doesNotThrow(() => entry.Make(), `${entry.Name} constructs under Material`);
            ControlHarness.Reset();
        });
    }
});
