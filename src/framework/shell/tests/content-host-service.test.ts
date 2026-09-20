import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, MetaData, MuralBase, type IServiceProvider } from '../../../runtime/index.js';
import { resolveKey } from '../../../runtime/model-internals.js';
import { ContentHostService } from '../services/content-host-service.js';
import {
    DocumentsContentHostService,
    type IDocument,
} from '../services/documents-content-host-service.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { CommandDefinition } from '../commands/command-definition.js';
import { ShellRegion } from '../commands/shell-control-definition.js';
import type { ICommandTarget } from '../commands/command-target.js';

// A test document that records Save() calls and can be marked dirty.
class FakeDoc implements IDocument
{
    public IsDirty = false;
    public saveCount = 0;
    constructor(public readonly Id: string, public readonly Title: string = id2title(Id)) {}
    public Save(): void { this.saveCount++; this.IsDirty = false; }
}
function id2title(id: string): string { return id.toUpperCase(); }

// A MuralBase document whose IsDirty is a reactive DP (so the host's aggregation
// sees changes), recording Save() calls.
class DirtyDoc extends MuralBase implements IDocument
{
    static { MuralBase.RegisterProperty(DirtyDoc, 'IsDirty', false, MetaData.None); }
    public saveCount = 0;
    constructor(public readonly Id: string, public readonly Title: string = Id) { super(); }
    public get IsDirty(): boolean { return this.get_property_value(resolveKey(this, undefined, 'IsDirty')); }
    public markDirty(): void { this.set_property_value(resolveKey(this, undefined, 'IsDirty'), true); }
    public Save(): void { this.saveCount++; this.set_property_value(resolveKey(this, undefined, 'IsDirty'), false); }
}

// A MuralBase document that exposes IsDirty as a PLAIN FIELD (no registered DP) —
// the host must tolerate it (contribute its static IsDirty, no live
// subscription) rather than throw when resolving a non-existent DP.
class PlainFieldDoc extends MuralBase implements IDocument
{
    public IsDirty = false;
    public saveCount = 0;
    constructor(public readonly Id: string, public readonly Title: string = Id) { super(); }
    public Save(): void { this.saveCount++; this.IsDirty = false; }
}

function provider(): IServiceProvider { return new Application().Services; }

// A document that also handles commands — so ExtendedCommands dispatch can be
// observed.
class CommandDoc implements IDocument, ICommandTarget
{
    public readonly Title = 'doc';
    public readonly IsDirty = false;
    public readonly CommandContexts: readonly never[] = [];   // no contexts; still a target
    public readonly executed: CommandDefinition[] = [];
    public canRun = true;
    constructor(public readonly Id: string) {}
    public Save(): void { /* no-op */ }
    public Execute(def: CommandDefinition): void { this.executed.push(def); }
    public CanExecute(_def: CommandDefinition): boolean { return this.canRun; }
}

function cmd(id: string, region: ShellRegion = ShellRegion.Toolbar): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id; c.Title = id; c.Region = region;
    return c;
}

describe('ContentHostService', () => {
    test('View(obj) sets Content; View(undefined) clears', () => {
        const host = new ContentHostService(provider());
        assert.equal(host.Content, undefined);

        const obj = { hello: 'world' };
        host.View(obj);
        assert.equal(host.Content, obj);

        host.View(undefined);
        assert.equal(host.Content, undefined);
    });
});

