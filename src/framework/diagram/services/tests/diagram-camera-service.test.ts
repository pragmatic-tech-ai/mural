import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection } from '../../../../runtime/index.js';
import { ContentHostService } from '../../../shell/services/content-host-service.js';
import { ScrollViewer } from '../../../surfaces/scroll-viewer.js';
import { Diagram } from '../../diagram.js';
import { DiagramDocument } from '../../diagram-document.js';
import { DiagramCameraService } from '../diagram-camera-service.js';
import { DiagramCameraStore, type DiagramCameraState } from '../diagram-camera-store.js';

// Minimal per-key property-change listener host, shared by the fake view (for
// Diagram.ZoomKey) and its fake ScrollHost (for the offset keys).
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

    // The document subscribes to the view's ContainerBound signal on ActiveView;
    // no containers realize under this fake.
    public AddContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void { }
    public RemoveContainerBoundListener(_fn: (c: unknown, i: unknown) => void): void { }

    public Fire(key: unknown): void
    {
        for (const fn of this.listeners.get(key) ?? []) fn();
    }
}

// A lightweight stand-in for the live Diagram control: it exposes only the
// camera surface the service touches. Avoids mounting the mural theme.
class FakeView extends Listenable
{
    private state: DiagramCameraState = { zoom: 1, offsetX: 0, offsetY: 0 };
    public readonly ScrollHost = new Listenable();

    public get Camera(): DiagramCameraState { return this.state; }

    public SetCamera(c: DiagramCameraState): void
    {
        this.state = { zoom: c.zoom, offsetX: c.offsetX, offsetY: c.offsetY };
        this.Fire(Diagram.ZoomKey);
        this.ScrollHost.Fire(ScrollViewer.HorizontalOffsetKey);
        this.ScrollHost.Fire(ScrollViewer.VerticalOffsetKey);
    }

    // Simulate a scrollbar/wheel scroll: the offset changes but the zoom does
    // NOT, so only the ScrollViewer offset keys fire.
    public Scroll(offsetX: number, offsetY: number): void
    {
        this.state = { ...this.state, offsetX, offsetY };
        this.ScrollHost.Fire(ScrollViewer.HorizontalOffsetKey);
        this.ScrollHost.Fire(ScrollViewer.VerticalOffsetKey);
    }
}

class Fixture
{
    public readonly OpenDocuments = new ObservableCollection<unknown>();
    public readonly Service: DiagramCameraService;

    public constructor()
    {
        const host = { OpenDocuments: this.OpenDocuments };
        const provider = {
            get: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
            getRequired: (k: unknown) => (k === ContentHostService.Key ? host : undefined),
        };
        this.Service = new DiagramCameraService(provider as never, 500);
    }

    public static Publish(doc: DiagramDocument, view: FakeView): void
    {
        doc.ActiveView = view as unknown as Diagram;
    }
}

describe('DiagramCameraService', () =>
{
    beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
    afterEach(() => { mock.timers.reset(); });

    test('Key is stable', () =>
    {
        assert.ok(DiagramCameraService.Key);
    });

    test('hydrates the published view from stored metadata without re-persisting', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        DiagramCameraStore.Write(doc, { zoom: 2, offsetX: 10, offsetY: 20 });
        fx.OpenDocuments.Add(doc);

        const view = new FakeView();
        Fixture.Publish(doc, view);

        assert.deepEqual(view.Camera, { zoom: 2, offsetX: 10, offsetY: 20 });
        // Hydration must NOT schedule a persist (guarded): advancing time does not save.
        const save = mock.method(doc, 'Save');
        mock.timers.tick(1000);
        assert.equal(save.mock.callCount(), 0);
    });

    test('persists (debounced) when the view camera changes', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);

        const save = mock.method(doc, 'Save');
        view.SetCamera({ zoom: 3, offsetX: 5, offsetY: 6 });   // user zoom
        view.SetCamera({ zoom: 3, offsetX: 7, offsetY: 8 });   // and scroll - coalesced
        assert.equal(save.mock.callCount(), 0);                // still within the debounce window
        mock.timers.tick(500);
        assert.equal(save.mock.callCount(), 1);
        assert.deepEqual(DiagramCameraStore.Read(doc), { zoom: 3, offsetX: 7, offsetY: 8 });
    });

    test('persists when only the scroll offset changes (zoom unchanged)', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);

        const save = mock.method(doc, 'Save');
        view.Scroll(50, 60);
        mock.timers.tick(500);
        assert.equal(save.mock.callCount(), 1);
        assert.deepEqual(DiagramCameraStore.Read(doc), { zoom: 1, offsetX: 50, offsetY: 60 });
    });

    test('stops persisting after the document closes', () =>
    {
        const fx = new Fixture();
        const doc = new DiagramDocument();
        fx.OpenDocuments.Add(doc);
        const view = new FakeView();
        Fixture.Publish(doc, view);

        const save = mock.method(doc, 'Save');
        fx.OpenDocuments.Remove(doc);   // close -> detach
        view.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });
        mock.timers.tick(500);
        assert.equal(save.mock.callCount(), 0);
    });
});
