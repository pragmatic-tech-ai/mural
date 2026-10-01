// RecentCommandContributor — the context-menu demo's dynamic "Recent"
// submenu under the Blue (File) menu (demo/demos/context-menu/context-menu-
// vm.mts). Contribute() must re-evaluate every time its owning node's
// submenu opens, not replay a cached list — these tests prove that both at
// the contributor level (direct repeated calls) and through the REAL
// machinery a reopened CommandContextMenu drives it with (CommandMenuBuilder
// + a fresh CommandViewModel per open, exactly like CommandContextMenu.
// BuildTree does on every real open — see command-context-menu.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    CommandContext,
    CommandDefinition,
    CommandMenuBuilder,
    type ICommandDispatcher,
} from '@pragmatic-tech-ai/mural/framework';
import type { ICommand, IServiceProvider, ServiceToken } from '@pragmatic-tech-ai/mural/runtime';
import { RecentCommandContributor } from '../../demos/context-menu/context-menu-vm.mjs';

// No leaf in the Recent submenu needs a resolvable command for these tests —
// they only exercise Contribute()'s re-evaluation, not dispatch.
const inertDispatcher: ICommandDispatcher = { Resolve: (): ICommand | undefined => undefined };

function providerFor(contributor: RecentCommandContributor): IServiceProvider
{
    return {
        get: (): undefined => undefined,
        getRequired: <T,>(token: ServiceToken<T>): T =>
        {
            assert.equal(token, RecentCommandContributor.Token, 'resolves via the published Token');
            return contributor as unknown as T;
        },
        has: (): boolean => true,
    };
}

function recentDef(): CommandDefinition
{
    const def = new CommandDefinition();
    def.Id = 'context-menu.blue.recent';
    def.Title = 'Recent';
    def.ChildrenContributor = RecentCommandContributor.Token;
    return def;
}

describe('RecentCommandContributor', () =>
{
    test('direct repeated calls return the same leaf ids with a bumped generation in the Title', () =>
    {
        const contributor = new RecentCommandContributor();

        const first  = contributor.Contribute(recentDef(), new CommandContext());
        const second = contributor.Contribute(recentDef(), new CommandContext());

        assert.deepEqual(first.map(d => d.Id), second.map(d => d.Id), 'leaf ids stay stable across calls (dispatch keeps working)');
        assert.notDeepEqual(first.map(d => d.Title), second.map(d => d.Title), 'titles differ — re-evaluation is visible');
        assert.ok(first[0]!.Title.includes('×1'), `expected generation 1 in ${first[0]!.Title}`);
        assert.ok(second[0]!.Title.includes('×2'), `expected generation 2 in ${second[0]!.Title}`);
    });

    test('a fresh CommandViewModel per CommandContextMenu-style open re-realizes with a new generation', () =>
    {
        // Mirrors CommandContextMenu.BuildTree: a NEW CommandMenuBuilder (and
        // therefore a NEW CommandViewModel per root) on every open — the
        // contributor instance itself persists (held by the service
        // provider), but each open's VM starts unrealized.
        const contributor = new RecentCommandContributor();
        const provider = providerFor(contributor);

        const open1Builder = new CommandMenuBuilder(inertDispatcher, provider, new CommandContext());
        const open1Vm = open1Builder.Build(recentDef());
        open1Vm.EnsureExpanded();
        const open1Titles = [...open1Vm.Children].map(c => c.Title);
        assert.equal(open1Titles.length, 3);
        assert.ok(open1Titles.every(t => t.includes('×1')), `expected generation 1 in ${JSON.stringify(open1Titles)}`);
        open1Vm.dispose();

        const open2Builder = new CommandMenuBuilder(inertDispatcher, provider, new CommandContext());
        const open2Vm = open2Builder.Build(recentDef());
        open2Vm.EnsureExpanded();
        const open2Titles = [...open2Vm.Children].map(c => c.Title);
        assert.ok(open2Titles.every(t => t.includes('×2')), `expected generation 2 in ${JSON.stringify(open2Titles)}`);
        assert.deepEqual(
            open2Titles.map((t, i) => t.replace('×2', '×1')),
            open1Titles,
            'same file names, only the generation differs',
        );
        open2Vm.dispose();
    });

    test('within ONE open, EnsureExpanded is idempotent — re-opening the SAME submenu twice does not re-call Contribute', () =>
    {
        const contributor = new RecentCommandContributor();
        const provider = providerFor(contributor);
        const builder = new CommandMenuBuilder(inertDispatcher, provider, new CommandContext());
        const vm = builder.Build(recentDef());

        vm.EnsureExpanded();
        const titlesAfterFirst = [...vm.Children].map(c => c.Title);
        vm.EnsureExpanded();   // idempotent per command-view-model.ts
        const titlesAfterSecond = [...vm.Children].map(c => c.Title);

        assert.deepEqual(titlesAfterFirst, titlesAfterSecond, 'no re-evaluation within the same open');
    });
});
