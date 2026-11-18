// IFontFormatSink on BoardDocument — the font-format proxy DPs the shell
// toolbar's font editor binds. They mirror the published ActiveView's Selection*
// DPs two-way: a picker write flows out to the control, a selection change flows
// back, and the size-step commands are sourced from the live view.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application } from '../../../runtime/index.js';
import { Board } from '../board.js';
import { BoardDocument } from '../board-document.js';

function newDoc(): BoardDocument
{
    Application.current = null;
    new Application();
    return new BoardDocument();
}

describe('BoardDocument — IFontFormatSink proxy', () => {
    test('a picker write flows OUT to the live view', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;

        doc.FontFamily = 'Arial';
        doc.FontSize = 20;
        doc.FontColorHex = '#ff0000';

        assert.equal(view.SelectionFontFamily, 'Arial');
        assert.equal(view.SelectionFontSize, 20);
        assert.equal(view.SelectionFontColorHex, '#ff0000');
    });

    test('a selection change flows BACK to the document', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;

        view.SelectionFontFamily = 'Times';
        view.SelectionFontSize = 9;
        view.SelectionFontColorHex = '#00ff00';

        assert.equal(doc.FontFamily, 'Times');
        assert.equal(doc.FontSize, 9);
        assert.equal(doc.FontColorHex, '#00ff00');
    });

    test('the size-step commands are sourced from the live view', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;

        assert.equal(doc.IncreaseFontSizeCommand, view.IncreaseFontSizeCommand);
        assert.equal(doc.DecreaseFontSizeCommand, view.DecreaseFontSizeCommand);
        assert.ok(doc.IncreaseFontSizeCommand !== undefined);
    });

    test('clearing ActiveView drops the step commands and stops mirroring', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;
        doc.ActiveView = undefined;

        assert.equal(doc.IncreaseFontSizeCommand, undefined);
        assert.equal(doc.DecreaseFontSizeCommand, undefined);

        // A later view change no longer reaches the detached document.
        view.SelectionFontFamily = 'Detached';
        assert.notEqual(doc.FontFamily, 'Detached');
    });

    test('the two-way mirror does not loop (view normalisation wins, once)', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;

        // Writing the document once lands the value on the view and back, stable.
        doc.FontFamily = 'Courier';
        assert.equal(view.SelectionFontFamily, 'Courier');
        assert.equal(doc.FontFamily, 'Courier');
    });
});

describe('BoardDocument — ConnectorsModePinned proxy', () => {
    test('mirrors the live view two-way', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;

        // document → view
        doc.ConnectorsModePinned = true;
        assert.equal(view.ConnectorsModePinned, true);

        // view → document
        view.ConnectorsModePinned = false;
        assert.equal(doc.ConnectorsModePinned, false);
    });

    test('detaches when the active view clears', () => {
        const doc = newDoc();
        const view = new Board();
        doc.ActiveView = view;
        view.ConnectorsModePinned = true;
        assert.equal(doc.ConnectorsModePinned, true);

        doc.ActiveView = undefined;
        view.ConnectorsModePinned = false;   // no longer mirrored
        assert.equal(doc.ConnectorsModePinned, true);
    });
});
