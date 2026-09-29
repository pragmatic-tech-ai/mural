import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Border } from '../../../basic/border.js';
import { TextBlock } from '../../../basic/text-block.js';
import { ContentPresenter } from '../../../basic/templates/content-presenter.js';
import { PanelButton } from '../panel-button.js';
import { IconButton } from '../../buttons/icon-button.js';
import { ButtonVariant } from '../../buttons/button.js';

// PanelButton is the shell panel-header icon button (pop-out / collapse /
// add). It extends IconButton for the Click / Command machinery, but its
// default Style (shell.template.mu) pins the Standard chrome-less fill and
// a small @RadiusMd (6dp) corner instead of IconButton's @ShapeFull
// circle — the rounded-rectangle look. These tests pin that chrome.

describe('PanelButton — default chrome', () => {
    beforeEach(() => { initTestApp(); });

    test('is an IconButton subclass (inherits Click / Command / Variant machinery)', () => {
        const btn = new PanelButton();
        assert.ok(btn instanceof IconButton);
    });

    test('default Style installs the Standard chrome: Border > StateLayer > ContentPresenter', () => {
        const btn = new PanelButton();
        const border = btn.visualChildren[0];
        assert.ok(border instanceof Border, 'template root should be PART_Border');
        const stateLayer = (border as Border).child;
        assert.ok(stateLayer instanceof Border, 'PART_Border child is the PART_StateLayer overlay');
        const presenter = (stateLayer as Border).child;
        assert.ok(presenter instanceof ContentPresenter, 'PART_StateLayer child is the glyph slot');
    });

    test('corner is @RadiusMd (6dp) — a rounded rectangle, not the IconButton circle', () => {
        const btn = new PanelButton();
        const border = btn.visualChildren[0] as Border;
        const stateLayer = border.child as Border;
        assert.equal(border.CornerRadius, 6,
            'PART_Border rides $$CornerRadius = @RadiusMd from the PanelButton Style');
        assert.equal(stateLayer.CornerRadius, 6,
            'PART_StateLayer overlay tracks the same corner');
    });

    test('Variant defaults to Standard (transparent-at-rest fill)', () => {
        const btn = new PanelButton();
        assert.equal(btn.Variant, ButtonVariant.Standard);
    });

    test('a slotted glyph lands in the templated ContentPresenter', () => {
        const glyph = new TextBlock('↑');
        const btn = new PanelButton(glyph);
        const border = btn.visualChildren[0] as Border;
        const stateLayer = border.child as Border;
        const presenter = stateLayer.child as ContentPresenter;
        assert.equal(presenter.visualChildren[0], glyph);
    });
});
