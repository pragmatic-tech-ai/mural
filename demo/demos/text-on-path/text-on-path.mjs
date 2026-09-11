// Bootstrap for the text-on-path demo.
//
// At demo registration time we kick off a Google Fonts load for a real
// TTF (opentype.js can parse it) into a `FontMetricsMeasurer`. While
// the font is in flight the VM's `IsFontLoaded` stays false and the
// status line reports the loading state. When the font lands we flip
// `IsFontLoaded` and the behaviour's listeners re-fire to render the
// initial glyph outlines.
//
// View materialisation is gated through `OnViewMounted` so we only
// wire the GeometryView visuals into the named Canvas once it exists.
// On every property change on the VM (Text / PathKey / FontSize /
// ShowPath / ShowGlyphs / IsFontLoaded) the behaviour:
//   1. Resolves the active path geometry from the catalog.
//   2. If the font is loaded, runs `textOnPath` for the rendered run.
//   3. Updates the two GeometryView instances' Geometry DPs.
//
// We intentionally do NOT cache the textOnPath output — it's cheap at
// the scales the demo operates on and recomputing fits the
// "everything else is bound, watch what happens" feel of the demo.

import { FontManager } from '@pragmatic-tech-ai/mural/runtime';
import { Canvas } from '@pragmatic-tech-ai/mural/basic';
import {
    Color,
    FontMetricsMeasurer,
    SolidColorBrush,
    textOnPath,
} from '@pragmatic-tech-ai/mural/visual-engine';

import { TextOnPathVM } from './text-on-path-vm.mjs';
import { GeometryView } from './geometry-view.mjs';
import { getPath } from './paths.mjs';
import { register } from '../../platform/registry.mjs';

// Font family the demo renders against. The font itself is DECLARED in
// text-on-path.mu's `fonts { Roboto from "…" }` block (resource
// management is mural-only) — the runtime FontManager owns the fetch.
// Here we just pull the same loaded buffer back to feed our opentype
// FontMetricsMeasurer, which textOnPath needs for glyph-outline
// extraction (the target's Canvas measurer gives metrics, not outlines).
const FONT_FAMILY = 'Roboto';

// Module-level singleton — load once, reuse across re-activations.
const fontMeasurer = new FontMetricsMeasurer();
let   fontReadyPromise;

function ensureFontLoaded(vm) {
    if (fontReadyPromise !== undefined) return fontReadyPromise;
    const face = FontManager.Current.Faces.find(f => f.Family === FONT_FAMILY);
    if (face === undefined) {
        vm.Status = `Font '${FONT_FAMILY}' not registered — check the fonts block in text-on-path.mu.`;
        fontReadyPromise = Promise.resolve();
        return fontReadyPromise;
    }
    fontReadyPromise = FontManager.Current.LoadBuffer(face)
        .then(buf => {
            fontMeasurer.LoadFont(FONT_FAMILY, buf, 'normal', 'normal');
            vm.IsFontLoaded = true;
            vm.Status = `${FONT_FAMILY} loaded — pipeline live.`;
        })
        .catch(err => {
            vm.Status = `Font load failed: ${err?.message ?? String(err)}. Try refreshing.`;
            console.error('text-on-path: font load failed', err);
        });
    return fontReadyPromise;
}

// Wire the behaviour: re-render whenever the relevant DPs flip.
function attachBehaviors(view, vm) {
    const canvas = view.FindName('surface');
    if (!(canvas instanceof Canvas)) {
        throw new Error('text-on-path.mu missing x:name="surface" Canvas');
    }

    // Two layered visuals — path first (under), glyphs second (over).
    const pathView  = new GeometryView();
    pathView.Stroke      = new SolidColorBrush(Color.FromHex(vm.PathColorHex));
    pathView.StrokeWidth = 1.5;

    const glyphView = new GeometryView();
    glyphView.Fill = new SolidColorBrush(Color.FromHex(vm.GlyphColorHex));

    canvas.AddChild(pathView);
    canvas.AddChild(glyphView);

    // Re-issue the brush whenever the VM's hex changes — the GeometryView
    // listens for Stroke / Fill DP writes through MetaData.Render, so
    // dropping in a fresh brush instance re-paints the canvas.
    const updatePathColor = () => {
        try { pathView.Stroke = new SolidColorBrush(Color.FromHex(vm.PathColorHex)); }
        catch { /* partial hex during typing — leave the prior brush in place */ }
    };
    const updateGlyphColor = () => {
        try { glyphView.Fill = new SolidColorBrush(Color.FromHex(vm.GlyphColorHex)); }
        catch { /* same */ }
    };

    const updatePath = () => {
        pathView.Geometry = vm.ShowPath ? getPath(vm.PathKey) : undefined;
    };

    const updateGlyphs = () => {
        if (!vm.ShowGlyphs || !vm.IsFontLoaded || vm.Text.length === 0) {
            glyphView.Geometry = undefined;
            return;
        }
        const path = getPath(vm.PathKey);
        if (path === undefined) { glyphView.Geometry = undefined; return; }
        try {
            glyphView.Geometry = textOnPath({
                text: vm.Text,
                path,
                measurer: fontMeasurer,
                fontFamily: FONT_FAMILY,
                fontSize: vm.FontSize,
                sideOffset: vm.SideOffset,
            });
        } catch (err) {
            console.error('textOnPath threw:', err);
            glyphView.Geometry = undefined;
        }
    };

    const updateBoth = () => { updatePath(); updateGlyphs(); };

    // Listen to every relevant DP — explicit per-property listeners
    // rather than a blanket OnPropertyChanged override (per CLAUDE.md
    // memory rule about VM purity; bootstrap reads DPs as a consumer).
    const subs = [
        [TextOnPathVM.TextKey,          updateGlyphs],
        [TextOnPathVM.PathKeyKey,       updateBoth],
        [TextOnPathVM.FontSizeKey,      updateGlyphs],
        [TextOnPathVM.SideOffsetKey,    updateGlyphs],
        [TextOnPathVM.IsFontLoadedKey,  updateGlyphs],
        [TextOnPathVM.ShowPathKey,      updatePath],
        [TextOnPathVM.ShowGlyphsKey,    updateGlyphs],
        [TextOnPathVM.PathColorHexKey,  updatePathColor],
        [TextOnPathVM.GlyphColorHexKey, updateGlyphColor],
    ];
    const subDisposers = subs.map(([key, h]) => vm.PropertyChanged(key).subscribe(h));

    // Initial paint.
    updateBoth();

    return function detach() {
        for (const d of subDisposers) d.dispose();
        canvas.RemoveChild(pathView);
        canvas.RemoveChild(glyphView);
    };
}

let vmInstance;

register({
    id:       'text-on-path',
    group:    'Demos',
    title:    'Text on a path',
    subtitle: 'Glyphs lifted to PathGeometry, arclength-sampled along a curve.',
    factory: () => {
        if (vmInstance === undefined) {
            vmInstance = new TextOnPathVM();
            ensureFontLoaded(vmInstance);
        }
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
});
