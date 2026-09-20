// §19.8 — translate Skia's PathOps regression-test corpus into TS
// stubs that route through `corpus-verifier`. One-shot tool: run via
// `npx tsx src/tooling/port-pathops-corpus.ts`; the output lives at
// `src/visual-engine/geometry/pathops/tests/corpus/*.test.ts`.
//
// Strategy: regex-scan the C++ source, recognise tests that build
// SkPath instances from `setFillType / moveTo / lineTo / quadTo /
// cubicTo / close` and terminate in `testPathOp / testSimplify /
// testPathOpFail / testPathOpFuzz / testSimplifyFail / testSimplifyFuzz`.
// Lower each builder sequence into the compact path-string DSL
// understood by `corpus-verifier.buildOpPath`. Skip any function
// that uses an unsupported method (`conicTo`, `addRect`, `addCircle`,
// `addPath`, `arcTo`, `setIsVolatile`, …) — those need a richer
// builder than the v1 corpus targets. The skipped count is included
// in the generated header so we can track recovery.
//
// `SkBits2Float(0xHHHH)` literals (used heavily inside conicTo and
// in a handful of cubicTo entries) get decoded via DataView — the
// same bit-pattern reinterpretation the SkBits2Float macro performs
// in the original source.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..', '..');
const SKIA_DIR = path.join(ROOT, 'third_party', 'skia', 'tests');
const OUT_DIR  = path.join(ROOT, 'src', 'visual-engine', 'geometry', 'pathops', 'tests', 'corpus');

// ── Sources ──────────────────────────────────────────────────────

const SOURCES = [
    { src: 'PathOpsOpTest.cpp',       out: 'op-corpus.test.ts',       kind: 'op' as const },
    { src: 'PathOpsSimplifyTest.cpp', out: 'simplify-corpus.test.ts', kind: 'simplify' as const },
];

// ── Lexer helpers ────────────────────────────────────────────────

function decodeSkBits2Float(hex: string): number
{
    const u32 = parseInt(hex, 16);
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, u32, false);
    return new DataView(buf).getFloat32(0, false);
}

const SK_BITS_RE = /SkBits2Float\s*\(\s*0x([0-9a-fA-F]+)[^)]*\)/g;

function resolveSkBits(s: string): string
{
    return s.replace(SK_BITS_RE, (_full, hex) => {
        const f = decodeSkBits2Float(hex);
        return Number.isFinite(f) ? String(f) : 'NaN';
    });
}

// Strip C++ comments — both `// ...` to end-of-line and `/* ... */`.
function stripComments(s: string): string
{
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Find the body of a static-void function starting at `start`. The
// body opens at `{` and closes at the matching `}`. Returns
// [openIdx, closeIdx, body) where body is the substring BETWEEN the
// braces (exclusive). Returns undefined if no matching close brace is
// found.
function extractBody(src: string, start: number): { open: number; close: number; body: string } | undefined
{
    const open = src.indexOf('{', start);
    if (open === -1) return undefined;
    let depth = 1;
    let i = open + 1;
    while (i < src.length && depth > 0)
    {
        const c = src[i]!;
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
    }
    if (depth !== 0) return undefined;
    return { open, close: i - 1, body: src.substring(open + 1, i - 1) };
}

// ── Builder lowering ─────────────────────────────────────────────

interface PathBuilder { name: string; fill: 'winding' | 'evenodd'; tokens: string[]; }

const FILL_RE = /(\w+)\.setFillType\s*\(\s*SkPathFillType::k(Winding|EvenOdd)/g;
const MOVE_RE = /(\w+)\.moveTo\s*\(([^)]+)\)/g;
const LINE_RE = /(\w+)\.lineTo\s*\(([^)]+)\)/g;
const QUAD_RE = /(\w+)\.quadTo\s*\(([^)]+)\)/g;
const CUBE_RE = /(\w+)\.cubicTo\s*\(([^)]+)\)/g;
const CLOSE_RE = /(\w+)\.close\s*\(\s*\)/g;

