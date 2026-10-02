import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RelayCommand, type ICommand } from '../../../runtime/index.js';
import { CommandContext } from '../../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../../shell/commands/command-dispatcher.js';
import { HierarchyRoutingDispatcher } from '../hierarchy-routing-dispatcher.js';

describe('HierarchyRoutingDispatcher', () =>
{
    test('routes an id to the dispatcher registered for it', () =>
    {
        const log: string[] = [];
        const a: ICommandDispatcher = { Resolve: id => new RelayCommand(() => log.push('a:' + id)) };
        const b: ICommandDispatcher = { Resolve: id => new RelayCommand(() => log.push('b:' + id)) };
        const routing = new HierarchyRoutingDispatcher(new Map<string, ICommandDispatcher>([['x', a], ['y', b]]));
        (routing.Resolve('y', new CommandContext()) as ICommand).Execute(undefined);
        assert.deepEqual(log, ['b:y']);
    });

    test('returns undefined for an unrouted id', () =>
    {
        const routing = new HierarchyRoutingDispatcher(new Map());
        assert.equal(routing.Resolve('missing', new CommandContext()), undefined);
    });
});
