import {
    MetaData,
    MuralBase,
    Color,
    HorizontalAlignment,
    VerticalAlignment,
    Element, Visual,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { SolidColorBrush, CornerRadius, Pen, type Brush } from '../../visual-engine/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { TextBlock } from '../../basic/text-block.js';
import { UniformGrid } from '../../basic/panels/uniform-grid.js';

// Material 3 Date Picker — Docked calendar variant (§18.9). A month grid
// with a header (month/year + prev/next navigation), a weekday row, and a
// 7-column day grid the control fills programmatically. Selecting a day
// sets SelectedDate; the prev/next buttons page DisplayMonth.
//
// This ships the M3 *Docked* date field's calendar body. The *Modal*
// date-picker dialog (the full-screen / dialog wrapper) layers on top via
// the overlay infra (Dialog / SideSheet pattern) and is deferred until a
// demo motivates it — the calendar body here is the reusable core either
// wrapper drives.
//
// Dates are plain JS Date. SelectedDate / DisplayMonth are normalised to
// local midnight; the control compares by year/month/day, never by time,
// so a caller passing a Date with a wall-clock time still matches its day
// cell. DisplayMonth is the FIRST of the shown month.
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
// Weekday initials, Sunday-first (the grid's FirstColumn is the 1st's
// getDay()). Rendered statically in the template's header row; kept here
// only for reference / a future locale hook.

const TRANSPARENT = new SolidColorBrush(new Color(0, 0, 0, 0));
const CELL = 40;

function sameDay(a: Date | undefined, b: Date | undefined): boolean
{
    return a !== undefined && b !== undefined
        && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function daysInMonth(year: number, month: number): number
{
    return new Date(year, month + 1, 0).getDate();
}

export class DatePicker extends TemplatedControl
{
    public static readonly SelectedDateKey = MuralBase.RegisterProperty<Date | undefined>(
        DatePicker, 'SelectedDate', undefined, MetaData.None | MetaData.BindsTwoWayByDefault);
    // First of the currently-displayed month. Undefined until the ctor
    // seeds it from SelectedDate (or today).
    public static readonly DisplayMonthKey = MuralBase.RegisterProperty<Date | undefined>(
        DatePicker, 'DisplayMonth', undefined, MetaData.None);
    // Optional "today" marker (an outline ring). Undefined → no marker.
    public static readonly TodayKey = MuralBase.RegisterProperty<Date | undefined>(
        DatePicker, 'Today', undefined, MetaData.None);

    public get SelectedDate(): Date | undefined { return this.get_property_value(DatePicker.SelectedDateKey); }
    public set SelectedDate(v: Date | undefined) { this.set_property_value(DatePicker.SelectedDateKey, v); }

    public get DisplayMonth(): Date | undefined { return this.get_property_value(DatePicker.DisplayMonthKey); }
    public set DisplayMonth(v: Date | undefined) { this.set_property_value(DatePicker.DisplayMonthKey, v); }

    public get Today(): Date | undefined { return this.get_property_value(DatePicker.TodayKey); }
    public set Today(v: Date | undefined) { this.set_property_value(DatePicker.TodayKey, v); }

    static
    {
        MuralBase.OverrideMetadata(DatePicker, Element.DefaultStyleKeyKey, { default_value: DatePicker });
    }

    private _monthLabel: TextBlock  | undefined;
    private _dayGrid:    UniformGrid | undefined;
    private _building = false;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptParts();
        if (this.DisplayMonth === undefined)
        {
            const base = this.SelectedDate ?? new Date();
            this._building = true;
            this.DisplayMonth = new Date(base.getFullYear(), base.getMonth(), 1);
            if (this.Today === undefined) this.Today = new Date();
            this._building = false;
        }
        this.rebuild();
    }

    private adoptParts(): void
    {
        const root = this.templateRoot;
        if (root === undefined) throw new Error('DatePicker template did not materialise (Template = @DefaultDatePicker?).');
        this._monthLabel = root.FindName('PART_MonthLabel') as TextBlock | undefined;
        this._dayGrid    = root.FindName('PART_DayGrid')    as UniformGrid | undefined;
        if (this._dayGrid === undefined) throw new Error('DatePicker template missing PART_DayGrid');

        const prev = root.FindName('PART_PrevButton') as (Visual & { AddClickHandler?: (h: () => void) => void }) | undefined;
        const next = root.FindName('PART_NextButton') as (Visual & { AddClickHandler?: (h: () => void) => void }) | undefined;
        prev?.AddClickHandler?.(() => this.shiftMonth(-1));
        next?.AddClickHandler?.(() => this.shiftMonth(1));
    }

    // Page the displayed month by `delta` months, keeping the day at 1.
    public shiftMonth(delta: number): void
    {
        const d = this.DisplayMonth ?? new Date();
        this.DisplayMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    }

    private brush(key: string, fallback: Brush): Brush
    {
        return (this.TryFindResource(key) as Brush | undefined) ?? fallback;
    }

    // Tear down + regenerate the day cells for the current DisplayMonth,
    // tinting the selected day and (optionally) the today marker.
    private rebuild(): void
    {
        const grid = this._dayGrid;
        const month = this.DisplayMonth;
        if (grid === undefined || month === undefined) return;

        const year = month.getFullYear();
        const mon  = month.getMonth();
        if (this._monthLabel !== undefined) this._monthLabel.Text = `${MONTHS[mon]} ${year}`;

        for (const c of [...grid.visualChildren]) grid.RemoveChild(c);

        // The 1st's weekday (0=Sun) is the empty lead-in; UniformGrid's
        // FirstColumn offsets the first cell into the right column.
        grid.FirstColumn = new Date(year, mon, 1).getDay();

        const primary          = this.brush('AccentInk',          new SolidColorBrush(new Color(103, 80, 164, 255)));
        const onPrimary        = this.brush('AccentInkOn',        new SolidColorBrush(new Color(255, 255, 255, 255)));
        const onSurface        = this.brush('Ink',        new SolidColorBrush(new Color(28, 27, 31, 255)));
        const total = daysInMonth(year, mon);

        for (let day = 1; day <= total; day++)
        {
            const date     = new Date(year, mon, day);
            const selected = sameDay(date, this.SelectedDate);
            const isToday  = !selected && sameDay(date, this.Today);

            const cell = new ClickableBorder();
            cell.Width        = CELL;
            cell.Height       = CELL;
            cell.CornerRadius = new CornerRadius(CELL / 2, CELL / 2, CELL / 2, CELL / 2);
            cell.Fill   = selected ? primary : TRANSPARENT;
            if (isToday)
            {
                cell.Stroke = new Pen(primary, 1);
            }

            const label = new TextBlock();
            label.Text                = String(day);
            label.Foreground          = selected ? onPrimary : (isToday ? primary : onSurface);
            label.HorizontalAlignment = HorizontalAlignment.Center;
            label.VerticalAlignment   = VerticalAlignment.Center;
            cell.SetChild(label);

            cell.onClick = (): void => { this.SelectedDate = new Date(year, mon, day); };
            grid.AddChild(cell);
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (this._building) return;
        const name = descriptor.Name;
        if (name === 'Template' && newValue !== oldValue)
        {
            this.adoptParts();
            this.rebuild();
            return;
        }
        if (descriptor.Owner === DatePicker
            && (name === 'SelectedDate' || name === 'DisplayMonth' || name === 'Today'))
        {
            this.rebuild();
        }
    }
}
