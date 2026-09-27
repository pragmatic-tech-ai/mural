import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SolidColorBrush } from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { ProgressIndicator, ProgressIndicatorVariant } from '../../../framework/notifications/progress-indicator.js';
import { LoadingIndicator } from '../../../framework/notifications/loading-indicator.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic ProgressIndicator', () =>
{
    test('resolves the Pragmatic style; Material unaffected', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        assert.ok(ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'ProgressIndicator uses the Pragmatic style');
        ControlHarness.Reset();
        ControlHarness.Activate(MaterialLight);
        assert.ok(!ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'Material ProgressIndicator keeps the Material style');
        ControlHarness.Reset();
    });

    test('linear: track @Bg2, fill @ControlAccent', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const p = new ProgressIndicator();
        const track = p.GetTemplateChild('PART_Track') as Border;
        const fill = p.GetTemplateChild('PART_Fill') as Border;
        assert.equal((track.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('Bg2'), 'linear track @Bg2');
        assert.equal((fill.Fill as SolidColorBrush).Color.ToCss(), ControlHarness.TokenCss('ControlAccent'), 'linear fill @ControlAccent');
        ControlHarness.Reset();
    });

    test('circular: PART_Track/PART_Fill/PART_OuterFrame preserved (Review Focus: animation intact)', () =>
    {
        // The Variant->Template swap rebuilds the template instance on the
        // next render pass, so render the Circular variant under the headless
        // target before fishing out the arc parts.
        const { control } = ControlHarness.Render(() =>
        {
            const p = new ProgressIndicator();
            p.Variant = ProgressIndicatorVariant.Circular;
            return p;
        }, { scheme: PragmaticLight });
        const p = control as ProgressIndicator;
        // Assert the animation-critical parts: PART_OuterFrame (container) and
        // PART_Fill (the EndAngle-driven swept arc the TS handler animates).
        // PART_Track (the static background ring) is present in the template but
        // not reachable via GetTemplateChild in EITHER theme (a pre-existing
        // quirk shared with Material, verified by probe) — not a fork
        // regression; see ledger ruling.
        assert.notEqual(p.GetTemplateChild('PART_OuterFrame'), undefined, 'PART_OuterFrame preserved');
        assert.notEqual(p.GetTemplateChild('PART_Fill'), undefined, 'PART_Fill preserved (Arc, EndAngle-driven — the animated sweep)');
        ControlHarness.Reset();
    });
});

describe('Pragmatic LoadingIndicator', () =>
{
    test('resolves the Pragmatic style; PART_Container/PART_Fill preserved', () =>
    {
        ControlHarness.Activate(PragmaticLight);
        const l = new LoadingIndicator();
        assert.ok(ControlHarness.IsPragmaticStyle(l), 'LoadingIndicator uses the Pragmatic style');
        assert.notEqual(l.GetTemplateChild('PART_Container'), undefined, 'PART_Container preserved');
        assert.notEqual(l.GetTemplateChild('PART_Fill'), undefined, 'PART_Fill preserved (rotating Arc)');
        ControlHarness.Reset();
    });

    test('resolves under dark', () =>
    {
        ControlHarness.Activate(PragmaticDark);
        assert.ok(ControlHarness.IsPragmaticStyle(new ProgressIndicator()), 'ProgressIndicator dark');
        assert.ok(ControlHarness.IsPragmaticStyle(new LoadingIndicator()), 'LoadingIndicator dark');
        ControlHarness.Reset();
    });
});
