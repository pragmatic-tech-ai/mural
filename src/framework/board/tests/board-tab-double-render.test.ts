import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, type Visual } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { EditorShell } from '../../shell/editor-shell.js';
import { ContentHostService } from '../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../shell/services/documents-content-host-service.js';
import { TextBlock } from '../../../basic/text-block.js';
import { ShellModule } from '../../shell/module.js';
import { ShellControlDefinition, ShellRegion } from '../../shell/commands/shell-control-definition.js';
import { StatusService } from '../../shell/services/status-service.js';
import { ToolbarService } from '../../shell/commands/toolbar-service.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { Board } from '../board.js';
import { BoardDocument } from '../board-document.js';
import { BoardEditingContext } from '../board-command-contexts.js';

// Repro of the Plexus mount crash: the content host is a TabControl; the active
// BoardDocument is presented by an implicit DataTemplate[BoardDocument] → a
// Board whose node Visuals are the document's Figures. If that template is
// applied in TWO places for the same document (e.g. the tab HEADER falling back
// to the implicit template AND the content slot), the second Board re-parents
// the already-parented Figures → "Visual already has a visual parent".
function countType(root: Visual, name: string): number
{
    let n = (root.constructor.name === name) ? 1 : 0;
    for (const c of root.visualChildren) n += countType(c, name);
    return n;
}

describe('Plexus board — content host must render the canvas exactly once', () => {
    beforeEach(() => { initTestApp(); });

    test('a seeded BoardDocument opens without a double-parent crash', async () => {
        const app = Application.current!;

        // The Plexus canvas template: DataTemplate[BoardDocument] → a Board
        // whose ItemsSource is the document's Figures. Registered under the TYPE
        // key (keyless-implicit), exactly like the compiled board.resources.mu.
        const canvas = new DataTemplate((data) =>
        {
            const d = new Board();
            (d as unknown as { ItemsSource: unknown }).ItemsSource = (data as BoardDocument).Nodes;
            return d;
        }, BoardDocument);
        app.Resources.Set(BoardDocument, canvas);

        // Mirror the Plexus module: a Toolbar-region font editor + a StatusBar-
        // region connector indicator, BOTH keyed DataTemplates whose DataType is
        // ALSO BoardDocument and whose Target (DataContext) is the active
        // document. If their ContentPresenter falls back to the implicit canvas
        // template instead of using ContentTemplate=$Template, a second (and third)
        // Board renders and re-parents the shared Figures → crash.
        const fontEditor = new DataTemplate((_d) => new TextBlock('font-editor'), BoardDocument);
        const connector  = new DataTemplate((_d) => new TextBlock('connector'), BoardDocument);
        const mod = new ShellModule();
        const tb = new ShellControlDefinition();
        tb.Region = ShellRegion.Toolbar; tb.Context = BoardEditingContext; tb.Template = fontEditor; tb.Order = 330;
        const sb = new ShellControlDefinition();
        sb.Region = ShellRegion.StatusBar; sb.Context = BoardEditingContext; sb.Template = connector;
        mod.ShellControls.Add(tb);
        mod.ShellControls.Add(sb);
        app.Modules.Add(mod);
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

        const doc = new BoardDocument();
        doc.CreateNode('rectangle', 40, 40);
        doc.CreateNode('ellipse', 160, 80);

        const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        // This is where the real app throws "Visual already has a visual parent".
        assert.doesNotThrow(() =>
        {
            host.Open(doc);
            target.Flush();
        }, 'opening a seeded board document must not double-render its canvas');

        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        // The canvas (Board) must be materialized exactly once across the whole
        // shell — a second one means the tab header (or another slot) re-rendered
        // the document through its implicit template.
        const shellRoot = shell.visualChildren[0]!;
        const findText = (root: Visual, text: string): boolean =>
        {
            if (root instanceof TextBlock && root.Text === text) return true;
            for (const c of root.visualChildren) if (findText(c, text)) return true;
            return false;
        };

        // The canvas must be materialized exactly once (the content area). The
        // toolbar font editor + status connector must render their OWN templates,
        // not the document's implicit canvas.
        const boards = countType(shellRoot, 'Board');
        assert.equal(boards, 1, `exactly one Board in the shell (found ${boards})`);
        assert.ok(findText(shellRoot, 'font-editor'), 'toolbar shell control rendered its OWN template, not the canvas');
        assert.ok(findText(shellRoot, 'connector'), 'status shell control rendered its OWN template, not the canvas');
    });
});
