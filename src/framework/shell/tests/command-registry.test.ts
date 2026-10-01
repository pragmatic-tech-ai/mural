import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ServiceKey } from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { CommandDefinition } from '../commands/command-definition.js';
import { CommandRegistry } from '../commands/command-registry.js';

function command(id: string, group = 'g', order = 0): CommandDefinition
{
    const c = new CommandDefinition();
    c.Id = id;
    c.Title = id;
    c.Group = group;
    c.Order = order;
    c.Context = new ServiceKey<unknown>(id + '.ctx');
    return c;
}

function moduleWith(...cmds: CommandDefinition[]): ShellModule
{
    const mod = new ShellModule();
    for (const c of cmds) mod.Commands.Add(c);
    return mod;
}

function appWith(...modules: ShellModule[]): Application
{
    const app = new Application();
    for (const m of modules) app.Modules.Add(m);
    app.Services.register(CommandRegistry.Key, p => new CommandRegistry(p));
    return app;
}

describe('CommandRegistry.PopulateFromModules', () => {
    test('aggregates every module\'s command definitions', () => {
        const app = appWith(
            moduleWith(command('a.one'), command('a.two')),
            moduleWith(command('b.one')),
        );
        const registry = app.Services.getRequired(CommandRegistry.Key);
        assert.deepEqual([...registry.Commands].map(c => c.Id), ['a.one', 'a.two', 'b.one']);
    });

    test('GetById resolves a definition', () => {
        const app = appWith(moduleWith(command('a.one')));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        assert.equal(registry.GetById('a.one')?.Id, 'a.one');
        assert.equal(registry.GetById('missing'), undefined);
    });

    test('a duplicate id across modules registers once (first wins)', () => {
        const first  = command('dup', 'g', 1);
        const second = command('dup', 'g', 2);
        const app = appWith(moduleWith(first), moduleWith(second));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        assert.equal(registry.Commands.Count, 1);
        assert.equal(registry.GetById('dup'), first);
    });

    test('an id-less definition is dropped', () => {
        const app = appWith(moduleWith(command(''), command('a.one')));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        assert.deepEqual([...registry.Commands].map(c => c.Id), ['a.one']);
    });

    test('GetById resolves a nested child command', () => {
        const parent = command('build');
        const child = command('build.default');
        parent.AddChild(child);
        const app = appWith(moduleWith(parent));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        assert.equal(registry.GetById('build.default')?.Id, 'build.default');
        assert.equal(registry.GetById('build')?.Id, 'build');
    });

    test('the flat Commands collection holds only roots, not nested children', () => {
        const parent = command('build');
        const child = command('build.default');
        parent.AddChild(child);
        const app = appWith(moduleWith(parent));
        const registry = app.Services.getRequired(CommandRegistry.Key);
        const ids = [...registry.Commands].map(c => c.Id);
        assert.ok(ids.includes('build'));
        assert.ok(!ids.includes('build.default'));
    });
});
