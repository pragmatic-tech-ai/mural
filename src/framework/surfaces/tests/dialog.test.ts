import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { RelayCommand, Visual } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Button, ButtonVariant } from '../../buttons/button.js';
import { TextBlock } from '../../../basic/text-block.js';
import { Dialog } from '../dialog.js';
import { DialogAction } from '../dialog-action.js';

// Recursively collect every Button in a visual subtree.
function findButtons(v: Visual, out: Button[] = []): Button[]
{
    // The title-bar close IconButton is chrome, not a DialogAction button.
    if (v instanceof Button && (v as unknown as { Name?: string }).Name !== 'PART_CloseButton') out.push(v);
    for (const c of (v as unknown as { visualChildren: readonly Visual[] }).visualChildren ?? [])
        findButtons(c, out);
    return out;
}

// The label TextBlock inside a button's content subtree.
function labelOf(b: Button): string | undefined
{
    const texts: TextBlock[] = [];
    const walk = (v: Visual): void => {
        if (v instanceof TextBlock) texts.push(v);
        for (const c of (v as unknown as { visualChildren: readonly Visual[] }).visualChildren ?? []) walk(c);
    };
    walk(b);
    return texts[0]?.Text;
}

describe('Dialog — Actions array', () => {
    beforeEach(() => { initTestApp(); });

    test('renders one Button per DialogAction through the template ItemsControl', () => {
        const target = new HeadlessTarget(600, 400);
        const dialog = new Dialog();
        dialog.Title = 'Delete file?';
        dialog.Actions = [
            new DialogAction('Cancel', new RelayCommand(() => {}), ButtonVariant.Text),
            new DialogAction('Delete', new RelayCommand(() => {}), ButtonVariant.Filled),
        ];
        target.Content = dialog;
        target.Flush();

        const buttons = findButtons(dialog);
        assert.equal(buttons.length, 2, 'one button per action');
        assert.deepEqual(buttons.map(labelOf), ['Cancel', 'Delete']);
    });

    test('renders the control\'s Title (control binding, independent of DataContext)', () => {
        // PART_Title binds $$Title (the templated control's own property), so the
        // headline shows even when the Dialog's DataContext is some unrelated VM
        // (as in the inline demo) rather than an object carrying a Title.
        const target = new HeadlessTarget(600, 400);
        const dialog = new Dialog();
        dialog.Title = 'Delete file?';
        (dialog as unknown as { DataContext: unknown }).DataContext = { Result: 'x' };
        target.Content = dialog;
        target.Flush();

        const titles: TextBlock[] = [];
        const walk = (v: Visual): void => {
            if (v instanceof TextBlock && (v as unknown as { Name?: string }).Name === 'PART_Title') titles.push(v);
            for (const c of (v as unknown as { visualChildren: readonly Visual[] }).visualChildren ?? []) walk(c);
        };
        walk(dialog);
        assert.equal(titles[0]?.Text, 'Delete file?');
    });

    test('each stamped button binds to its action\'s command (Command = $Command)', () => {
        const target = new HeadlessTarget(600, 400);
        const dialog = new Dialog();
        let deleted = 0;
        dialog.Actions = [
            new DialogAction('Cancel', new RelayCommand(() => {}), ButtonVariant.Text),
            new DialogAction('Delete', new RelayCommand(() => { deleted++; }), ButtonVariant.Filled),
        ];
        target.Content = dialog;
        target.Flush();

        const del = findButtons(dialog).find((b) => labelOf(b) === 'Delete');
        assert.notEqual(del, undefined, 'Delete button stamped');
        assert.notEqual(del!.Command, undefined, 'the item template bound Command = $Command');
        del!.Command!.Execute(undefined);
        assert.equal(deleted, 1, 'invoking the bound command runs the action');
    });

    test('title bar carries a PART_CloseButton', () => {
        const dialog = new Dialog();
        assert.notEqual(dialog.GetTemplateChild('PART_CloseButton'), undefined);
    });

    test('clicking the close button fires the close-requested listeners once', () => {
        const target = new HeadlessTarget(600, 400);
        const dialog = new Dialog();
        target.Content = dialog;
        target.Flush();
        let fired = 0;
        dialog.AddCloseRequestedListener(() => { fired++; });
        const btn = dialog.GetTemplateChild('PART_CloseButton') as unknown as { fireClick(a: unknown): void };
        btn.fireClick({});
        assert.equal(fired, 1);
    });

    test('Content still renders through the ContentPresenter', () => {
        const target = new HeadlessTarget(600, 400);
        const dialog = new Dialog();
        dialog.Title = 'T';
        const body = new TextBlock();
        body.Text = 'sentinel-body';
        (dialog as unknown as { Content: Visual }).Content = body;
        target.Content = dialog;
        target.Flush();

        const found: TextBlock[] = [];
        const walk = (v: Visual): void => {
            if (v instanceof TextBlock && v.Text === 'sentinel-body') found.push(v);
            for (const c of (v as unknown as { visualChildren: readonly Visual[] }).visualChildren ?? []) walk(c);
        };
        walk(dialog);
        assert.equal(found.length, 1);
    });
});
