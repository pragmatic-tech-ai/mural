import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ThemeManager } from '../../../runtime/index.js';
// Importing the barrel is exactly the registration side-effect a consumer gets.
import '../index.js';

describe('Pragmatic delivery — subpath export + registration', () =>
{
    test('importing the Pragmatic barrel registers the theme and its schemes', () =>
    {
        const theme = ThemeManager.GetTheme('Pragmatic');
        assert.ok(theme !== undefined, 'theme "Pragmatic" is registered');
        assert.ok(theme.schemes.has('PragmaticLight'), 'PragmaticLight scheme present');
        assert.ok(theme.schemes.has('PragmaticDark'), 'PragmaticDark scheme present');
    });

    test('package.json exposes ./resources/pragmatic mirroring ./resources/material', () =>
    {
        type ExportEntry = { types: string; import: { development: string; default: string } };
        const pkgPath = fileURLToPath(new URL('../../../../package.json', import.meta.url));
        const exports = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, ExportEntry> }).exports;
        const pragmatic = exports['./resources/pragmatic'];
        const material  = exports['./resources/material'];
        assert.ok(pragmatic !== undefined, './resources/pragmatic export entry exists');
        assert.equal(pragmatic.types, './dist/resources/pragmatic/index.d.ts');
        assert.equal(pragmatic.import.development, './src/resources/pragmatic/index.ts');
        assert.equal(pragmatic.import.default, './dist/resources/pragmatic/index.js');
        assert.deepEqual(Object.keys(pragmatic), Object.keys(material), 'same keys as material entry');
        assert.deepEqual(Object.keys(pragmatic.import), Object.keys(material.import), 'same import conditions');
    });
});