// Unsupported builder calls — presence of any of these in the body
// kills the test for this v1 port.
const UNSUPPORTED_RE = /\.(conicTo|addRect|addCircle|addOval|addPath|addRoundRect|arcTo|setIsVolatile|setLastPt|reverseAddPath|rArcTo|rMoveTo|rLineTo|rQuadTo|rCubicTo|rConicTo|setPath)\b|path_edit\s*\(|reverseAddPath\b/;

interface Issued { idx: number; tag: string; bx: string; }

function parseNums(s: string, expected: number): number[] | undefined
{
    const resolved = resolveSkBits(s);
    const parts = resolved.split(',').map(t => t.trim()).filter(t => t.length > 0);
    if (parts.length !== expected) return undefined;
    const out: number[] = [];
    for (const p of parts)
    {
        // Strip trailing `f` (float suffix) and any `(float)` cast.
        const m = p.replace(/\(\s*float\s*\)\s*/g, '').replace(/f$/, '').trim();
        const n = Number(m);
        if (!Number.isFinite(n)) return undefined;
        out.push(n);
    }
    return out;
}

function fmt(n: number): string
{
    if (n === 0) return '0';
    if (Number.isInteger(n) && Math.abs(n) < 1e9) return String(n);
    return String(+n.toFixed(6));
}

// Walk a function body and collect path-string DSLs per builder name.
// Returns a map name → { fill, tokens } or undefined if the body uses
// any unsupported method.
function collectBuilders(body: string): Map<string, PathBuilder> | undefined
{
    if (UNSUPPORTED_RE.test(body)) return undefined;

    const builders = new Map<string, PathBuilder>();
    const ensure = (name: string): PathBuilder => {
        let b = builders.get(name);
        if (b === undefined)
        {
            b = { name, fill: 'winding', tokens: [] };
            builders.set(name, b);
        }
        return b;
    };

    // We walk the body in source order so the DSL emits each verb
    // exactly once and in the right sequence. The regexes above are
    // exhaustive — we run all of them and sort the hits by index.

    const issued: Issued[] = [];
    const pushIssue = (re: RegExp, fn: (m: RegExpExecArray) => Issued | undefined): void => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body)) !== null)
        {
            const it = fn(m);
            if (it === undefined)
            {
                // Malformed match — fail the whole function.
                throw new Error(`malformed match: ${m[0]}`);
            }
            issued.push(it);
        }
    };

    try
    {
        pushIssue(FILL_RE, (m) => ({ idx: m.index, tag: 'fill:' + m[1] + ':' + m[2], bx: m[1]! }));
        pushIssue(MOVE_RE, (m) => {
            const nums = parseNums(m[2]!, 2);
            if (!nums) return undefined;
            return { idx: m.index, tag: 'M ' + fmt(nums[0]!) + ' ' + fmt(nums[1]!), bx: m[1]! };
        });
        pushIssue(LINE_RE, (m) => {
            const nums = parseNums(m[2]!, 2);
            if (!nums) return undefined;
            return { idx: m.index, tag: 'L ' + fmt(nums[0]!) + ' ' + fmt(nums[1]!), bx: m[1]! };
        });
        pushIssue(QUAD_RE, (m) => {
            const nums = parseNums(m[2]!, 4);
            if (!nums) return undefined;
            return { idx: m.index, tag: 'Q ' + nums.map(fmt).join(' '), bx: m[1]! };
        });
        pushIssue(CUBE_RE, (m) => {
            const nums = parseNums(m[2]!, 6);
            if (!nums) return undefined;
            return { idx: m.index, tag: 'C ' + nums.map(fmt).join(' '), bx: m[1]! };
        });
        pushIssue(CLOSE_RE, (m) => ({ idx: m.index, tag: 'Z', bx: m[1]! }));
    }
    catch
    {
        return undefined;
    }

    issued.sort((a, b) => a.idx - b.idx);
    for (const it of issued)
    {
        const b = ensure(it.bx);
        if (it.tag.startsWith('fill:'))
        {
            b.fill = it.tag.endsWith(':EvenOdd') ? 'evenodd' : 'winding';
        }
        else
        {
            b.tokens.push(it.tag);
        }
    }
    return builders;
}

// ── Test extraction ──────────────────────────────────────────────

interface BinaryOpKind { kind: 'op' | 'fail'; opShort: string; }
interface UnaryOpKind  { kind: 'simplify' | 'simplify-fail'; }

const OP_NUMERIC_TO_SHORT = ['diff', 'sect', 'union', 'xor', 'revdiff'] as const;

