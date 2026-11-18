import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RelayCommand, ServiceKey, ServiceProvider } from '../../../../runtime/index.js';
import { ContentHostService } from '../../services/content-host-service.js';
import { DocumentsContentHostService, type IDocument } from '../../services/documents-content-host-service.js';
import { BoardDocument } from '../../../board/board-document.js';
import type { Board } from '../../../board/board.js';
import type { BoardHistory } from '../../../board/history/board-history.js';
import { EditCommandsService } from '../edit-commands-service.js';

// A BoardDocument whose undo/redo and active view are observable fakes, so the
// service's routing can be asserted without standing up a live Board control.
class SpyBoardDocument extends BoardDocument
{
    public UndoCalls = 0;
    public RedoCalls = 0;
    public readonly CutSpy = new RelayCommand(() => { this.CutCalls++; });
    public readonly CopySpy = new RelayCommand(() => { this.CopyCalls++; });
    public readonly PasteSpy = new RelayCommand(() => { this.PasteCalls++; });
    public CutCalls = 0;
    public CopyCalls = 0;
    public PasteCalls = 0;

    public override Undo(): void { this.UndoCalls++; }
    public override Redo(): void { this.RedoCalls++; }
    public override get History(): BoardHistory
    {
        return { CanUndo: true, CanRedo: true } as unknown as BoardHistory;
    }
    public override get ActiveView(): Board | undefined
    {
        return { CutCommand: this.CutSpy, CopyCommand: this.CopySpy, PasteCommand: this.PasteSpy } as unknown as Board;
    }
}

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

    test('a non-board active document keeps all commands disabled', () =>
    {
        const f = new Fixture();
        const doc: IDocument = { Id: 'x', Title: 'x', IsDirty: false, Save: () => undefined };
        f.Host.Open(doc);
        assert.deepEqual(f.CanExecuteStates(), [false, false, false, false, false]);
    });

    test('an active BoardDocument enables Paste (Undo stays off with empty history)', () =>
    {
        const f = new Fixture();
        f.Host.Open(new BoardDocument());
        assert.equal(f.Service.PasteCommand.CanExecute(undefined), true);
        assert.equal(f.Service.UndoCommand.CanExecute(undefined), false);
    });

    test('each command routes to the active board operation', () =>
    {
        const f = new Fixture();
        const doc = new SpyBoardDocument();
        f.Host.Open(doc);
        assert.deepEqual(f.CanExecuteStates(), [true, true, true, true, true]);

        f.Service.UndoCommand.Execute(undefined);
        f.Service.RedoCommand.Execute(undefined);
        f.Service.CutCommand.Execute(undefined);
        f.Service.CopyCommand.Execute(undefined);
        f.Service.PasteCommand.Execute(undefined);

        assert.deepEqual(
            [doc.UndoCalls, doc.RedoCalls, doc.CutCalls, doc.CopyCalls, doc.PasteCalls],
            [1, 1, 1, 1, 1]);
    });

    test('changing the active document re-raises CanExecuteChanged on every command', () =>
    {
        const f = new Fixture();
        const s = f.Service;
        const commands = [s.UndoCommand, s.RedoCommand, s.CutCommand, s.CopyCommand, s.PasteCommand];
        const raised = commands.map(() => 0);
        commands.forEach((c, i) => c.AddCanExecuteChangedListener(() => { raised[i]++; }));

        f.Host.Open(new SpyBoardDocument());

        assert.ok(raised.every(n => n >= 1), `each command should re-raise, got ${raised.join(',')}`);
    });
});
