import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile, EmitError } from '../compile.js';
import type { GlyphResolver } from '../compiler.js';

// The `fonts { Family from "path" [Weight=…, Style=…] }` block registers
// font faces with the runtime FontManager and publishes one `@<family>`
// FontFamily resource per family. Unlike `glyphs`, it needs no injected
// resolver — registration is a pure code emit (the URL is fetched at
// runtime). A declared family is also resolvable by `glyphs @<family>`.

function emitted(src: string): string
{
    return compile(src).js;
}

describe('fonts — emit', () => {

    test('one entry → FontManager.Register + a FontFamily resource', () => {
        const js = emitted(`resources F { fonts { Inter from "../assets/Inter.ttf" } @m = #fff }`);
        assert.match(js,
            /FontManager\.Current\.Register\("Inter", \{ kind: FontSourceKind\.Url, url: FontManager\.ResolveSourceUrl\("\.\.\/assets\/Inter\.ttf", import\.meta\.url\) \}\);/);
        assert.match(js, /\.Set\("Inter", new FontFamily\("Inter"\)\)/);
        assert.match(js,
            /import \{[^}]*\bFontManager\b[^}]*\bFontSourceKind\b[^}]*\} from "@pragmatic-tech-ai\/mural\/visual-engine"/);
    });

    test('Weight / Style attributes lower to enum members in the options', () => {
        const js = emitted(`resources F {
            fonts {
                Inter from "a.ttf"
                Inter from "b.ttf" [Weight=Bold]
                Inter from "c.ttf" [Style=Italic]
                Inter from "d.ttf" [Weight=Medium, Style=Italic]
            }
            @m = #fff
        }`);
        assert.match(js, /Register\("Inter", \{[^}]+\}\);/);                       // no opts (a.ttf)
        assert.match(js, /Register\("Inter", \{[^}]+\}, \{ weight: FontWeight\.Bold \}\)/);
        assert.match(js, /Register\("Inter", \{[^}]+\}, \{ style: FontStyle\.Italic \}\)/);
        assert.match(js, /Register\("Inter", \{[^}]+\}, \{ weight: FontWeight\.Medium, style: FontStyle\.Italic \}\)/);
    });

    test('the FontFamily resource is published once per family, not per face', () => {
        const js = emitted(`resources F {
            fonts { Inter from "a.ttf"  Inter from "b.ttf" [Weight=Bold] }
            @m = #fff
        }`);
        const sets = [...js.matchAll(/\.Set\("Inter", new FontFamily\("Inter"\)\)/g)];
        assert.equal(sets.length, 1);
    });

    test('an absolute URL is registered verbatim', () => {
        const js = emitted(`resources F { fonts { Roboto from "https://x/Roboto.ttf" } @m = #fff }`);
        assert.match(js, /FontManager\.ResolveSourceUrl\("https:\/\/x\/Roboto\.ttf", import\.meta\.url\)/);
    });

    test('an unknown attribute is a clear error', () => {
        assert.throws(
            () => emitted(`resources F { fonts { Inter from "a.ttf" [Slant=Oblique] } }`),
            (e: unknown) => /unknown attribute 'Slant'/.test((e as Error).message),
        );
    });

    test('a non-member Weight is rejected', () => {
        assert.throws(
            () => emitted(`resources F { fonts { Inter from "a.ttf" [Weight=Heavy] } }`),
            (e: unknown) => e instanceof EmitError && /Weight=Heavy is not a FontWeight member/.test((e as Error).message),
        );
    });
});

describe('fonts + glyphs unification', () => {

    // Stub glyph resolver — records the font path it was handed.
    let glyphFont: string | undefined;
    const glyphStub: GlyphResolver = (font, entries) => {
        glyphFont = font;
        return {
            entries: entries.map(e => ({ key: e.key, valueJs: 'new PathGeometry([])' })),
            imports: [{ module: '@pragmatic-tech-ai/mural/visual-engine', names: ['PathGeometry'] }],
        };
    };

    test('`glyphs @Family` resolves the font path from a preceding fonts block', () => {
        glyphFont = undefined;
        const js = compile(
            `resources I { fonts { Symbols from "../assets/sym.ttf" } glyphs @Symbols { home star } }`,
            { glyphs: glyphStub },
        ).js;
        assert.equal(glyphFont, '../assets/sym.ttf');
        assert.match(js, /\.Set\("home", new PathGeometry/);
        assert.match(js, /\.Set\("Symbols", new FontFamily\("Symbols"\)\)/);
    });

    test('`glyphs @Family` with no matching fonts block is an error', () => {
        assert.throws(
            () => compile(`resources I { glyphs @Nope { home } }`, { glyphs: glyphStub }),
            (e: unknown) => e instanceof EmitError && /no font family 'Nope' is declared/.test((e as Error).message),
        );
    });

    test('a literal-path glyphs block still works alongside the new form', () => {
        glyphFont = undefined;
        compile(`resources I { glyphs "fonts/icons.ttf" { home } }`, { glyphs: glyphStub });
        assert.equal(glyphFont, 'fonts/icons.ttf');
    });
});
