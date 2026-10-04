import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Panel, RelayCommand } from '../../../runtime/index.js';
import { MenuItem, MenuStrip } from '../menu-strip.js';

// Exposes the protected listener count so a leak is observable.
class CountingCommand extends RelayCommand
{
    public get ListenerCount(): number { return this._listenerCount(); }
}

class Root extends Panel {}

describe('MenuItem command-source teardown on container clear', () =>
{
    beforeEach(() => { initTestApp(); });

    test('DisposeCommandSource detaches the CanExecuteChanged listener', () =>
    {
        const cmd = new CountingCommand(() => {}, () => true);
        const mi = new MenuItem();
        mi.Command = cmd;
        assert.equal(cmd.ListenerCount, 1);
        mi.DisposeCommandSource();
        assert.equal(cmd.ListenerCount, 0);
    });

    test('ClearContainerForItemOverride disposes a generated container\'s command listener', () =>
    {
        const owner = new MenuStrip();
        const cmd = new CountingCommand(() => {}, () => true);
        const vm = {}; // stand-in item data (not the container itself)
        const child = new MenuItem();
        owner.PrepareContainerForItemOverride(child, vm, 0);
        child.Command = cmd;
        assert.equal(cmd.ListenerCount, 1);
        owner.ClearContainerForItemOverride(child, vm);
        assert.equal(cmd.ListenerCount, 0);
    });

    test('repeated prepare/clear cycles do not accumulate listeners', () =>
    {
        const owner = new MenuStrip();
        const cmd = new CountingCommand(() => {}, () => true);
        for (let i = 0; i < 5; i++)
        {
            const vm = {};
            const child = new MenuItem();
            owner.PrepareContainerForItemOverride(child, vm, i);
            child.Command = cmd;
            owner.ClearContainerForItemOverride(child, vm);
        }
        assert.equal(cmd.ListenerCount, 0);
    });

    test('a recycled container re-attaches when its Command is re-set after clear', () =>
    {
        const owner = new MenuStrip();
        const a = new CountingCommand(() => {}, () => true);
        const b = new CountingCommand(() => {}, () => false);
        const child = new MenuItem();
        const vm1 = {};
        owner.PrepareContainerForItemOverride(child, vm1, 0);
        child.Command = a;
        owner.ClearContainerForItemOverride(child, vm1);
        assert.equal(a.ListenerCount, 0);
        // reuse the same container for a new item + command
        const vm2 = {};
        owner.PrepareContainerForItemOverride(child, vm2, 0);
        child.Command = b;
        assert.equal(b.ListenerCount, 1);
        assert.equal(child.IsEnabled, false); // tracks b.CanExecute
    });

    test('a non-container-cleared item keeps its listener (static menu safety)', () =>
    {
        const root = new Root();
        const cmd = new CountingCommand(() => {}, () => true);
        const mi = new MenuItem();
        root.AddChild(mi);
        mi.Command = cmd;
        // open+close a submenu-style state change must NOT drop the listener
        mi.IsSubmenuOpen = true;
        mi.IsSubmenuOpen = false;
        assert.equal(cmd.ListenerCount, 1);
    });
});