function detectBinaryCall(body: string):
    { paths: [string, string]; op: BinaryOpKind } | undefined
{
    // Capture the entire arg list — testPathOp(reporter, A, B, OP, ...).
    const m = body.match(/test(PathOp|PathOpCheck|PathOpFail|PathOpFuzz)\s*\(([^)]*)\)/);
    if (!m) return undefined;
    const helper = m[1]!;
    const args = m[2]!.split(',').map(s => s.trim());
    if (args.length < 4) return undefined;
    const pathA = args[1]!;
    const pathB = args[2]!;
    const opTok = args[3]!;
    let opShort: string | undefined;
    const named = /k(Difference|Intersect|Union|XOR|ReverseDifference)_SkPathOp/.exec(opTok);
    if (named)
    {
        opShort =
            named[1] === 'Difference'        ? 'diff' :
            named[1] === 'Intersect'         ? 'sect' :
            named[1] === 'Union'             ? 'union' :
            named[1] === 'XOR'               ? 'xor' :
            'revdiff';
    }
    else
    {
        const numeric = /\(\s*SkPathOp\s*\)\s*(\d+)/.exec(opTok);
        if (numeric)
        {
            const n = Number(numeric[1]);
            if (n >= 0 && n <= 4) opShort = OP_NUMERIC_TO_SHORT[n]!;
        }
    }
    if (!opShort) return undefined;
    const kind: BinaryOpKind['kind'] =
        helper === 'PathOpFail' || helper === 'PathOpFuzz' ? 'fail' : 'op';
    return { paths: [pathA, pathB], op: { kind, opShort } };
}

function detectUnaryCall(body: string):
    { p: string; op: UnaryOpKind } | undefined
{
    const m = body.match(/test(Simplify|SimplifyCheck|SimplifyFail|SimplifyFuzz)\s*\(([^)]*)\)/);
    if (!m) return undefined;
    const helper = m[1]!;
    const args = m[2]!.split(',').map(s => s.trim());
    if (args.length < 2) return undefined;
    const p = args[1]!;
    const kind: UnaryOpKind['kind'] =
        helper === 'SimplifyFail' || helper === 'SimplifyFuzz' ? 'simplify-fail' : 'simplify';
    return { p, op: { kind } };
}

// ── File processing ──────────────────────────────────────────────

interface OpEntry { name: string; op: string; a: string; b: string; fillA?: string; fillB?: string; }
interface SimplifyEntry { name: string; p: string; fill?: string; }

interface Buckets
{
    opOk: OpEntry[];
    opFail: OpEntry[];
    simplifyOk: SimplifyEntry[];
    simplifyFail: SimplifyEntry[];
    skipped: number;
    total: number;
}

const FN_RE = /static\s+void\s+(\w+)\s*\(\s*skiatest::Reporter\s*\*\s*\w+\s*,\s*const\s+char\s*\*\s*\w+\s*\)/g;

function processFile(srcPath: string, kind: 'op' | 'simplify'): Buckets
{
    const raw = fs.readFileSync(srcPath, 'utf8');
    const src = stripComments(raw);
    const out: Buckets = {
        opOk: [], opFail: [], simplifyOk: [], simplifyFail: [], skipped: 0, total: 0,
    };
    FN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FN_RE.exec(src)) !== null)
    {
        out.total++;
        const name = m[1]!;
        const body = extractBody(src, m.index + m[0].length);
        if (!body) { out.skipped++; continue; }

        const builders = collectBuilders(body.body);
        if (!builders) { out.skipped++; continue; }

        if (kind === 'op')
        {
            const call = detectBinaryCall(body.body);
            if (!call) { out.skipped++; continue; }
            const ba = builders.get(call.paths[0]);
            const bb = builders.get(call.paths[1]);
            if (!ba || !bb || ba.tokens.length === 0 || bb.tokens.length === 0)
            {
                out.skipped++; continue;
            }
            const entry: OpEntry = {
                name,
                op: call.op.opShort,
                a: ba.tokens.join(' '),
                b: bb.tokens.join(' '),
            };
            if (ba.fill === 'evenodd') entry.fillA = 'evenodd';
            if (bb.fill === 'evenodd') entry.fillB = 'evenodd';
            if (call.op.kind === 'fail') out.opFail.push(entry);
            else out.opOk.push(entry);
        }
        else
        {
            const call = detectUnaryCall(body.body);
            if (!call) { out.skipped++; continue; }
            const bp = builders.get(call.p);
            if (!bp || bp.tokens.length === 0) { out.skipped++; continue; }
            const entry: SimplifyEntry = { name, p: bp.tokens.join(' ') };
            if (bp.fill === 'evenodd') entry.fill = 'evenodd';
            if (call.op.kind === 'simplify-fail') out.simplifyFail.push(entry);
            else out.simplifyOk.push(entry);
        }
    }
    return out;
}

