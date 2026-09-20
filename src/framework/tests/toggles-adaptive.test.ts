import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { Size, Rect, ThemeManager, Pointer, Density } from '../../runtime/index.js';
import { Checkbox } from '../toggles/checkbox.js';
import { Switch } from '../toggles/switch.js';
import { RadioButton } from '../toggles/radio-button.js';

// §18.6 — Switch / Checkbox / RadioButton adaptive touch targets.
//
// These controls pin their own Width/Height defaults (Checkbox 18, Radio
// 20, Switch 36.4×22.4), so the render size clamps to those regardless of the
// template root. The touch-target ladder therefore grows the CONTROL's
// Width/Height (Style triggers), NOT a template wrapper's MinHeight — the
// earlier wrapper-MinHeight attempt silently no-op'd because the control's
// explicit size clamped it. The transparent PART_HitTarget stretches to
// fill the grown bounds and keeps the visible mark centred + unscaled (so
// the margin-anchored Switch thumb / bordered box never clip).

function walk(v: unknown, name: string): { DesiredSize: Size } | undefined
{
    const node = v as { Name?: string; visualChildren?: readonly unknown[] };
    if (node?.Name === name) return v as { DesiredSize: Size };
    for (const c of node?.visualChildren ?? [])
    {
        const r = walk(c, name);
        if (r) return r;
    }
    return undefined;
}

function measure(c: { Measure(s: Size): void; Arrange(r: Rect): void; DesiredSize: Size }): Size
{
    c.Measure(new Size(200, 200));
    c.Arrange(new Rect(0, 0, c.DesiredSize.Width, c.DesiredSize.Height));
    return c.DesiredSize;
}

describe('Toggles — adaptive touch targets (§18.6)', () => {

    test('rest sizes unchanged (no layout shift for existing usages)', () => {
        initTestApp();
        assert.deepEqual({ ...measure(new Checkbox()) },    { Width: 18, Height: 18 });
        assert.deepEqual({ ...measure(new Switch()) },      { Width: 36.4, Height: 22.4 });
        assert.deepEqual({ ...measure(new RadioButton()) }, { Width: 20, Height: 20 });
    });

    test('coarse pointer grows the CONTROL to 48; the visible mark stays fixed', () => {
        initTestApp();

        const c = new Checkbox();
        ThemeManager.SetPointer(c, Pointer.Coarse);
        assert.deepEqual({ ...measure(c) }, { Width: 48, Height: 48 }, 'checkbox grows to 48');
        assert.deepEqual({ ...walk(c, 'PART_Box')!.DesiredSize }, { Width: 18, Height: 18 },
            'checkbox box stays 18 (unscaled border)');

        const s = new Switch();
        ThemeManager.SetPointer(s, Pointer.Coarse);
        const ds = measure(s);
        assert.equal(ds.Height, 48, 'switch height grows to 48');
        assert.equal(ds.Width, 48, 'switch width grows to 48 (30%-smaller track is now below the floor)');
        assert.deepEqual({ ...walk(s, 'PART_Track')!.DesiredSize }, { Width: 36.4, Height: 22.4 },
            'switch track stays 36.4×22.4 (thumb not clipped)');

        const r = new RadioButton();
        ThemeManager.SetPointer(r, Pointer.Coarse);
        assert.deepEqual({ ...measure(r) }, { Width: 48, Height: 48 }, 'radio grows to 48');
    });

    test('comfortable density grows to 40', () => {
        initTestApp();
        const c = new Checkbox();
        ThemeManager.SetDensity(c, Density.Comfortable);
        assert.deepEqual({ ...measure(c) }, { Width: 40, Height: 40 });
        const s = new Switch();
        ThemeManager.SetDensity(s, Density.Comfortable);
        assert.equal(measure(s).Height, 40);
    });

    test('coarse wins over comfortable when both are active (a11y-favouring)', () => {
        initTestApp();
        const c = new Checkbox();
        ThemeManager.SetDensity(c, Density.Comfortable);
        ThemeManager.SetPointer(c, Pointer.Coarse);
        assert.deepEqual({ ...measure(c) }, { Width: 48, Height: 48 });
    });
});
