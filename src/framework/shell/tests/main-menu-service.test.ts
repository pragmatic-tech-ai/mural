import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    RelayCommand,
    type ICommand,
} from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { ContentHostService } from '../services/content-host-service.js';
import { DocumentsContentHostService, type IDocument } from '../services/documents-content-host-service.js';
import { CommandDefinition } from '../commands/command-definition.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { ShellRegion } from '../commands/shell-control-definition.js';
import { MainMenuService } from '../commands/main-menu-service.js';
import type { CommandContext } from '../commands/command-context.js';

// A document that is both an IDocument (so the host can open it) and an
// ICommandDispatcher (Resolve) — the same minimal shape toolbar-service.test
// uses, so MainMenuService's ActiveDispatcher chain has something real to
// resolve against.
class FakeDoc implements IDocument
{
    public readonly Id: string;
    public readonly Title = 'doc';
    public readonly IsDirty = false;
    // Every command id this document was asked to Resolve, in call order.
    public readonly resolved: string[] = [];

    constructor(id: string)
    {
        this.Id = id;
    }

    public Save(): void { /* no-op */ }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        this.resolved.push(commandId);
        return new RelayCommand(() => { /* no-op */ }, () => true, { Text: commandId });
    }
}

function menuRoot(id: string, ...children: CommandDefinition[]): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    c.Region = ShellRegion.MainMenu;
    for (const child of children) c.AddChild(child);
    return c;
}

function menuChild(id: string): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    return c;
}

function toolbarCommand(id: string): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    // Region defaults to Toolbar — left unset deliberately, proving
    // MainMenuService's filter excludes the default region too.
    return c;
}

function appWith(...cmds: CommandDefinition[]): Application
{
    const mod = new ShellModule();
    for (const c of cmds) mod.Commands.Add(c);
    const app = new Application();
    app.Modules.Add(mod);
    app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
    app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
    app.Services.register(MainMenuService.Key, p => new MainMenuService(p));
    return app;
}

describe('MainMenuService roots', () => {
    test('RootItems holds only the MainMenu-region roots, in registry order', () => {
        const app = appWith(
            menuRoot('file', menuChild('file.new'), menuChild('file.open')),
            toolbarCommand('tb.save'),
            menuRoot('edit'),
        );
        const menu = app.Services.getRequired(MainMenuService.Key);

        assert.deepEqual([...menu.RootItems].map(vm => vm.Definition.Id), ['file', 'edit']);
    });

    test('each root VM resolves its Command via the active dispatcher; HasChildren tracks declared children', () => {
        const app = appWith(
            menuRoot('file', menuChild('file.new'), menuChild('file.open')),
            menuRoot('edit'),
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const doc = new FakeDoc('a');
        host.Open(doc);

        // MainMenuService built its roots in the ctor — before the document
        // opened — so re-point it at the now-active document.
        const menu = app.Services.getRequired(MainMenuService.Key);
        menu.Rebuild();

        const [file, edit] = [...menu.RootItems];
        assert.ok(file!.HasChildren, 'file has declared children');
        assert.ok(!edit!.HasChildren, 'edit has none');
        assert.ok(doc.resolved.includes('file'), 'the root command was resolved through the active dispatcher');
    });

    test('opening a root (EnsureExpanded) lazily realizes its child VMs via the dispatcher', () => {
        const app = appWith(menuRoot('file', menuChild('file.new'), menuChild('file.open')));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const doc = new FakeDoc('a');
        host.Open(doc);

        const menu = app.Services.getRequired(MainMenuService.Key);
        menu.Rebuild();

        const file = menu.RootItems.Get(0)!;
        assert.equal(file.Children.Count, 0, 'children not realized before first open');
        doc.resolved.length = 0;

        file.EnsureExpanded();

        assert.deepEqual([...file.Children].map(vm => vm.Definition.Id), ['file.new', 'file.open']);
        assert.deepEqual(doc.resolved, ['file.new', 'file.open'], 'children resolved through the active dispatcher on expand');
    });

    test('with no active document, building the roots does not crash (inert commands)', () => {
        const app = appWith(menuRoot('file', menuChild('file.new')));
        const menu = app.Services.getRequired(MainMenuService.Key);

        const file = menu.RootItems.Get(0)!;
        assert.equal(file.Definition.Id, 'file');
        assert.equal(file.Command, undefined, 'no-op dispatcher resolves nothing to run');
    });

    test('Rebuild() disposes the old root VMs and produces a fresh set', () => {
        const app = appWith(menuRoot('file', menuChild('file.new')), menuRoot('edit'));
        const menu = app.Services.getRequired(MainMenuService.Key);

        const before = [...menu.RootItems];
        const file = before[0]!;
        file.EnsureExpanded();
        assert.equal(file.Children.Count, 1, 'sanity: file realized its one child before rebuild');

        menu.Rebuild();
        const after = [...menu.RootItems];

        // dispose() recurses into Children and clears them — an observable
        // sign the OLD root was torn down rather than reused.
        assert.equal(file.Children.Count, 0, 'the old root VM was disposed (Children cleared)');
        assert.deepEqual(after.map(vm => vm.Definition.Id), before.map(vm => vm.Definition.Id));
        for (let i = 0; i < before.length; i++)
        {
            assert.notEqual(after[i], before[i], `root[${i}] is a freshly built VM, not reused`);
        }
    });
});