// ── Emit ─────────────────────────────────────────────────────────

function escapeString(s: string): string
{
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function emitOpEntries(entries: OpEntry[]): string
{
    return entries.map(e => {
        const extra = (e.fillA ? `, fillA: '${e.fillA}'` : '')
                    + (e.fillB ? `, fillB: '${e.fillB}'` : '');
        return `    { name: '${escapeString(e.name)}', op: '${e.op}', a: '${escapeString(e.a)}', b: '${escapeString(e.b)}'${extra} },`;
    }).join('\n');
}

function emitSimplifyEntries(entries: SimplifyEntry[]): string
{
    return entries.map(e => {
        const extra = e.fill ? `, fill: '${e.fill}'` : '';
        return `    { name: '${escapeString(e.name)}', p: '${escapeString(e.p)}'${extra} },`;
    }).join('\n');
}

function emitOpFile(b: Buckets, srcName: string): string
{
    const header
        = `// AUTO-GENERATED — do not edit by hand.\n`
        + `// Source: third_party/skia/tests/${srcName}\n`
        + `// Translated by src/tooling/port-pathops-corpus.ts.\n`
        + `// Ported: ${b.opOk.length + b.opFail.length} / ${b.total} (${b.skipped} skipped — unsupported builders).\n`
        + `//\n`
        + `// "Ok" entries route through runOpCorpus (Contains-probe + robustness).\n`
        + `// "Fail" entries route through runOpCorpusFail (robustness only — Skia\n`
        + `// historically saw Op() bail out on these adversarial inputs).\n\n`
        + `import { runOpCorpus, runOpCorpusFail } from '../corpus-verifier.js';\n\n`;
    const okSection = b.opOk.length > 0
        ? `runOpCorpus('${srcName}', [\n${emitOpEntries(b.opOk)}\n]);\n\n`
        : '';
    const failSection = b.opFail.length > 0
        ? `runOpCorpusFail('${srcName}', [\n${emitOpEntries(b.opFail)}\n]);\n`
        : '';
    return header + okSection + failSection;
}

function emitSimplifyFile(b: Buckets, srcName: string): string
{
    const header
        = `// AUTO-GENERATED — do not edit by hand.\n`
        + `// Source: third_party/skia/tests/${srcName}\n`
        + `// Translated by src/tooling/port-pathops-corpus.ts.\n`
        + `// Ported: ${b.simplifyOk.length + b.simplifyFail.length} / ${b.total} (${b.skipped} skipped — unsupported builders).\n\n`
        + `import { runSimplifyCorpus, runSimplifyCorpusFail } from '../corpus-verifier.js';\n\n`;
    const okSection = b.simplifyOk.length > 0
        ? `runSimplifyCorpus('${srcName}', [\n${emitSimplifyEntries(b.simplifyOk)}\n]);\n\n`
        : '';
    const failSection = b.simplifyFail.length > 0
        ? `runSimplifyCorpusFail('${srcName}', [\n${emitSimplifyEntries(b.simplifyFail)}\n]);\n`
        : '';
    return header + okSection + failSection;
}

// ── Driver ───────────────────────────────────────────────────────

function main(): void
{
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const cfg of SOURCES)
    {
        const srcPath = path.join(SKIA_DIR, cfg.src);
        if (!fs.existsSync(srcPath))
        {
            console.warn(`[port-pathops-corpus] skipping missing source ${cfg.src}`);
            continue;
        }
        const buckets = processFile(srcPath, cfg.kind);
        const text = cfg.kind === 'op'
            ? emitOpFile(buckets, cfg.src)
            : emitSimplifyFile(buckets, cfg.src);
        const outPath = path.join(OUT_DIR, cfg.out);
        fs.writeFileSync(outPath, text, 'utf8');
        const ported = cfg.kind === 'op'
            ? buckets.opOk.length + buckets.opFail.length
            : buckets.simplifyOk.length + buckets.simplifyFail.length;
        console.log(`[port-pathops-corpus] ${cfg.src}: ${ported} / ${buckets.total} ported (${buckets.skipped} skipped) → ${path.relative(ROOT, outPath)}`);
    }
}

main();