describe('DocumentsContentHostService', () => {
    test('Open() adds, activates, and presents the document', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');

        host.Open(a);
        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(host.ActiveDocument, a);
        // ActiveDocument routes through the base View() → Content tracks it.
        assert.equal(host.Content, a);
    });

    test('Open() dedupes by Id — re-opening re-activates the existing instance', () => {
        const host = new DocumentsContentHostService(provider());
        const a1 = new FakeDoc('a');
        const b  = new FakeDoc('b');
        const a2 = new FakeDoc('a');   // same Id, different instance

        host.Open(a1);
        host.Open(b);
        host.Open(a2);

        assert.equal(host.OpenDocuments.Count, 2, 'no duplicate for Id "a"');
        assert.equal(host.ActiveDocument, a1, 're-activates the ORIGINAL instance');
        assert.equal(host.Content, a1);
    });

    test('Close() of the active document activates the shifted-in neighbour', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');
        const c = new FakeDoc('c');
        host.Open(a); host.Open(b); host.Open(c);   // active = c

        host.ActiveDocument = b;                    // active middle
        host.Close(b);
        // b was at index 1; c shifts into slot 1 → c becomes active.
        assert.equal(host.OpenDocuments.Count, 2);
        assert.equal(host.ActiveDocument, c);
        assert.equal(host.Content, c);
    });

    test('Close() of a non-active document leaves the active one untouched', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');
        host.Open(a); host.Open(b);                 // active = b

        host.Close(a);
        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(host.ActiveDocument, b, 'active unchanged');
    });

    test('Close() of the last document clears the region', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        host.Open(a);

        host.Close(a);
        assert.equal(host.OpenDocuments.Count, 0);
        assert.equal(host.ActiveDocument, undefined);
        assert.equal(host.Content, undefined);
    });

    test('Close() of an unopened document is a no-op', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        host.Open(a);
        host.Close(new FakeDoc('z'));               // never opened
        assert.equal(host.OpenDocuments.Count, 1);
        assert.equal(host.ActiveDocument, a);
    });

    test('Save() defaults to the active document; Save(doc) targets a specific one', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        const b = new FakeDoc('b');
        host.Open(a); host.Open(b);                 // active = b

        host.Save();                                // → b
        assert.equal(b.saveCount, 1);
        assert.equal(a.saveCount, 0);

        host.Save(a);                               // explicit target
        assert.equal(a.saveCount, 1);
    });

    test('Save() with nothing active and no argument is a no-op', () => {
        const host = new DocumentsContentHostService(provider());
        assert.doesNotThrow(() => host.Save());
    });

    test('CloseAll() empties the open-set and clears the region', () => {
        const host = new DocumentsContentHostService(provider());
        host.Open(new FakeDoc('a')); host.Open(new FakeDoc('b')); host.Open(new FakeDoc('c'));

        host.CloseAll();
        assert.equal(host.OpenDocuments.Count, 0);
        assert.equal(host.ActiveDocument, undefined);
        assert.equal(host.Content, undefined);
    });

    test('CloseAll() on an empty host is a no-op', () => {
        const host = new DocumentsContentHostService(provider());
        assert.doesNotThrow(() => host.CloseAll());
        assert.equal(host.OpenDocuments.Count, 0);
    });

    test('CloseAllCommand runs CloseAll()', () => {
        const host = new DocumentsContentHostService(provider());
        host.Open(new FakeDoc('a')); host.Open(new FakeDoc('b'));

        host.CloseAllCommand.Execute(undefined);
        assert.equal(host.OpenDocuments.Count, 0);
        assert.equal(host.ActiveDocument, undefined);
    });

    test('ActivateById / ActivateDocumentCommand makes a document active', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a'); const b = new FakeDoc('b');
        host.Open(a); host.Open(b);                  // active = b

        host.ActivateById('a');
        assert.equal(host.ActiveDocument, a);
        assert.equal(host.Content, a);

        host.ActivateDocumentCommand.Execute('b');
        assert.equal(host.ActiveDocument, b);
    });

    test('ActivateById on an unknown id is a no-op', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new FakeDoc('a');
        host.Open(a);
        host.ActivateById('nope');
        assert.equal(host.ActiveDocument, a, 'active unchanged');
    });

    // ── ExtendedCommands (editor-region command strip) ──────────────────────
    function hostWithCommands(...defs: CommandDefinition[]): { host: DocumentsContentHostService; registry: CommandRegistry }
    {
        const app = new Application();
        app.Services.register(CommandRegistry.Key, (p) => new CommandRegistry(p));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        for (const d of defs) registry.Commands.Add(d);
        const host = new DocumentsContentHostService(app.Services);
        return { host, registry };
    }

    test('ExtendedCommands collects only EditorActions-region commands', () => {
        const { host } = hostWithCommands(
            cmd('e1', ShellRegion.EditorActions), cmd('t1'), cmd('e2', ShellRegion.EditorActions));
        assert.equal(host.ExtendedCommands.Count, 2);
        assert.deepEqual(
            [host.ExtendedCommands.Get(0)!.Definition.Id, host.ExtendedCommands.Get(1)!.Definition.Id],
            ['e1', 'e2']);
    });

    test('ExtendedCommands updates when a command is registered later', () => {
        const { host, registry } = hostWithCommands(cmd('e1', ShellRegion.EditorActions));
        assert.equal(host.ExtendedCommands.Count, 1);
        registry.Commands.Add(cmd('e2', ShellRegion.EditorActions));
        assert.equal(host.ExtendedCommands.Count, 2);
    });

    test('an ExtendedCommands VM dispatches to the active document', () => {
        const { host } = hostWithCommands(cmd('e1', ShellRegion.EditorActions));
        const doc = new CommandDoc('d');
        host.Open(doc);
        host.ExtendedCommands.Get(0)!.Command.Execute(undefined);
        assert.deepEqual(doc.executed.map((d) => d.Id), ['e1']);
    });

    test('ExtendedCommands is empty when no CommandRegistry is registered', () => {
        const host = new DocumentsContentHostService(provider());
        assert.equal(host.ExtendedCommands.Count, 0);
    });

    // ── TabMenu (⋯ overflow menu rows) ──────────────────────────────────────
    test('TabMenu is empty with no open documents', () => {
        const host = new DocumentsContentHostService(provider());
        assert.equal(host.TabMenu.Count, 0);
    });

    test('TabMenu is [Close All action, separator, ...one row per document]', () => {
        const host = new DocumentsContentHostService(provider());
        host.Open(new FakeDoc('a')); host.Open(new FakeDoc('b'));
        const kinds = [];
        for (const item of host.TabMenu) kinds.push(item.constructor.name);
        assert.deepEqual(kinds, ['TabMenuAction', 'TabMenuSeparator', 'TabMenuDocument', 'TabMenuDocument']);
    });

    test('TabMenu re-synthesises on open / close', () => {
        const host = new DocumentsContentHostService(provider());
        host.Open(new FakeDoc('a'));
        assert.equal(host.TabMenu.Count, 3);          // action + sep + 1 doc
        host.Open(new FakeDoc('b'));
        assert.equal(host.TabMenu.Count, 4);          // + 1 doc
        host.CloseAll();
        assert.equal(host.TabMenu.Count, 0);
    });

    test('is substitutable for the base — resolves under ContentHostService.Key', () => {
        const app = new Application();
        app.Services.registerScoped(ContentHostService.Key, (p) => new DocumentsContentHostService(p));
        const resolved = app.Services.getRequired(ContentHostService.Key);
        assert.ok(resolved instanceof DocumentsContentHostService);
        // The region binds $service(ContentHostService).Content; document
        // commands resolve the same key and cast to call Open/Close/Save.
        (resolved as DocumentsContentHostService).Open(new FakeDoc('a'));
        assert.equal(resolved.Content instanceof FakeDoc, true);
    });
});

