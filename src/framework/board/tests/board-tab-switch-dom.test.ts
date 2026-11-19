import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    Application, type Visual,
    PointerButton, NoModifiers, type PointerEventInit,
} from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget, SvgRenderer, VISUAL_BACKREF } from '../../../visual-engine/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { EditorShell } from '../../shell/editor-shell.js';
import { ContentHostService } from '../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../shell/services/documents-content-host-service.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { StatusService } from '../../shell/services/status-service.js';
import { ToolbarService } from '../../shell/commands/toolbar-service.js';
import { InputManager } from '../../index.js';
import { TabControl, TabItem } from '../../tabs/tabs.js';
import { Board } from '../board.js';
import { BoardDocument } from '../board-document.js';

// H2 probe: the logical/visual swap is proven (board-tab-switch.test.ts), but
// the REAL app paints through the incremental SvgRenderer into a live SVG DOM —
// a path HeadlessTarget's full-redraw never exercises. This drives the actual
// SvgRenderer over the real shell tree and asserts the DOM canvas swaps: the
// stale document's Board <g> must be reaped and the clicked document's painted.

function makeDom(): { document: Document; surface: SVGSVGElement }
{
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const d = dom.window.document;
    const surface = d.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    d.body.appendChild(surface);
    return { document: d, surface };
}

function findFirst<T extends Visual>(root: Visual, ctor: new (...a: never[]) => T): T | undefined
{
    if (root instanceof ctor) return root as T;
    for (const c of root.visualChildren)
    {
        const hit = findFirst(c, ctor);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

// The DOCUMENTS TabControl specifically — the shell also has a panel-dock
// TabControl (which comes first in the tree), so select by DataContext.
function findDocsTab(root: Visual): TabControl | undefined
{
    if (root instanceof TabControl && root.DataContext instanceof DocumentsContentHostService) return root;
    for (const c of root.visualChildren)
    {
        const hit = findDocsTab(c);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

// Every Board outer <g> currently in the DOM, resolved back to its Visual.
function boardOutersInDom(surface: SVGSVGElement): Board[]
{
    const out: Board[] = [];
    for (const g of surface.querySelectorAll('g.mural-visual'))
    {
        const v = (g as unknown as { [k: symbol]: Visual })[VISUAL_BACKREF];
        if (v instanceof Board) out.push(v);
    }
    return out;
}

function pointer(o: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse', ...o,
    };
}

describe('Plexus board — the DOM canvas swaps on tab click (incremental renderer)', () => {
    beforeEach(() => { initTestApp(); });

    test('clicking the other tab reaps the stale canvas <g> and paints the clicked one', async () => {
        const app = Application.current!;
        app.Resources.Set(BoardDocument, new DataTemplate((data) =>
        {
            const d = new Board();
            (d as unknown as { ItemsSource: unknown }).ItemsSource = (data as BoardDocument).Nodes;
            return d;
        }, BoardDocument));

        app.Services.registerScoped(CommandRegistry.Key, (p) => new CommandRegistry(p));
        app.Services.registerScoped(StatusService.Key, (p) => new StatusService(p));
        app.Services.registerScoped(ToolbarService.Key, (p) => new ToolbarService(p));
        app.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));

        const shell = new EditorShell();
        const target = new HeadlessTarget(1200, 800);
        target.Content = shell as never;
        target.Flush();
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        // Paint the shell tree through the REAL incremental renderer into jsdom.
        const { document, surface } = makeDom();
        const renderer = new SvgRenderer(surface, { document });
        const paint = (): void => { renderer.Render(target.Content as Visual, undefined, null, null); };

        const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const docA = new BoardDocument(); docA.CreateNode('rectangle', 40, 40);
        const docB = new BoardDocument();
        docB.CreateNode('ellipse', 160, 80); docB.CreateNode('heart', 200, 120);

        host.Open(docA); target.Flush(); paint();
        host.Open(docB); target.Flush();
        await Promise.resolve(); target.Flush();
        paint();

        const shellRoot = shell.visualChildren[0]!;
        // docB active → exactly one Board <g> in the DOM, bound to docB.
        let domBoards = boardOutersInDom(surface);
        assert.equal(domBoards.length, 1, `one canvas <g> in the DOM (found ${domBoards.length})`);
        assert.equal(
            (domBoards[0] as unknown as { ItemsSource: unknown }).ItemsSource, docB.Nodes,
            'DOM canvas shows docB before the click');

        // Click docA's tab.
        const tabs = findDocsTab(shellRoot)!;
        const tabA = tabs.logicalChildren[0] as TabItem;
        const im = new InputManager();
        im.InjectPointerMove(tabA, pointer());
        im.InjectPointerDown(tabA, pointer());
        im.InjectPointerUp(tabA, pointer());
        target.Flush();
        await Promise.resolve(); target.Flush();
        paint();

        assert.equal(host.ActiveDocument, docA, 'click switched ActiveDocument to docA');

        // The DOM must now show docA's canvas — stale docB canvas reaped.
        domBoards = boardOutersInDom(surface);
        assert.equal(domBoards.length, 1, `still one canvas <g> after the click (found ${domBoards.length})`);
        assert.equal(
            (domBoards[0] as unknown as { ItemsSource: unknown }).ItemsSource, docA.Nodes,
            'DOM canvas swapped to docA after clicking its tab');
    });
});
