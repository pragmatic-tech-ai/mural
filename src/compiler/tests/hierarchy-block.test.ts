import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';

// Pure source-to-source test, mirroring command-nesting.test.ts's style
// (there is no shared `helpers.ts` harness in this directory — each test
// file defines its own local `emitted()` wrapping `compile()`).
function emitted(src: string): string
{
    return compile(src).js;
}

describe('Hierarchy { } block — Contributor fan-out', () =>
{
    test('each Contributor lowers to a HierarchyContributorDefinition on HierarchyContributors', () =>
    {
        const js = emitted(`
            import ProjectsContributor from "./projects-contributor.mjs"
            import ConnectionsContributor from "./connections-contributor.mjs"

            shell module ExplorerModule {
                Hierarchy {
                    Contributor [ Under = "solution", Use = ProjectsContributor, Order = 10 ]
                    Contributor [ Under = ["project", "folder"], Use = ConnectionsContributor, Order = 20 ]
                }
            }
        `);
        assert.match(js, /new HierarchyContributorDefinition\(\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ParentKeysKey, \["solution"\]\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ContributorKey, ProjectsContributor\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.OrderKey, 10\)/);
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ParentKeysKey, \["project", "folder"\]\)/);
        assert.match(js, /\.HierarchyContributors\.Add\(/);
    });

    test('a non-Contributor entry in Hierarchy { } throws', () =>
    {
        assert.throws(
            () => emitted(`
                shell module ExplorerModule {
                    Hierarchy {
                        NotAContributor [ Under = "solution" ]
                    }
                }
            `),
            /Hierarchy \{ \} accepts only Contributor entries/,
        );
    });
});
