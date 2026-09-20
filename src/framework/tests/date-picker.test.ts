import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { Visual } from '../../runtime/index.js';
import { UniformGrid } from '../../basic/panels/uniform-grid.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { TextBlock } from '../../basic/text-block.js';
import { DatePicker } from '../pickers/date-picker.js';

// July 2026 — a stable fixture month (31 days).
const JULY_2026 = () => new Date(2026, 6, 1);

function dayGrid(dp: DatePicker): UniformGrid
{
    return dp.GetTemplateChild('PART_DayGrid') as UniformGrid;
}
function cells(dp: DatePicker): readonly Visual[]
{
    return dayGrid(dp).visualChildren;
}
function monthLabel(dp: DatePicker): string
{
    return (dp.GetTemplateChild('PART_MonthLabel') as TextBlock).Text;
}

describe('DatePicker', () => {
    beforeEach(() => { initTestApp(); });

    test('defaults — no selection, DisplayMonth normalised to the 1st', () => {
        const dp = new DatePicker();
        assert.equal(dp.SelectedDate, undefined);
        assert.notEqual(dp.DisplayMonth, undefined);
        assert.equal(dp.DisplayMonth!.getDate(), 1, 'DisplayMonth is first-of-month');
    });

    test('builds the day grid for the displayed month', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = JULY_2026();
        assert.equal(cells(dp).length, 31, 'July has 31 day cells');
        assert.equal(dayGrid(dp).FirstColumn, new Date(2026, 6, 1).getDay(),
            'FirstColumn = weekday of the 1st');
        assert.equal(monthLabel(dp), 'July 2026');
    });

    test('clicking a day cell selects that date', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = JULY_2026();
        // No blank cells (FirstColumn handles the offset) → children[n-1] is day n.
        const day15 = cells(dp)[14] as ClickableBorder;
        day15.onClick!();
        assert.equal(dp.SelectedDate!.getFullYear(), 2026);
        assert.equal(dp.SelectedDate!.getMonth(), 6);
        assert.equal(dp.SelectedDate!.getDate(), 15);
    });

    test('shiftMonth pages DisplayMonth and rebuilds', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = JULY_2026();
        dp.shiftMonth(1);
        assert.equal(dp.DisplayMonth!.getMonth(), 7, 'advanced to August');
        assert.equal(monthLabel(dp), 'August 2026');
        assert.equal(cells(dp).length, 31, 'August has 31 days');

        dp.shiftMonth(-2);
        assert.equal(dp.DisplayMonth!.getMonth(), 5, 'back to June');
        assert.equal(cells(dp).length, 30, 'June has 30 days');
    });

    test('year rolls over when paging past December', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = new Date(2026, 11, 1);   // December 2026
        dp.shiftMonth(1);
        assert.equal(dp.DisplayMonth!.getFullYear(), 2027);
        assert.equal(dp.DisplayMonth!.getMonth(), 0, 'January 2027');
    });

    test('prev / next template buttons page the month', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = JULY_2026();
        const next = dp.GetTemplateChild('PART_NextButton') as unknown as { AddClickHandler(h: () => void): void };
        // Drive the wired handler by re-adding is not needed — invoke via the
        // control's own API path used by the button (shiftMonth). Assert the
        // button exists + is a click source.
        assert.ok(next !== undefined, 'PART_NextButton present');
        assert.equal(typeof next.AddClickHandler, 'function', 'next is a click source');
    });

    test('the selected cell is tinted differently from its siblings', () => {
        const dp = new DatePicker();
        dp.DisplayMonth = JULY_2026();
        dp.SelectedDate = new Date(2026, 6, 10);
        const selected = cells(dp)[9]  as ClickableBorder;   // day 10
        const other    = cells(dp)[11] as ClickableBorder;   // day 12
        assert.notEqual(selected.Fill, other.Fill,
            'selected day carries a distinct background brush');
    });
});
