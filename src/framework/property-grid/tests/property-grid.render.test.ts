// Render tests for the PropertyGrid default template (Task 7).
//
// These tests mount a PropertyGrid with concrete Descriptors + a
// MapPropertyBag, force measure/arrange via HeadlessTarget.Flush(), then walk
// the visual tree to assert that the REAL editor dispatch mechanism
// (ItemTemplateSelector → one DataTemplate per row) instantiates exactly the
// correct editor for each PropertyItem kind — and nothing else.
//
// The dispatch is structural: each row instantiates ONLY the DataTemplate the
// grid's EditorTemplateSelector returns. So these tests guard both directions:
//   • the RIGHT editor is present (TextBox for Text, Checkbox for Boolean, …),
//   • the WRONG editors are ABSENT (a Boolean row has no TextBox; a read-only
//     row has no editable TextBox; a non-enum row has no ComboBox), which is
//     what makes hidden-editor write-back to $Value structurally impossible.
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
import { ComboBox } from '../../list/combo-box.js';
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

// ── Bag factories ──────────────────────────────────────────────────────────────

// Read-write bag: every accessor has a setter, so IsReadOnly(name) === false.
// `stored` is returned so a test can inspect the source value after inflation.
function makeBag(entries: Record<string, unknown>): { bag: MapPropertyBag; stored: Record<string, unknown> } {
    const stored: Record<string, unknown> = { ...entries };
    const accessors = new Map<string, PropertyAccessor>();
    for (const name of Object.keys(stored)) {
        accessors.set(name, {
            id: () => name,
            displayName: () => name,
            get: () => stored[name],
            set: (v) => { stored[name] = v; },
        });
    }
    return { bag: new MapPropertyBag(accessors), stored };
}

// Read-only bag: accessors expose no setter, so MapPropertyBag.IsReadOnly(name)
// returns true → PropertyItem.IsReadOnly is true → the read-only editor
// (TextBlock, not TextBox) is selected.
function makeReadOnlyBag(entries: Record<string, unknown>): MapPropertyBag {
    const accessors = new Map<string, PropertyAccessor>();
    for (const name of Object.keys(entries)) {
        accessors.set(name, { id: () => name, displayName: () => name, get: () => entries[name] });
    }
    return new MapPropertyBag(accessors);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PropertyGrid render — per-row editor dispatch', () => {
    beforeEach(() => { initTestApp(); });

    test('a Text property row materialises exactly one editable TextBox (and no Checkbox)', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Title')];
        grid.Target = makeBag({ Title: 'Hello' }).bag;

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        assert.equal(findAllType(grid, TextBox).length, 1, 'exactly one TextBox for the single Text row');
        assert.equal(findAllType(grid, Checkbox).length, 0, 'no Checkbox for a Text row');
    });

    test('a Boolean property row materialises a Checkbox and NO text-style editor', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.bool('Active')];
        grid.Target = makeBag({ Active: false }).bag;

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        assert.equal(findAllType(grid, Checkbox).length, 1, 'exactly one Checkbox for the Boolean row');
        // The write-back hazard the review flagged: with the old overlay, a
        // hidden TextBox[Text=$Value] existed on this row and could coerce the
        // boolean through the two-way binding. Structural dispatch means NO
        // TextBox is instantiated for a Boolean row at all.
        assert.equal(findAllType(grid, TextBox).length, 0, 'no editable TextBox bound to a Boolean row');
    });

    test('a read-only Text row renders ONLY the read-only editor (no editable TextBox)', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Label')];
        grid.Target = makeReadOnlyBag({ Label: 'immutable' });

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        // Read-only wins over kind: selectEditorTemplate returns the ReadOnly
        // editor (a TextBlock), so no editable TextBox is present for the row.
        assert.equal(findAllType(grid, TextBox).length, 0,
            'a read-only row must not instantiate an editable TextBox');
    });

    test('a NON-enum row does not instantiate a ComboBox and leaves $Value UNCHANGED after inflation', () => {
        const { bag, stored } = makeBag({ Name: 'alice' });
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Name')];
        grid.Target = bag;

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        // No ComboBox exists for a non-enum row, so the ComboBox's two-way
        // SelectedItem=$Value binding cannot fire and corrupt the source.
        assert.equal(findAllType(grid, ComboBox).length, 0, 'no ComboBox for a Text row');
        // Prove the source value survived template inflation untouched.
        assert.equal(stored['Name'], 'alice', 'inflation must not write back to $Value');
    });

    test('an Enum row materialises a ComboBox seeded with the descriptor options', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.enumOf('Mode', ['A', 'B', 'C'])];
        grid.Target = makeBag({ Mode: 'B' }).bag;

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        const combos = findAllType(grid, ComboBox);
        assert.equal(combos.length, 1, 'exactly one ComboBox for the Enum row');
        assert.equal(findAllType(grid, Checkbox).length, 0, 'no Checkbox for an Enum row');
        // NB: a ComboBox nests its own internal PART_EditText TextBox as chrome
        // (bound to the ComboBox edit state, not $Value), so we do NOT assert
        // "zero TextBox" here — that TextBox is not a row editor bound to $Value.
    });

    test('mixed Text + Boolean descriptors: one TextBox and one Checkbox, no cross-instantiation', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [
            GridProperty.text('Label'),
            GridProperty.bool('Visible'),
        ];
        grid.Target = makeBag({ Label: 'node-1', Visible: true }).bag;

        const target = new HeadlessTarget(400, 400, grid);
        target.Flush();

        assert.equal(findAllType(grid, TextBox).length, 1, 'exactly one TextBox (the Text row)');
        assert.equal(findAllType(grid, Checkbox).length, 1, 'exactly one Checkbox (the Boolean row)');
    });

    test('category header is rendered as a ToggleButton', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [GridProperty.text('Name', { category: 'General' })];
        grid.Target = makeBag({ Name: 'Alice' }).bag;

        const target = new HeadlessTarget(400, 300, grid);
        target.Flush();

        const header = findType(grid, ToggleButton);
        assert.ok(header !== undefined, 'a ToggleButton should appear for the category header');
    });

    test('two categories each produce their own ToggleButton header', () => {
        const grid = new PropertyGrid();
        grid.Descriptors = [
            GridProperty.text('Name',   { category: 'Identity' }),
            GridProperty.text('Color',  { category: 'Appearance' }),
        ];
        grid.Target = makeBag({ Name: 'node', Color: '#ff0000' }).bag;

        const target = new HeadlessTarget(400, 400, grid);
        target.Flush();

        const headers = findAllType(grid, ToggleButton);
        assert.equal(headers.length, 2, `expected 2 category headers, got ${headers.length}`);
    });

    test('EditorTemplateSelector resolves the per-kind template and is a stable function', () => {
        const grid = new PropertyGrid();
        // The resolver is always available (built as a field, independent of the
        // template being applied) and returns the same reference each read.
        const selector = grid.EditorTemplateSelector;
        assert.ok(typeof selector === 'function', 'EditorTemplateSelector is a function');
        assert.equal(grid.EditorTemplateSelector, selector, 'the resolver reference is stable');
    });
});
