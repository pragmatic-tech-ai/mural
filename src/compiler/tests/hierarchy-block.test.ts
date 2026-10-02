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

    test('nested CommandDefinitions become the contributor Actions with interned Context', () =>
    {
        const js = emitted(`
            import ProjectsContributor from "./projects-contributor.mjs"

            shell module ExplorerModule {
                Hierarchy {
                    Contributor [ Under = "solution", Use = ProjectsContributor, Order = 10 ] {
                        CommandDefinition [ Id = "project.build", Title = "Build", Context = "project", Icon = @Build ] {
                            CommandDefinition [ Id = "project.build.default", Title = "Build (Default)", Context = "project" ]
                        }
                        CommandDefinition [ Id = "folder.newFile", Title = "New File", Context = "folder" ]
                    }
                }
            }
        `);
        // top-level actions collected into an array assigned to Actions
        assert.match(js, /set_property_value\(HierarchyContributorDefinition\.ActionsKey, \[/);
        // Context authored as a key string lowers to the interner call
        assert.match(js, /set_property_value\(CommandDefinition\.ContextKey, HierarchyContext\.For\("project"\)\)/);
        assert.match(js, /set_property_value\(CommandDefinition\.ContextKey, HierarchyContext\.For\("folder"\)\)/);
        // nesting still routes through AddChild
        assert.match(js, /\.AddChild\(/);
        // Icon ref still lowers as a resource
        assert.match(js, /DynamicResource\(/);
    });

    test('a normal .commands: block Context keeps the bare class/token reference (hook does not leak)', () =>
    {
        const js = emitted(`
            shell module DiagramModule {
                .commands: {
                    CommandDefinition[Id="build", Title="Build", Context=DiagramEditingContext]
                }
            }
        `);
        assert.match(js, /set_property_value\(CommandDefinition\.ContextKey, DiagramEditingContext\)/);
        assert.doesNotMatch(js, /HierarchyContext\.For/);
    });

    test('a non-CommandDefinition entry in a Contributor body throws', () =>
    {
        assert.throws(
            () => emitted(`
                import SomeContributor from "./some-contributor.mjs"

                shell module ExplorerModule {
                    Hierarchy {
                        Contributor [ Under = "x", Use = SomeContributor, Order = 0 ] {
                            NotACommand [ ]
                        }
                    }
                }
            `),
            /accepts only CommandDefinition entries/,
        );
    });
});
