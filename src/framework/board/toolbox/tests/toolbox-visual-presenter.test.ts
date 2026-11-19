import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ServiceKey, Visual } from '../../../../runtime/index.js';
import { Border } from '../../../../basic/index.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { VisualContext, type IToolboxVisualResolver } from '../toolbox-visual-resolver.js';
import { ToolboxVisualPresenter } from '../toolbox-visual-presenter.js';

// A fake resolver: returns a placeholder Border until markReady(key), then
// returns a distinct "real" Border and fires changed.
class FakeResolver implements IToolboxVisualResolver
{
    private readonly listeners = new Set<(k: string) => void>();
    private readonly ready = new Set<string>();
    public readonly placeholder = new Border();
    public readonly real = new Border();
    Resolve(d: ToolboxVisualDescriptor, _c: VisualContext): Visual
    {
        return this.ready.has(d.Key) ? this.real : this.placeholder;
    }
    AddChangedListener(cb: (k: string) => void): void { this.listeners.add(cb); }
    RemoveChangedListener(cb: (k: string) => void): void { this.listeners.delete(cb); }
    markReady(key: string): void { this.ready.add(key); for (const l of [...this.listeners]) l(key); }
    get listenerCount(): number { return this.listeners.size; }
}

function withApp(): { app: Application; prior: Application | null }
{
    const prior = Application.current;
    const app = new Application();
    Application.current = app;
    return { app, prior };
}

test('presenter resolves to placeholder, then swaps to real on changed', () => {
    const { app, prior } = withApp();
    try
    {
        const resolverKey = new ServiceKey<IToolboxVisualResolver>('fake');
        const resolver = new FakeResolver();
        app.Services.registerInstance(resolverKey, resolver);

        const presenter = new ToolboxVisualPresenter();
        presenter.Context = VisualContext.Tile;
        presenter.Descriptor = new ToolboxVisualDescriptor(resolverKey, 'k1');
        (presenter as unknown as { _forceAttachedForTest(): void })._forceAttachedForTest();

        assert.equal(presenter.Content, resolver.placeholder);
        resolver.markReady('k1');
        assert.equal(presenter.Content, resolver.real);
    }
    finally
    {
        Application.current = prior;
    }
});

test('presenter unsubscribes on detach (no leak)', () => {
    const { app, prior } = withApp();
    try
    {
        const resolverKey = new ServiceKey<IToolboxVisualResolver>('fake');
        const resolver = new FakeResolver();
        app.Services.registerInstance(resolverKey, resolver);

        const presenter = new ToolboxVisualPresenter();
        presenter.Descriptor = new ToolboxVisualDescriptor(resolverKey, 'k1');
        (presenter as unknown as { _forceAttachedForTest(): void })._forceAttachedForTest();
        assert.equal(resolver.listenerCount, 1);
        (presenter as unknown as { _forceDetachedForTest(): void })._forceDetachedForTest();
        assert.equal(resolver.listenerCount, 0);
    }
    finally
    {
        Application.current = prior;
    }
});
