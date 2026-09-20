import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Size, Rect } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Border } from '../../../basic/border.js';
import { TextBlock } from '../../../basic/text-block.js';
import { ContentPresenter } from '../../../basic/templates/content-presenter.js';
import { ShellSideContentPane } from '../shell-side-content-pane.js';

// A fixed-size leaf used as Content / Commands so slotting is observable.
class Leaf extends Border
{
    constructor(private box = new Size(20, 12)) { super(); }
    protected override MeasureOverride(): Size { return this.box; }
}

describe('ShellSideContentPane', () => {
    beforeEach(() => { initTestApp(); });

    test('applies its default template with all named parts', () => {
        const root = new ShellSideContentPane().visualChildren[0]!;
        for (const part of ['PART_Header', 'PART_Title', 'PART_Commands', 'PART_ContentHost'])
        {
            assert.ok(root.FindName(part) !== undefined, `${part} present`);
        }
    });

    test('Header drives the title TextBlock text', () => {
        const pane = new ShellSideContentPane();
        pane.Header = 'EXPLORER';
        const title = pane.visualChildren[0]!.FindName('PART_Title') as TextBlock;
        assert.ok(title instanceof TextBlock);
        assert.equal(title.Text, 'EXPLORER');
    });

    test('Commands slots into the header commands presenter (not the content host)', () => {
        const pane = new ShellSideContentPane();
        const bar = new Leaf();
        pane.Commands = bar;
        const commands = pane.visualChildren[0]!.FindName('PART_Commands') as ContentPresenter;
        assert.equal(commands.visualChildren[0], bar);
    });

    test('Content slots into PART_ContentHost — the first ContentPresenter', () => {
        const pane = new ShellSideContentPane();
        const body = new Leaf();
        pane.Content = body;
        const host = pane.visualChildren[0]!.FindName('PART_ContentHost') as ContentPresenter;
        assert.equal(host.visualChildren[0], body, 'content lands in PART_ContentHost, not PART_Commands');
    });

    test('Content and Commands stay in their own presenters simultaneously', () => {
        const pane = new ShellSideContentPane();
        const body = new Leaf();
        const bar  = new Leaf();
        pane.Content  = body;
        pane.Commands = bar;
        const host     = pane.visualChildren[0]!.FindName('PART_ContentHost') as ContentPresenter;
        const commands = pane.visualChildren[0]!.FindName('PART_Commands') as ContentPresenter;
        assert.equal(host.visualChildren[0], body);
        assert.equal(commands.visualChildren[0], bar);
    });

    test('header sits above the content (row 0 over row 1)', () => {
        const pane = new ShellSideContentPane();
        pane.Header  = 'FILES';
        pane.Content = new Leaf();
        pane.Measure(new Size(300, 400));
        pane.Arrange(new Rect(0, 0, 300, 400));
        const header = pane.visualChildren[0]!.FindName('PART_Header')!;
        const host   = pane.visualChildren[0]!.FindName('PART_ContentHost')!;
        assert.ok(header.ArrangedRect.Y < host.ArrangedRect.Y, 'header above content');
    });
});
