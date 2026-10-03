import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, RelayCommand, ServiceKey, type ICommand } from '../../../runtime/index.js';
import { CommandDefinition } from '../commands/command-definition.js';
import { CommandViewModel } from '../commands/command-view-model.js';
import type { ICommandContributor } from '../commands/command-contributor.js';

function def(id = 'cmd'): CommandDefinition
{
    const d = new CommandDefinition();
    d.Id = id;
    d.Title = id;
    return d;
}

function command(): RelayCommand
{
    return new RelayCommand(() => { /* no-op */ }, () => true);
}

describe('CommandViewModel', () => {
    test('is an Observable', () => {
        const vm = new CommandViewModel(def(), command());
        assert.ok(vm instanceof Observable);
    });

    test('setting IsChecked raises PropertyChanged("IsChecked") exactly once', () => {
        const vm = new CommandViewModel(def(), command());
        let fired = 0;
        vm.PropertyChanged('IsChecked').subscribe(() => { fired++; });

        vm.IsChecked = true;
        assert.equal(vm.IsChecked, true);
        assert.equal(fired, 1);
    });

    test('setting IsChecked to its current value is a no-op', () => {
        const vm = new CommandViewModel(def(), command());
        let fired = 0;
        vm.PropertyChanged('IsChecked').subscribe(() => { fired++; });

        vm.IsChecked = false;   // already false
        assert.equal(fired, 0);
    });

    test('HasChildren is false with no children and no ChildrenContributor', () => {
        const vm = new CommandViewModel(def(), command());
        assert.equal(vm.HasChildren, false);
    });

    test('HasChildren is true once a child is added', () => {
        const vm = new CommandViewModel(def(), command());
        vm.Children.Add(new CommandViewModel(def('child'), command()));
        assert.equal(vm.HasChildren, true);
    });

    test('HasChildren is true for a definition with declared Children before EnsureExpanded', () => {
        // Lazy model: the VM's own Children stays empty until EnsureExpanded()
        // realizes it, so the expand affordance must be driven off the
        // DEFINITION's declared Children, not the (still-empty) VM Children.
        const d = def();
        d.AddChild(def('child'));
        const vm = new CommandViewModel(d, command());
        assert.equal(vm.Children.Count, 0, 'sanity: not yet expanded');
        assert.equal(vm.HasChildren, true);
    });

    test('HasChildren is true when the Definition names a ChildrenContributor', () => {
        const d = def();
        d.ChildrenContributor = new ServiceKey<ICommandContributor>('test.contributor');
        const vm = new CommandViewModel(d, command());
        assert.equal(vm.HasChildren, true);
    });

    test('IsEnabled reflects the command\'s current CanExecute', () => {
        let enabled = true;
        const cmd = new RelayCommand(() => { /* no-op */ }, () => enabled);
        const vm = new CommandViewModel(def(), cmd);
        assert.equal(vm.IsEnabled, true);

        enabled = false;
        assert.equal(vm.IsEnabled, false, 'live-reads CanExecute, not cached at construction');
    });

    test('IsEnabled defaults to true when the command is undefined', () => {
        const vm = new CommandViewModel(def(), undefined as unknown as ICommand);
        assert.equal(vm.IsEnabled, true);
    });

    test('CanExecuteChanged raises PropertyChanged("IsEnabled") and updates IsEnabled', () => {
        let enabled = true;
        const cmd = new RelayCommand(() => { /* no-op */ }, () => enabled);
        const vm = new CommandViewModel(def(), cmd);
        let fired = 0;
        vm.PropertyChanged('IsEnabled').subscribe(() => { fired++; });

        enabled = false;
        cmd.RaiseCanExecuteChanged();
        assert.equal(fired, 1);
        assert.equal(vm.IsEnabled, false);
    });

    test('dispose() unsubscribes from CanExecuteChanged — no further updates', () => {
        let enabled = true;
        const cmd = new RelayCommand(() => { /* no-op */ }, () => enabled);
        const vm = new CommandViewModel(def(), cmd);
        let fired = 0;
        vm.PropertyChanged('IsEnabled').subscribe(() => { fired++; });

        vm.dispose();
        enabled = false;
        cmd.RaiseCanExecuteChanged();
        assert.equal(fired, 0, 'no PropertyChanged("IsEnabled") after dispose');
    });

    test('dispose() disposes children recursively and is idempotent', () => {
        const parent = new CommandViewModel(def('parent'), command());
        const child = new CommandViewModel(def('child'), command());
        let childDisposed = 0;
        child.dispose = (): void => { childDisposed++; };
        parent.Children.Add(child);

        parent.dispose();
        assert.equal(childDisposed, 1);
        assert.equal(parent.Children.Count, 0, 'children cleared after dispose');

        assert.doesNotThrow(() => parent.dispose(), 'second dispose is a no-op, not a throw');
    });
});
