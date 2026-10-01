import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RelayCommand, ServiceKey, type IServiceProvider } from '../../../runtime/index.js';
import { CommandDefinition } from '../commands/command-definition.js';
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
