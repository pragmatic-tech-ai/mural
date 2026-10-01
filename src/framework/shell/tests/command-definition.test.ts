import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, type ServiceToken } from '../../../runtime/index.js';
import { CommandDefinition } from '../commands/command-definition.js';
import type { ICommandContributor } from '../commands/command-contributor.js';

describe('CommandDefinition — hierarchical children', () => {
    test('AddChild appends to Children', () => {
        const parent = new CommandDefinition();
        parent.Id = 'build';
        const child = new CommandDefinition();
        child.Id = 'build.default';

        parent.AddChild(child);

        assert.equal(parent.Children.Count, 1);
        assert.equal([...parent.Children][0].Id, 'build.default');
    });

    test('ChildrenContributor defaults to undefined and round-trips a ServiceToken', () => {
        const definition = new CommandDefinition();
        assert.equal(definition.ChildrenContributor, undefined);

        const contributorKey: ServiceToken<ICommandContributor> = new ServiceKey<ICommandContributor>('build.contributor');
        definition.ChildrenContributor = contributorKey;

        assert.equal(definition.ChildrenContributor, contributorKey);
    });
});
