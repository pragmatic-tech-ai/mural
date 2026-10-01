import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandContext } from '../../shell/commands/command-context.js';
import { isCheckableCommand } from '../../../runtime/command.js';
import { makeDiagramDocumentWithSelection } from './helpers/diagram-command-harness.js';
import { DiagramCommandId } from '../diagram-command-contexts.js';

test('Resolve returns the executor command for a known id', () =>
{
    const doc = makeDiagramDocumentWithSelection();
    const cmd = doc.Resolve(DiagramCommandId.AlignLeft, new CommandContext());
    assert.notEqual(cmd, undefined);
    assert.equal(typeof cmd!.Execute, 'function');
});

test('Resolve of a toggle id yields a checkable command whose IsChecked reflects the active predicate', () =>
{
    const doc = makeDiagramDocumentWithSelection({ bold: true });
    const cmd = doc.Resolve(DiagramCommandId.TextBold, new CommandContext());
    assert.ok(cmd !== undefined && isCheckableCommand(cmd));
    assert.equal((cmd as { IsChecked: boolean }).IsChecked, true);

    // Flip the view's SelectionBold DP directly (no cmd re-resolve) and confirm
    // IsChecked re-reads it live — CheckableRelayCommand pulls the predicate on
    // demand rather than caching it at Resolve time.
    (doc.ActiveView as unknown as { SelectionBold: boolean }).SelectionBold = false;
    assert.equal((cmd as { IsChecked: boolean }).IsChecked, false);
});

test('Resolve of an unknown id returns undefined', () =>
{
    const doc = makeDiagramDocumentWithSelection();
    assert.equal(doc.Resolve('nope.not.a.command', new CommandContext()), undefined);
});
