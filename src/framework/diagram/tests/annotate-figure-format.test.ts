// Regression: the Format Shape stroke/fill channel must work for the annotate
// figures (container / text / callout), exactly as it does for a catalog shape.
// Selecting a figure must (a) seed the editor's Stroke pen from the figure and
// (b) broadcast an edit back onto the figure's own Stroke pen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application, ObservableCollection } from '../../../runtime/index.js';
import { Color, Pen, SolidColorBrush } from '../../../visual-engine/index.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
// Register the annotate kinds (module side-effect).
import '../container-figure.js';
import '../text-node.js';
import '../callout.js';

function diagram(): Diagram
{
    Application.current = null;
    new Application();
    const d = new Diagram();
    d.ItemsSource = new ObservableCollection<Figure>();
    return d;
}

// In a diagram, an item Figure is its OWN selection container (self-container
// ItemsControl), so select by handing the figure straight to the selection core
// and firing the change the FormatMirror listens for — no mounted view needed.
interface SelectorCore
{
    setSelectedContainers(containers: readonly unknown[]): void;
    refreshExposedSelection(): void;
    fireSelectionChanged(): void;
}
function selectLeaf(d: Diagram, fig: Figure): void
{
    const core = d as unknown as SelectorCore;
    core.setSelectedContainers([fig]);
    core.refreshExposedSelection();
    core.fireSelectionChanged();
}

for (const kind of ['rectangle', 'container', 'text', 'callout'])
{
    test(`selecting a ${kind} seeds an editable Stroke pen`, () => {
        const d = diagram();
        const fig = Figure.fromKind(kind, 0, 0);
        (d.ItemsSource as ObservableCollection<Figure>).Add(fig);
        selectLeaf(d, fig);
        assert.ok(d.SelectionFormatStroke instanceof Pen, `${kind}: stroke pen seeded for the editor`);
    });

    test(`editing the Stroke broadcasts onto a ${kind}'s own pen`, () => {
        const d = diagram();
        const fig = Figure.fromKind(kind, 0, 0);
        (d.ItemsSource as ObservableCollection<Figure>).Add(fig);
        selectLeaf(d, fig);
        const editor = d.SelectionFormatStroke!;
        const red = new SolidColorBrush(Color.FromHex('#ff0000'));
        editor.Brush = red;
        editor.Thickness = 5;
        const pen = (fig as unknown as { Stroke: Pen | undefined }).Stroke;
        assert.ok(pen instanceof Pen, `${kind}: figure keeps a Stroke pen`);
        assert.equal((pen!.Brush as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7), '#ff0000', `${kind}: brush broadcast`);
        assert.equal(pen!.Thickness, 5, `${kind}: thickness broadcast`);
    });
}
