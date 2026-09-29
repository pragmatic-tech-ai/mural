import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../basic/tests/test-app.js';

import { Border } from '../../basic/border.js';
import { ContentPresenter } from '../../basic/templates/content-presenter.js';
import { TextBlock } from '../../basic/text-block.js';
import { FabSize, FloatingActionButton } from '../buttons/fab.js';

describe('FloatingActionButton — Size DP', () => {
    beforeEach(() => { initTestApp(); });

    test('Size default is Default (the 56dp baseline)', () => {
        const fab = new FloatingActionButton();
        assert.equal(fab.Size, FabSize.Default);
    });

    test('Size is a settable, get-roundtrips DP', () => {
        const fab = new FloatingActionButton();
        fab.Size = FabSize.Small;
        assert.equal(fab.Size, FabSize.Small);
        fab.Size = FabSize.Large;
        assert.equal(fab.Size, FabSize.Large);
        fab.Size = FabSize.Extended;
        assert.equal(fab.Size, FabSize.Extended);
    });
});

describe('FloatingActionButton — default template', () => {
    beforeEach(() => { initTestApp(); });

    test('Default size installs PART_Border + PART_StateLayer + ContentPresenter', () => {
        const fab = new FloatingActionButton();
        const root = fab.visualChildren[0];
        assert.ok(root instanceof Border,
            'template root should be a Border (PART_Border)');
        const stateLayer = (root as Border).child;
        assert.ok(stateLayer instanceof Border,
            'PART_Border child should be the PART_StateLayer Border');
        const presenter = (stateLayer as Border).child;
        assert.ok(presenter instanceof ContentPresenter,
            'PART_StateLayer child should be the ContentPresenter slot');
    });

    test('Default size: 56dp × 56dp minimum container with ElevationLevel3 Effect', () => {
        const fab = new FloatingActionButton();
        const root = (fab.visualChildren[0] as Border).child as Border;  // PART_Root (inside PART_FocusRing)
        // Width / Height are unset (auto) so the chrome can grow past
        // the M3 baseline when a consumer slots an oversized glyph;
        // MinWidth / MinHeight pin the 56dp baseline at the lower bound.
        assert.equal(root.MinWidth,  56, 'Default FAB MinWidth should be 56');
        assert.equal(root.MinHeight, 56, 'Default FAB MinHeight should be 56');
        assert.ok(Number.isNaN(root.Width),  'Default FAB Width should be auto');
        assert.ok(Number.isNaN(root.Height), 'Default FAB Height should be auto');
        assert.ok(root.Effect !== undefined,
            'Default FAB carries an Effect (the @ShadowMd elevation)');
    });

    test('Content set on FAB slots into the templated ContentPresenter', () => {
        const fab = new FloatingActionButton();
        const glyph = new TextBlock('+');
        fab.Content = glyph;
        const root = fab.visualChildren[0] as Border;
        const stateLayer = root.child as Border;
        const presenter = stateLayer.child as ContentPresenter;
        assert.equal(presenter.visualChildren[0], glyph);
    });
});

describe('FloatingActionButton — size variants', () => {
    beforeEach(() => { initTestApp(); });

    test('Small size installs the 40dp template', () => {
        const fab = new FloatingActionButton();
        fab.Size = FabSize.Small;
        const root = (fab.visualChildren[0] as Border).child as Border;  // PART_Root (inside PART_FocusRing)
        assert.equal(root.MinWidth,  40, 'Small FAB MinWidth should be 40');
        assert.equal(root.MinHeight, 40, 'Small FAB MinHeight should be 40');
        assert.ok(Number.isNaN(root.Width),  'Small FAB Width should be auto');
        assert.ok(Number.isNaN(root.Height), 'Small FAB Height should be auto');
    });

    test('Large size installs the 96dp template', () => {
        const fab = new FloatingActionButton();
        fab.Size = FabSize.Large;
        const root = (fab.visualChildren[0] as Border).child as Border;  // PART_Root (inside PART_FocusRing)
        assert.equal(root.MinWidth,  96, 'Large FAB MinWidth should be 96');
        assert.equal(root.MinHeight, 96, 'Large FAB MinHeight should be 96');
        assert.ok(Number.isNaN(root.Width),  'Large FAB Width should be auto');
        assert.ok(Number.isNaN(root.Height), 'Large FAB Height should be auto');
    });

    test('Extended size installs the 56dp-tall, auto-width template', () => {
        const fab = new FloatingActionButton();
        fab.Size = FabSize.Extended;
        const root = (fab.visualChildren[0] as Border).child as Border;  // PART_Root (inside PART_FocusRing)
        assert.equal(root.MinHeight, 56,
            'Extended FAB MinHeight should be 56');
        assert.ok(Number.isNaN(root.Height),
            'Extended FAB Height should be auto');
        assert.ok(Number.isNaN(root.Width) || root.Width === undefined,
            'Extended FAB Width should be auto (NaN/undefined) — content drives the width');
    });
});
