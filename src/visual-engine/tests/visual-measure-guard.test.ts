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
        border.Child = new TextBlock();

        border.Measure(new Size(200, Infinity));

        assert.ok(Number.isFinite(border.DesiredSize.Width), 'Width is finite');
        assert.ok(Number.isFinite(border.DesiredSize.Height), 'Height is finite');
    });
});
