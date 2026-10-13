import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { IServiceProvider } from '../../../runtime/index.js';
import type { IDocument } from '../services/documents-content-host-service.js';
import { SaveOnCloseGuard } from '../services/save-on-close-guard.js';
import { SavePromptResult, type promptSave } from '../services/save-prompt.js';

class FakeDocument implements IDocument
{
    public SaveCalls = 0;
    public constructor(
        public readonly Id: string,
        public readonly IsDirty: boolean,
        private readonly failSave = false)
    {
    }
    public get Title(): string { return this.Id; }
    public Save(): void
    {
        this.SaveCalls++;
        if (this.failSave) throw new Error('save failed');
    }
}

class Harness
{
    public PromptCalls = 0;
    public readonly Guard: SaveOnCloseGuard;
    public constructor(private readonly script: SavePromptResult[])
    {
        const fake = (async () => { this.PromptCalls++; return this.script.shift()!; }) as unknown as typeof promptSave;
        const provider = { get: () => undefined } as unknown as IServiceProvider;
        this.Guard = new SaveOnCloseGuard(provider, fake);
    }
}

describe('SaveOnCloseGuard', () =>
{
    test('clean document closes without prompting or saving', async () =>
    {
        const h = new Harness([]);
        const doc = new FakeDocument('a', false);
        assert.equal(await h.Guard.TryClose(doc), true);
        assert.equal(h.PromptCalls, 0);
        assert.equal(doc.SaveCalls, 0);
    });

    test('dirty + Save saves and approves', async () =>
    {
        const h = new Harness([SavePromptResult.Save]);
        const doc = new FakeDocument('a', true);
        assert.equal(await h.Guard.TryClose(doc), true);
        assert.equal(doc.SaveCalls, 1);
    });

    test('dirty + DontSave approves without saving', async () =>
    {
        const h = new Harness([SavePromptResult.DontSave]);
        const doc = new FakeDocument('a', true);
        assert.equal(await h.Guard.TryClose(doc), true);
        assert.equal(doc.SaveCalls, 0);
    });

    test('dirty + Cancel vetoes without saving', async () =>
    {
        const h = new Harness([SavePromptResult.Cancel]);
        const doc = new FakeDocument('a', true);
        assert.equal(await h.Guard.TryClose(doc), false);
        assert.equal(doc.SaveCalls, 0);
    });

    test('Save that throws vetoes', async () =>
    {
        const h = new Harness([SavePromptResult.Save]);
        const doc = new FakeDocument('a', true, true);
        assert.equal(await h.Guard.TryClose(doc), false);
        assert.equal(doc.SaveCalls, 1);
    });

    test('TryCloseAll aborts on first Cancel', async () =>
    {
        const h = new Harness([SavePromptResult.Cancel, SavePromptResult.Save]);
        const a = new FakeDocument('a', true);
        const b = new FakeDocument('b', true);
        assert.equal(await h.Guard.TryCloseAll([a, b]), false);
        assert.equal(h.PromptCalls, 1);
        assert.equal(b.SaveCalls, 0);
    });
});
