/**
 * Test-runner preload (`--import`), loaded into the runner and into every
 * per-file test process it spawns.
 *
 * Each test file runs in a child process that streams its results to the
 * runner over stdout. `--test-force-exit` (needed because render tests leak
 * timers / animation-frame handles) ends that child with `process.exit()` as
 * soon as its last test finishes. On Linux and macOS a pipe stdout is
 * asynchronous, so whatever is still buffered at that moment is dropped and
 * the runner never hears about the file's remaining suites: they vanish from
 * the totals without failing anything. On Windows pipes are already
 * synchronous, which is why the loss shows only on Linux CI.
 *
 * Making stdout and stderr blocking flushes every write before `exit`.
 */
export class BlockingStdio
{
    public static Apply(): void
    {
        for (const stream of [process.stdout, process.stderr])
        {
            (stream as unknown as BlockingStream)._handle?.setBlocking?.(true);
        }
    }
}

interface BlockingStream
{
    _handle?: { setBlocking?(blocking: boolean): void };
}

BlockingStdio.Apply();
