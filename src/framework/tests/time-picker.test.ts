import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { Canvas } from '../../basic/panels/canvas.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { TextBlock } from '../../basic/text-block.js';
import { TimePicker } from '../pickers/time-picker.js';

function face(tp: TimePicker): Canvas
{
    return tp.GetTemplateChild('PART_ClockFace') as Canvas;
}

// Find the dial number cell whose label reads `text`.
function numberCell(tp: TimePicker, text: string): ClickableBorder | undefined
{
    for (const c of face(tp).visualChildren)
    {
        const cb = c as ClickableBorder;
        const label = cb.child as TextBlock | undefined;
        if (label instanceof TextBlock && label.Text === text) return cb;
    }
    return undefined;
}

function labelText(tp: TimePicker, part: string): string
{
    return (tp.GetTemplateChild(part) as TextBlock).Text;
}
function part(tp: TimePicker, name: string): ClickableBorder
{
    return tp.GetTemplateChild(name) as ClickableBorder;
}

describe('TimePicker', () => {
    beforeEach(() => { initTestApp(); });

    test('defaults — 9:00 AM', () => {
        const tp = new TimePicker();
        assert.equal(tp.Hour, 9);
        assert.equal(tp.Minute, 0);
        assert.equal(labelText(tp, 'PART_HourLabel'), '9');
        assert.equal(labelText(tp, 'PART_MinuteLabel'), '00');
    });

    test('clock face has a hand, a pivot, and 12 numbers', () => {
        const tp = new TimePicker();
        assert.equal(face(tp).visualChildren.length, 14);
    });

    test('clicking an hour number sets the hour (honouring AM)', () => {
        const tp = new TimePicker();      // 9 AM
        numberCell(tp, '3')!.onClick!();
        assert.equal(tp.Hour, 3, '3 AM → 3');
    });

    test('PM toggle maps the hour into the afternoon; readout stays 12h', () => {
        const tp = new TimePicker();      // 9 AM
        part(tp, 'PART_PmButton').onClick!();
        assert.equal(tp.Hour, 21, '9 AM → 9 PM = 21');
        assert.equal(labelText(tp, 'PART_HourLabel'), '9', '12h readout unchanged');

        part(tp, 'PART_AmButton').onClick!();
        assert.equal(tp.Hour, 9, 'back to 9 AM');
    });

    test('clicking hour 12 maps to 0 (midnight) in AM', () => {
        const tp = new TimePicker();      // AM
        numberCell(tp, '12')!.onClick!();
        assert.equal(tp.Hour, 0);
        assert.equal(labelText(tp, 'PART_HourLabel'), '12', 'displayed as 12');
    });

    test('switching to the minute ring re-labels the dial (00,05,…) and selects minutes', () => {
        const tp = new TimePicker();
        part(tp, 'PART_MinuteHit').onClick!();
        // Minute ring shows 00,05,…,55 — pick "15".
        const fifteen = numberCell(tp, '15');
        assert.ok(fifteen !== undefined, 'minute ring shows 15');
        fifteen!.onClick!();
        assert.equal(tp.Minute, 15);
        assert.equal(labelText(tp, 'PART_MinuteLabel'), '15');
    });

    test('Hour is stored 0-23 for an unambiguous bound value', () => {
        const tp = new TimePicker();
        part(tp, 'PART_PmButton').onClick!();
        numberCell(tp, '12')!.onClick!();   // 12 PM = noon = 12
        assert.equal(tp.Hour, 12);
    });
});
