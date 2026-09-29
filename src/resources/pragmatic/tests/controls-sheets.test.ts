import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { BottomSheet } from '../../../framework/surfaces/bottom-sheet.js';
import { SideSheet } from '../../../framework/surfaces/side-sheet.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic BottomSheet', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomSheet()), 'BottomSheet uses the Pragmatic style');
        ControlHarness.Reset();
    });

    test('resolves the Pragmatic fork; @Bg1 surface token resolves', () =>
    {
        // BottomSheet is a bare ContentControl shown via a service; it never
        // applies its template on headless construction or Render (its ctor
        // does not call the protected applyDefaultStyle), so PART_Sheet is
        // unreachable in a unit test. Gate on the resolved Pragmatic style
        // identity + the @Bg1 surface token proxy — the same fallback the
        // Wave-2 ComboBox/GridSplitter tests use (Ruling in ledger). The
        // @Bg1 surface fill itself is exercised through Card/Dialog/Drawer/
        // SideSheet, whose parts ARE reachable and share the surface idiom.
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomSheet()), 'BottomSheet resolves the Pragmatic fork');
        assert.equal(ControlHarness.TokenCss('Bg1'), 'rgb(255,255,255)', '@Bg1 surface token resolves under Pragmatic');
        ControlHarness.Reset();
    });
});

describe('Pragmatic SideSheet', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new SideSheet()), 'SideSheet uses the Pragmatic style');
        ControlHarness.Reset();
    });

    test('sheet fills @Bg2 and keeps the close button + title anatomy', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const s = new SideSheet();
        const sheet = s.GetTemplateChild('PART_Sheet') as Border;
        assert.equal((sheet.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'side sheet fills @Bg2');
        assert.notEqual(s.GetTemplateChild('PART_CloseButton'), undefined, 'PART_CloseButton preserved');
        assert.notEqual(s.GetTemplateChild('PART_Title'), undefined, 'PART_Title preserved');
        ControlHarness.Reset();
    });

    test('both sheets resolve the Pragmatic style under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new BottomSheet()), 'BottomSheet dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new SideSheet()), 'SideSheet dark');
        ControlHarness.Reset();
    });
});
