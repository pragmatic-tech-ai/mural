// The Format-Shape pane lays its sections out as 2-column grids whose
// label columns all join one SharedSizeGroup ("ShapeFormatLabels"), so the
// labels align pane-wide and the editor (Star) columns keep a real width.
// Mounted under a HeadlessTarget so the per-target shared-size registry is
// live (a Grid with no host gets no coordination).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Visual } from '../../../runtime/index.js';
import { SolidColorBrush, Color, Pen, HeadlessTarget } from '../../../visual-engine/index.js';
import { ShapeFormatControl } from '../shape-format-control.js';
import { ScrollViewer } from '../../surfaces/scroll-viewer.js';
import { PenEditor } from '../pen-editor.js';
import { connectorCapOptions } from '../../diagram/caps/connector-cap-options.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

function mountedPane(): ShapeFormatControl
{
    const sfc = new ShapeFormatControl();
    sfc.Fill   = new SolidColorBrush(Color.FromHex('#3366cc'));
    sfc.Stroke = new Pen(new SolidColorBrush(Color.FromHex('#222222')), 2);
    sfc.ShowCaps   = true;
    sfc.CapOptions = connectorCapOptions();
    // Mount under a target so the SharedSizeGroup registry coordinates the
    // section grids; Flush drives measure + arrange.
    const target = new HeadlessTarget(360, 1000, sfc);
    target.Flush();
    return sfc;
}

describe('ShapeFormatControl — shared-size 2-column layout', () => {
    test('shared label column + right-aligned bounded editors line up', () => {
        initTestApp();
        const sfc = mountedPane();

        const capCombo  = sfc.GetTemplateChild('PART_SourceCap') as Visual | undefined;
        const pe        = sfc.GetTemplateChild('PART_PenEditor') as PenEditor | undefined;
        assert.ok(capCombo !== undefined, 'cap Start combo materialised');
        assert.ok(pe instanceof PenEditor, 'PenEditor materialised');
        const thickness = pe!.GetTemplateChild('PART_Thickness') as Visual | undefined;
        assert.ok(thickness !== undefined, 'pen Thickness editor materialised');

        const cap   = capCombo!.ArrangedRect;
        const thick = thickness!.ArrangedRect;

        // The stretch cap combo begins at the shared label-column width —
        // a non-zero offset proves the label column reserved space (not
        // collapsed to 0) and that the editor column didn't collapse.
        assert.ok(cap.X > 0,        `cap editor offset by the label column (got ${cap.X})`);
        assert.ok(cap.Width > 40,   `cap editor column kept a real width (got ${cap.Width})`);

        // Thickness is a bounded (Width=120) editor, right-aligned in its
        // Star cell — so it sits to the RIGHT of the shared label column,
        // not flush against it.
        assert.equal(thick.Width, 120, 'Thickness keeps its bounded width');
        assert.ok(thick.X > cap.X,
            `right-aligned Thickness sits past the label column (thickX=${thick.X}, colX=${cap.X})`);

        // Both the stretch cap combo and the right-aligned Thickness share
        // one right edge — the section grids end at the same x, so every
        // editor's right edge lines up.
        assert.ok(Math.abs((cap.X + cap.Width) - (thick.X + thick.Width)) < 0.5,
            `editors share a right edge (cap=${cap.X + cap.Width}, thick=${thick.X + thick.Width})`);
    });

    // Regression: the Fill/Line body slot and transparency row span
    // col0 (Auto) + col1 (Star) of their section grid. Measured with
    // infinity in the Auto pass, their inner Star tracks resolved to
    // Infinity and arrange emitted NaN/Infinity rects — the editor
    // collapsed onto its label (the "everything overlaps" screenshot).
    // Every editor must land at a finite x/width inside the pane.
    test('editor cells in Star columns get finite rects (no NaN/Infinity)', () => {
        initTestApp();
        const sfc = mountedPane();

        const finite = (n: number): boolean => Number.isFinite(n);
        const offenders: string[] = [];
        const walk = (v: Visual): void => {
            const r = v.ArrangedRect;
            if (!finite(r.X) || !finite(r.Y) || !finite(r.Width) || !finite(r.Height))
            {
                const nm = (v as unknown as { Name?: string }).Name ?? '';
                offenders.push(`${v.constructor.name}#${nm} (${r.X},${r.Y},${r.Width},${r.Height})`);
            }
            for (const k of (v as unknown as { visualChildren: Iterable<Visual> }).visualChildren) walk(k);
        };
        walk(sfc);

        assert.deepEqual(offenders, [],
            `every arranged rect is finite; offenders: ${offenders.join('; ')}`);
    });

    // Regression: the diagram hosts the pane inside a ScrollViewer. A
    // ScrollViewer with HorizontalScrollEnabled (the default) measures its
    // content with +Infinity width — so PART_EmptyMessage (TextWrapping=Wrap)
    // hit the "unbounded width" single-line bail in TextBlock.MeasureOverride
    // and ran off one line past the pane edge instead of wrapping. The pane
    // only ever scrolls vertically; the demo sets HorizontalScrollEnabled=false
    // so the content is bounded to the viewport and the message wraps.
    test('empty-state message wraps under a vertical-only ScrollViewer', () => {
        initTestApp();
        // Empty state: no Fill AND no Stroke → PART_EmptyMessage is Visible.
        const sfc = new ShapeFormatControl();
        const sv = new ScrollViewer();
        sv.HorizontalScrollEnabled = false;
        sv.Content = sfc;
        // Narrow viewport so the ~45-char message must wrap to fit.
        const VIEWPORT = 170;
        new HeadlessTarget(VIEWPORT, 600, sv).Flush();

        const msg = sfc.GetTemplateChild('PART_EmptyMessage') as Visual | undefined;
        assert.ok(msg !== undefined, 'empty message materialised');
        const r = msg!.ArrangedRect;
        assert.ok(Number.isFinite(r.Width), `message width is finite (got ${r.Width})`);
        assert.ok(r.Width <= VIEWPORT, `message fit within the viewport (got ${r.Width})`);
        // Wrapped: the single-line message is wider than 170px, so wrapping
        // forces it onto >1 line (taller than one BodySmall line ≈ 16px).
        assert.ok(r.Height > 20, `message wrapped to multiple lines (got ${r.Height})`);
    });
});
