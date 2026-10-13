import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import { PaginatedCanvas } from '../../../../basic/index.js';
import { PatternBrush, SolidColorBrush } from '../../../../visual-engine/index.js';
import { Application, Color, ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { ApplicationSettings } from '../../../shell/services/application-settings-service.js';
import { ContentHostService } from '../../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../../shell/services/documents-content-host-service.js';
import { DiagramDocument } from '../../diagram-document.js';
import { Diagram } from '../../diagram.js';
import { DiagramCanvasService } from '../diagram-canvas-service.js';

class FakeSettings
{
    public constructor(private readonly values: Record<string, unknown>) { }
    public Get(key: string): unknown { return this.values[key]; }
    public GetSetting(): undefined { return undefined; }
    public Contribute(): void { }
}

class Fixture
{
    private static readonly CanvasToken = 'CanvasBg';

    public readonly App: Application;
    public readonly Canvas = new PaginatedCanvas();
    public readonly Document = new DiagramDocument();
    private readonly priorBackground: unknown;

    public constructor(settings: Record<string, unknown>)
    {
        this.App = initTestApp();
        this.priorBackground = this.App.Resources.Get(Fixture.CanvasToken);
        this.App.Services.unregister(ApplicationSettings.Key);
        this.App.Services.registerInstance(ApplicationSettings.Key, new FakeSettings(settings) as unknown as ApplicationSettings);
    }

    public SetBackground(c: Color): void
    {
        this.App.Resources.Set(Fixture.CanvasToken, new SolidColorBrush(c));
    }

    public Start(): DiagramCanvasService
    {
        const provider = new ServiceProvider();
        const host = new DocumentsContentHostService(provider);
        provider.registerInstance(ContentHostService.Key, host);
        const svc = new DiagramCanvasService(provider);
        host.Open(this.Document);
        const view = new Diagram();
        Object.defineProperty(view, 'ItemsPanelInstance', { get: () => this.Canvas });
        this.Document.ActiveView = view;
        return svc;
    }

    public Restore(): void
    {
        if (this.priorBackground === undefined) this.App.Resources.Delete(Fixture.CanvasToken);
        else this.App.Resources.Set(Fixture.CanvasToken, this.priorBackground);
    }
}

describe('DiagramCanvasService', () =>
{
    let fixture: Fixture | undefined;
    afterEach(() => { fixture?.Restore(); fixture = undefined; });

    test('Key is a ServiceKey', () =>
    {
        assert.ok(DiagramCanvasService.Key instanceof ServiceKey);
    });

    test('applies page size and a grid brush from settings', () =>
    {
        fixture = new Fixture({ 'diagram.grid.show': true, 'diagram.grid.size': 32, 'diagram.page.width': 1234, 'diagram.page.height': 777 });
        fixture.Start();
        assert.equal(fixture.Canvas.PageWidth, 1234);
        assert.equal(fixture.Canvas.PageHeight, 777);
        const brush = fixture.Canvas.PaperBrush;
        assert.ok(brush instanceof PatternBrush);
        assert.equal(brush.Size, 32);
    });

    test('falls back to default size/page when settings are absent', () =>
    {
        fixture = new Fixture({});
        fixture.Start();
        assert.equal(fixture.Canvas.PageWidth, 2000);
        assert.equal(fixture.Canvas.PageHeight, 2000);
        const brush = fixture.Canvas.PaperBrush;
        assert.ok(brush instanceof PatternBrush);
        assert.equal(brush.Size, 20);
    });

    test('grid off clears the paper brush', () =>
    {
        fixture = new Fixture({ 'diagram.grid.show': false });
        fixture.Start();
        assert.equal(fixture.Canvas.PaperBrush, undefined);
    });

    test('grid lines shift toward white on a dark page and toward black on a light page', () =>
    {
        fixture = new Fixture({ 'diagram.grid.show': true });
        const dark = Color.FromHex('#111112');
        fixture.SetBackground(dark);
        fixture.Start();
        const darkBrush = fixture.Canvas.PaperBrush as PatternBrush;
        assert.equal(darkBrush.Background.R, dark.R);
        assert.ok(darkBrush.Foreground.R > dark.R, 'dark page: grid is lighter');

        fixture.Restore();
        const light = Color.FromHex('#F4F4F1');
        fixture.SetBackground(light);
        const lightFixture = new Fixture({ 'diagram.grid.show': true });
        lightFixture.SetBackground(light);
        lightFixture.Start();
        const lightBrush = lightFixture.Canvas.PaperBrush as PatternBrush;
        assert.ok(lightBrush.Foreground.R < light.R, 'light page: grid is darker');
        lightFixture.Restore();
    });

    test('PageBackgroundColor reads the CanvasBg token', () =>
    {
        fixture = new Fixture({});
        const c = Color.FromHex('#123456');
        fixture.SetBackground(c);
        assert.equal(DiagramCanvasService.PageBackgroundColor().R, c.R);
    });
});
