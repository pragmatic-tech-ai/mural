import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { PositionAnchor } from '../position-anchor.js';
import { SizePositionControl } from '../size-position-control.js';

function make(): SizePositionControl
{
    Application.current = null; new Application();
    const c = new SizePositionControl();
    c.BaseWidth = 100; c.BaseHeight = 50;
    c.WidthValue = 200; c.HeightValue = 100; c.Left = 10; c.Top = 20;
    return c;
}

describe('SizePositionControl conversions', () => {
    test('anchor TopLeftCorner: H/V position = Left/Top', () => {
        const c = make(); c.PositionFrom = PositionAnchor.TopLeftCorner;
        assert.equal(c.HorizontalPosition, 10);
        assert.equal(c.VerticalPosition, 20);
        c.HorizontalPosition = 40; assert.equal(c.Left, 40);
    });
    test('anchor Center: H/V position = Left+W/2, Top+H/2 and inverse', () => {
        const c = make(); c.PositionFrom = PositionAnchor.Center;
        assert.equal(c.HorizontalPosition, 10 + 200 / 2);   // 110
        assert.equal(c.VerticalPosition, 20 + 100 / 2);     // 70
        c.HorizontalPosition = 210; assert.equal(c.Left, 210 - 100);  // 110
    });
    test('scale = size / base * 100, and inverse sets size', () => {
        const c = make();
        assert.equal(c.ScaleWidth, 200);   // 200/100*100
        assert.equal(c.ScaleHeight, 200);  // 100/50*100
        c.ScaleWidth = 150; assert.equal(c.WidthValue, 150);   // 100 * 150/100
    });
    test('lock aspect: editing Width scales Height by the same ratio', () => {
        const c = make(); c.LockAspectRatio = true;
        c.WidthValue = 400;                       // was 200 → x2
        assert.equal(c.HeightValue, 200);         // 100 → x2
    });
    test('zero base: scale shows 100 and scale edits are ignored', () => {
        const c = make(); c.BaseWidth = 0;
        assert.equal(c.ScaleWidth, 100);
        c.ScaleWidth = 300; assert.equal(c.WidthValue, 200);   // unchanged
    });
    test('HasTarget defaults false', () => {
        Application.current = null; new Application();
        assert.equal(new SizePositionControl().HasTarget, false);
    });
    test('From dropdown label maps to/from PositionFrom', () => {
        const c = make();
        assert.deepEqual([...c.FromLabels], ['Top Left Corner', 'Center']);
        assert.equal(c.SelectedFromLabel, 'Top Left Corner');
        c.SelectedFromLabel = 'Center';
        assert.equal(c.PositionFrom, PositionAnchor.Center);
        c.PositionFrom = PositionAnchor.TopLeftCorner;
        assert.equal(c.SelectedFromLabel, 'Top Left Corner');
    });
});
