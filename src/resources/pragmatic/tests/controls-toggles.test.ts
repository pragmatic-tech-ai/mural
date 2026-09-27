import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Checkbox } from '../../../framework/toggles/checkbox.js';
import { RadioButton } from '../../../framework/toggles/radio-button.js';
import { Switch } from '../../../framework/toggles/switch.js';
import { PragmaticLight, PragmaticDark } from '../pragmatic.js';
import { MaterialLight } from '../../material/material.js';
import { ControlHarness } from './control-harness.js';

describe('Pragmatic Checkbox', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Checkbox(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Checkbox uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Checkbox under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new Checkbox(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Checkbox does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('unchecked box paints the @BorderStrong outline stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new Checkbox(), { scheme: PragmaticLight });
        const borderStrong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${borderStrong}"`), 'unchecked Checkbox paints @BorderStrong as a stroke');
        ControlHarness.Reset();
    });

    test('checked state fills @ControlAccent (#22824D)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Checkbox();
            c.IsChecked = true;
            return c;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(34,130,77)');
        assert.ok(svg.includes(controlAccent!), 'checked Checkbox paints @ControlAccent');
        ControlHarness.Reset();
    });

    test('focus paints the @BorderFocus ring as a stroke, distinct from the checked fill', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Checkbox();
            c._setIsFocused(true);
            return c;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(borderFocus, 'rgb(34,130,77)');
        // @ControlAccent and @BorderFocus share the same rgb() under
        // PragmaticLight, so the stroke-attribute form is what proves this
        // painted as a STROKE (the focus ring) rather than the checked FILL.
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Checkbox paints @BorderFocus as a border stroke');
        ControlHarness.Reset();
    });

    test('checked + hovered keeps the checked fill — hover must not erase it', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Checkbox();
            c.IsChecked = true;
            c._setIsMouseOver(true);
            return c;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        const hover = ControlHarness.TokenCss('Bg2');
        const accentIndex = svg.indexOf(controlAccent!);
        const hoverIndex = svg.indexOf(hover!);
        assert.notEqual(accentIndex, -1, 'checked + hovered Checkbox still paints @ControlAccent');
        assert.notEqual(hoverIndex, -1, 'the hover surface (@Bg2) still paints underneath — the ghost box layer');
        assert.ok(accentIndex > hoverIndex,
            'the @ControlAccent PART_Selected layer must paint AFTER (on top of, in SVG document order) the ' +
            '@Bg2 hover layer, so the checked cue visually wins while hovered');
        ControlHarness.Reset();
    });

    test('checked + focused shows BOTH the checked stroke and a separate focus-ring stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Checkbox();
            c.IsChecked = true;
            c._setIsFocused(true);
            return c;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        // @ControlAccent and @BorderFocus share the same rgb() under
        // PragmaticLight, so the two states can't be told apart by colour —
        // only by STRUCTURE. If focus reused PART_Box's Stroke (the bug this
        // regression guards against), IsFocused's SetTriggerValue call (it
        // runs after IsChecked's here) would overwrite the checked stroke,
        // leaving exactly ONE `stroke="rgb(34,130,77)"` in the document. A
        // dedicated PART_FocusRing element paints its OWN stroke on top of
        // PART_Box's still-intact checked stroke, so both attributes
        // survive — asserting the count is 2 fails against the old
        // shared-Stroke structure and passes once focus has its own ring.
        assert.equal(controlAccent, borderFocus);
        const strokeAttr = `stroke="${controlAccent}"`;
        const occurrences = svg.split(strokeAttr).length - 1;
        assert.equal(occurrences, 2,
            'checked Checkbox paints two distinct stroke="rgb(34,130,77)" attributes — PART_Box\'s checked ' +
            'outline AND PART_FocusRing\'s focus ring — proving focus did not overwrite the checked stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Checkbox(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });

    test('renders under PragmaticDark with no grey fallback and paints the dark @ControlAccent fill', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const c = new Checkbox();
            c.IsChecked = true;
            return c;
        }, { scheme: PragmaticDark });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(46,168,98)', '@ControlAccent under PragmaticDark is #2EA862');
        assert.ok(svg.includes(controlAccent!), 'checked Checkbox paints the dark @ControlAccent fill');
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral fallback — every token resolves under PragmaticDark');
        ControlHarness.Reset();
    });
});

