import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Board } from '../board.js';
import { BoardInspector } from '../board-inspector.js';
import { ShapeStylePage, SizePositionPage } from '../inspector-pages.js';

describe('BoardInspector paging', () => {
    test('exposes Style + Size/Position pages, default selection = Style', () => {
        Application.current = null; new Application();
        const insp = new BoardInspector();
        const pages = [...insp.Pages];
        assert.equal(pages.length, 2);
        assert.ok(pages[0] instanceof ShapeStylePage);
        assert.ok(pages[1] instanceof SizePositionPage);
        assert.equal(insp.SelectedPage, pages[0]);
        assert.equal(pages[0].Title, 'Style');
        assert.equal(pages[1].Title, 'Size & Position');
    });
    test('each page resolves its rail icon geometry from the framework dictionary', () => {
        initTestApp();   // activates Material → the Boards dict (with the icon includes)
        const insp = new BoardInspector();
        const [style, size] = [...insp.Pages];
        // The rail glyphs must resolve — an undefined Icon means a blank tab.
        assert.ok(style.Icon !== undefined, 'Style page icon resolved');
        assert.ok(size.Icon !== undefined, 'Size & Position page icon resolved');
        assert.notEqual(style.Icon, size.Icon, 'the two pages use distinct glyphs');
    });

    test('View propagates to the pages', () => {
        Application.current = null; new Application();
        const insp = new BoardInspector();
        const d = new Board();
        insp.View = d;
        for (const p of insp.Pages) assert.equal(p.View, d);
    });
});
