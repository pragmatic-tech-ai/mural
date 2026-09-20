import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    Color,
    CornerRadius,
    MetaData,
    MuralBase,
    Element,
    Visual,
    type DrawingContext,
    DynamicResource,
    Size,
} from '../../../runtime/index.js';
import { resolveKey } from '../../../runtime/model-internals.js';
import { GeometryGroup, PathGeometry, SolidColorBrush } from '../../../visual-engine/index.js';
import { SetTheme, CurrentTheme, ToggleTheme } from '../index.js';

// Plain Visual subclass with a writable Brush DP — Material tokens are
// SolidColorBrush instances, so this proves the lookup wires up
// correctly when bound through `DynamicResource`.
class BrushTarget extends Element
{
    static
    {
        MuralBase.RegisterProperty(BrushTarget, 'Brush', undefined, MetaData.None);
    }
    public get Brush(): SolidColorBrush | undefined
    {
        return this.get_property_value(resolveKey(this, undefined, 'Brush')) as SolidColorBrush | undefined;
    }
    public set Brush(v: SolidColorBrush | undefined)
    {
        this.set_property_value(resolveKey(this, undefined, 'Brush'), v);
    }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void { }
}

// Resets Material's internal palette pointer + Application.current
// between tests so each test starts from a clean slate. Material
// caches the last-applied theme name; without a reset, calling
// SetTheme('light') after a previous test left it 'light' is a no-op
// and the dictionary doesn't re-register.
function resetMaterial(): void
{
    // Force re-application by setting the theme to the other one then
    // back. Cheap reliable reset that doesn't reach into module-level
    // state via reflection.
    (Application as unknown as { current: Application | undefined }).current = undefined;
    // SetTheme tracked state lives in the material module's closure —
    // there's no public reset hook. Toggling through a non-current
    // theme works because the active-dict pointer is per-test fresh.
}

beforeEach(() => {
    resetMaterial();
    new Application();
});

describe('Material — palette registration', () => {
    test('SetTheme(\'light\') merges the light palette into Application.Resources', () => {
        SetTheme('light');
        const primary = Application.current!.Resources.Resolve('Primary');
        assert.ok(primary instanceof SolidColorBrush);
        // Light Primary token is M3 baseline #6750A4.
        assert.equal(
            (primary as SolidColorBrush).Color.Equals(Color.FromHex('#6750A4')),
            true);
    });

    test('SetTheme(\'dark\') swaps the palette — Primary changes to the dark baseline', () => {
        SetTheme('light');
        SetTheme('dark');
        const primary = Application.current!.Resources.Resolve('Primary');
        assert.ok(primary instanceof SolidColorBrush);
        // Dark Primary token is M3 baseline #D0BCFF.
        assert.equal(
            (primary as SolidColorBrush).Color.Equals(Color.FromHex('#D0BCFF')),
            true);
    });

    test('shape tokens resolve to numbers (CornerRadius / spacing inputs)', () => {
        SetTheme('light');
        assert.equal(Application.current!.Resources.Resolve('ShapeMedium'), 12);
        // ShapeFull is the M3 "fully rounded" sentinel — CornerRadius.Full,
        // a CornerRadius value with every corner Number.POSITIVE_INFINITY.
        // Border's render path clamps each non-finite corner to
        // min(width, height) / 2 at paint time.
        assert.equal(Application.current!.Resources.Resolve('ShapeFull'),
                     CornerRadius.Full);
    });

    test('shared chevron geometries resolve to PathGeometry from the root dictionary', () => {
        SetTheme('light');
        const down = Application.current!.Resources.Resolve('ChevronDown');
        const up   = Application.current!.Resources.Resolve('ChevronUp');
        assert.ok(down instanceof PathGeometry, 'ChevronDown resolves to a PathGeometry');
        assert.ok(up   instanceof PathGeometry, 'ChevronUp resolves to a PathGeometry');
        // Filled closed thick-V (Material expand_more/less) — painted via Fill.
        assert.equal(down.Figures[0]!.IsClosed, true, 'chevron is a closed filled shape');
    });

    test('MoreHoriz (three-dots) geometry resolves to a GeometryGroup from the root dictionary', () => {
        SetTheme('light');
        const more = Application.current!.Resources.Resolve('MoreHoriz');
        // Three <circle> shapes → a GeometryGroup (one Shape paints all dots).
        assert.ok(more instanceof GeometryGroup, 'MoreHoriz resolves to a GeometryGroup');
        assert.equal(more.Children.length, 3, 'three dots');
    });

    test('CurrentTheme reports the active palette name after SetTheme', () => {
        SetTheme('light');
        assert.equal(CurrentTheme(), 'light');
        SetTheme('dark');
        assert.equal(CurrentTheme(), 'dark');
    });

    test('ToggleTheme flips between light and dark', () => {
        SetTheme('light');
        assert.equal(ToggleTheme(), 'dark');
        assert.equal(CurrentTheme(), 'dark');
        assert.equal(ToggleTheme(), 'light');
        assert.equal(CurrentTheme(), 'light');
    });

    test('SetTheme without an Application throws a clear error', () => {
        // Drop Application.current — Material's SetTheme reads it at
        // call time and throws if undefined.
        (Application as unknown as { current: Application | undefined }).current = undefined;
        assert.throws(() => SetTheme('light'), /no Application\.current/);
    });
});

describe('Material — DynamicResource binding into a token', () => {
    test('@Primary lookup yields the live SolidColorBrush; theme swap repaints', () => {
        SetTheme('light');

        const target = new BrushTarget();
        // The DynamicResource binding subscribes to
        // Application.current.Resources directly, so the host doesn't
        // need to be tree-attached for theme swaps to propagate.
        target.set_property_value(
            resolveKey(target, undefined, 'Brush'),
            DynamicResource(target, 'Primary'));

        const light = target.Brush;
        assert.ok(light instanceof SolidColorBrush);
        assert.equal(
            light!.Color.Equals(Color.FromHex('#6750A4')), true,
            'light Primary should be #6750A4');

        // Flip to dark — DynamicResource subscribed to Application's
        // ResourceDictionary, so the Brush DP should re-resolve
        // automatically when the merged dict is swapped.
        SetTheme('dark');
        const dark = target.Brush;
        assert.ok(dark instanceof SolidColorBrush);
        assert.equal(
            dark!.Color.Equals(Color.FromHex('#D0BCFF')), true,
            'dark Primary should be #D0BCFF — DynamicResource did not re-resolve');
    });
});