describe('Pragmatic RadioButton', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new RadioButton(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'RadioButton uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a RadioButton under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new RadioButton(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material RadioButton does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('unchecked ring paints the @BorderStrong outline stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new RadioButton(), { scheme: PragmaticLight });
        const borderStrong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${borderStrong}"`), 'unchecked RadioButton paints @BorderStrong as a stroke');
        ControlHarness.Reset();
    });

    test('checked state fills @ControlAccent (#22824D)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const r = new RadioButton();
            r.IsChecked = true;
            return r;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(34,130,77)');
        assert.ok(svg.includes(controlAccent!), 'checked RadioButton paints @ControlAccent');
        ControlHarness.Reset();
    });

    test('focus paints the @BorderFocus ring as a stroke, distinct from the checked fill', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const r = new RadioButton();
            r._setIsFocused(true);
            return r;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused RadioButton paints @BorderFocus as a border stroke');
        ControlHarness.Reset();
    });

    test('checked + hovered keeps the checked fill — hover must not erase it', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const r = new RadioButton();
            r.IsChecked = true;
            r._setIsMouseOver(true);
            return r;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        const hover = ControlHarness.TokenCss('Bg2');
        const accentIndex = svg.indexOf(controlAccent!);
        const hoverIndex = svg.indexOf(hover!);
        assert.notEqual(accentIndex, -1, 'checked + hovered RadioButton still paints @ControlAccent');
        assert.notEqual(hoverIndex, -1, 'the hover surface (@Bg2) still paints underneath — the ghost ring layer');
        assert.ok(accentIndex > hoverIndex,
            'the @ControlAccent PART_Selected layer must paint AFTER (on top of, in SVG document order) the ' +
            '@Bg2 hover layer, so the checked cue visually wins while hovered');
        ControlHarness.Reset();
    });

    test('checked + focused shows BOTH the checked stroke and a separate focus-ring stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const r = new RadioButton();
            r.IsChecked = true;
            r._setIsFocused(true);
            return r;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(controlAccent, borderFocus);
        // See the equivalent Checkbox test above for why this must be a
        // structural (occurrence-count) assertion rather than a colour one —
        // @ControlAccent and @BorderFocus share the same rgb() here.
        const strokeAttr = `stroke="${controlAccent}"`;
        const occurrences = svg.split(strokeAttr).length - 1;
        assert.equal(occurrences, 2,
            'checked RadioButton paints two distinct stroke="rgb(34,130,77)" attributes — PART_Ring\'s checked ' +
            'outline AND PART_FocusRing\'s focus ring — proving focus did not overwrite the checked stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new RadioButton(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});

describe('Pragmatic Switch', () =>
{
    test('resolves the Pragmatic style under Pragmatic', () =>
    {
        const { control } = ControlHarness.Render(() => new Switch(), { scheme: PragmaticLight });
        assert.ok(ControlHarness.IsPragmaticStyle(control), 'Switch uses the Pragmatic override style');
        ControlHarness.Reset();
    });

    test('Material is unaffected — a Switch under Material keeps the Material style', () =>
    {
        const { control } = ControlHarness.Render(() => new Switch(), { scheme: MaterialLight });
        assert.ok(!ControlHarness.IsPragmaticStyle(control), 'Material Switch does NOT resolve the Pragmatic style');
        ControlHarness.Reset();
    });

    test('off track fills @Bg3', () =>
    {
        const { svg } = ControlHarness.Render(() => new Switch(), { scheme: PragmaticLight });
        const bg3 = ControlHarness.TokenCss('Bg3');
        assert.ok(svg.includes(bg3!), 'off Switch track paints @Bg3');
        ControlHarness.Reset();
    });

    test('unchecked track paints the @BorderStrong outline stroke', () =>
    {
        const { svg } = ControlHarness.Render(() => new Switch(), { scheme: PragmaticLight });
        const borderStrong = ControlHarness.TokenCss('BorderStrong');
        assert.ok(svg.includes(`stroke="${borderStrong}"`), 'unchecked Switch track paints @BorderStrong as a stroke');
        ControlHarness.Reset();
    });

    test('on track fills @ControlAccent (#22824D)', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Switch();
            s.IsChecked = true;
            return s;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        assert.equal(controlAccent, 'rgb(34,130,77)');
        assert.ok(svg.includes(controlAccent!), 'on Switch track paints @ControlAccent');
        ControlHarness.Reset();
    });

    test('thumb fills @Bg1', () =>
    {
        const { svg } = ControlHarness.Render(() => new Switch(), { scheme: PragmaticLight });
        const bg1 = ControlHarness.TokenCss('Bg1');
        assert.ok(svg.includes(bg1!), 'Switch thumb paints @Bg1');
        ControlHarness.Reset();
    });

    test('focus paints the @BorderFocus track stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Switch();
            s._setIsFocused(true);
            return s;
        }, { scheme: PragmaticLight });
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.ok(svg.includes(`stroke="${borderFocus}"`), 'focused Switch paints @BorderFocus as a track stroke');
        ControlHarness.Reset();
    });

    test('checked + focused shows BOTH the checked stroke and a separate focus-ring stroke', () =>
    {
        const { svg } = ControlHarness.Render(() =>
        {
            const s = new Switch();
            s.IsChecked = true;
            s._setIsFocused(true);
            return s;
        }, { scheme: PragmaticLight });
        const controlAccent = ControlHarness.TokenCss('ControlAccent');
        const borderFocus = ControlHarness.TokenCss('BorderFocus');
        assert.equal(controlAccent, borderFocus);
        // See the equivalent Checkbox test above for why this must be a
        // structural (occurrence-count) assertion rather than a colour one —
        // @ControlAccent and @BorderFocus share the same rgb() here.
        const strokeAttr = `stroke="${controlAccent}"`;
        const occurrences = svg.split(strokeAttr).length - 1;
        assert.equal(occurrences, 2,
            'checked Switch paints two distinct stroke="rgb(34,130,77)" attributes — PART_Track\'s checked ' +
            'outline AND PART_FocusRing\'s focus ring — proving focus did not overwrite the checked stroke');
        ControlHarness.Reset();
    });

    test('no grey fallback — every token resolves under Pragmatic', () =>
    {
        const { svg } = ControlHarness.Render(() => new Switch(), { scheme: PragmaticLight });
        assert.ok(!svg.includes(ControlHarness.NeutralFallbackCss),
            'no #808080 neutral — an unresolved token would paint the marker');
        ControlHarness.Reset();
    });
});
