import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';
import { SchemeValues } from '../scheme-values.js';
import { ColorValue } from '../color-value.js';
import { PragmaticShadowEffect } from '../../../visual-engine/drawing/pragmatic-shadow-effect.js';

function read(rel: string): string
{
    return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}
function snapshot(): TokenSnapshot
{
    return new TokenSnapshot(JSON.parse(read('../../../../../dev-kit/design/design-systems/pragmatic/tokens.json')));
}
function kebab(pascal: string): string
{
    return pascal
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')   // aA -> a-A
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // HDense -> H-Dense
        .replace(/([A-Za-z])(\d)/g, '$1-$2')      // Bg0 -> Bg-0
        .toLowerCase();
}

describe('Pragmatic conformance', () =>
{
    const snap  = snapshot();
    const light = SchemeValues.Parse(read('../light.mu'));
    const dark  = SchemeValues.Parse(read('../dark.mu'));
    const colourNames = snap.ColorNames().filter(n => !n.startsWith('neutral-'));

    test('every design-system colour token is projected into the schemes', () =>
    {
        for (const ds of colourNames)
        {
            const pascal = [...light.keys()].find(k => kebab(k) === ds);
            assert.ok(pascal, `no scheme token for design-system colour '${ds}'`);
        }
    });

    test('light + dark scheme colours equal the resolved snapshot', () =>
    {
        for (const [pascal, value] of light)
        {
            const ds = kebab(pascal);
            if (!colourNames.includes(ds)) continue; // non-colour token
            assert.equal(
                ColorValue.Normalize(value),
                ColorValue.Normalize(snap.Resolve(ds, 'light')),
                `light ${pascal} (${ds})`);
            assert.equal(
                ColorValue.Normalize(dark.get(pascal) ?? ''),
                ColorValue.Normalize(snap.Resolve(ds, 'dark')),
                `dark ${pascal} (${ds})`);
        }
    });

    test('scalar tokens (spacing/radius/sizing/density/duration/opacity/focus) equal the snapshot', () =>
    {
        for (const [pascal, value] of light)
        {
            const ds = kebab(pascal);
            if (!snap.ScalarNames().includes(ds)) continue;
            // RadiusPill is authored as CornerRadius.Full, not a number.
            if (pascal === 'RadiusPill') continue;
            assert.equal(Number(value), snap.Scalar(ds), `${pascal} (${ds})`);
        }
        // And every scalar token in the snapshot must be projected.
        for (const ds of snap.ScalarNames())
        {
            if (ds === 'radius-pill') continue;
            const pascal = [...light.keys()].find(k => kebab(k) === ds);
            assert.ok(pascal, `no scheme token for scalar '${ds}'`);
        }
    });

    // NOTE: type-scale (fontSize/weight/lineHeight/tracking) conformance is a
    // deferred follow-up — the snapshot's style names are not a clean function
    // of the Pascal tokens (h1 vs display-1) and lineHeight/tracking need
    // ratio/em conversion, so a reliable guard needs an explicit role->style
    // map + conversion table. The current transcription was verified correct.

    test('shadow layers equal the snapshot in both themes', () =>
    {
        for (const level of ['sm', 'md', 'lg'] as const)
        {
            for (const [theme, dark] of [['light', false], ['dark', true]] as const)
            {
                const expected = snap.ShadowLayers(level, theme);
                const actual   = PragmaticShadowEffect.LayersFor(level, dark);
                assert.equal(actual.length, expected.length, `shadow-${level} ${theme} layer count`);
                expected.forEach((e, i) =>
                {
                    assert.equal(actual[i].y,     e.y,     `shadow-${level} ${theme} layer ${i} y`);
                    assert.equal(actual[i].blur,  e.blur,  `shadow-${level} ${theme} layer ${i} blur`);
                    assert.equal(actual[i].alpha, e.alpha, `shadow-${level} ${theme} layer ${i} alpha`);
                });
            }
        }
    });

    test('a missing projection is detected (guard)', () =>
    {
        const partial = new Map(light);
        partial.delete('Bg0');
        const allProjected = colourNames.every(
            ds => [...partial.keys()].some(k => kebab(k) === ds));
        assert.equal(allProjected, false, 'removing Bg0 must be detectable');
    });
});
