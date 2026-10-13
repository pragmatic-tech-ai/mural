import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { ICommand } from '../../../../runtime/index.js';
import { DocumentShortcutsService } from '../document-shortcuts-service.js';

class FakeCommand implements ICommand
{
    public Executed = 0;
    public constructor(public CanRun: boolean = true) { }
    public CanExecute(): boolean { return this.CanRun; }
    public Execute(): void { this.Executed++; }
    public readonly CanExecuteChanged = undefined as never;
}

class FakeTarget
{
    public AddedType: string | undefined;
    public AddedOptions: unknown;
    public RemovedOptions: unknown;
    public Listener: ((e: Event) => void) | undefined;

    public addEventListener(type: string, listener: (e: Event) => void, options?: unknown): void
    {
        this.AddedType = type;
        this.AddedOptions = options;
        this.Listener = listener;
    }

    public removeEventListener(_type: string, listener: (e: Event) => void, options?: unknown): void
    {
        this.RemovedOptions = options;
        if (this.Listener === listener) this.Listener = undefined;
    }

    public Press(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean } = { ctrl: true }): { Prevented: boolean; Stopped: boolean }
    {
        const state = { Prevented: false, Stopped: false };
        const event = {
            key,
            ctrlKey: mods.ctrl === true,
            metaKey: mods.meta === true,
            shiftKey: mods.shift === true,
            preventDefault: (): void => { state.Prevented = true; },
            stopPropagation: (): void => { state.Stopped = true; },
        };
        this.Listener?.(event as unknown as Event);
        return state;
    }
}

class Fixture
{
    public readonly Target = new FakeTarget();
    public readonly Save = new FakeCommand();
    public readonly SaveAll = new FakeCommand();
    public readonly Close = new FakeCommand();

    public Attach()
    {
        return new DocumentShortcutsService().Attach(this.Target as unknown as EventTarget, {
            SaveActiveCommand: this.Save,
            SaveAllCommand: this.SaveAll,
            CloseActiveCommand: this.Close,
        });
    }
}

describe('DocumentShortcutsService', () =>
{
    test('registers keydown in the CAPTURE phase', () =>
    {
        const f = new Fixture();
        f.Attach();
        assert.equal(f.Target.AddedType, 'keydown');
        assert.deepEqual(f.Target.AddedOptions, { capture: true });
    });

    test('Ctrl+S executes SaveActive, Ctrl+Shift+S SaveAll, Ctrl+W CloseActive', () =>
    {
        const f = new Fixture();
        f.Attach();
        const s = f.Target.Press('s');
        assert.deepEqual([f.Save.Executed, f.SaveAll.Executed, f.Close.Executed], [1, 0, 0]);
        assert.ok(s.Prevented && s.Stopped);
        f.Target.Press('S', { ctrl: true, shift: true });
        assert.deepEqual([f.Save.Executed, f.SaveAll.Executed, f.Close.Executed], [1, 1, 0]);
        f.Target.Press('w');
        assert.deepEqual([f.Save.Executed, f.SaveAll.Executed, f.Close.Executed], [1, 1, 1]);
    });

    test('Cmd (metaKey) is accepted; a bare key or other chord passes through', () =>
    {
        const f = new Fixture();
        f.Attach();
        f.Target.Press('s', { meta: true });
        assert.equal(f.Save.Executed, 1);
        const bare = f.Target.Press('s', {});
        const other = f.Target.Press('k');
        assert.equal(f.Save.Executed, 1);
        assert.ok(!bare.Prevented && !other.Prevented);
    });

    test('a command with CanExecute=false is not executed and the key is not swallowed', () =>
    {
        const f = new Fixture();
        f.Save.CanRun = false;
        f.Attach();
        const r = f.Target.Press('s');
        assert.equal(f.Save.Executed, 0);
        assert.ok(!r.Prevented && !r.Stopped);
    });

    test('dispose detaches with the same capture option', () =>
    {
        const f = new Fixture();
        const handle = f.Attach();
        handle.dispose();
        assert.equal(f.Target.Listener, undefined);
        assert.deepEqual(f.Target.RemovedOptions, { capture: true });
    });
});
