import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application,
    CheckableRelayCommand,
    ServiceKey,
    type ICommand,
    type ServiceToken,
} from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { ContentHostService } from '../services/content-host-service.js';
import { DocumentsContentHostService, type IDocument } from '../services/documents-content-host-service.js';
import { CommandManager } from '../../commands/command-manager.js';
import { CommandDefinition, CommandGroupPresentation } from '../commands/command-definition.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { ShellControlAlignment, ShellControlDefinition, ShellRegion } from '../commands/shell-control-definition.js';
import { StatusService } from '../services/status-service.js';
import { StatusBarItem } from '../../status-bar/status-bar.js';
import { DockPanel, Dock } from '../../../basic/panels/dock-panel.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Border } from '../../../basic/border.js';
import { ToolbarService } from '../commands/toolbar-service.js';
import {
    ShellControlViewModel,
    ToolbarFlatGroup,
    ToolbarGroupViewModel,
    ToolbarSeparatorItem,
    ToolbarSplitGridGroup,
    ToolbarSplitMenuGroup,
    ToolbarToggleGroup,
} from '../commands/toolbar-group-view-model.js';
import { CommandToggleViewModel, CommandViewModel } from '../commands/command-view-model.js';
import { type ICommandTarget } from '../commands/command-target.js';
import { CommandContext } from '../commands/command-context.js';

// Two shared contexts the fake documents activate.
const CTX_A = new ServiceKey<unknown>('ctx.a');
const CTX_B = new ServiceKey<unknown>('ctx.b');

function command(id: string, context: ServiceToken<unknown>, order = 0): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    c.Context = context;
    c.Group = 'g';
    c.Order = order;
    return c;
}

// A document that is BOTH an IDocument (so the host can open it) and an
// ICommandTarget (so the toolbar's context filter still reads CommandContexts —
// R1: the filter dispatches via ActiveTarget/isCommandTarget, untouched by this
// migration) AND an ICommandDispatcher (so the toolbar's EXECUTION path, which
// now dispatches via Resolve, has something to resolve against).
class FakeDoc implements IDocument, ICommandTarget
{
    public readonly Id: string;
    public readonly Title = 'doc';
    public readonly IsDirty = false;
    public CommandContexts: readonly ServiceToken<unknown>[];
    // Now holds the command IDS Resolve's returned command was invoked with
    // (dispatch runs through Resolve(id).Execute(), not doc.Execute(def)).
    public readonly executed: string[] = [];
    public canRun = true;

    constructor(id: string, contexts: readonly ServiceToken<unknown>[])
    {
        this.Id = id;
        this.CommandContexts = contexts;
    }

    public Save(): void { /* no-op */ }
    // Kept so FakeDoc still satisfies ICommandTarget for the context filter
    // (R1) — not invoked by the toolbar's dispatch path any more.
    public Execute(_def: CommandDefinition): void { /* no-op: see Resolve() */ }
    public CanExecute(): boolean { return this.canRun; }

    // Checked-state hook for subclasses (TogglingDoc). Base reports unchecked.
    protected IsCheckedFor(_id: string): boolean { return false; }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        return new CheckableRelayCommand(
            () => this.executed.push(commandId),
            () => this.canRun,
            () => this.IsCheckedFor(commandId));
    }
}

function appWith(...cmds: CommandDefinition[]): Application
{
    const mod = new ShellModule();
    for (const c of cmds) mod.Commands.Add(c);
    const app = new Application();
    app.Modules.Add(mod);
    app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
    app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
    app.Services.register(ToolbarService.Key, p => new ToolbarService(p));
    return app;
}

function ids(toolbar: ToolbarService): string[]
{
    return [...toolbar.VisibleCommands].map(vm => vm.Definition.Id);
}

