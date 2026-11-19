import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application, type Visual,
    PointerButton, NoModifiers, DataContextBinding, type PointerEventInit,
} from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
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

// Repro of the reported symptom: with two open board documents, clicking a
// document tab moves the highlight but the CANVAS does not switch. The shell
// content host is a TabControl presenting the active BoardDocument through
// DataTemplate[BoardDocument] → a Board, in the tab's content slot
// (SelectedContent). Switching the active document must swap that canvas to the
// other document's Nodes — and never leave two Boards parented at once.

function countType(root: Visual, name: string): number
{
    let n = (root.constructor.name === name) ? 1 : 0;
    for (const c of root.visualChildren) n += countType(c, name);
    return n;
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

function pointer(o: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse', ...o,
    };
}

function click(im: InputManager, container: TabItem): void
{
    im.InjectPointerMove(container, pointer());
    im.InjectPointerDown(container, pointer());
    im.InjectPointerUp(container, pointer());
}

async function buildShell(bindItemsSource = false): Promise<{ shell: EditorShell; target: HeadlessTarget; host: DocumentsContentHostService }>
{
    const app = Application.current!;
    // bindItemsSource mirrors the real board.resources.mu template
    // (`Board [ ItemsSource = $Nodes ]` — a DataContextBinding). The
    // hardcoded form is kept for the plain swap tests; the bound form is what
    // exposes the DataContext-inheritance collision on swap.
    app.Resources.Set(BoardDocument, new DataTemplate((data) =>
    {
        const d = new Board();
        if (bindItemsSource)
        {
            d.set_property_value(Board.ItemsSourceKey, DataContextBinding(d, 'Nodes'));
        }
        else
        {
            (d as unknown as { ItemsSource: unknown }).ItemsSource = (data as BoardDocument).Nodes;
        }
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

    const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
    return { shell, target, host };
}

describe('Plexus board — switching document tabs swaps the canvas', () => {
    beforeEach(() => { initTestApp(); });

    test('setting ActiveDocument to the other open doc swaps the rendered canvas', async () => {
        const { shell, target, host } = await buildShell();

        const docA = new BoardDocument(); docA.CreateNode('rectangle', 40, 40);
        const docB = new BoardDocument();
        docB.CreateNode('ellipse', 160, 80); docB.CreateNode('heart', 200, 120);

        host.Open(docA); target.Flush();
        host.Open(docB); target.Flush();
        await Promise.resolve(); target.Flush();

        const shellRoot = shell.visualChildren[0]!;
        // docB active → its canvas shows docB's 2 nodes, exactly one Board.
        assert.equal(host.ActiveDocument, docB, 'last-opened doc is active');
        assert.equal(countType(shellRoot, 'Board'), 1, 'exactly one canvas after opening two docs');
        let board = findFirst(shellRoot, Board)!;
        assert.equal((board as unknown as { ItemsSource: unknown }).ItemsSource, docB.Nodes, 'canvas shows docB');

        // Switch active back to docA — the write-back a tab click performs.
        assert.doesNotThrow(() => { host.ActiveDocument = docA; target.Flush(); },
            'switching the active document must not double-parent the canvas');
        await Promise.resolve(); target.Flush();

        assert.equal(countType(shellRoot, 'Board'), 1, 'still exactly one canvas after switch');
        board = findFirst(shellRoot, Board)!;
        assert.equal((board as unknown as { ItemsSource: unknown }).ItemsSource, docA.Nodes,
            'canvas swapped to docA after switching ActiveDocument');
    });

    test('clicking the other document tab swaps the rendered canvas', async () => {
        const { shell, target, host } = await buildShell();

        const docA = new BoardDocument(); docA.CreateNode('rectangle', 40, 40);
        const docB = new BoardDocument();
        docB.CreateNode('ellipse', 160, 80); docB.CreateNode('heart', 200, 120);

        host.Open(docA); target.Flush();
        host.Open(docB); target.Flush();
        await Promise.resolve(); target.Flush();

        const shellRoot = shell.visualChildren[0]!;
        const tabs = findDocsTab(shellRoot)!;
        assert.ok(tabs !== undefined, 'the content host materialized a TabControl');

        // docA's tab is the first container; docB is active. Click docA's tab.
        const tabA = tabs.logicalChildren[0] as TabItem;
        click(new InputManager(), tabA);
        target.Flush();
        await Promise.resolve(); target.Flush();

        assert.equal(tabs.SelectedItem, docA, 'clicking tab A selects docA (highlight)');
        assert.equal(host.ActiveDocument, docA, 'clicking tab A writes back ActiveDocument = docA');
        assert.equal(countType(shellRoot, 'Board'), 1, 'exactly one canvas after clicking a tab');
        const board = findFirst(shellRoot, Board)!;
        assert.equal((board as unknown as { ItemsSource: unknown }).ItemsSource, docA.Nodes,
            'canvas swapped to docA after clicking its tab');
    });

    // The real repro: board.resources.mu binds `Board [ ItemsSource = $Nodes ]`.
    // On swap, ContentPresenter.resolveAndSlot re-points its DataContext to the
    // incoming document while the OUTGOING Board is still slotted, so the
    // outgoing Board inherits the incoming doc, its ItemsSource binding
    // re-resolves to the incoming Nodes, and it rebuilds the incoming document's
    // shared node Visuals — which the incoming Board also builds → "Visual
    // already has a visual parent". The bound ItemsSource is what triggers it;
    // the hardcoded form above dodges the DataContext re-resolution.
    test('bound ItemsSource=$Nodes: clicking the other tab swaps without a double-parent throw', async () => {
        const { shell, target, host } = await buildShell(true);

        const docA = new BoardDocument(); docA.CreateNode('rectangle', 40, 40);
        const docB = new BoardDocument();
        docB.CreateNode('ellipse', 160, 80); docB.CreateNode('heart', 200, 120);

        host.Open(docA); target.Flush();
        host.Open(docB); target.Flush();
        await Promise.resolve(); target.Flush();

        const shellRoot = shell.visualChildren[0]!;
        const tabs = findDocsTab(shellRoot)!;
        const tabA = tabs.logicalChildren[0] as TabItem;

        assert.doesNotThrow(() =>
        {
            click(new InputManager(), tabA);
            target.Flush();
        }, 'switching tabs with a bound ItemsSource must not double-parent the shared node Visuals');
        await Promise.resolve(); target.Flush();

        assert.equal(host.ActiveDocument, docA, 'clicking tab A writes back ActiveDocument = docA');
        assert.equal(countType(shellRoot, 'Board'), 1, 'exactly one canvas after the swap');
        const board = findFirst(shellRoot, Board)!;
        assert.equal((board as unknown as { ItemsSource: unknown }).ItemsSource, docA.Nodes,
            'canvas swapped to docA (its Nodes), not stuck on docB');
    });
});
