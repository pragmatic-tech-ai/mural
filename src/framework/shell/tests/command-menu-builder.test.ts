import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CheckableRelayCommand, RelayCommand, ServiceKey, type ICommand, type IServiceProvider } from '../../../runtime/index.js';
import { CommandDefinition, CommandGroupPresentation } from '../commands/command-definition.js';
import { CommandMenuBuilder } from '../commands/command-menu-builder.js';
import { CommandContext } from '../commands/command-context.js';
import type { ICommandDispatcher } from '../commands/command-dispatcher.js';
import type { ICommandContributor } from '../commands/command-contributor.js';

function def(id: string): CommandDefinition
{
    const d = new CommandDefinition();
    d.Id = id;
    d.Title = id;
    return d;
}

// A dispatcher that always resolves — mirrors toolbar-service.test.ts's FakeDoc
// shape but as a bare ICommandDispatcher (no document surface needed here).
const dispatcher: ICommandDispatcher =
{
    Resolve(id: string): RelayCommand { return new RelayCommand(() => { /* no-op */ }, () => true, { Text: id }); },
};

// A provider stub whose getRequired throws — used by tests that never expect a
// ChildrenContributor to be resolved (no ChildrenContributor on the definition).
function throwingProvider(): IServiceProvider
{
    return { get: () => undefined, getRequired: () => { throw new Error('no service registered'); } } as unknown as IServiceProvider;
}

