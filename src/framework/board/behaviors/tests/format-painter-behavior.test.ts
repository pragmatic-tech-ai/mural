import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../../../basic/tests/test-app.js';
import { Color, Pen, SolidColorBrush } from '../../../../visual-engine/index.js';
import { Figure } from '../../figure.js';
import { Connector } from '../../connector.js';
import { Board } from '../../board.js';
import { FormatPainter, primaryFormatTarget } from '../format-painter-behavior.js';

// A stand-in Board exposing only what primaryFormatTarget reads.
function fakeBoard(items: unknown[], connectors: Connector[] = [], container?: Figure): Board
{
    return {
        SelectedItems: items,
        SelectedConnectors: connectors,
        Generator: { ContainerFromItem: (_i: unknown) => container },
    } as unknown as Board;
}

function fillHex(fig: Figure): string
{
    return (fig.Fill as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7);
}

describe('FormatPainter — pick up / paint / drop', () => {
    beforeEach(() => { initTestApp(); });

    test('inactive until Begin, then paints the picked-up format', () => {
        const painter = new FormatPainter();
        assert.equal(painter.IsActive, false);

        const source = Figure.fromKind('rectangle', 0, 0);
        source.Fill = new SolidColorBrush(Color.FromHex('#00ff00'));
        painter.Begin(source);
        assert.equal(painter.IsActive, true);

        const target = Figure.fromKind('ellipse', 0, 0);
        painter.PaintAt(target);
        assert.equal(fillHex(target), '#00ff00');
    });

    test('sticky — one pick-up paints many targets', () => {
        const painter = new FormatPainter();
        const source = Figure.fromKind('rectangle', 0, 0);
        source.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#ff0000')), 5);
        painter.Begin(source);

        const a = Figure.fromKind('rectangle', 0, 0);
        const b = Figure.fromKind('ellipse', 0, 0);
        painter.PaintAt(a);
        painter.PaintAt(b);

        assert.equal(a.Stroke!.Thickness, 5);
        assert.equal(b.Stroke!.Thickness, 5);
        assert.equal(painter.IsActive, true, 'still active after painting');
    });

    test('PaintAt after End is a no-op', () => {
        const painter = new FormatPainter();
        const source = Figure.fromKind('rectangle', 0, 0);
        source.Fill = new SolidColorBrush(Color.FromHex('#00ff00'));
        painter.Begin(source);
        painter.End();
        assert.equal(painter.IsActive, false);

        const target = Figure.fromKind('rectangle', 0, 0);
        const before = fillHex(target);
        painter.PaintAt(target);
        assert.equal(fillHex(target), before, 'unchanged — painter was dropped');
    });
});

describe('primaryFormatTarget — the pick-up source', () => {
    beforeEach(() => { initTestApp(); });

    test('a selected shape figure is the source directly', () => {
        const fig = Figure.fromKind('rectangle', 0, 0);
        assert.equal(primaryFormatTarget(fakeBoard([fig])), fig);
    });

    test('a selected content node resolves to its container figure', () => {
        const vm = { Id: 'node' };                       // not a Figure
        const container = Figure.fromKind('rectangle', 0, 0);
        assert.equal(primaryFormatTarget(fakeBoard([vm], [], container)), container);
    });

    test('falls back to the first selected connector when no figure is selected', () => {
        const conn = new Connector();
        assert.equal(primaryFormatTarget(fakeBoard([], [conn])), conn);
    });

    test('nothing formattable selected → undefined', () => {
        assert.equal(primaryFormatTarget(fakeBoard([])), undefined);
    });
});

describe('Copy Format — command + mode DP wiring', () => {
    beforeEach(() => { initTestApp(); });

    test('the CopyFormatCommand is installed and disabled with an empty selection', () => {
        const d = new Board();
        assert.ok(d.CopyFormatCommand !== undefined, 'command installed on the DP');
        assert.equal(d.CopyFormatCommand!.CanExecute(undefined), false, 'nothing to copy → disabled');
    });

    test('activating with nothing selected auto-resets the mode off (nothing to pick up)', () => {
        const d = new Board();
        d.FormatPainterActive = true;                    // no formattable selection
        assert.equal(d.FormatPainterActive, false, 'the behavior dropped straight back to off');
    });
});
