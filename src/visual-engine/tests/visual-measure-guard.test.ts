import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Size, Thickness } from '../../runtime/index.js';
import { Border, TextBlock } from '../../basic/index.js';

describe('Visual.Measure non-finite backstop', () =>
{
    test('a Border whose Padding has undefined sides measures finite (0 insets), not NaN', () =>
    {
        const border = new Border();
        border.Padding = new Thickness(undefined as unknown as number);
        border.SetChild(new TextBlock());

        border.Measure(new Size(200, Infinity));

        assert.ok(Number.isFinite(border.DesiredSize.Width), 'Width is finite');
        assert.ok(Number.isFinite(border.DesiredSize.Height), 'Height is finite');
    });

    test('control: finite padding and a known-size child measure to the exact sum (guard changes nothing)', () =>
    {
        const child = new Border();
        child.Width = 50;
        child.Height = 20;
        const border = new Border();
        border.Padding = new Thickness(8, 4, 8, 4);
        border.SetChild(child);

        border.Measure(new Size(200, Infinity));

        assert.equal(border.DesiredSize.Width, 50 + 8 + 8);
        assert.equal(border.DesiredSize.Height, 20 + 4 + 4);
    });
});
