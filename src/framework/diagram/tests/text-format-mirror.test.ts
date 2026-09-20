import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ObservableCollection, Size, Visual, ModifierKeys, RelayCommand, type MountableTarget } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { RichTextBox } from '../../../basic/rich-text-box.js';
import { TextPointer } from '../../../basic/documents/text-pointer.js';
import { DocumentParagraphs } from '../../../basic/documents/text-navigation.js';
import { TextAlignment } from '../../../visual-engine/index.js';
import { CommandManager } from '../../commands/command-manager.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { TextPlacement } from '../shape-text.js';
import { deserializeFlowDocument } from '../serialization/shape-text-document.js';
import { SelectionMode } from '../../list/list-box.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

// FormatMirror text channel (§ diagram-text alignment toolbars):
// SelectionTextAlignment / SelectionTextPlacement seed from the first
// selected shape's label and broadcast edits onto every selected shape —
// the same seed/broadcast shape as the fill/stroke/cap channels.

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(figs: readonly Figure[]): Diagram
{
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    diagram.ItemsSource   = new ObservableCollection<Figure>([...figs]);
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return diagram;
}

function select(diagram: Diagram, fig: Figure): void
{
    const container = diagram.Generator.ContainerFromItem(fig);
    if (container === undefined) throw new Error('no container for figure');
    diagram.HandleContainerClick(container, ModifierKeys.Control);
}

describe('FormatMirror — text channel', () => {
    beforeEach(() => { initTestApp(); });

    test('nothing selected → both text DPs undefined', () => {
        const d = setup([new Figure()]);
        assert.equal(d.SelectionTextAlignment, undefined);
        assert.equal(d.SelectionTextPlacement, undefined);
    });

    test('selecting a shape seeds the DPs from its label', () => {
        const f = new Figure();
        f.Text.TextAlignment = TextAlignment.Right;
        f.Text.Placement     = TextPlacement.Bottom;
        const d = setup([f]);
        select(d, f);
        assert.equal(d.SelectionTextAlignment, TextAlignment.Right);
        assert.equal(d.SelectionTextPlacement, TextPlacement.Bottom);
    });

    test('setting SelectionTextAlignment broadcasts onto every selected shape', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        d.SelectionTextAlignment = TextAlignment.Justify;
        assert.equal(a.Text.TextAlignment, TextAlignment.Justify);
        assert.equal(b.Text.TextAlignment, TextAlignment.Justify);
    });

    test('setting SelectionTextPlacement broadcasts onto every selected shape', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        d.SelectionTextPlacement = TextPlacement.TopLeft;
        assert.equal(a.Text.Placement, TextPlacement.TopLeft);
        assert.equal(b.Text.Placement, TextPlacement.TopLeft);
    });

    test('seeds from the FIRST selected shape', () => {
        const a = new Figure(); a.Text.TextAlignment = TextAlignment.Center;
        const b = new Figure(); b.Text.TextAlignment = TextAlignment.Right;
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        assert.equal(d.SelectionTextAlignment, TextAlignment.Center);
    });

    test('a text-format DP change pulses RequerySuggested (keeps toolbar toggles a radio group)', () => {
        // The toolbar's align/decoration toggles are `IsChecked = $IsActive`, re-read
        // only on a requery PULSE. A command-driven alignment change mutates the DP
        // without a selection change, so the DP itself must pulse — otherwise the
        // previously-active button stays lit (Center stays toggled after Left).
        const d = setup([new Figure()]);
        let pulses = 0;
        const listener = (): void => { pulses += 1; };
        CommandManager.SubscribeRequerySuggested(listener);
        try
        {
            d.SelectionTextAlignment = TextAlignment.Left;
            assert.ok(pulses >= 1, 'alignment change should pulse RequerySuggested');
            const afterFirst = pulses;
            d.SelectionTextAlignment = TextAlignment.Center;
            assert.ok(pulses > afterFirst, 'a subsequent alignment change should pulse again');
            const afterAlign = pulses;
            d.SelectionBold = true;
            assert.ok(pulses > afterAlign, 'a decoration toggle change should pulse too');
        }
        finally
        {
            CommandManager.UnsubscribeRequerySuggested(listener);
        }
    });

    // Part 2: while a shape is being edited, the alignment DP reflects the
    // caret paragraph and re-seeds as the caret moves between paragraphs.
    test('while editing, SelectionTextAlignment tracks the caret paragraph', () => {
        const f = new Figure();
        f.Text.Document = deserializeFlowDocument([
            { align: TextAlignment.Left,  runs: [{ t: 'aa' }] },
            { align: TextAlignment.Right, runs: [{ t: 'bb' }] },
        ]);
        const d = setup([f]);
        select(d, f);
        f.Text.BeginEdit();
        const ed = f.Text.GetTemplateChild('PART_Edit') as RichTextBox;
        const paras = DocumentParagraphs(ed.Document!);
        ed.SetCaret(new TextPointer(paras[0]!, 0));
        assert.equal(d.SelectionTextAlignment, TextAlignment.Left, 'caret in the Left paragraph');
        ed.SetCaret(new TextPointer(paras[1]!, 0));
        assert.equal(d.SelectionTextAlignment, TextAlignment.Right, 're-seeded on caret move');
    });

    // Part 2: setting the DP while editing writes the caret paragraph, not the
    // whole label.
    test('while editing, setting SelectionTextAlignment writes the caret paragraph only', () => {
        const f = new Figure();
        f.Text.Document = deserializeFlowDocument([{ runs: [{ t: 'aa' }] }, { runs: [{ t: 'bb' }] }]);
        const d = setup([f]);
        select(d, f);
        f.Text.BeginEdit();
        const ed = f.Text.GetTemplateChild('PART_Edit') as RichTextBox;
        const paras = DocumentParagraphs(ed.Document!);
        const before0 = paras[0]!.TextAlignment;
        ed.SetCaret(new TextPointer(paras[1]!, 0));
        d.SelectionTextAlignment = TextAlignment.Center;
        assert.equal(paras[1]!.TextAlignment, TextAlignment.Center);
        assert.equal(paras[0]!.TextAlignment, before0, 'other paragraph untouched');
    });
});

