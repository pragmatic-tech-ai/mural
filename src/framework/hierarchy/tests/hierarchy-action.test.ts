import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyAction } from '../hierarchy-action.js';
import type { HierarchyActionContext } from '../hierarchy-action.js';

const ctx = { Anchor: undefined, Selection: [] } as unknown as HierarchyActionContext;

test('Command action runs its handler with the context and defaults enabled', () =>
{
    let ran: HierarchyActionContext | undefined;
    const a = HierarchyAction.Command('Delete', (c) => { ran = c; }, { context: ctx });
    assert.equal(a.Label, 'Delete');
    assert.equal(a.IsSeparator, false);
    assert.equal(a.Invoke.CanExecute(), true);
    a.Invoke.Execute();
    assert.equal(ran, ctx);   // handler received the captured context
    assert.equal(a.Children.Count, 0);
});

test('canExecute gates the command; captured context is passed', () =>
{
    const a = HierarchyAction.Command('Publish', () => {}, { context: ctx, canExecute: () => false, iconKey: 'Publish' });
    assert.equal(a.Invoke.CanExecute(), false);
    assert.equal(a.IconKey, 'Publish');
});

test('Separator is marked and inert', () =>
{
    const s = HierarchyAction.Separator();
    assert.equal(s.IsSeparator, true);
});
