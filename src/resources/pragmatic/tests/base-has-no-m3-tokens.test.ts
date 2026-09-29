import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../material/material.js';
import '../pragmatic.js';
import { ThemeManager } from '../../../runtime/index.js';

// Completeness gate for the Phase-4 SP2 collapse. After Pragmatic became the
// framework base, no shared base template — the control templates under
// src/framework/** and the basic-control templates in
// src/resources/basic.resources.mu — may reference a Material token that
// Pragmatic does not also define. Were one to remain, it would resolve to
// nothing under the (now default) Pragmatic theme.
//
// The forbidden set is DERIVED, not hand-listed: it is the Material theme's
// own vocabulary (its token catalog plus every scheme's token map) minus the
// Pragmatic vocabulary — the same scheme-membership net the consumer guards
// use. It stays exhaustive as Material evolves and never flags a Pragmatic
// token. Migration comments in the base files deliberately name the old
// Material atoms ("// @Surface -> @Bg1"); those are documentation, not
// references, so each line's `//` comment is stripped before matching.
class BaseSchemeMembershipScan
{
    private static readonly MaterialThemeName = 'Material';
    private static readonly PragmaticThemeName = 'Pragmatic';
    private static readonly BasicResources = 'basic.resources.mu';

    // A theme's full token vocabulary: declared catalog plus every scheme's
    // token map (colours live on the schemes, scalars/type/shape on the catalog).
    public static Vocabulary(themeName: string): Set<string>
    {
        const theme = ThemeManager.GetTheme(themeName) as unknown as
            {
                catalog: ReadonlyMap<string, unknown>;
                schemes: ReadonlyMap<string, { tokens: ReadonlyMap<string, unknown> }>;
            } | undefined;
        const out = new Set<string>();
        if (theme === undefined) return out;
        for (const k of theme.catalog.keys()) out.add(k);
        for (const s of theme.schemes.values()) for (const k of s.tokens.keys()) out.add(k);
        return out;
    }

    // Material tokens Pragmatic does not define — what must not appear in the base.
    public static ForbiddenTokens(): Set<string>
    {
        const material = BaseSchemeMembershipScan.Vocabulary(BaseSchemeMembershipScan.MaterialThemeName);
        const pragmatic = BaseSchemeMembershipScan.Vocabulary(BaseSchemeMembershipScan.PragmaticThemeName);
        const out = new Set<string>();
        for (const t of material) if (!pragmatic.has(t)) out.add(t);
        return out;
    }

    // The @Name resource references on one .mu line, ignoring its `//` comment.
    public static MuRefs(line: string): string[]
    {
        const code = BaseSchemeMembershipScan.StripComment(line);
        const out: string[] = [];
        const re = /@([A-Za-z][A-Za-z0-9]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null)
        {
            const name = m[1];
            if (name !== undefined) out.push(name);
        }
        return out;
    }

    // The code portion of a .mu line: everything before the first `//`.
    public static StripComment(line: string): string
    {
        const i = line.indexOf('//');
        return i === -1 ? line : line.slice(0, i);
    }

    public static ScanMu(file: string, text: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        text.split('\n').forEach((line, i) =>
        {
            for (const tok of BaseSchemeMembershipScan.MuRefs(line))
                if (forbidden.has(tok))
                    hits.push(`${file}:${i + 1} @${tok} (Material token absent from Pragmatic)`);
        });
        return hits;
    }

    // The shared-base source roots. Every template that composes the base
    // dictionaries lives under one of these: the src/framework tree, the
    // src/basic tree (basic controls — TextBox/Slider/ScrollBar/Splitter
    // templates were relocated here in the SP2 collapse), and the single
    // basic-control dictionary basic.resources.mu. Resolved relative to
    // this test file.
    public static BaseRoots(fromUrl: string): { framework: string; basic: string; basicResources: string }
    {
        const here = dirname(fileURLToPath(fromUrl));         // src/resources/pragmatic/tests
        const src = dirname(dirname(dirname(here)));           // src
        return {
            framework: join(src, 'framework'),
            basic: join(src, 'basic'),
            basicResources: join(src, 'resources', BaseSchemeMembershipScan.BasicResources),
        };
    }

    public static Walk(dir: string, out: string[]): void
    {
        for (const name of readdirSync(dir))
        {
            if (name === 'node_modules' || name === 'dist' || name === 'tests') continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { BaseSchemeMembershipScan.Walk(p, out); continue; }
            if (p.endsWith('.mu')) out.push(p);
        }
    }

    // Every .mu file that composes the shared base: the framework tree, the
    // basic tree, and basic.resources.mu.
    public static ScannedFiles(fromUrl: string): string[]
    {
        const roots = BaseSchemeMembershipScan.BaseRoots(fromUrl);
        const files: string[] = [roots.basicResources];
        BaseSchemeMembershipScan.Walk(roots.framework, files);
        BaseSchemeMembershipScan.Walk(roots.basic, files);
        return files;
    }

    public static Offenders(fromUrl: string, forbidden: ReadonlySet<string>): string[]
    {
        const hits: string[] = [];
        for (const file of BaseSchemeMembershipScan.ScannedFiles(fromUrl))
        {
            const text = readFileSync(file, 'utf8');
            hits.push(...BaseSchemeMembershipScan.ScanMu(file, text, forbidden));
        }
        return hits;
    }
}

test('the forbidden set is derived from Material and excludes shared Pragmatic tokens', () =>
{
    const forbidden = BaseSchemeMembershipScan.ForbiddenTokens();
    assert.ok(forbidden.size > 0, 'forbidden derivation must be non-empty');
    assert.ok(forbidden.has('OnSurface'), 'a Material-only token is forbidden');
    assert.ok(!forbidden.has('Fg1'), 'a Pragmatic token is never forbidden');
});

test('MuRefs ignores tokens named inside a // comment', () =>
{
    const forbidden = new Set(['OnSurface']);
    const hits = BaseSchemeMembershipScan.ScanMu(
        'x.mu', 'a = @Bg1  // migrated from @OnSurface\nb = @OnSurface', forbidden);
    assert.equal(hits.length, 1, 'only the real reference on line 2 is flagged');
    assert.match(hits[0]!, /x\.mu:2 @OnSurface/);
});

test('the scan covers the basic-control templates relocated to src/basic', () =>
{
    // The SP2 collapse moved the TextBox / Slider / ScrollBar / Splitter
    // forks into src/basic; they compose the base (imported by
    // framework.resources.mu) so the gate must scan them too, or its
    // "no Material token in the base" invariant is silently false there.
    const scanned = BaseSchemeMembershipScan.ScannedFiles(import.meta.url).map(p => p.replace(/\\/g, '/'));
    for (const rel of ['basic/textbox.template.mu', 'basic/sliders.template.mu',
        'basic/splitter.template.mu', 'basic/scroll/scroll-bar.template.mu'])
    {
        assert.ok(scanned.some(p => p.endsWith(rel)), `scan must include ${rel}`);
    }
});

test('no shared base template references a Material token Pragmatic lacks', () =>
{
    const offenders = BaseSchemeMembershipScan.Offenders(
        import.meta.url, BaseSchemeMembershipScan.ForbiddenTokens());
    assert.deepEqual(offenders, [], `Material tokens remain in the base:\n${offenders.join('\n')}`);
});
