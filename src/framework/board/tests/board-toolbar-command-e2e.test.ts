import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ModifierKeys, ObservableCollection, type Visual } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { ItemsPanelTemplate, Canvas, DockPanel } from '../../../basic/index.js';
import { EditorShell } from '../../shell/editor-shell.js';
import { ShellModule } from '../../shell/module.js';
import { ContentHostService } from '../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../shell/services/documents-content-host-service.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import { ToolbarService } from '../../shell/commands/toolbar-service.js';
import { ToolBarButton } from '../../tool-bar/tool-bar-items.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { BoardDocument } from '../board-document.js';
import { BoardEditingContext, BoardCommandId } from '../board-command-contexts.js';
import { SelectionMode } from '../../list/list-box.js';

function findType<T>(root: Visual, ctor: new (...a: never[]) => T): T | undefined
{
    if (root instanceof ctor) return root as unknown as T;
    for (const c of root.visualChildren)
    {
        const hit = findType(c, ctor);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

function cmd(id: string): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id; c.Title = id; c.Context = BoardEditingContext; c.Group = 'align'; c.Order = 10;
    return c;
}

// End-to-end: the toolbar CommandViewModel (the button's command) must, after a
// canvas selection, become executable and move the shapes — the full
// button → RelayCommand → BoardDocument.Execute → ActiveView path, including
// the CanExecute requery pulse on selection change.
describe('Board toolbar command — end to end through the shell', () => {
    beforeEach(() => { initTestApp(); });

    test('align enables on selection and executes via the toolbar VM', async () => {
        const app = Application.current!;

        // Canvas template: DataTemplate[BoardDocument] → a laid-out Board bound
        // to the document's Nodes, publishing itself as the document's ActiveView.
        // Wrap the Board in a DockPanel like the real Plexus canvas template
        // (`DockPanel { Board … }`), so the Board receives its DataContext by
        // INHERITANCE (not an explicit set) — exactly the shape ActiveView
        // publication must survive.
        const canvasTpl = new DataTemplate((data) =>
        {
            const d = new Board();
            d.SelectionMode = SelectionMode.Extended;
            d.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
            (d as unknown as { ItemsSource: unknown }).ItemsSource = (data as BoardDocument).Nodes;
            const dock = new DockPanel();
            (dock as unknown as { AddChild(v: Visual): void }).AddChild(d);
            return dock;
        }, BoardDocument);
        app.Resources.Set(BoardDocument, canvasTpl);

        const mod = new ShellModule();
        mod.Commands.Add(cmd(BoardCommandId.AlignLeft));
        app.Modules.Add(mod);
        app.Services.registerScoped(CommandRegistry.Key, (p) => new CommandRegistry(p));
        app.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));

        const shell = new EditorShell();
        const target = new HeadlessTarget(1200, 800);
        target.Content = shell as never;
        target.Flush();
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        const doc = new BoardDocument();
        const a = doc.CreateNode('rectangle', 40, 60)!;
        const b = doc.CreateNode('ellipse', 220, 140)!;
        const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        host.Open(doc);
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        // The canvas materialized and published ActiveView.
        const canvas = findType(shell.visualChildren[0]!, Board);
        assert.ok(canvas !== undefined, 'canvas Board materialized in the content host');
        assert.equal(doc.ActiveView, canvas, 'document ActiveView published');

        // The toolbar built a CommandViewModel for align-left.
        const toolbar = shell.Services.getRequired(ToolbarService.Key);
        const vm = [...toolbar.VisibleCommands].find(v => v.Definition.Id === BoardCommandId.AlignLeft);
        assert.ok(vm !== undefined, 'align-left CommandViewModel present in the toolbar');

        // Before selection: not executable.
        assert.equal(vm!.Command.CanExecute(undefined), false, 'align disabled with no selection');

        // Select both shapes on the canvas (this fires the requery pulse).
        for (const fig of [a, b] as Figure[])
        {
            const container = canvas!.Generator.ContainerFromItem(fig);
            assert.ok(container !== undefined, 'container generated');
            canvas!.HandleContainerClick(container!, ModifierKeys.Control);
        }
        assert.equal(canvas!.SelectionCount, 2, 'two shapes selected');

        // After the requery pulse the button command must be executable...
        assert.equal(vm!.Command.CanExecute(undefined), true,
            'align RE-ENABLED after selection (requery pulse reached the toolbar)');

        // The RENDERED button in the command bar must carry that same command
        // (the last mile: DataTemplate[CommandViewModel] → ToolBarButton[Command=$Command]).
        const commandHost = shell.visualChildren[0]!.FindName('PART_CommandHost') as Visual;
        const buttons: { Command?: unknown }[] = [];
        const collect = (r: Visual): void =>
        {
            if (r instanceof ToolBarButton) buttons.push(r as unknown as { Command?: unknown });
            for (const c of r.visualChildren) collect(c);
        };
        collect(commandHost);
        const wired = buttons.find(b => b.Command === vm!.Command);
        assert.ok(wired !== undefined,
            `a rendered command-bar button is bound to the align command (found ${buttons.length} ToolBarButtons)`);

        // ...and invoking it (what the button Click does) must move the shapes.
        vm!.Command.Execute(undefined);
        assert.equal(a.Left, b.Left, 'align-left executed through the toolbar VM → shapes aligned');
    });
});
void ObservableCollection;
