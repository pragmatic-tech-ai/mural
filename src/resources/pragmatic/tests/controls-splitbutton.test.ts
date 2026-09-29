import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { SplitButton } from '../../../framework/button-groups/split-button.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic SplitButton', () =>
{
    test('resolves the Pragmatic style', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new SplitButton()), 'SplitButton uses the Pragmatic style');
        ControlHarness.Reset();
    });

    test('both halves fill @ActionPrimary at rest', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        const trigger = sb.GetTemplateChild('PART_TriggerButton') as Border;
        assert.equal((primary.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimary'), 'primary half fills @ActionPrimary');
        assert.equal((trigger.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimary'), 'trigger half fills @ActionPrimary');
        ControlHarness.Reset();
    });

    test('primary half hover ramps to @ActionPrimaryHover', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        primary._setIsMouseOver(true);
        assert.equal((primary.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ActionPrimaryHover'), 'hovered primary ramps @ActionPrimaryHover');
        ControlHarness.Reset();
    });

    test('disabled dims BOTH halves (Review Focus: whole capsule greys)', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const sb = new SplitButton();
        sb.IsEnabled = false;
        const primary = sb.GetTemplateChild('PART_PrimaryButton') as Border;
        const trigger = sb.GetTemplateChild('PART_TriggerButton') as Border;
        assert.ok(primary.Opacity < 1, 'primary half dims when disabled');
        assert.ok(trigger.Opacity < 1, 'trigger half dims when disabled');
        ControlHarness.Reset();
    });

    test('resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new SplitButton()), 'SplitButton dark');
        ControlHarness.Reset();
    });
});
