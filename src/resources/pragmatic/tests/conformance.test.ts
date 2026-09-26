import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TokenSnapshot } from '../token-snapshot.js';
import { SchemeValues } from '../scheme-values.js';
import { ColorValue } from '../color-value.js';

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
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/([A-Za-z])(\d)/g, '$1-$2')
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

    test('a missing projection is detected (guard)', () =>
    {
        const partial = new Map(light);
        partial.delete('Bg0');
        const allProjected = colourNames.every(
            ds => [...partial.keys()].some(k => kebab(k) === ds));
        assert.equal(allProjected, false, 'removing Bg0 must be detectable');
    });
});
