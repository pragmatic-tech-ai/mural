import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../../../compiler/compile.js';
import { ShellModule } from '../module.js';
import { HierarchyActionDefinition } from '../../hierarchy/index.js';

// Mirrors module-hierarchy-contributors.test.ts: compile source, assert on the emitted JS.
function emitted(src: string): string
{
    return compile(src).js;
}

describe('.hierarchyActions: DSL block', () =>
{
    test('a .hierarchyActions: entry lowers to module.HierarchyActions.Add(def)', () =>
    {
        const js = emitted(`
            module TestModule {
                .hierarchyActions: {
                    HierarchyActionDefinition [ ActionKeys = ["project"], Order = 0 ]
                }
            }
        `);
        assert.match(js, /\.HierarchyActions\.Add\(/);
    });

    test('ShellModule exposes a HierarchyActions collection the block feeds', () =>
    {
        const mod = new ShellModule();
        assert.equal(mod.HierarchyActions.Count, 0);
        mod.HierarchyActions.Add(new HierarchyActionDefinition());
        assert.equal(mod.HierarchyActions.Count, 1);
    });
});
