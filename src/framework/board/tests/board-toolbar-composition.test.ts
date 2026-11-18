import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, type Visual } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { TextBlock } from '../../../basic/text-block.js';
import { EditorShell } from '../../shell/editor-shell.js';
import { ShellModule } from '../../shell/module.js';
import { ContentHostService } from '../../shell/services/content-host-service.js';
import { DocumentsContentHostService } from '../../shell/services/documents-content-host-service.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { CommandDefinition, CommandGroupPresentation } from '../../shell/commands/command-definition.js';
import { ShellControlDefinition, ShellRegion } from '../../shell/commands/shell-control-definition.js';
import { StatusService } from '../../shell/services/status-service.js';
import { ToolbarService } from '../../shell/commands/toolbar-service.js';
import { BoardDocument } from '../board-document.js';
import { BoardEditingContext } from '../board-command-contexts.js';

function countVisuals(root: Visual): number
{
    let n = 0;
    for (const c of root.visualChildren) n += 1 + countVisuals(c);
    return n;
}

// True when some TextBlock under `root` has the given text.
function findText(root: Visual, text: string): boolean
{
    if (root instanceof TextBlock && root.Text === text) return true;
    for (const c of root.visualChildren) if (findText(c, text)) return true;
    return false;
}

// Regression guard for Plexus's command-bar composition: a ShellModule declaring the
// board commands (Context = BoardEditingContext) + a real BoardDocument
// opened as the host's ActiveDocument. Verifies the toolbar actually populates
// — i.e. the module command Context and the document's live CommandContexts
// resolve to the SAME token so `contexts.includes(def.Context)` matches.
function cmd(id: string, order: number, group = 'g', extra: Partial<CommandDefinition> = {}): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    c.Context = BoardEditingContext;
    c.Group = group;
    c.Order = order;
    Object.assign(c, extra);
    return c;
}

describe('Plexus board toolbar — composition', () => {
    test('an active BoardDocument populates VisibleEntries from module commands', () => {
        const mod = new ShellModule();
        mod.Commands.Add(cmd('board.align.left', 10, 'align', { Presentation: CommandGroupPresentation.SplitMenu }));
        mod.Commands.Add(cmd('board.align.right', 20, 'align'));
        mod.Commands.Add(cmd('board.group', 80, 'arrange'));
        // A StatusBar-region control (the connector indicator) + a Toolbar-region
        // control (the font editor) — both should route without error.
        const status = new ShellControlDefinition();
        status.Region = ShellRegion.StatusBar;
        status.Context = BoardEditingContext;
        mod.ShellControls.Add(status);

        const app = new Application();
        app.Modules.Add(mod);
        app.Services.register(CommandRegistry.Key, (p) => new CommandRegistry(p));
        app.Services.register(ContentHostService.Key, (p) => new DocumentsContentHostService(p));
        app.Services.register(StatusService.Key, (p) => new StatusService(p));
        app.Services.register(ToolbarService.Key, (p) => new ToolbarService(p));

        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        // No active document yet → empty.
        assert.equal(toolbar.VisibleEntries.Count, 0, 'empty toolbar before a document is active');

        // Open a real BoardDocument — this is exactly what main.js does.
        const doc = new BoardDocument();
        host.Open(doc);

        assert.equal(host.ActiveDocument, doc, 'the board document is now active');
        assert.ok(toolbar.VisibleEntries.Count > 0,
            `toolbar populated for the active BoardDocument (got ${toolbar.VisibleEntries.Count} entries)`);

        // The status connector cell posted into StatusService.Items.
        const st = app.Services.getRequired(StatusService.Key);
        assert.ok(st.Items.Count >= 1, 'connector status cell posted for the active board doc');
    });
});

describe('Plexus board toolbar — mounted EditorShell (template resolution)', () => {
    beforeEach(() => { initTestApp(); });

    test('the command host renders group visuals for an active BoardDocument', async () => {
        const app = Application.current!;
        const mod = new ShellModule();
        mod.Commands.Add(cmd('board.align.left', 10, 'align', { Presentation: CommandGroupPresentation.SplitMenu }));
        mod.Commands.Add(cmd('board.align.right', 20, 'align'));
        mod.Commands.Add(cmd('board.group', 80, 'arrange'));
        app.Modules.Add(mod);

        // Root-register the document host so EditorShell adopts it (its `has`
        // guard walks to the app root) and main.js-style Open() lands on the same
        // instance the shell's ToolbarService reads.
        app.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));

        const shell = new EditorShell();
        const target = new HeadlessTarget(1200, 800);
        target.Content = shell as never;
        target.Flush();
        // Let the `$service(ToolbarService)` ServiceBinding forward-ref retry
        // settle (same as shell.test.ts), so the command host's ItemsControl
        // actually binds VisibleEntries before we mutate it.
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        const commandHost = shell.visualChildren[0]!.FindName('PART_CommandHost') as Visual;
        assert.ok(commandHost !== undefined, 'PART_CommandHost present');
        const before = countVisuals(commandHost);

        // Open the board document — exactly what the Plexus bootstrap does.
        const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        host.Open(new BoardDocument());
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        const after = countVisuals(commandHost);
        // The command bar must materialize real button chrome (SplitButton + icon
        // buttons) — a template-resolution failure would leave it empty/stringified.
        assert.ok(after > before, `command host materialized command visuals (before=${before}, after=${after})`);
        assert.ok(after >= 3, `command host has real button chrome (visual count ${after})`);
    });

    test('ShellControlViewModel renders in BOTH the command bar and the status bar', async () => {
        const app = Application.current!;
        const mod = new ShellModule();

        // A Toolbar-region control (like the board font editor) and a StatusBar-
        // region control (like the connector indicator). Both wrap a ShellControl-
        // ViewModel, resolved by `DataTemplate [DataType = ShellControlViewModel]`.
        const editorTpl = new DataTemplate((_d) => new TextBlock('font-editor'), BoardDocument);
        const statusTpl = new DataTemplate((_d) => new TextBlock('connector'), BoardDocument);
        const toolbarCtl = new ShellControlDefinition();
        toolbarCtl.Region = ShellRegion.Toolbar;
        toolbarCtl.Context = BoardEditingContext;
        toolbarCtl.Template = editorTpl;
        toolbarCtl.Order = 330;
        const statusCtl = new ShellControlDefinition();
        statusCtl.Region = ShellRegion.StatusBar;
        statusCtl.Context = BoardEditingContext;
        statusCtl.Template = statusTpl;
        mod.ShellControls.Add(toolbarCtl);
        mod.ShellControls.Add(statusCtl);
        app.Modules.Add(mod);

        app.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));

        const shell = new EditorShell();
        const target = new HeadlessTarget(1200, 800);
        target.Content = shell as never;
        target.Flush();
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        const shellRoot = shell.visualChildren[0]!;
        const host = shell.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        host.Open(new BoardDocument());
        await Promise.resolve(); await Promise.resolve();
        target.Flush();

        // The Toolbar-region control's template text must appear in the command bar.
        const commandHost = shellRoot.FindName('PART_CommandHost') as Visual;
        assert.ok(findText(commandHost, 'font-editor'),
            'Toolbar-region ShellControlViewModel resolved DataTemplate[ShellControlViewModel] and rendered');

        // The StatusBar-region control's template text must appear in the status bar.
        const statusHost = shellRoot.FindName('PART_StatusHost') as Visual;
        assert.ok(findText(statusHost, 'connector'),
            'StatusBar-region ShellControlViewModel synced into StatusService.Items and rendered');
    });
});
