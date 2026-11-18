// FormatMirror text/character channel must reach a CONTENT VM whose label lives
// outside a ShapeText (an arch node's `$Label` tile) via the VM's exposed
// ITextStyleTarget — the character/paragraph analogue of the Fill/Stroke
// paint-target redirect. Selecting such a VM seeds the toolbar DPs from its
// TextStyle, and an edit broadcasts back onto it.
import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, Size, Visual, ModifierKeys, type MountableTarget } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Brush, FontFamily, TextAlignment } from '../../../visual-engine/index.js';
import { Board } from '../board.js';
import { NodeViewModel } from '../node-view-model.js';
import { SelectionMode } from '../../list/list-box.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import type { ITextStyleTarget } from '../shape-text.js';

// Records what FormatMirror applies; seeds from its current fields.
class FakeTextStyle implements ITextStyleTarget
{
    public family = 'Inter'; public size = 12; public fg: Brush | undefined = undefined;
    public bold = false; public italic = false; public underline = false; public strike = false;
    public align = TextAlignment.Center;
    public ApplyFontFamily(f: FontFamily | string): void { this.family = typeof f === 'string' ? f : f.Source; }
    public ApplyFontSize(n: number): void { this.size = n; }
    public ApplyForeground(b: Brush): void { this.fg = b; }
    public ApplyBold(on: boolean): void { this.bold = on; }
    public ApplyItalic(on: boolean): void { this.italic = on; }
    public ApplyUnderline(on: boolean): void { this.underline = on; }
    public ApplyStrikethrough(on: boolean): void { this.strike = on; }
    public ApplyParagraphAlignment(a: TextAlignment): void { this.align = a; }
    public CurrentFontFamily(): string { return this.family; }
    public CurrentFontSize(): number { return this.size; }
    public CurrentForeground(): Brush | undefined { return this.fg; }
    public CurrentBold(): boolean { return this.bold; }
    public CurrentItalic(): boolean { return this.italic; }
    public CurrentUnderline(): boolean { return this.underline; }
    public CurrentStrikethrough(): boolean { return this.strike; }
    public CurrentParagraphAlignment(): TextAlignment { return this.align; }
}

// A content VM with no ShapeText, exposing its label styling as an ITextStyleTarget.
class LabelVM extends NodeViewModel
{
    public readonly style = new FakeTextStyle();
    public get TextStyle(): ITextStyleTarget { return this.style; }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: readonly NodeViewModel[]): Board
{
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    board.ItemsSource   = new ObservableCollection<unknown>([...items]) as never;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return board;
}

function select(board: Board, vm: NodeViewModel): void
{
    const container = board.Generator.ContainerFromItem(vm);
    if (container === undefined) throw new Error('no container for vm');
    board.HandleContainerClick(container, ModifierKeys.Control);
}

describe('FormatMirror — content-VM text target', () =>
{
    beforeEach(() => { initTestApp(); });

    test('selecting a label VM seeds the char + alignment DPs from its TextStyle', () =>
    {
        const vm = new LabelVM();
        vm.style.size = 18; vm.style.bold = true; vm.style.align = TextAlignment.Right;
        const d = setup([vm]);
        select(d, vm);
        assert.equal(d.SelectionFontSize, 18, 'font size seeded from the VM label');
        assert.equal(d.SelectionBold, true, 'bold seeded from the VM label');
        assert.equal(d.SelectionTextAlignment, TextAlignment.Right, 'alignment seeded from the VM label');
    });

    test('a char/alignment edit broadcasts onto the VM TextStyle', () =>
    {
        const vm = new LabelVM();
        const d = setup([vm]);
        select(d, vm);
        d.SelectionFontSize      = 22;
        d.SelectionBold          = true;
        d.SelectionTextAlignment = TextAlignment.Left;
        assert.equal(vm.style.size, 22, 'font size broadcast to the VM label');
        assert.equal(vm.style.bold, true, 'bold broadcast to the VM label');
        assert.equal(vm.style.align, TextAlignment.Left, 'alignment broadcast to the VM label');
    });
});
