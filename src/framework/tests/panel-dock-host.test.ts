import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';
import { PanelDockService } from '../shell/services/panel-dock-service.js';
import type { IDockPanel } from '../shell/services/dock-panel.js';
import { Application, MetaData, MuralBase, Rect, Size, type Visual } from '../../runtime/index.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { Border } from '../../basic/border.js';
import { EditorShell } from '../shell/editor-shell.js';
import { TabControl } from '../tabs/tabs.js';

// Minimal dock panel: an Id + Title is all IDockPanel requires.
class Panel implements IDockPanel
{
    constructor(public readonly Id: string, public readonly Title: string) {}
}

describe('PanelDockService — tabbed dock host', () => {
    beforeEach(() => { initTestApp(); });

    function svc(): PanelDockService
    {
        return new PanelDockService(undefined as never);
    }

    test('Add appends, selects the added panel, and flips HasPanels', () => {
        const s = svc();
        assert.equal(s.HasPanels, false);
        const a = s.Add(new Panel('a', 'Alpha'));
        assert.equal(s.Panels.Count, 1);
        assert.equal(s.SelectedPanel, a);
        assert.equal(s.HasPanels, true);
    });

    test('Add dedupes by Id — re-adds re-select the existing panel, no duplicate', () => {
        const s = svc();
        const a = s.Add(new Panel('a', 'Alpha'));
        s.Add(new Panel('b', 'Beta'));
        const again = s.Add(new Panel('a', 'Alpha again'));
        assert.equal(again, a, 'returns the existing instance');
        assert.equal(s.Panels.Count, 2, 'no duplicate');
        assert.equal(s.SelectedPanel, a, 're-add re-selects the existing panel');
    });

    test('CloseById removes; closing the selected panel selects an adjacent one', () => {
        const s = svc();
        s.Add(new Panel('a', 'Alpha'));
        const b = s.Add(new Panel('b', 'Beta'));   // selected (last added)
        s.CloseById('b');
        assert.equal(s.Panels.Count, 1);
        assert.equal(s.SelectedPanel?.Id, 'a', 'selection falls back to the survivor');
        assert.notEqual(s.SelectedPanel, b);
    });

    test('closing the last panel clears selection and HasPanels', () => {
        const s = svc();
        s.Add(new Panel('a', 'Alpha'));
        s.CloseById('a');
        assert.equal(s.Panels.Count, 0);
        assert.equal(s.SelectedPanel, undefined);
        assert.equal(s.HasPanels, false);
    });

    test('ClosePanelCommand closes by Id parameter', () => {
        const s = svc();
        s.Add(new Panel('a', 'Alpha'));
        s.ClosePanelCommand.Execute('a');
        assert.equal(s.Panels.Count, 0);
    });

    test('Clear empties the dock', () => {
        const s = svc();
        s.Add(new Panel('a', 'Alpha'));
        s.Add(new Panel('b', 'Beta'));
        s.Clear();
        assert.equal(s.Panels.Count, 0);
        assert.equal(s.HasPanels, false);
        assert.equal(s.SelectedPanel, undefined);
    });
});

function collect<T>(root: Visual, ctor: new (...a: never[]) => T, out: T[] = []): T[]
{
    if (root instanceof ctor) out.push(root);
    for (const c of root.visualChildren) collect(c, ctor, out);
    return out;
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// A concrete dock panel rendered by a marker DataTemplate.
class ViewPanel extends MuralBase implements IDockPanel
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(ViewPanel, 'Id', '', MetaData.None);
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(ViewPanel, 'Title', '', MetaData.None);
    public readonly marker = new Border();
    constructor(id: string, title: string)
    {
        super();
        this.set_property_value(ViewPanel.IdKey, id);
        this.set_property_value(ViewPanel.TitleKey, title);
    }
    public get Id(): string { return this.get_property_value(ViewPanel.IdKey); }
    public get Title(): string { return this.get_property_value(ViewPanel.TitleKey); }
}

describe('PanelDockService — shell region renders a TabControl', () => {
    beforeEach(() => {
        initTestApp();
        Application.current.Resources.Set(ViewPanel, new DataTemplate((s) => (s as ViewPanel).marker, ViewPanel));
    });

    async function mount(): Promise<{ root: Visual; dock: PanelDockService }>
    {
        const shell = new EditorShell();
        const root = shell.visualChildren[0]!;
        const dock = shell.Services.get(PanelDockService.Key) as PanelDockService;
        await settle();
        return { root, dock };
    }

    test('EditorShell registers PanelDockService', async () => {
        const { dock } = await mount();
        assert.ok(dock instanceof PanelDockService);
    });

    test('adding panels materializes a TabControl bound to Panels/SelectedPanel', async () => {
        const { root, dock } = await mount();
        const a = dock.Add(new ViewPanel('a', 'Alpha'));
        dock.Add(new ViewPanel('b', 'Beta'));
        await settle();
        root.Measure(new Size(1200, 800));
        root.Arrange(new Rect(0, 0, 1200, 800));

        // The Content region also hosts a TabControl (the documents editor group),
        // so find the dock's TabControl by its ItemsSource binding rather than
        // assuming it is the only one.
        const dockTab = collect(root, TabControl).find(t => t.ItemsSource === dock.Panels);
        assert.ok(dockTab !== undefined, 'a TabControl bound to the dock Panels materialized');
        assert.equal(dockTab!.SelectedItem, dock.SelectedPanel, 'SelectedItem tracks SelectedPanel');
        // Add() selected the last-added panel; re-selecting a is reflected.
        dock.SelectedPanel = a;
        await settle();
        assert.equal(dockTab!.SelectedItem, a);
    });
});
