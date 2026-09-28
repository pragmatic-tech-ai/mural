import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ThemeManager } from '../../../runtime/index.js';
// Importing the barrel is exactly the registration side-effect a consumer gets.
import '../index.js';

// The package's own import specifier — how a downstream app (Plexus/TODL) reaches
// the theme. Resolving THIS through the exports map is the consumer mechanism, as
// opposed to the relative source import above.
const PragmaticSpecifier = '@pragmatic-tech-ai/mural/resources/pragmatic';

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

    // Consumer path: resolve the package's own import specifier through the exports
    // map (ESM `import` condition) — the exact mechanism a downstream app uses.
    // Unlike the relative source import, this fails if the exports entry is
    // missing/malformed or its target file does not exist.
    test('the ./resources/pragmatic specifier resolves through exports and registers', async () =>
    {
        const mod = await import(PragmaticSpecifier) as Record<string, unknown>;
        assert.ok('Pragmatic' in mod, 'specifier resolves to the Pragmatic bundle');
        assert.ok('PragmaticLight' in mod && 'PragmaticDark' in mod, 'schemes exported');
        const theme = ThemeManager.GetTheme('Pragmatic');
        assert.ok(theme !== undefined, 'importing via the specifier registers Pragmatic');
        assert.ok(theme.schemes.has('PragmaticLight') && theme.schemes.has('PragmaticDark'), 'both schemes registered');
    });

    // Built-artifact gate: when a `dist` build is present (the publish flow always
    // builds first), the compiled default-condition entry must register Pragmatic
    // through its OWN runtime — the path an external consumer of the published
    // package actually loads. Run in a CLEAN `node` (default conditions, no dev
    // remap), because loading dist into this tsx dev-condition process would split
    // the ThemeManager into separate module instances. Skipped in an unbuilt
    // checkout so the source suite stays build-order-independent.
    test('the built dist artifact registers Pragmatic via its own runtime', () =>
    {
        const repoRoot   = fileURLToPath(new URL('../../../../', import.meta.url));
        const distBarrel  = fileURLToPath(new URL('../../../../dist/resources/pragmatic/index.js', import.meta.url));
        const distRuntime = fileURLToPath(new URL('../../../../dist/runtime/index.js', import.meta.url));
        if (!existsSync(distBarrel) || !existsSync(distRuntime))
        {
            return; // no dist build present — publish always builds first
        }
        const probe =
            "import('./dist/resources/pragmatic/index.js').then(async () => {"
            + " const { ThemeManager } = await import('./dist/runtime/index.js');"
            + " const t = ThemeManager.GetTheme('Pragmatic');"
            + " if (!t || !t.schemes.has('PragmaticLight') || !t.schemes.has('PragmaticDark')) process.exit(1);"
            + " process.exit(0); }).catch(() => process.exit(1));";
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: repoRoot });
        assert.equal(result.status, 0, 'clean-node import of the dist artifact registers Pragmatic + both schemes');
    });
});
