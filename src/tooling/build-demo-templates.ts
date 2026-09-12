#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, EmitError } from '../compiler/compile.js';
import { ParseError } from '../compiler/parser.js';
import { makeIncludeResolver } from './include-resolver.js';
import { makeGlyphResolver } from './font-glyph-geometry.js';

// Compiles every `.mu` file under the demo tree into a sibling
// `.mu.js` file. Run via `npm run build:demos` (chained into
// `npm run build`). Unlike control templates, demo `.mu.js` outputs
// are committed alongside their sources — the dev loop edits a `.mu`,
// re-runs the build, and the regenerated `.mu.js` is what gets diffed
// and shipped.

function discoverMuSources(root: string): string[]
{
    const out: string[] = [];
    const walk = (dir: string): void =>
    {
        for (const entry of readdirSync(dir))
        {
            // Skip the Electron app's package tree: node_modules is huge and out/
            // holds build output — neither has authorable `.mu` sources. (The demo
            // app now lives at the demo/ root alongside its own node_modules/out.)
            if (entry === 'node_modules' || entry === 'out') continue;
            const full = join(dir, entry);
            const st = statSync(full);
            if (st.isDirectory()) walk(full);
            else if (entry.endsWith('.mu')) out.push(full);
        }
    };
    walk(root);
    return out.sort();
}

export interface BuildOptions
{
    /** Directory tree to search for `.mu` files. */
    rootDir: string;
}

export function buildDemoTemplates(opts: BuildOptions): number
{
    const inputs = discoverMuSources(opts.rootDir);
    if (inputs.length === 0)
    {
        process.stdout.write('build-demo-templates: no .mu sources found\n');
        return 0;
    }
    for (const input of inputs)
    {
        const source  = readFileSync(input, 'utf8');
        // `include` / `glyphs` paths resolve relative to the .mu file's dir.
        const result  = compile(source, {
            include: makeIncludeResolver(dirname(input)),
            glyphs:  makeGlyphResolver(dirname(input)),
        });
        const outPath = input.replace(/\.mu$/, '.mu.js');
        writeFileSync(outPath, result.js, 'utf8');
        process.stdout.write(
            `${relative(process.cwd(), input)} → ${relative(process.cwd(), outPath)}\n`);
    }
    process.stdout.write(`build-demo-templates: compiled ${inputs.length} file(s)\n`);
    return 0;
}

if (process.argv[1] !== undefined
    && fileURLToPath(import.meta.url).replace(/\\/g, '/') ===
       process.argv[1].replace(/\\/g, '/'))
{
    const here        = fileURLToPath(import.meta.url);
    const projectRoot = join(dirname(here), '..', '..');
    const rootDir     = join(projectRoot, 'demo');
    try
    {
        process.exit(buildDemoTemplates({ rootDir }));
    }
    catch (err)
    {
        if (err instanceof ParseError || err instanceof EmitError)
        {
            process.stderr.write(`build-demo-templates: ${err.message}\n`);
            process.exit(2);
        }
        process.stderr.write(
            `build-demo-templates: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(3);
    }
}
