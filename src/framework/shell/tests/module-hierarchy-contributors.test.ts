import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../compiler/compile.js';
import { ShellModule } from '../module.js';
import { HierarchyContributorDefinition } from '../../hierarchy/index.js';

// Mirrors the services-block.test.ts harness: compile source, assert on the emitted JS.
function emitted(src: string): string
{
    return compile(src).js;
}

describe('.hierarchyContributors: DSL block', () =>
{
    test('a .hierarchyContributors: entry lowers to module.HierarchyContributors.Add(def)', () =>
    {
        const js = emitted(`
            module TestModule {
                .hierarchyContributors: {
                    HierarchyContributorDefinition [ ParentKeys = ["solution"], Order = 0 ]
                }
            }
        `);
        assert.match(js, /\.HierarchyContributors\.Add\(/);
    });

    test('ShellModule exposes a HierarchyContributors collection the block feeds', () =>
    {
        const mod = new ShellModule();
        assert.equal(mod.HierarchyContributors.Count, 0);
        mod.HierarchyContributors.Add(new HierarchyContributorDefinition());
        assert.equal(mod.HierarchyContributors.Count, 1);
    });
});
