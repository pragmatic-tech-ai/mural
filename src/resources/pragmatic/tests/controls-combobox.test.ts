import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Panel, type Visual } from '../../../runtime/index.js';
import { ScrollViewer } from '../../../framework/index.js';
import { HeadlessTarget, SolidColorBrush, Pen } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ComboBox, ComboBoxItem } from '../../../framework/list/combo-box.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness, type SchemeHandle } from './control-harness.js';

// A bare panel root to host the ComboBox in a PresentationTarget so the
// dropdown can mount on the target's OverlayRoot (mirrors combo-box.test.ts).
class Root extends Panel { }

// Opens a ComboBox's dropdown under a scheme and exposes the realized
// popup rows. ComboBoxItem can't be constructed bare (it wires against a
// host ComboBoxItemList), so every row-level check goes through here.
class ComboPopup
{
    public readonly cb: ComboBox;
    public readonly target: HeadlessTarget;
    public readonly rows: readonly Visual[];

    private constructor(cb: ComboBox, target: HeadlessTarget, rows: readonly Visual[])
    {
        this.cb = cb;
        this.target = target;
        this.rows = rows;
    }

    public static Open(scheme: SchemeHandle, items: readonly string[]): ComboPopup
    {
        ControlHarness.Activate(scheme);
        const cb = new ComboBox();
        cb.Items = items.slice();
        const root = new Root();
        root.AddChild(cb);
        const target = new HeadlessTarget(400, 600);
        target.Content = root;
        target.Flush();
        cb.IsDropDownOpen = true;
        target.Flush();
        const popupHost = target.OverlayRoot!.visualChildren[0] as unknown as { FindName(n: string): Visual | undefined };
        const popupList = popupHost.FindName('PART_PopupList')!;
        const stack = popupList.visualChildren[0]!;
        return new ComboPopup(cb, target, stack.visualChildren);
    }
}

describe('Pragmatic ComboBox — selection box', () =>
{
    test('rest selection box strokes @BorderStrong (Pragmatic template resolved)', () =>
    {
        const { svg } = ControlHarness.Render(() => new ComboBox(), { scheme: PragmaticLight });
        const strong = ControlHarness.TokenCss('BorderStrong');
        assert.equal(strong, 'rgb(214,213,208)');
        assert.ok(svg.includes(`stroke="${strong}"`), 'rest ComboBox selection box strokes @BorderStrong');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 — every token resolves');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey', () =>
    {
        const { svg } = ControlHarness.Render(() => new ComboBox(), { scheme: PragmaticDark });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss), 'no #808080 under PragmaticDark');
        ControlHarness.Reset();
    });
});

describe('Pragmatic ComboBox — popup', () =>
{
    test('open dropdown keeps PART_PopupScroll cap + @Bg1 popup surface; selection border flips to @ControlAccent', () =>
    {
        const popup = ComboPopup.Open(PragmaticLight, Array.from({ length: 40 }, (_, i) => `Item ${i}`));
        const popupHost = popup.target.OverlayRoot!.visualChildren[0] as unknown as { FindName(n: string): Visual | undefined };

        const scroll = popupHost.FindName('PART_PopupScroll') as ScrollViewer;
        assert.notEqual(scroll, undefined, 'popup keeps PART_PopupScroll');
        assert.equal(scroll.HorizontalScrollEnabled, false, 'horizontal scroll off');
        assert.ok(Number.isFinite(scroll.MaxHeight), 'finite MaxHeight cap');
        assert.ok(scroll.ViewportHeight <= scroll.MaxHeight + 0.5, 'viewport capped at MaxHeight, not the screen');

        const popupBorder = popupHost.FindName('PART_Popup') as Border;
        const bg1 = ControlHarness.TokenCss('Bg1');
        assert.ok(popupBorder.Fill instanceof SolidColorBrush, 'popup surface resolves a fill');
        assert.equal((popupBorder.Fill as SolidColorBrush).Color.ToCss(), bg1, 'popup surface is @Bg1');

        // Selection box is the ComboBox's in-flow template root; open flips its stroke.
        const box = popup.cb.visualChildren[0] as Border;
        const accent = ControlHarness.TokenCss('ControlAccent');
        assert.ok(box.Stroke instanceof Pen, 'selection box stroke is a Pen');
        assert.equal(((box.Stroke as Pen).Brush as SolidColorBrush).Color.ToCss(), accent, 'open selection box strokes @ControlAccent');
        ControlHarness.Reset();
    });
});

describe('Pragmatic ComboBoxItem (via an open popup)', () =>
{
    test('realized rows resolve the Pragmatic style and rest transparent', () =>
    {
        const popup = ComboPopup.Open(PragmaticLight, ['Apple', 'Pear']);
        assert.equal(popup.rows.length, 2, 'both items realized');
        const row = popup.rows[0] as ComboBoxItem;
        assert.ok(ControlHarness.IsPragmaticStyle(row), 'a realized ComboBoxItem resolves the Pragmatic style');
        assert.ok(row.Fill instanceof SolidColorBrush, 'row resolves a fill');
        assert.equal((row.Fill as SolidColorBrush).Color.ToCss(), 'rgba(0,0,0,0)', 'rest row is transparent');
        ControlHarness.Reset();
    });

    test('selecting a row fills it @SurfaceSelected', () =>
    {
        const popup = ComboPopup.Open(PragmaticLight, ['Apple', 'Pear']);
        popup.cb.SelectedIndex = 0;
        popup.target.Flush();
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(226,243,233)');
        const row = popup.rows[0] as ComboBoxItem;
        assert.ok(row.Fill instanceof SolidColorBrush, 'selected row resolves a fill');
        assert.equal((row.Fill as SolidColorBrush).Color.ToCss(), selected, 'selected ComboBoxItem fills @SurfaceSelected');
        ControlHarness.Reset();
    });

    test('selecting a row fills the dark @SurfaceSelected under PragmaticDark', () =>
    {
        const popup = ComboPopup.Open(PragmaticDark, ['Apple', 'Pear']);
        popup.cb.SelectedIndex = 1;
        popup.target.Flush();
        const selected = ControlHarness.TokenCss('SurfaceSelected');
        assert.equal(selected, 'rgb(15,42,26)');
        const row = popup.rows[1] as ComboBoxItem;
        assert.equal((row.Fill as SolidColorBrush).Color.ToCss(), selected, 'dark selected ComboBoxItem fill');
        ControlHarness.Reset();
    });
});
