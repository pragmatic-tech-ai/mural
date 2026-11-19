import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ToolboxPage } from '../toolbox-page.js';

describe('ToolboxPage', () => {

    test('carries Id / Title and an empty Items collection', () => {
        const page = new ToolboxPage('shapes', 'Shapes');
        assert.equal(page.Id, 'shapes');
        assert.equal(page.Title, 'Shapes');
        assert.equal(page.Items.Count, 0);
    });

    // Accordion state: a section starts expanded and its IsExpanded is settable
    // so a header toggle two-way binds IsChecked to it (the palette collapse).
    test('IsExpanded defaults to true and is settable', () => {
        const page = new ToolboxPage('shapes', 'Shapes');
        assert.equal(page.IsExpanded, true);
        page.IsExpanded = false;
        assert.equal(page.IsExpanded, false);
    });

    test('applyContext hides a page whose Context is not in the active set, keeps Items', () => {
        const page = new ToolboxPage('lib:x', 'X');
        page.Context = 'x@1.0.0';
        const itemsChanged: string[] = [];
        page.Items.Subscribe((e) => itemsChanged.push(e.kind));
        page.applyContext(new Set(['y@2.0.0']));
        assert.equal(page.IsVisible, false);
        page.applyContext(new Set(['x@1.0.0']));
        assert.equal(page.IsVisible, true);
        assert.deepEqual(itemsChanged, [], 'applyContext never touches Items');
    });

    test('context-free page is always visible', () => {
        const page = new ToolboxPage('shapes', 'Shapes'); // Context left undefined
        assert.equal(page.Context, undefined);
        page.applyContext(new Set());
        assert.equal(page.IsVisible, true);
    });
});
