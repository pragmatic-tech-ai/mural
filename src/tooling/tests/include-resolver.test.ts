import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '../../compiler/compile.js';
import { makeIncludeResolver } from '../include-resolver.js';

// End-to-end: the real filesystem resolver over on-disk fixtures, driven through
// the compiler. Monochrome .svg → Geometry; colored .svg → IconDefinition;
// raster → ImageBrush. Each include binds a local `const _incN = <value>` and
// `t.Set(key, _incN)` (the local-resource fast path), so assertions match the
// const binding, not an inline value inside Set().

// A real 1×1 transparent PNG (for the raster include fixture).
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64');

function fixtureDir(): string
{
    const dir = mkdtempSync(join(tmpdir(), 'mural-include-'));
    writeFileSync(join(dir, 'home.svg'),
        `<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20"/></svg>`);
    writeFileSync(join(dir, 'logo.svg'),
        `<svg viewBox="0 0 24 24"><rect x="0" y="0" width="12" height="12" fill="#ff0000"/><circle cx="18" cy="18" r="4" fill="#0000ff"/></svg>`);
    writeFileSync(join(dir, 'dot.png'), PNG_1x1);
    return dir;
}

describe('makeIncludeResolver — colored vs monochrome', () => {

    test('monochrome include emits a Geometry from visual-engine (unchanged)', () => {
        const dir = fixtureDir();
        const js = compile(`resources I { include "home.svg" }`,
            { include: makeIncludeResolver(dir) }).js;
        assert.match(js, /const _inc\d+ = new RectangleGeometry\(/);
        assert.match(js, /\.Set\("home", _inc\d+\)/);
        assert.match(js, /from "@pragmatic-tech-ai\/mural\/visual-engine"/);
        assert.doesNotMatch(js, /IconDefinition/);
    });

    test('colored include emits an IconDefinition + basic import', () => {
        const dir = fixtureDir();
        const js = compile(`resources I { include colored "logo.svg" as logo }`,
            { include: makeIncludeResolver(dir) }).js;
        assert.match(js, /const _inc\d+ = new IconDefinition\(24, 24, \[/);
        assert.match(js, /\.Set\("logo", _inc\d+\)/);
        assert.match(js, /Fill: new Color\(255, 0, 0, 255\)/);
        assert.match(js, /import \{ IconDefinition \} from "@pragmatic-tech-ai\/mural\/basic"/);
        assert.match(js, /Color/);   // Color imported from visual-engine
    });
});

describe('makeIncludeResolver — raster', () => {

    test('a .png include emits an ImageBrush(BitmapImage(dataURI)) + visual-engine import', () => {
        const dir = fixtureDir();
        const js = compile(`resources I { include "dot.png" as Dot }`,
            { include: makeIncludeResolver(dir) }).js;
        // A raster include is a singleton: hoisted to a module-scope const.
        assert.match(js, /const _single\d+ = new ImageBrush\(new BitmapImage\("data:image\/png;base64,/);
        assert.match(js, /\.Set\("Dot", _single\d+\)/);
        assert.match(js, /import \{[^}]*\} from "@pragmatic-tech-ai\/mural\/visual-engine"/);
        assert.ok(js.includes('BitmapImage') && js.includes('ImageBrush'));
    });

    test('an unsupported extension still throws a clear error', () => {
        const dir = fixtureDir();
        writeFileSync(join(dir, 'note.txt'), 'hi');
        assert.throws(
            () => compile(`resources I { include "note.txt" }`, { include: makeIncludeResolver(dir) }),
            /unsupported include type '\.txt'/);
    });
});
