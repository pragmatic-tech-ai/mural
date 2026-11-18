import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ServiceKey } from '../../../runtime/index.js';
import { ShellModule } from '../module.js';
import { DocumentDefinition } from '../documents/document-definition.js';
import { DocumentTypeRegistry } from '../documents/document-type-registry.js';

function definition(
    type: string,
    extensions: readonly string[],
    contexts: readonly ServiceKey<unknown>[] = [],
): DocumentDefinition
{
    const d = new DocumentDefinition();
    d.Type = type;
    d.Title = type;
    d.FileExtensions = extensions;
    d.CommandContexts = contexts;
    return d;
}

function moduleWith(...defs: DocumentDefinition[]): ShellModule
{
    const mod = new ShellModule();
    for (const d of defs) mod.Documents.Add(d);
    return mod;
}

function appWith(...modules: ShellModule[]): Application
{
    const app = new Application();
    for (const m of modules) app.Modules.Add(m);
    app.Services.register(DocumentTypeRegistry.Key, p => new DocumentTypeRegistry(p));
    return app;
}

describe('DocumentTypeRegistry.PopulateFromModules', () => {
    test('aggregates every module\'s document definitions', () => {
        const app = appWith(
            moduleWith(definition('board', ['.board', '.dgm'])),
            moduleWith(definition('sheet', ['.sheet'])),
        );
        const registry = app.Services.getRequired(DocumentTypeRegistry.Key);
        const types = [...registry.Definitions].map(d => d.Type);
        assert.deepEqual(types, ['board', 'sheet']);
    });

    test('GetByType resolves a definition', () => {
        const app = appWith(moduleWith(definition('board', ['.board'])));
        const registry = app.Services.getRequired(DocumentTypeRegistry.Key);
        assert.equal(registry.GetByType('board')?.Type, 'board');
        assert.equal(registry.GetByType('missing'), undefined);
    });

    test('GetByExtension matches case-insensitively, dot optional', () => {
        const app = appWith(moduleWith(definition('board', ['.board', '.dgm'])));
        const registry = app.Services.getRequired(DocumentTypeRegistry.Key);
        assert.equal(registry.GetByExtension('.DGM')?.Type, 'board');
        assert.equal(registry.GetByExtension('dgm')?.Type, 'board');
        assert.equal(registry.GetByExtension('.board')?.Type, 'board');
        assert.equal(registry.GetByExtension('.xyz'), undefined);
    });

    test('a duplicate type across modules registers once (first wins)', () => {
        const first  = definition('board', ['.board']);
        const second = definition('board', ['.dgm']);
        const app = appWith(moduleWith(first), moduleWith(second));
        const registry = app.Services.getRequired(DocumentTypeRegistry.Key);
        assert.equal(registry.Definitions.Count, 1);
        assert.equal(registry.GetByType('board'), first);
        // The dropped duplicate's extension is not indexed.
        assert.equal(registry.GetByExtension('.dgm'), undefined);
    });

    test('carries the factory and command-context tokens through', () => {
        const factory = new ServiceKey<unknown>('BoardFactory');
        const editing = new ServiceKey<unknown>('board.editing');
        const def = definition('board', ['.board'], [editing]);
        def.Factory = factory;
        const app = appWith(moduleWith(def));
        const registry = app.Services.getRequired(DocumentTypeRegistry.Key);
        const resolved = registry.GetByType('board')!;
        assert.equal(resolved.Factory, factory);
        assert.deepEqual([...resolved.CommandContexts], [editing]);
    });
});
