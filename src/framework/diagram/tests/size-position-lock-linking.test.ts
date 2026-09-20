import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { ObservableCollection, ModifierKeys, Size } from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { SpinEdit } from '../../../basic/spin-edit.js';
import { SelectionMode } from '../../list/selector.js';
import { Diagram } from '../diagram.js';
import { Figure } from '../figure.js';
import { SizePositionControl } from '../size-position-control.js';
import { TemplateBinding } from '../../../runtime/binding/template-binding.js';
import { DataContextBinding } from '../../../runtime/binding/data-context-binding.js';

// Faithful wiring of the Format-Shape Size & Position editor over a live
// Diagram selection: the control's raw fields two-way bind to the Diagram's
// SelectedShape* DPs ($, DataContextBinding), each visible field is a SpinEdit
// whose Value two-way binds the control DP ($$, TemplateBinding), and the
// Diagram's SelectionGeometryMirror bridges SelectedShape* <-> the Figure.
//
// Regression guard: a lock-linked resize writes BOTH Width and Height into the
// figure in one gesture. The mirror must not re-seed the inspector from a
// half-updated figure mid-gesture (which clobbered the sibling field and left
// the control desynced, so the NEXT edit scaled from a stale old-width and the
// shape grew non-uniformly: 80x80 -> 81x81 -> 82x83 instead of 82x82).
function wire(lock: boolean): { fig: Figure; ctl: SizePositionControl; spin: (f: string) => SpinEdit }
{
    const fig = Figure.fromKind('rectangle', 10, 20, { width: 80, height: 80 }); fig.Id = 'a';
    const coll = new ObservableCollection<Figure>(); coll.Add(fig);
    const d = new Diagram(); d.SelectionMode = SelectionMode.Extended;
    d.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
    d.ItemsSource = coll;
    const surface = new Border(); (surface as unknown as { Child: unknown }).Child = d;
    (surface as unknown as { Measure(s: Size): void }).Measure(new Size(800, 600));
    (surface as unknown as { Arrange(r: unknown): void }).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 });
    d.HandleContainerClick(d.Generator.ContainerFromItem(fig)!, ModifierKeys.None);

    const ctl = new SizePositionControl();
    (ctl as unknown as { DataContext: unknown }).DataContext = d;
    const raw: Array<[symbol | object, string]> = [
        [SizePositionControl.WidthValueKey, 'SelectedShapeWidth'],
        [SizePositionControl.HeightValueKey, 'SelectedShapeHeight'],
        [SizePositionControl.BaseWidthKey, 'SelectedShapeBaseWidth'],
        [SizePositionControl.BaseHeightKey, 'SelectedShapeBaseHeight'],
    ];
    for (const [key, path] of raw) ctl.set_property_value(key as never, DataContextBinding(ctl as never, path));
    const spin = (field: string): SpinEdit => {
        const s = new SpinEdit(); s.DecimalPlaces = 0;
        s.set_property_value(SpinEdit.ValueKey, TemplateBinding(ctl as never, field));
        return s;
    };
    // Materialise the fields the template hosts (their $$ bindings must be live).
    spin('WidthValue'); spin('HeightValue'); spin('ScaleWidth'); spin('ScaleHeight');
    ctl.LockAspectRatio = lock;
    return { fig, ctl, spin };
}

describe('SizePositionControl over a live selection', () => {
    beforeEach(() => { initTestApp(); });

    test('lock-linked width edits resize the shape uniformly across repeated edits', () => {
        const { fig, ctl } = wire(true);
        const w = new SpinEdit(); w.DecimalPlaces = 0;
        w.set_property_value(SpinEdit.ValueKey, TemplateBinding(ctl as never, 'WidthValue'));

        w.Value = 81;
        assert.equal(fig.Width, 81); assert.equal(fig.Height, 81);
        assert.equal(ctl.WidthValue, 81, 'control width stays in sync (no mirror clobber)');

        w.Value = 82;
        assert.equal(fig.Width, 82); assert.equal(fig.Height, 82, 'lock stays uniform on the 2nd edit');

        w.Value = 83;
        assert.equal(fig.Width, 83); assert.equal(fig.Height, 83, 'still uniform on the 3rd edit');
    });

    test('unlocked width edit leaves the height scale untouched', () => {
        const { fig, ctl } = wire(false);
        const w = new SpinEdit(); w.DecimalPlaces = 0;
        w.set_property_value(SpinEdit.ValueKey, TemplateBinding(ctl as never, 'WidthValue'));

        w.Value = 120;
        assert.equal(fig.Width, 120);
        assert.equal(fig.Height, 80, 'height unchanged');
        assert.equal(ctl.ScaleWidth, 150);
        assert.equal(ctl.ScaleHeight, 100, 'editing width must not move Scale Height');
    });
});