describe('ToolbarService visibility', () => {
    test('shows only commands whose context the active document activates', () => {
        const app = appWith(command('c.a1', CTX_A, 0), command('c.a2', CTX_A, 1), command('c.b1', CTX_B, 0));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        assert.deepEqual(ids(toolbar), []);            // nothing active yet

        host.Open(new FakeDoc('a', [CTX_A]));
        assert.deepEqual(ids(toolbar), ['c.a1', 'c.a2']);
    });

    test('reflows when the active document changes', () => {
        const app = appWith(command('c.a1', CTX_A), command('c.b1', CTX_B));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        host.Open(new FakeDoc('a', [CTX_A]));
        assert.deepEqual(ids(toolbar), ['c.a1']);
        host.Open(new FakeDoc('b', [CTX_B]));
        assert.deepEqual(ids(toolbar), ['c.b1']);
    });

    test('orders survivors by Order', () => {
        const app = appWith(command('c.late', CTX_A, 20), command('c.early', CTX_A, 5));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        host.Open(new FakeDoc('a', [CTX_A]));
        assert.deepEqual(ids(toolbar), ['c.early', 'c.late']);
    });

    test('an active document that is not a command target yields an empty toolbar', () => {
        const app = appWith(command('c.a1', CTX_A));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        // A plain IDocument (no Execute/CanExecute/CommandContexts).
        host.Open({ Id: 'plain', Title: 'plain', IsDirty: false, Save() { /* */ } });
        assert.deepEqual(ids(toolbar), []);
    });
});

describe('ToolbarService dispatch', () => {
    test('invoking a command executes it on the active document with the definition', () => {
        const app = appWith(command('c.a1', CTX_A));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        const doc = new FakeDoc('a', [CTX_A]);
        host.Open(doc);

        toolbar.VisibleCommands.Get(0)!.Command.Execute(undefined);
        assert.equal(doc.executed.length, 1);
        assert.equal(doc.executed[0], 'c.a1');
    });

    test('CanExecute reflects the active document', () => {
        const app = appWith(command('c.a1', CTX_A));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        const doc = new FakeDoc('a', [CTX_A]);
        host.Open(doc);
        const cmd = toolbar.VisibleCommands.Get(0)!.Command;

        doc.canRun = false;
        assert.equal(cmd.CanExecute(undefined), false);
        doc.canRun = true;
        assert.equal(cmd.CanExecute(undefined), true);
    });

    // Explicit proof the dispatch path now goes through ICommandDispatcher.Resolve
    // rather than the old ICommandTarget.Execute(def)/CanExecute(def) — a document
    // that records every commandId passed to Resolve, and whose resolved command's
    // IsChecked drives the VM's checked state.
    test('dispatch flows through Resolve, not the old ICommandTarget.Execute', () => {
        const app = appWith(command('c.a1', CTX_A));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        const resolvedIds: string[] = [];
        class RecordingDoc extends FakeDoc
        {
            public checked = false;
            public override Resolve(commandId: string, context: CommandContext): ICommand | undefined
            {
                resolvedIds.push(commandId);
                return new CheckableRelayCommand(
                    () => this.executed.push(commandId),
                    () => this.canRun,
                    () => this.checked);
            }
        }
        const doc = new RecordingDoc('a', [CTX_A]);
        host.Open(doc);
        resolvedIds.length = 0;   // discard the Resolve calls Open()'s Rebuild made

        const vm = toolbar.VisibleCommands.Get(0)!;
        vm.Command.Execute(undefined);
        assert.deepEqual(resolvedIds, ['c.a1'], 'Execute dispatched via Resolve(id, ctx)');
        assert.deepEqual(doc.executed, ['c.a1'], 'the command Resolve returned actually ran');

        doc.checked = true;
        CommandManager.InvalidateRequerySuggested();   // triggers RefreshActiveStates
        assert.equal(vm.IsActive, true, 'IsChecked on the resolved command flows into vm.IsActive');
    });
});

