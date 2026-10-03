#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, EmitError, type CompileResult } from '../compiler/compile.js';
import { ParseError } from '../compiler/parser.js';
import { DEFAULT_SLOT_INFO, type SlotInfo } from '../compiler/symbol-table.js';
import { makeIncludeResolver } from './include-resolver.js';
import { makeGlyphResolver } from './font-glyph-geometry.js';

// Compiles every `*.mu` file under the framework source trees
// (src/resources, src/basic, src/framework) into a matching
// `build/<tree>/<name>.{js,d.ts}`. Run via `npm run build:templates`.
// The generated files are NOT in `src/` (they're build artifacts) and
// are gitignored under `build/`.
//
// Why the public symbol table works as-is now: each control file's
// internal helpers (`ClickableBorder`, `ComboBoxPopupHost`, …) are
// re-exported from the `mural/basic` barrel, so
// the package's `DEFAULT_SYMBOLS` already resolves them. The build
// script uses the DEFAULT map straight through and lets the compiled
// `.mu.js` emit imports against the package self-reference — exactly
// the same shape consumers' compiled `.mu.js` files use. Both the
// build outputs and the consumer outputs resolve to `dist/basic/`
// at load time via the package's `exports` field.

// Default slot info for the internal helper classes — same shape the
// build script always used, just lifted here so the compiler knows
// how to attach children to a template body that names them.
const INTERNAL_SLOTS: ReadonlyArray<readonly [string, SlotInfo]> = [
    ['ClickableBorder',       { name: 'Child',    kind: 'single' }],
    ['ClickAwayScrim',        { name: 'Child',    kind: 'single' }],
    ['SplitRow',              { name: 'Children', kind: 'list'   }],
    ['ComboBoxPopupHost',     { name: 'Children', kind: 'list'   }],
    ['ScrimSurface',          { name: 'Child',    kind: 'single' }],
    ['TemporaryOverlayHost',  { name: 'Children', kind: 'list'   }],
    ['ClickableRow',          { name: 'Child',    kind: 'single' }],
    ['ChevronTarget',         { name: 'Child',    kind: 'single' }],
    ['CollapsibleStack',      { name: 'Children', kind: 'list'   }],
    ['ScrollBarLayout',       { name: 'Children', kind: 'list'   }],
];

function buildSlotInfo(): Map<string, SlotInfo>
{
    const out = new Map<string, SlotInfo>(DEFAULT_SLOT_INFO);
    for (const [name, info] of INTERNAL_SLOTS) out.set(name, info);
    return out;
}

// Non-`.mu` runtime assets that a compiled `.mu.js` loads at runtime — today
// the Pragmatic theme's font files (typography.mu.js emits
// `new URL("./fonts/<file>.woff2", import.meta.url)`, which resolves relative
// to the file's location under `build/`). The template compiler only writes
// `.mu.js`/`.d.ts`, so without copying these the fonts exist only under `src/`
// and every consumer's bundler resolves the URL to a missing file → the app
// boots with a wall of 404s and falls back to a system font. Mirror them into
// `build/` next to the module that references them. `.txt` carries the OFL
// font licenses that must ship beside the fonts.
const ASSET_EXTENSIONS: ReadonlyArray<string> = ['.woff2', '.woff', '.ttf', '.otf', '.txt'];

