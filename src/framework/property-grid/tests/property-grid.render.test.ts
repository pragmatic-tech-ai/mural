// Render tests for the PropertyGrid default template (Task 7).
//
// These tests mount a PropertyGrid with concrete Descriptors + a
// MapPropertyBag, force measure/arrange via HeadlessTarget.Flush(),
// then walk the visual tree to assert the correct editor widgets
// materialise for each PropertyItem kind.
//
// Modeled after src/framework/tool-bar/tests/tool-bar.test.ts.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { Visual } from '../../../runtime/index.js';
import { PropertyGrid } from '../property-grid.js';
import { GridProperty } from '../grid-property.js';
import { MapPropertyBag, type PropertyAccessor } from '../property-bag.js';
import { TextBox } from '../../../basic/text-box.js';
import { Checkbox } from '../../toggles/checkbox.js';
import { ToggleButton } from '../../buttons/toggle-button.js';

// ── Tree-walk helpers ─────────────────────────────────────────────────────────

function findType<T extends Visual>(root: Visual, ctor: new (...a: never[]) => T): T | undefined {
    const stack: Visual[] = [root];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur instanceof ctor) return cur;
        for (const c of (cur as unknown as { visualChildren: Iterable<Visual> }).visualChildren) {
            stack.push(c);
        }
    }
    return undefined;
}

function findAllType<T extends Visual>(root: Visual, ctor: new (...a: never[]) => T): T[] {
    const out: T[] = [];
    const stack: Visual[] = [root];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur instanceof ctor) out.push(cur);
        for (const c of (cur as unknown as { visualChildren: Iterable<Visual> }).visualChildren) {
            stack.push(c);
        }
    }
    return out;
}

// ── Bag factory ───────────────────────────────────────────────────────────────

function makeBag(entries: Record<string, unknown>): MapPropertyBag {
    const stored: Record<string, unknown> = { ...entries };
    const accessors = new Map<string, PropertyAccessor>();
    for (const name of Object.keys(stored)) {
        accessors.set(name, {
            get: () => stored[name],
            set: (v) => { stored[name] = v; },
        });
    }
    return new MapPropertyBag(accessors);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PropertyGrid render — template materialisation', () => {
    beforeEach(() => { initTestApp(); });

    test('a Text property row materialises a TextBox editor', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Title')];
        grid.Target = makeBag({ Title: 'Hello' });

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        const box = findType(grid, TextBox);
        assert.ok(box !== undefined, 'a TextBox should materialise for a Text property');
    });

    test('a Boolean property row materialises a Checkbox editor', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.bool('Active')];
        grid.Target = makeBag({ Active: false });

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        const cb = findType(grid, Checkbox);
        assert.ok(cb !== undefined, 'a Checkbox should materialise for a Boolean property');
    });

    test('category header is rendered as a ToggleButton', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Name', { category: 'General' })];
        grid.Target = makeBag({ Name: 'Alice' });

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        const header = findType(grid, ToggleButton);
        assert.ok(header !== undefined, 'a ToggleButton should appear for the category header');
    });

    test('mixed Text + Boolean descriptors materialise both a TextBox and a Checkbox', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [
            GridProperty.text('Label'),
            GridProperty.bool('Visible'),
        ];
        grid.Target = makeBag({ Label: 'node-1', Visible: true });

        const target = new HeadlessTarget(400, 400, grid);
        target.Flush();

        const textBoxes = findAllType(grid, TextBox);
        const checkboxes = findAllType(grid, Checkbox);

        assert.ok(textBoxes.length > 0, 'at least one TextBox for the Text row');
        assert.ok(checkboxes.length > 0, 'at least one Checkbox for the Boolean row');
    });

    test('two categories each produce their own ToggleButton header', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [
            GridProperty.text('Name',   { category: 'Identity' }),
            GridProperty.text('Color',  { category: 'Appearance' }),
        ];
        grid.Target = makeBag({ Name: 'node', Color: '#ff0000' });

        const target = new HeadlessTarget(400, 400, grid);
        target.Flush();

        const headers = findAllType(grid, ToggleButton);
        assert.ok(headers.length >= 2, `expected at least 2 category headers, got ${headers.length}`);
    });

    test('EditorTemplateSelector DP is seeded after applyDefaultStyle', () => {
        const grid = new PropertyGrid();
        // The selector function is always seeded by the ctor regardless of the
        // template being applied, so it is callable without a HeadlessTarget.
        const selector = grid.EditorTemplateSelector;
        assert.ok(typeof selector === 'function', 'EditorTemplateSelector is a function');
    });
});