describe('DocumentsContentHostService — dirty tracking + save commands', () => {
    test('AnyDirty aggregates open documents reactively', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new DirtyDoc('a'); const b = new DirtyDoc('b');
        host.Open(a); host.Open(b);
        assert.equal(host.AnyDirty, false, 'clean set → false');
        a.markDirty();
        assert.equal(host.AnyDirty, true, 'a dirty → true');
        a.Save();
        assert.equal(host.AnyDirty, false, 'a saved → false');
    });

    test('removing the only dirty doc recomputes AnyDirty', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new DirtyDoc('a'); host.Open(a); a.markDirty();
        assert.equal(host.AnyDirty, true);
        host.Close(a);
        assert.equal(host.AnyDirty, false, 'closing the dirty doc clears AnyDirty');
    });

    test('SaveActiveCommand: enabled iff active doc is dirty; saves the active doc', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new DirtyDoc('a'); host.Open(a);
        assert.equal(host.SaveActiveCommand.CanExecute(undefined), false, 'clean → disabled');
        a.markDirty();
        assert.equal(host.SaveActiveCommand.CanExecute(undefined), true, 'dirty → enabled');
        host.SaveActiveCommand.Execute(undefined);
        assert.equal(a.saveCount, 1);
        assert.equal(host.SaveActiveCommand.CanExecute(undefined), false, 'saved → disabled');
    });

    test('a MuralBase document without an IsDirty DP is tolerated (static, no throw)', () => {
        const host = new DocumentsContentHostService(provider());
        const a = new PlainFieldDoc('a');
        assert.doesNotThrow(() => host.Open(a), 'opening a plain-field MuralBase doc must not throw');
        assert.equal(host.AnyDirty, false, 'clean static field → not dirty');
        a.IsDirty = true;                       // plain field flip — no notification
        // No DP, so no reactive update; but any open-set change re-reads the
        // static flag through recomputeDirty().
        host.Open(new PlainFieldDoc('b'));
        assert.equal(host.AnyDirty, true, 'recompute on open-set change reflects the static flag');
    });

    test('SaveAllCommand: enabled iff any dirty; saves only the dirty docs', async () => {
        const host = new DocumentsContentHostService(provider());
        const a = new DirtyDoc('a'); const b = new DirtyDoc('b'); const c = new DirtyDoc('c');
        host.Open(a); host.Open(b); host.Open(c);
        assert.equal(host.SaveAllCommand.CanExecute(undefined), false);
        a.markDirty(); c.markDirty();
        assert.equal(host.SaveAllCommand.CanExecute(undefined), true);
        host.SaveAllCommand.Execute(undefined);
        // SaveAll() is async (awaits each doc.Save()); drain the task queue.
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(a.saveCount, 1); assert.equal(b.saveCount, 0); assert.equal(c.saveCount, 1);
        assert.equal(host.SaveAllCommand.CanExecute(undefined), false, 'all clean → disabled');
    });
});