function copyResourceAssets(sourceDir: string, outDir: string): number
{
    let copied = 0;
    const walk = (d: string): void =>
    {
        for (const entry of readdirSync(d, { withFileTypes: true }))
        {
            const full = join(d, entry.name);
            if (entry.isDirectory())
            {
                if (entry.name === 'tests') continue;
                walk(full);
            }
            else if (ASSET_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
            {
                const outPath = join(outDir, relative(sourceDir, full));
                mkdirSync(dirname(outPath), { recursive: true });
                copyFileSync(full, outPath);
                copied++;
            }
        }
    };
    walk(sourceDir);
    return copied;
}

function discoverTemplateSources(dir: string): string[]
{
    const out: string[] = [];
    const walk = (d: string): void =>
    {
        for (const entry of readdirSync(d, { withFileTypes: true }))
        {
            const full = join(d, entry.name);
            if (entry.isDirectory())
            {
                // Skip test folders — templates aren't compiled out of them.
                if (entry.name === 'tests') continue;
                walk(full);
            }
            else if (entry.name.endsWith('.mu'))
            {
                // Discovery is scoped to framework source trees
                // (src/basic, src/framework); any `.mu` file here is
                // build-pipeline-owned — control templates
                // (`*.template.mu`) and token dictionaries
                // (`material/*.mu`) alike.
                out.push(full);
            }
        }
    };
    walk(dir);
    return out.sort();
}

export interface BuildOptions
{
    /** Where to read `*.template.mu` source files from. */
    sourceDir: string;
    /** Where to write the matching `*.template.mu.{js,d.ts}` outputs. */
    outDir:    string;
}

// Format the companion `.d.ts` for a compiled `.mu` file.
//   * `kind === 'resources'`  — one `export class NAME extends
//                               ResourceDictionary` per block, with
//                               `Clone(): NAME` plus typed
//                               getter/setter pairs for each
//                               `x:name`'d resource. Auxiliary type
//                               imports are collected from the
//                               accessor metadata.
//   * Legacy `'fragment'`     — historic `function create():
//                               ResourceDictionary` shape.
//   * `'application'`         — `const app: Application` shape.
function formatDts(out: CompileResult): string
{
    if (out.kind === 'resources')
    {
        const blocks      = out.resourcesBlocks ?? [];
        const themeNames  = new Set(out.themeNames  ?? []);
        const schemeNames = out.schemeNames ?? [];
        // Collect type symbols referenced by accessors so the `.d.ts`
        // can import them. Group by source module via the same
        // imports map the `.mu.js` uses — the build pipeline already
        // resolved each symbol to its bundle, so we can reuse it here.
        const accessorTypes = new Set<string>();
        for (const b of blocks)
        {
            for (const a of b.accessors) accessorTypes.add(a.type);
        }
        // Map each symbol → source module. The body's `out.imports`
        // contains module → set; invert it for lookup.
        const symbolToModule = new Map<string, string>();
        for (const [mod, syms] of out.imports)
        {
            for (const s of syms) symbolToModule.set(s, mod);
        }
        // Build the import header: ResourceDictionary always; plus
        // each accessor type (only if the symbol came from a known
        // module — otherwise fall back to `unknown` at use site).
        const importsByModule = new Map<string, Set<string>>();
        const ensureType = (sym: string, mod: string): void =>
        {
            let s = importsByModule.get(mod);
            if (s === undefined) { s = new Set(); importsByModule.set(mod, s); }
            s.add(sym);
        };
        ensureType('ResourceDictionary', '@pragmatic-tech-ai/mural/runtime');
        if (themeNames.size > 0)
        {
            ensureType('TokenCatalog', '@pragmatic-tech-ai/mural/runtime');
            ensureType('Theme', '@pragmatic-tech-ai/mural/runtime');
        }
        if (schemeNames.length > 0)
        {
            ensureType('Scheme', '@pragmatic-tech-ai/mural/runtime');
        }
        for (const t of accessorTypes)
        {
            const mod = symbolToModule.get(t);
            if (mod !== undefined) ensureType(t, mod);
        }
        // Also import any block-import classes — accessor types may
        // reference them in the future; for now they appear in the
        // .mu.js but not the .d.ts (block imports are runtime concerns).
        const headerLines: string[] = [];
        const sortedModules = [...importsByModule.keys()].sort();
        for (const mod of sortedModules)
        {
            const syms = [...importsByModule.get(mod)!].sort().join(', ');
            headerLines.push(`import type { ${syms} } from ${JSON.stringify(mod)};`);
        }
        const declarations: string[] = [];
        for (const b of blocks)
        {
            // Theme blocks emit a class extending Theme (with
            // statics + Activate); the body resources dictionary lives
            // alongside as `${name}Resources`. Skip the dictionary
            // declaration here — emit the Theme class itself further
            // below, after catalogs.
            if (themeNames.has(b.name)) continue;

            const lines: string[] = [];
            lines.push(`export declare class ${b.name} extends ResourceDictionary {`);
            lines.push(`    static Clone(): ${b.name};`);
            for (const a of b.accessors)
            {
                const t = symbolToModule.has(a.type) ? a.type : 'unknown';
                lines.push(`    ${a.name}: ${t};`);
            }
            lines.push(`}`);
            declarations.push(lines.join('\n'));
        }
        // Theme catalogs — one sibling const per `theme NAME { … }` block.
        for (const name of themeNames)
        {
            declarations.push(`export declare const ${name}Catalog: TokenCatalog;`);
        }
        // Theme classes — one per `theme NAME { … }` block. The
        // emitted JS carries a sibling `${name}Resources` resource
        // dictionary plus the `${name}Catalog` constant and a
        // self-registering side effect for ThemeManager / Application.
        // The .d.ts captures the public surface only.
        for (const name of themeNames)
        {
            const resourcesBlock = blocks.find(b => b.name === name);
            if (resourcesBlock !== undefined)
            {
                const lines: string[] = [];
                lines.push(`export declare class ${name}Resources extends ResourceDictionary {`);
                lines.push(`    static Clone(): ${name}Resources;`);
                for (const a of resourcesBlock.accessors)
                {
                    const t = symbolToModule.has(a.type) ? a.type : 'unknown';
                    lines.push(`    ${a.name}: ${t};`);
                }
                lines.push(`}`);
                declarations.push(lines.join('\n'));
            }
            const themeClass: string[] = [];
            themeClass.push(`export declare class ${name} extends Theme {`);
            themeClass.push(`    static readonly Catalog: TokenCatalog;`);
            themeClass.push(`    static readonly DefaultScheme: typeof Scheme;`);
            themeClass.push(`    static readonly instance: ${name};`);
            themeClass.push(`    static Activate(scheme?: typeof Scheme): void;`);
            themeClass.push(`}`);
            declarations.push(themeClass.join('\n'));
        }
        // Scheme classes — one per `scheme NAME against … { … }` block.
        for (const name of schemeNames)
        {
            const lines: string[] = [];
            lines.push(`export declare class ${name} extends Scheme {`);
            lines.push(`    static readonly instance: ${name};`);
            lines.push(`}`);
            declarations.push(lines.join('\n'));
        }
        return headerLines.join('\n') + '\n\n' + declarations.join('\n\n') + '\n';
    }
    if (out.kind === 'application')
    {
        return (
            `import type { Application } from '@pragmatic-tech-ai/mural/runtime';\n` +
            `export declare const app: Application;\n`
        );
    }
    // Fragment / legacy ResourceDictionary root.
    return (
        `import type { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime';\n` +
        `export function create(): ResourceDictionary;\n`
    );
}

export function buildControlTemplates(opts: BuildOptions): number
{
    const slots  = buildSlotInfo();
    const inputs = discoverTemplateSources(opts.sourceDir);
    // Copy runtime assets (fonts + licenses) first — a tree can ship assets
    // even with no `.mu` of its own, and copyResourceAssets creates only the
    // directories it actually writes into, so a truly empty tree stays empty.
    const assets = copyResourceAssets(opts.sourceDir, opts.outDir);
    if (assets > 0)
    {
        process.stdout.write(
            `build-control-templates: copied ${assets} asset file(s) → ${relative(process.cwd(), opts.outDir)}\n`);
    }
    if (inputs.length === 0)
    {
        // Empty tree is a normal forward-compat outcome — the build
        // root walks src/basic and src/framework even though neither
        // ships a `.mu` file today (the call site comment explains why
        // the walk is kept). Stay silent so the build log only carries
        // entries for trees that produced output.
        return 0;
    }
    mkdirSync(opts.outDir, { recursive: true });
    for (const input of inputs)
    {
        const source = readFileSync(input, 'utf8');
        // No custom symbols map — the default symbol table already
        // points every basic class (including internal helpers) at
        // `mural/basic`. The emitted `.mu.js`
        // resolves that self-reference via the package's `exports`
        // field at load time, the same as any consumer template would.
        // `include` (SVG → Geometry) and `glyphs` (font outline →
        // Geometry) resolve relative to the .mu file's directory — same
        // wiring the demo build uses, so the framework's own root resource
        // dictionaries can carry shared shape geometries (e.g. chevrons).
        const out      = compile(source, {
            slots,
            include: makeIncludeResolver(dirname(input)),
            glyphs:  makeGlyphResolver(dirname(input)),
        });
        // Mirror the input's path under outDir so framework subfolders
        // (menu/, tool-bar/, …) keep their structure. `relative` strips
        // the sourceDir prefix; `dirname` carries the trailing
        // sub-directory chain.
        const rel      = relative(opts.sourceDir, input);
        const outPath  = join(opts.outDir, rel.replace(/\.mu$/, '.mu.js'));
        const dtsPath  = join(opts.outDir, rel.replace(/\.mu$/, '.mu.d.ts'));
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, out.js, 'utf8');
        // Companion `.d.ts`. Two shapes:
        //   * `resources NAME { … }` files (new model) — one declared
        //     class per block, plus a typed `Clone()` and one
        //     getter/setter pair per `x:name`'d resource.
        //   * Legacy `ResourceDictionary { … }` / fragment files — the
        //     historical `export function create(): ResourceDictionary`
        //     shape. (Both Application and bare fragments use this until
        //     they migrate.)
        writeFileSync(dtsPath, formatDts(out), 'utf8');
        process.stdout.write(
            `${relative(process.cwd(), input)} → ${relative(process.cwd(), outPath)} (+ .d.ts)\n`);
    }
    process.stdout.write(`build-control-templates: compiled ${inputs.length} file(s)\n`);
    return 0;
}