// The command surface the two label toolbars bind (and Plexus reaches by id):
// discrete per-option RelayCommands on the Diagram, installed by DiagramCommands,
// force-applying to every selected label via ApplySelectionText*.
describe('Diagram — text-format commands', () => {
    beforeEach(() => { initTestApp(); });

    test('all 13 text-format commands are installed at construction', () => {
        const d = setup([new Figure()]);
        for (const c of [
            d.SetTextAlignLeftCommand, d.SetTextAlignCenterCommand, d.SetTextAlignRightCommand, d.SetTextAlignJustifyCommand,
            d.SetTextPlacementCenterCommand, d.SetTextPlacementTopCommand, d.SetTextPlacementBottomCommand,
            d.SetTextPlacementLeftCommand, d.SetTextPlacementRightCommand,
            d.SetTextPlacementTopLeftCommand, d.SetTextPlacementTopRightCommand,
            d.SetTextPlacementBottomLeftCommand, d.SetTextPlacementBottomRightCommand,
        ]) assert.ok(c instanceof RelayCommand);
    });

    test('CanExecute is false with no shape selected, true once a label-bearing shape is selected', () => {
        const f = new Figure();
        const d = setup([f]);
        assert.equal(d.SetTextAlignLeftCommand?.CanExecute(), false);
        assert.equal(d.SetTextPlacementTopLeftCommand?.CanExecute(), false);
        select(d, f);
        assert.equal(d.SetTextAlignLeftCommand?.CanExecute(), true);
        assert.equal(d.SetTextPlacementTopLeftCommand?.CanExecute(), true);
    });

    test('Execute applies the alignment to every selected label and reflects the DP', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        d.SetTextAlignRightCommand?.Execute();
        assert.equal(a.Text.TextAlignment, TextAlignment.Right);
        assert.equal(b.Text.TextAlignment, TextAlignment.Right);
        assert.equal(d.SelectionTextAlignment, TextAlignment.Right, 'DP reflects for the toggle');
    });

    test('Execute applies the placement to every selected label and reflects the DP', () => {
        const a = new Figure(); const b = new Figure();
        const d = setup([a, b]);
        select(d, a);
        select(d, b);
        d.SetTextPlacementBottomRightCommand?.Execute();
        assert.equal(a.Text.Placement, TextPlacement.BottomRight);
        assert.equal(b.Text.Placement, TextPlacement.BottomRight);
        assert.equal(d.SelectionTextPlacement, TextPlacement.BottomRight, 'DP reflects for the toggle');
    });

    // Force-apply is the point of routing through the command: it re-applies even
    // when the reflected DP already equals the value (a bare DP set would no-op).
    test('Execute force-applies to a shape whose label differs from the seeded DP', () => {
        const a = new Figure(); a.Text.Placement = TextPlacement.Center;
        const b = new Figure(); b.Text.Placement = TextPlacement.TopLeft;
        const d = setup([a, b]);
        select(d, a);   // seeds SelectionTextPlacement = Center (from a)
        select(d, b);   // still seeds from first (a) → Center
        assert.equal(d.SelectionTextPlacement, TextPlacement.Center);
        d.SetTextPlacementCenterCommand?.Execute();   // DP already Center — must still push to b
        assert.equal(b.Text.Placement, TextPlacement.Center, 'b re-aligned despite unchanged DP');
    });
});
