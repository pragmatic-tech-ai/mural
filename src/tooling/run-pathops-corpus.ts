// §19.8 — standalone runner for the regression corpus. Wraps the
// summary-style verifier and prints incremental progress so we can
// monitor large runs and isolate slow / hanging entries. Invoke
// with: `npx tsx src/tooling/run-pathops-corpus.ts`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Op, Simplify } from '../visual-engine/geometry/pathops/op-path-ops-op.js';
import { OpPath, OpFillType } from '../visual-engine/geometry/pathops/op-path.js';
import { SkPathOp } from '../visual-engine/geometry/pathops/op-segment.js';
import { buildOpPath } from '../visual-engine/geometry/pathops/tests/corpus-verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const OP_BY_SHORT: Record<string, SkPathOp> = {
    diff: SkPathOp.kDifference,
    sect: SkPathOp.kIntersect,
    intersect: SkPathOp.kIntersect,
    union: SkPathOp.kUnion,
    xor: SkPathOp.kXOR_SkPathOp,
    revdiff: SkPathOp.kReverseDifference,
};

function fillCode(s: string | undefined): OpFillType
{
    return s === 'evenodd' ? OpFillType.kEvenOdd : OpFillType.kWinding;
}

interface OpEntry { name: string; op: string; a: string; b: string; fillA?: string; fillB?: string; }
interface SimplifyEntry { name: string; p: string; fill?: string; }

function parseOpFile(p: string): OpEntry[]
{
    const text = fs.readFileSync(p, 'utf8');
    const out: OpEntry[] = [];
    const re = /\{ name: '([^']+)', op: '([^']+)', a: '([^']+)', b: '([^']+)'([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null)
    {
        const tail = m[5]!;
        const fillA = tail.match(/fillA: '(\w+)'/);
        const fillB = tail.match(/fillB: '(\w+)'/);
        out.push({
            name: m[1]!, op: m[2]!, a: m[3]!, b: m[4]!,
            ...(fillA ? { fillA: fillA[1]! } : {}),
            ...(fillB ? { fillB: fillB[1]! } : {}),
        });
    }
    return out;
}

function parseSimplifyFile(p: string): SimplifyEntry[]
{
    const text = fs.readFileSync(p, 'utf8');
    const out: SimplifyEntry[] = [];
    const re = /\{ name: '([^']+)', p: '([^']+)'([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null)
    {
        const tail = m[3]!;
        const fill = tail.match(/fill: '(\w+)'/);
        out.push({ name: m[1]!, p: m[2]!, ...(fill ? { fill: fill[1]! } : {}) });
    }
    return out;
}

function classify<T>(entries: T[], fn: (e: T) => string): { name: string; bucket: string; elapsed: number }[]
{
    const out: { name: string; bucket: string; elapsed: number }[] = [];
    let i = 0;
    for (const e of entries)
    {
        const name = (e as unknown as { name: string }).name;
        process.stdout.write(`  [${i}] ${name}\n`);
        const t0 = Date.now();
        let bucket: string;
        try
        {
            bucket = fn(e);
        }
        catch (err)
        {
            bucket = `THROW(${(err as Error).message.slice(0, 80)})`;
        }
        const elapsed = Date.now() - t0;
        out.push({ name, bucket, elapsed });
        i++;
    }
    return out;
}

function summarize(label: string, results: { name: string; bucket: string; elapsed: number }[]): void
{
    const counts = new Map<string, number>();
    const examples = new Map<string, string[]>();
    for (const r of results)
    {
        const key = r.bucket.startsWith('THROW(') ? 'THROW' : r.bucket;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!examples.has(key)) examples.set(key, []);
        const arr = examples.get(key)!;
        if (arr.length < 5) arr.push(r.name);
    }
    console.log(`\n=== ${label} (${results.length} total) ===`);
    const keys = Array.from(counts.keys()).sort((a, b) => (counts.get(b)! - counts.get(a)!));
    for (const k of keys)
    {
        const ex = examples.get(k)!;
        console.log(`  ${k.padEnd(28)} ${counts.get(k)!.toString().padStart(4)}  e.g. ${ex.slice(0, 5).join(', ')}`);
    }
    const slow = results.filter(r => r.elapsed > 1000).sort((a, b) => b.elapsed - a.elapsed);
    if (slow.length > 0)
    {
        console.log(`  slow entries (> 1s): ${slow.length}`);
        for (const s of slow.slice(0, 10)) console.log(`    ${s.elapsed.toString().padStart(6)}ms  ${s.name}  ${s.bucket}`);
    }
}

function classifyOp(e: OpEntry): string
{
    const a = buildOpPath(e.a, fillCode(e.fillA));
    const b = buildOpPath(e.b, fillCode(e.fillB));
    const result = new OpPath();
    const ok = Op(a, b, OP_BY_SHORT[e.op]!, result);
    if (!ok) return 'OK_RETURNED_FALSE';
    if (result.fCommands.length === 0) return 'OK_EMPTY_RESULT';
    return 'OK_NON_EMPTY';
}

function classifySimplify(e: SimplifyEntry): string
{
    const input = buildOpPath(e.p, fillCode(e.fill));
    const result = new OpPath();
    const ok = Simplify(input, result);
    if (!ok) return 'OK_RETURNED_FALSE';
    if (result.fCommands.length === 0) return 'OK_EMPTY_RESULT';
    return 'OK_NON_EMPTY';
}

function main(): void
{
    const opEntries = parseOpFile(path.join(ROOT, 'src', 'visual-engine', 'geometry', 'pathops', 'tests', 'corpus', 'op-corpus.test.ts'));
    const simplifyEntries = parseSimplifyFile(path.join(ROOT, 'src', 'visual-engine', 'geometry', 'pathops', 'tests', 'corpus', 'simplify-corpus.test.ts'));
    console.log(`parsed ${opEntries.length} op + ${simplifyEntries.length} simplify entries`);

    console.log(`\n>>> running ${opEntries.length} Op() entries`);
    const opStart = Date.now();
    const opRes = classify(opEntries, classifyOp);
    console.log(`  Op corpus done in ${Date.now() - opStart}ms`);
    summarize('Op corpus', opRes);

    console.log(`\n>>> running ${simplifyEntries.length} Simplify() entries`);
    const simpStart = Date.now();
    const sRes = classify(simplifyEntries, classifySimplify);
    console.log(`  Simplify corpus done in ${Date.now() - simpStart}ms`);
    summarize('Simplify corpus', sRes);
}

main();
