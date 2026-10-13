import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { ContentHostService } from '../../services/content-host-service.js';
import { DocumentsContentHostService, type IDocument } from '../../services/documents-content-host-service.js';
import { DiagramDocument } from '../../../diagram/diagram-document.js';
import { EditCommandsService } from '../edit-commands-service.js';

class Fixture
{
    public readonly Provider = new ServiceProvider();
    public readonly Host: DocumentsContentHostService;
    public readonly Service: EditCommandsService;

    public constructor()
    {
        this.Host = new DocumentsContentHostService(this.Provider);
        this.Provider.registerInstance(ContentHostService.Key, this.Host);
        this.Service = new EditCommandsService(this.Provider);
    }

    public CanExecuteStates(): boolean[]
    {
        const s = this.Service;
        return [s.UndoCommand, s.RedoCommand, s.CutCommand, s.CopyCommand, s.PasteCommand].map(c => c.CanExecute(undefined));
    }
}

describe('EditCommandsService', () =>
{
    test('Key is a ServiceKey', () =>
    {
        assert.ok(EditCommandsService.Key instanceof ServiceKey);
    });

    test('all five commands are disabled and inert with no active document', () =>
    {
        const f = new Fixture();
        assert.deepEqual(f.CanExecuteStates(), [false, false, false, false, false]);
        assert.doesNotThrow(() => f.Service.PasteCommand.Execute(undefined));
    });

    test('a non-diagram active document keeps all commands disabled', () =>
    {
        const f = new Fixture();
        const doc: IDocument = { Id: 'x', Title: 'x', IsDirty: false, Save: () => undefined };
        f.Host.Open(doc);
        assert.deepEqual(f.CanExecuteStates(), [false, false, false, false, false]);
    });

    test('an active DiagramDocument enables Paste (Undo stays off with empty history)', () =>
    {
        const f = new Fixture();
        f.Host.Open(new DiagramDocument());
        assert.equal(f.Service.PasteCommand.CanExecute(undefined), true);
        assert.equal(f.Service.UndoCommand.CanExecute(undefined), false);
    });
});
