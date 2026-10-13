import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { AlignmentAxis, ObservableCollection, type PersistentGuide } from '../../../../runtime/index.js';
import { ContentHostService } from '../../../shell/services/content-host-service.js';
import { Diagram } from '../../diagram.js';
import { DiagramDocument } from '../../diagram-document.js';
import { DiagramGuidesService } from '../diagram-guides-service.js';
import { DiagramGuidesStore } from '../diagram-guides-store.js';

// Per-key property-change listener host, standing in for the live Diagram's
// Guides DP notifications without mounting the mural theme.
class Listenable
{
    private readonly listeners = new Map<unknown, Set<() => void>>();

    public PropertyChanged(key: unknown): { subscribe(fn: () => void): { dispose(): void } }
    {
        const listeners = this.listeners;
        return {
            subscribe(fn: () => void): { dispose(): void }
            {
                if (!listeners.has(key)) listeners.set(key, new Set());
                listeners.get(key)!.add(fn);
                return { dispose(): void { listeners.get(key)?.delete(fn); } };
            },
        };
    }

    // No containers realize under this fake, so these are no-ops.
    public AddContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void { }
    public RemoveContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void { }

    public Fire(key: unknown): void
    {
        for (const fn of this.listeners.get(key) ?? []) fn();
    }
}

class FakeView extends Listenable
{
    private guides: readonly PersistentGuide[] = [];

    public get Guides(): readonly PersistentGuide[] { return this.guides; }
    public set Guides(v: readonly PersistentGuide[])
    {
        this.guides = v;
        this.Fire(Diagram.GuidesKey);
    }
}

class Fixture
{
    public readonly OpenDocuments = new ObservableCollection<unknown>();
    public readonly Service: DiagramGuidesService;

    public constructor()
    {
        const host = { OpenDocuments: this.OpenDocuments };
        const provider = {
            get: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
            getRequired: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
        };
        this.Service = new DiagramGuidesService(provider as never, 500);
    }

    public static Publish(doc: DiagramDocument, view: FakeView): void
    {
        doc.ActiveView = view as unknown as Diagram;
    }
}

describe('DiagramGuidesService', () =>
{
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
    afterEach(() => { mock.timers.reset(); });

    test('hydrates the published view from stored guides without re-persisting', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        DiagramGuidesStore.Write(doc, { guides: [{ axis: AlignmentAxis.X, position: 200, glued: [] }] });
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);
        assert.equal(view.Guides.length, 1);
        assert.equal(view.Guides[0]!.position, 200);
        const save = mock.method(doc, 'Save');
        mock.timers.tick(1000);
        assert.equal(save.mock.callCount(), 0);
    });

    test('persists (debounced) when the view guides change', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);
        const save = mock.method(doc, 'Save');
        view.Guides = [{ axis: AlignmentAxis.Y, position: 90, glued: [] }];
        assert.equal(save.mock.callCount(), 0);
        mock.timers.tick(500);
        assert.equal(save.mock.callCount(), 1);
        assert.equal(DiagramGuidesStore.Read(doc)?.guides[0]!.position, 90);
    });

    test('stops persisting after the document closes', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);
        const save = mock.method(doc, 'Save');
        fx.OpenDocuments.Remove(doc);
        view.Guides = [{ axis: AlignmentAxis.X, position: 10, glued: [] }];
        mock.timers.tick(500);
        assert.equal(save.mock.callCount(), 0);
    });
});
