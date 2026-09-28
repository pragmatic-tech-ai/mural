import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ThemeManager } from '../../../runtime/index.js';
import * as MaterialBarrel from '../index.js';

describe('resources/material barrel — intact after dynamic-scheme removal', () =>
{
    test('still registers Material and exports its theme/scheme classes', () =>
    {
        assert.ok(ThemeManager.GetTheme('Material') !== undefined, 'Material registered');
        assert.ok('Material' in MaterialBarrel, 'exports Material');
        assert.ok('MaterialLight' in MaterialBarrel, 'exports MaterialLight');
        assert.ok('MaterialDark' in MaterialBarrel, 'exports MaterialDark');
        assert.ok('SetTheme' in MaterialBarrel, 'exports SetTheme');
    });

    test('no longer exports the retired dynamic-scheme API', () =>
    {
        assert.ok(!('makeDynamicScheme' in MaterialBarrel), 'makeDynamicScheme gone');
        assert.ok(!('makeDynamicLightDarkPair' in MaterialBarrel), 'makeDynamicLightDarkPair gone');
        assert.ok(!('DynamicSchemeVariant' in MaterialBarrel), 'DynamicSchemeVariant gone');
    });
});