// Direct-invocation entry — `node dist/tooling/build-control-templates.js`
// after tsc, or `tsx src/tooling/build-control-templates.ts` during
// development. Both forms resolve the project root by walking up from
// the script location.
if (process.argv[1] !== undefined
    && fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
       process.argv[1].replace(/\\/g, '/'))
{
    // Script lives at <root>/(src|dist)/tooling/build-control-templates.{ts,js}.
    // Walk two levels up for the project root.
    const here        = fileURLToPath(import.meta.url);
    const projectRoot = join(dirname(here), '..', '..');
    // Three source trees:
    //   * src/resources — the theme bundles (basic.resources.mu,
    //                     framework.resources.mu, material/*.mu) and any
    //                     shared resource dicts. Compiled outputs go to
    //                     build/resources/.
    //   * src/basic     — primitive controls (no `.mu` files now that
    //                     basic.resources.mu moved into src/resources;
    //                     walk kept so authoring a control-local .mu still
    //                     works).
    //   * src/framework — composite controls (no .mu files now that
    //                     framework.resources.mu moved). Walked for the
    //                     same forward-compat reason.
    const trees: ReadonlyArray<readonly [string, string]> = [
        [join(projectRoot, 'src',   'resources'), join(projectRoot, 'build', 'resources')],
        [join(projectRoot, 'src',   'basic'),     join(projectRoot, 'build', 'basic')],
        [join(projectRoot, 'src',   'framework'), join(projectRoot, 'build', 'framework')],
    ];
    try
    {
        let total = 0;
        for (const [sourceDir, outDir] of trees)
        {
            total += buildControlTemplates({ sourceDir, outDir });
        }
        process.exit(total);
    }
    catch (err)
    {
        if (err instanceof ParseError || err instanceof EmitError)
        {
            process.stderr.write(`build-control-templates: ${err.message}\n`);
            process.exit(2);
        }
        process.stderr.write(
            `build-control-templates: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(3);
    }
}