describe('CommandMenuBuilder.Build', () => {
    test('resolves the command and wraps the definition', () => {
        const builder = new CommandMenuBuilder(dispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(def('file'));
        assert.equal(vm.Definition.Id, 'file');
        assert.notEqual(vm.Command, undefined);
    });

    test('a plain (Flat) definition never builds a toggle VM', () => {
        const builder = new CommandMenuBuilder(dispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(def('file'));
        assert.equal(vm.IsToggle, false);
    });

    test('a Presentation=Toggles definition builds a toggle VM, seeded from the resolved ICheckableCommand', () => {
        let checked = true;
        const checkable = new CheckableRelayCommand(() => { checked = !checked; }, undefined, () => checked);
        const toggleDispatcher: ICommandDispatcher = { Resolve: (): ICommand => checkable };

        const toggleDef = def('view.showGrid');
        toggleDef.Presentation = CommandGroupPresentation.Toggles;

        const builder = new CommandMenuBuilder(toggleDispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(toggleDef);

        assert.equal(vm.IsToggle, true, 'Presentation=Toggles drives CommandViewModel.IsToggle');
        assert.equal(vm.IsChecked, true, 'IsChecked seeded from the resolved ICheckableCommand on Build');
    });

    test('a toggle VM tracks the command\'s IsChecked live, across CanExecuteChanged pulses', () => {
        let checked = false;
        const checkable = new CheckableRelayCommand(() => { /* no-op */ }, undefined, () => checked);
        const toggleDispatcher: ICommandDispatcher = { Resolve: (): ICommand => checkable };

        const toggleDef = def('view.snapToGrid');
        toggleDef.Presentation = CommandGroupPresentation.Toggles;

        const builder = new CommandMenuBuilder(toggleDispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(toggleDef);
        assert.equal(vm.IsChecked, false, 'precondition');

        // Flip the underlying state out-of-band (as the demo's Execute does) and
        // pulse the same CanExecuteChanged channel ICheckableCommand documents —
        // the VM must re-read IsChecked, not cache the Build-time snapshot.
        checked = true;
        checkable.RaiseCanExecuteChanged();
        assert.equal(vm.IsChecked, true, 'IsChecked re-read on the CanExecuteChanged pulse');

        checked = false;
        checkable.RaiseCanExecuteChanged();
        assert.equal(vm.IsChecked, false, 'IsChecked tracks back down too');
    });

    test('disposing a toggle VM detaches its CanExecuteChanged listener (no leak)', () => {
        let checked = false;
        let listenerCount = 0;
        const checkable = new CheckableRelayCommand(() => { /* no-op */ }, undefined, () => checked);
        const originalAdd = checkable.AddCanExecuteChangedListener.bind(checkable);
        const originalRemove = checkable.RemoveCanExecuteChangedListener.bind(checkable);
        checkable.AddCanExecuteChangedListener = (l) => { listenerCount++; originalAdd(l); };
        checkable.RemoveCanExecuteChangedListener = (l) => { listenerCount--; originalRemove(l); };
        const toggleDispatcher: ICommandDispatcher = { Resolve: (): ICommand => checkable };

        const toggleDef = def('view.showRulers');
        toggleDef.Presentation = CommandGroupPresentation.Toggles;

        const builder = new CommandMenuBuilder(toggleDispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(toggleDef);
        assert.equal(listenerCount, 1, 'Build registered exactly one live-sync listener');

        vm.dispose();
        assert.equal(listenerCount, 0, 'dispose() detached the listener');

        // Flipping + pulsing after dispose must not throw and must not reach the
        // (disposed) VM.
        checked = true;
        assert.doesNotThrow(() => checkable.RaiseCanExecuteChanged());
        assert.equal(vm.IsChecked, false, 'disposed VM no longer tracks the command');
    });
});

describe('CommandMenuBuilder.RealizeChildren via EnsureExpanded', () => {
    test('merges declared children first, then contributor children, once', () => {
        const parent = def('file');
        parent.AddChild(def('file.new'));
        parent.AddChild(def('file.open'));
        const token = new ServiceKey<ICommandContributor>('recent.contributor');
        parent.ChildrenContributor = token;

        let calls = 0;
        const contributor: ICommandContributor =
        {
            Contribute(_p: CommandDefinition, _c: CommandContext): readonly CommandDefinition[]
            {
                calls++;
                return [def('file.recent.a'), def('file.recent.b')];
            },
        };
        const provider = { get: () => undefined, getRequired: () => contributor } as unknown as IServiceProvider;

        const builder = new CommandMenuBuilder(dispatcher, provider, new CommandContext());
        const vm = builder.Build(parent);

        vm.EnsureExpanded();
        vm.EnsureExpanded();   // idempotent — contributor resolved once

        assert.deepEqual([...vm.Children].map(c => c.Definition.Id),
            ['file.new', 'file.open', 'file.recent.a', 'file.recent.b']);
        assert.equal(calls, 1);
    });

    test('a self-referential contributor terminates (expansion is per-level, lazy)', () => {
        const root = def('r');
        const token = new ServiceKey<ICommandContributor>('self');
        root.ChildrenContributor = token;

        const selfish: ICommandContributor =
        {
            Contribute(_p: CommandDefinition, _c: CommandContext): readonly CommandDefinition[]
            {
                const child = def('r.child');
                child.ChildrenContributor = token;
                return [child];
            },
        };
        const provider = { get: () => undefined, getRequired: () => selfish } as unknown as IServiceProvider;

        const builder = new CommandMenuBuilder(dispatcher, provider, new CommandContext());
        const vm = builder.Build(root);

        vm.EnsureExpanded();   // realizes one level only
        assert.equal([...vm.Children].length, 1);
        assert.equal([...vm.Children][0]!.HasChildren, true, 'child is expandable but NOT yet expanded');
        assert.equal([...vm.Children][0]!.Children.Count, 0);
    });
});

describe('CommandMenuBuilder-built CommandViewModel disposal', () => {
    test('dispose releases children idempotently and clears Children', () => {
        const parent = def('p');
        parent.AddChild(def('p.a'));

        const builder = new CommandMenuBuilder(dispatcher, throwingProvider(), new CommandContext());
        const vm = builder.Build(parent);
        vm.EnsureExpanded();
        assert.equal(vm.Children.Count, 1, 'sanity: expanded before dispose');

        vm.dispose();
        assert.equal(vm.Children.Count, 0);
        assert.doesNotThrow(() => vm.dispose(), 'second dispose is a no-op, not a throw');
        assert.equal(vm.Children.Count, 0);
    });
});
