import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../compile.js';

// Pure source-to-source tests, mirroring compile.test.ts's style: assert on
// substrings of the emitted JS rather than executing the compiled module
// (there is no harness that runs an emitted Mural module and hands back a
// live instance — see compile.test.ts's own `emitted()` helper).
function emitted(src: string): string
{
    return compile(src).js;
}

describe('compile — nested CommandDefinition bodies (Children)', () => {
    test('a nested CommandDefinition body lowers into the parent via AddChild', () => {
        const js = emitted(`
            shell module DiagramModule {
                .commands: {
                    CommandDefinition[Id="build", Title="Build"] {
                        CommandDefinition[Id="build.default", Title="Build (Default)"]
                    }
                }
            }
        `);
        // The nested CommandDefinition routes through the list slot
        // (DEFAULT_SLOT_INFO['CommandDefinition'] = Children) → AddChild,
        // exactly like Canvas children / ShellModule Capabilities.
        assert.match(js, /_commandDefinition\d+\.AddChild\(_commandDefinition\d+\);/);
        // The outer CommandDefinition is still appended to the module's
        // Commands collection via the `.commands:` member-block (→ Commands.Add),
        // the separate top-level mechanism this task does NOT change.
        assert.match(js, /_shellModule\d+\.Commands\.Add\(_commandDefinition\d+\);/);
    });
});

describe('compile — CommandDefinition.Region = MainMenu (ShellRegion)', () => {
    test('a `.commands:` root declaring Region = MainMenu resolves to the ShellRegion enum member', () => {
        // Region = MainMenu authors a main-menu-bar root (MainMenuService, A2
        // Task 5) exactly as Region = StatusBar authors a status-bar control —
        // resolved via PROPERTY_TO_ENUM['Region'] = ['ShellRegion'], so it must
        // be registered in ENUM_MEMBERS['ShellRegion'] for a bare `MainMenu`
        // identifier to resolve here.
        const js = emitted(`
            shell module DiagramModule {
                .commands: {
                    CommandDefinition[Id="file", Title="File", Region=MainMenu]
                }
            }
        `);
        assert.match(
            js,
            /import \{ ShellRegion \} from "@pragmatic-tech-ai\/mural\/framework\/shell\/commands\/shell-control-definition\.js";/,
        );
        assert.match(
            js,
            /_commandDefinition\d+\.set_property_value\(CommandDefinition\.RegionKey, ShellRegion\.MainMenu\);/,
        );
        assert.match(js, /_shellModule\d+\.Commands\.Add\(_commandDefinition\d+\);/);
    });
});