// A grouped command with an explicit Group + optional presentation metadata.
function grouped(
    id: string, group: string, order: number,
    opts?: { presentation?: CommandGroupPresentation; groupTitle?: string; columns?: number },
): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    c.Context = CTX_A;
    c.Group = group;
    c.Order = order;
    if (opts?.presentation !== undefined) c.Presentation = opts.presentation;
    if (opts?.groupTitle !== undefined)  c.GroupTitle = opts.groupTitle;
    if (opts?.columns !== undefined)     c.Columns = opts.columns;
    return c;
}

// A command target that also reports active-state for a fixed id set. Toggle
// state now flows Resolve → ICheckableCommand.IsChecked → RefreshActiveStates
// → vm.IsActive, so this overrides IsCheckedFor rather than ICommandTarget's
// (optional, now-unused) IsActive.
class TogglingDoc extends FakeDoc
{
    public active = new Set<string>();
    protected override IsCheckedFor(id: string): boolean { return this.active.has(id); }
}

describe('ToolbarService grouping', () => {
    test('clusters commands into presentation groups by Group, leader sets the type', () => {
        const app = appWith(
            grouped('align.l', 'align', 10, { presentation: CommandGroupPresentation.SplitMenu, groupTitle: 'Align' }),
            grouped('align.r', 'align', 20),
            grouped('dist.h',  'align', 30),   // rides in the align group
            grouped('place.tl', 'place', 40, { presentation: CommandGroupPresentation.SplitGrid, columns: 3 }),
            grouped('place.t',  'place', 50),
            grouped('bold', 'style', 60, { presentation: CommandGroupPresentation.Toggles }),
            grouped('italic', 'style', 70),
            grouped('grp', 'arrange', 80),     // no presentation → Flat
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        host.Open(new FakeDoc('a', [CTX_A]));

        const groups = [...toolbar.VisibleEntries] as ToolbarGroupViewModel[];
        assert.equal(groups.length, 4, 'four groups: align, place, style, arrange');

        assert.ok(groups[0] instanceof ToolbarSplitMenuGroup);
        assert.equal(groups[0]!.Title, 'Align');
        assert.deepEqual([...groups[0]!.Items].map(vm => vm.Definition.Id), ['align.l', 'align.r', 'dist.h']);

        assert.ok(groups[1] instanceof ToolbarSplitGridGroup);
        assert.equal(groups[1]!.Columns, 3);

        assert.ok(groups[2] instanceof ToolbarToggleGroup);
        assert.deepEqual([...groups[2]!.Items].map(vm => vm.Definition.Id), ['bold', 'italic']);

        assert.ok(groups[3] instanceof ToolbarFlatGroup);
    });

    test('ToolbarItems is the flat render stream: groups expanded, separators between them', () => {
        const app = appWith(
            grouped('align.l', 'align', 10, { presentation: CommandGroupPresentation.SplitMenu, groupTitle: 'Align' }),
            grouped('align.r', 'align', 20),
            grouped('grp',     'arrange', 30),   // Flat, single member
            grouped('ungrp',   'arrange', 40),
            grouped('bold',   'style', 50, { presentation: CommandGroupPresentation.Toggles }),
            grouped('italic', 'style', 60),
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        host.Open(new FakeDoc('a', [CTX_A]));

        const items = [...toolbar.ToolbarItems];
        // align (1 split VM) | sep | arrange (grp, ungrp) | sep | style (bold, italic)
        assert.ok(items[0] instanceof ToolbarSplitMenuGroup, 'split group rides as ONE item');
        assert.ok(items[1] instanceof ToolbarSeparatorItem, 'separator after the split group');
        // Flat group members expand to plain CommandViewModels (not the toggle subclass).
        assert.ok(items[2] instanceof CommandViewModel && !(items[2] instanceof CommandToggleViewModel));
        assert.equal((items[2] as CommandViewModel).Definition.Id, 'grp');
        assert.equal((items[3] as CommandViewModel).Definition.Id, 'ungrp');
        assert.ok(items[4] instanceof ToolbarSeparatorItem, 'separator before the toggle group');
        // Toggles group members expand to CommandToggleViewModels (toggle template).
        assert.ok(items[5] instanceof CommandToggleViewModel, 'bold is a toggle-flavored VM');
        assert.equal((items[5] as CommandViewModel).Definition.Id, 'bold');
        assert.ok(items[6] instanceof CommandToggleViewModel);
        assert.equal(items.length, 7, 'exactly: split | sep | grp | ungrp | sep | bold | italic');

        // The SAME cached VM instance backs both projections (liveness of
        // CanExecute / IsActive), so ToolbarItems' command VMs are the group's.
        const arrange = [...toolbar.VisibleEntries].find(e => e instanceof ToolbarFlatGroup) as ToolbarFlatGroup;
        assert.equal(items[2], arrange.Items.Get(0), 'flat member VM is shared with VisibleEntries');
    });

    test('a toolbar CONTROL interleaves with command groups by Order', () => {
        const mod = new ShellModule();
        mod.Commands.Add(grouped('a', 'g1', 10));
        mod.Commands.Add(grouped('b', 'g2', 30));
        const ctrl = new ShellControlDefinition();
        ctrl.Context = CTX_A;
        ctrl.Order = 20;   // between the two command groups
        mod.ShellControls.Add(ctrl);

        const app = new Application();
        app.Modules.Add(mod);
        app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
        app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
        app.Services.register(ToolbarService.Key, p => new ToolbarService(p));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        const doc = new FakeDoc('a', [CTX_A]);
        host.Open(doc);

        const entries = [...toolbar.VisibleEntries];
        assert.equal(entries.length, 3);
        assert.ok(entries[0] instanceof ToolbarFlatGroup);
        assert.ok(entries[1] instanceof ShellControlViewModel);
        assert.ok(entries[2] instanceof ToolbarFlatGroup);
        // The control is bound to the active document.
        assert.equal((entries[1] as ShellControlViewModel).Target, doc);
    });

    test('a StatusBar-region control syncs into StatusService.Items for the active doc', () => {
        const mod = new ShellModule();
        const ctrl = new ShellControlDefinition();
        ctrl.Context = CTX_A;
        ctrl.Region = ShellRegion.StatusBar;
        mod.ShellControls.Add(ctrl);

        const app = new Application();
        app.Modules.Add(mod);
        app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
        app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
        app.Services.register(StatusService.Key, p => new StatusService(p));
        app.Services.register(ToolbarService.Key, p => new ToolbarService(p));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        app.Services.getRequired(ToolbarService.Key);   // instantiate (wires listeners)
        const status = app.Services.getRequired(StatusService.Key);

        // A StatusBar-region control is NOT in the command bar entries.
        const doc = new FakeDoc('a', [CTX_A]);
        host.Open(doc);
        assert.equal(status.Items.Count, 1);
        assert.ok(status.Items.Get(0) instanceof ShellControlViewModel);
        assert.equal((status.Items.Get(0) as ShellControlViewModel).Target, doc);

        // Switching to a doc that doesn't activate the context removes the cell.
        host.Open(new FakeDoc('b', [CTX_B]));
        assert.equal(status.Items.Count, 0);
    });

    test('a service-bound StatusBar control is app-global and right-docks (Alignment=End)', () => {
        const SVC = new ServiceKey<object>('svc.theme');
        const svcInstance = { tag: 'theme' };

        const mod = new ShellModule();
        const ctrl = new ShellControlDefinition();
        ctrl.Region      = ShellRegion.StatusBar;
        ctrl.Alignment   = ShellControlAlignment.End;
        ctrl.DataContext = SVC;                              // service-bound → app-global
        ctrl.Template    = new DataTemplate(() => new Border());
        mod.ShellControls.Add(ctrl);

        const app = new Application();
        app.Modules.Add(mod);
        app.Services.registerInstance(SVC, svcInstance);
        app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
        app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
        app.Services.register(StatusService.Key, p => new StatusService(p));
        app.Services.register(ToolbarService.Key, p => new ToolbarService(p));
        app.Services.getRequired(ToolbarService.Key);       // ctor Rebuild — NO active document
        const status = app.Services.getRequired(StatusService.Key);

        // Shows with no active document (app-global): a right-docked cell + a
        // trailing fill spacer so LastChildFill claims the middle.
        assert.equal(status.Items.Count, 2, 'right cell + fill spacer');
        const cell = status.Items.Get(0);
        assert.ok(cell instanceof StatusBarItem, 'right cell wrapped in a StatusBarItem');
        assert.equal(DockPanel.GetDock(cell as StatusBarItem), Dock.Right, 'docked right');
    });

    test('a StatusBar control with NO DataContext and NO Context is app-global (shown, DataContext undefined)', () => {
        // A control that drives global state itself (e.g. a ThemeSelector talking
        // to ThemeManager) sets neither axis — it must still show, with no
        // DataContext, rather than being filtered out as "no context to bind".
        const mod = new ShellModule();
        const ctrl = new ShellControlDefinition();
        ctrl.Region    = ShellRegion.StatusBar;
        ctrl.Alignment = ShellControlAlignment.End;
        ctrl.Template  = new DataTemplate(() => new Border());
        // No DataContext, no Context.
        mod.ShellControls.Add(ctrl);

        const app = new Application();
        app.Modules.Add(mod);
        app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
        app.Services.register(ContentHostService.Key, p => new DocumentsContentHostService(p));
        app.Services.register(StatusService.Key, p => new StatusService(p));
        app.Services.register(ToolbarService.Key, p => new ToolbarService(p));
        app.Services.getRequired(ToolbarService.Key);       // ctor Rebuild — NO active document
        const status = app.Services.getRequired(StatusService.Key);

        // Shown unconditionally: a right-docked cell + trailing fill spacer.
        assert.equal(status.Items.Count, 2, 'app-global cell + fill spacer');
        const cell = status.Items.Get(0);
        assert.ok(cell instanceof StatusBarItem, 'right cell wrapped in a StatusBarItem');
        assert.equal(DockPanel.GetDock(cell as StatusBarItem), Dock.Right, 'docked right');
    });

    test('IsActive reflects the active document per command, refreshed on requery', () => {
        const app = appWith(
            grouped('bold',   'style', 10, { presentation: CommandGroupPresentation.Toggles }),
            grouped('italic', 'style', 20),
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        const doc = new TogglingDoc('a', [CTX_A]);
        doc.active.add('bold');
        host.Open(doc);

        const group = [...toolbar.VisibleEntries][0]!;
        const byId = new Map([...group.Items].map(vm => [vm.Definition.Id, vm]));
        assert.equal(byId.get('bold')!.IsActive, true);
        assert.equal(byId.get('italic')!.IsActive, false);

        // Flip the selection state → the requery pulse re-reads IsActive.
        doc.active.delete('bold');
        doc.active.add('italic');
        CommandManager.InvalidateRequerySuggested();
        assert.equal(byId.get('bold')!.IsActive, false);
        assert.equal(byId.get('italic')!.IsActive, true);
    });
});

describe('ToolbarService requery', () => {
    test('the CommandManager pulse re-raises CanExecuteChanged on visible commands', () => {
        const app = appWith(command('c.a1', CTX_A));
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);
        host.Open(new FakeDoc('a', [CTX_A]));

        let fired = 0;
        toolbar.VisibleCommands.Get(0)!.Command.AddCanExecuteChangedListener(() => fired++);
        CommandManager.InvalidateRequerySuggested();
        assert.ok(fired >= 1, 'CanExecuteChanged should fire on the requery pulse');
    });
});

// The command ToolBar (ToolbarItems) is the expensive, view-bound projection:
// re-materializing it on every ActiveDocument change (buttons + all split-menu
// dropdowns) was the ~800ms tab-switch cost. Rebuild gates that teardown on the
// command SET, not the document identity — a switch between documents exposing
// the same commands leaves the realized ToolBar intact; only the requery /
// document-bound controls update. These lock in that behavior.
describe('ToolbarService — document-switch rebuild gating', () => {
    test('a switch between same-command documents keeps the realized command ToolBar (no teardown)', () => {
        const app = appWith(
            grouped('align.l', 'align', 10, { presentation: CommandGroupPresentation.SplitMenu, groupTitle: 'Align' }),
            grouped('align.r', 'align', 20),
            grouped('grp',     'arrange', 30),   // Flat group → a separator precedes it
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        host.Open(new FakeDoc('a', [CTX_A]));
        const before = [...toolbar.ToolbarItems];
        assert.ok(before.length > 0, 'toolbar built for the first document');
        assert.ok(before[0] instanceof ToolbarSplitMenuGroup, 'sanity: a split group leads');

        host.Open(new FakeDoc('a2', [CTX_A]));    // different document, IDENTICAL commands
        const after = [...toolbar.ToolbarItems];

        assert.equal(after.length, before.length, 'same item count after a same-command switch');
        // Identity across the WHOLE stream — the split group VM and the
        // separators are freshly allocated on a real rebuild, so identity here
        // proves the ToolBar was NOT torn down and rebuilt.
        for (let i = 0; i < before.length; i++)
        {
            assert.equal(after[i], before[i], `ToolbarItems[${i}] is the same instance (not rebuilt)`);
        }
    });

    test('a switch to a document with different commands DOES rebuild the command ToolBar', () => {
        const app = appWith(
            grouped('align.l', 'align', 10, { presentation: CommandGroupPresentation.SplitMenu }),
            grouped('align.r', 'align', 20),
            command('c.b1', CTX_B, 10),
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        host.Open(new FakeDoc('a', [CTX_A]));
        const splitBefore = [...toolbar.ToolbarItems][0];
        assert.ok(splitBefore instanceof ToolbarSplitMenuGroup);

        host.Open(new FakeDoc('b', [CTX_B]));     // different command set
        assert.deepEqual(ids(toolbar), ['c.b1'], 'toolbar reflows to the B command');

        host.Open(new FakeDoc('a2', [CTX_A]));     // back to A commands — must rebuild
        const splitAfter = [...toolbar.ToolbarItems][0];
        assert.ok(splitAfter instanceof ToolbarSplitMenuGroup);
        assert.notEqual(splitAfter, splitBefore, 'a genuine command-set change rebuilds the group');
    });

    test('the transient ActiveDocument=undefined during a switch does not tear down the toolbar', () => {
        const app = appWith(
            grouped('align.l', 'align', 10, { presentation: CommandGroupPresentation.SplitMenu }),
            grouped('align.r', 'align', 20),
        );
        const host = app.Services.getRequired(ContentHostService.Key) as DocumentsContentHostService;
        const toolbar = app.Services.getRequired(ToolbarService.Key);

        host.Open(new FakeDoc('a', [CTX_A]));
        const before = [...toolbar.ToolbarItems];
        assert.ok(before.length > 0);

        // The Selector clears the selection mid-switch (ActiveDocument = undefined)
        // before setting the newly-clicked document. With the document still open,
        // that transient must be ignored — not a toolbar teardown.
        host.ActiveDocument = undefined;
        assert.equal(host.OpenDocuments.Count, 1, 'document is still open during the transient');

        const during = [...toolbar.ToolbarItems];
        assert.equal(during.length, before.length, 'toolbar untouched by the transient undefined');
        for (let i = 0; i < before.length; i++)
        {
            assert.equal(during[i], before[i], `ToolbarItems[${i}] survives the transient undefined`);
        }
    });
});
