import { ModifierKeys } from '../../runtime/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Color,
    MetaData,
    MuralBase,
    ObservableCollection,
    SetterFactory,
    Setter,
    Size,
    Style,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../runtime/index.js';
import { Pen, SolidColorBrush } from '../../visual-engine/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Diagram } from '../diagram/diagram.js';
import { Figure } from '../diagram/figure.js';
import { SelectionMode } from '../list/list-box.js';
import { flattenToLeaves } from '../diagram/commands/group-ops.js';

// IFillableItem + IStrokableItem: a single VM that satisfies both.
// Fill is a Brush DP; Stroke is a Pen DP. Each instance gets its
// own Pen so FormatMirror can verify per-shape Pen identity is preserved
// during broadcast.
class FormattableVM extends MuralBase
{
    public static readonly LeftKey      = MuralBase.RegisterProperty<number>(FormattableVM, 'Left',      0,  MetaData.None);
    public static readonly TopKey       = MuralBase.RegisterProperty<number>(FormattableVM, 'Top',       0,  MetaData.None);
    public static readonly WidthKey     = MuralBase.RegisterProperty<number>(FormattableVM, 'Width',    10, MetaData.None);
    public static readonly HeightKey    = MuralBase.RegisterProperty<number>(FormattableVM, 'Height',   10, MetaData.None);
    public static readonly FillKey = MuralBase.RegisterProperty<SolidColorBrush | undefined>(FormattableVM, 'Fill', undefined, MetaData.None);
    public static readonly StrokeKey    = MuralBase.RegisterProperty<Pen | undefined>(FormattableVM, 'Stroke',    undefined, MetaData.None);
    constructor(fill: SolidColorBrush, stroke: Pen)
    {
        super();
        this.set_property_value(FormattableVM.WidthKey,  10);
        this.set_property_value(FormattableVM.HeightKey, 10);
        this.set_property_value(FormattableVM.FillKey, fill);
        this.set_property_value(FormattableVM.StrokeKey,    stroke);
    }
    public get Fill(): SolidColorBrush | undefined { return this.get_property_value(FormattableVM.FillKey); }
    public set Fill(v: SolidColorBrush | undefined) { this.set_property_value(FormattableVM.FillKey, v); }
    public get Stroke():    Pen | undefined { return this.get_property_value(FormattableVM.StrokeKey); }
    public set Stroke(v:    Pen | undefined) { this.set_property_value(FormattableVM.StrokeKey, v); }
}

// IGroup-shaped VM containing FormattableVM members. Used to verify
// flattenToLeaves walks Members.
class GroupOfFormattablesVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(GroupOfFormattablesVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(GroupOfFormattablesVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(GroupOfFormattablesVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(GroupOfFormattablesVM, 'Height', 10, MetaData.None);
    public Members: FormattableVM[];
    constructor(members: FormattableVM[])
    {
        super();
        this.Members = members;
    }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

const red  = new SolidColorBrush(Color.FromHex('#ff0000'));
const blue = new SolidColorBrush(Color.FromHex('#0000ff'));
const green = new SolidColorBrush(Color.FromHex('#00ff00'));

function freshPen(brushColor: SolidColorBrush, thickness: number = 1): Pen
{
    const p = new Pen();
    p.set_property_value(Pen.BrushKey,     brushColor);
    p.set_property_value(Pen.ThicknessKey, thickness);
    return p;
}

function setup(items: MuralBase[]): { diagram: Diagram }
{
    Application.current = null;
    new Application();
    const coll = new ObservableCollection<MuralBase>();
    for (const i of items) coll.Add(i);
    const diagram = new Diagram();
    diagram.SelectionMode = SelectionMode.Extended;
    diagram.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    diagram.ItemContainerStyle = style;
    diagram.ItemsSource = coll;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = diagram;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { diagram };
}

function cont(diagram: Diagram, item: unknown): Figure
{
    const gen = (diagram as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

function selectMany(diagram: Diagram, items: unknown[]): void
{
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(diagram, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        diagram.HandleContainerClick(c, mods);
    }
}

describe('commands/group-ops.ts — flattenToLeaves', () => {

    test('flat selection passes through', () => {
        const a = new FormattableVM(red,  freshPen(red));
        const b = new FormattableVM(blue, freshPen(blue));
        const leaves = flattenToLeaves([a, b]);
        assert.equal(leaves.length, 2);
        assert.ok(leaves.includes(a));
        assert.ok(leaves.includes(b));
    });

    test('selecting a group expands to its members', () => {
        const a = new FormattableVM(red,  freshPen(red));
        const b = new FormattableVM(blue, freshPen(blue));
        const g = new GroupOfFormattablesVM([a, b]);
        const leaves = flattenToLeaves([g]);
        assert.equal(leaves.length, 2);
        assert.ok(leaves.includes(a));
        assert.ok(leaves.includes(b));
    });

    test('selecting both a group and one of its members yields each leaf once', () => {
        const a = new FormattableVM(red,  freshPen(red));
        const b = new FormattableVM(blue, freshPen(blue));
        const g = new GroupOfFormattablesVM([a, b]);
        const leaves = flattenToLeaves([g, a]);
        assert.equal(leaves.length, 2);   // a not duped
    });
});

describe('Diagram — FormatMirror', () => {

    test('FormatFill / FormatStroke DPs default to undefined', () => {
        const { diagram } = setup([]);
        assert.equal(diagram.SelectionFormatFill,   undefined);
        assert.equal(diagram.SelectionFormatStroke, undefined);
    });

    test('selection seeds FormatFill / FormatStroke from the first leaf', () => {
        const a = new FormattableVM(red,  freshPen(red,   1));
        const b = new FormattableVM(blue, freshPen(blue,  3));
        const { diagram } = setup([a, b]);

        selectMany(diagram, [a, b]);

        assert.equal(diagram.SelectionFormatFill, red,
            'FormatFill seeded from first leaf\'s Fill by reference');
        const stroke = diagram.SelectionFormatStroke;
        assert.ok(stroke instanceof Pen);
        // Pen is CLONED on seed — same property values, distinct instance.
        assert.notEqual(stroke, a.Stroke, 'FormatStroke is a clone, not the same Pen instance');
        assert.equal(stroke?.get_property_value(Pen.BrushKey),     red);
        assert.equal(stroke?.get_property_value(Pen.ThicknessKey), 1);
    });

    test('FormatFill DP write broadcasts to every leaf', () => {
        const a = new FormattableVM(red,  freshPen(red));
        const b = new FormattableVM(red,  freshPen(red));
        const { diagram } = setup([a, b]);
        selectMany(diagram, [a, b]);

        diagram.SelectionFormatFill = green;

        assert.equal(a.Fill, green);
        assert.equal(b.Fill, green);
    });

    test('FormatStroke per-property edit broadcasts to every leaf\'s Pen in place', () => {
        const aPen = freshPen(red, 1);
        const bPen = freshPen(red, 1);
        const a = new FormattableVM(red, aPen);
        const b = new FormattableVM(red, bPen);
        const { diagram } = setup([a, b]);
        selectMany(diagram, [a, b]);

        // Edit Thickness on the editor's Pen — broadcasts to each leaf's
        // own Pen, NOT replacing the Pen instance.
        const editorPen = diagram.SelectionFormatStroke;
        assert.ok(editorPen instanceof Pen);
        editorPen!.set_property_value(Pen.ThicknessKey, 7);

        assert.equal(a.Stroke, aPen, 'leaf a\'s Pen identity preserved');
        assert.equal(b.Stroke, bPen, 'leaf b\'s Pen identity preserved');
        assert.equal(aPen.get_property_value(Pen.ThicknessKey), 7);
        assert.equal(bPen.get_property_value(Pen.ThicknessKey), 7);
    });

    test('selecting a group broadcasts format to all leaves in the group', () => {
        const a = new FormattableVM(red, freshPen(red));
        const b = new FormattableVM(red, freshPen(red));
        const g = new GroupOfFormattablesVM([a, b]);
        const { diagram } = setup([g, a, b]);  // a, b in items source for container materialization
        selectMany(diagram, [g]);

        diagram.SelectionFormatFill = blue;

        assert.equal(a.Fill, blue, 'group member a got the fill');
        assert.equal(b.Fill, blue, 'group member b got the fill');
    });

    test('clearing selection resets FormatFill / FormatStroke to undefined', () => {
        const a = new FormattableVM(red, freshPen(red));
        const { diagram } = setup([a]);
        selectMany(diagram, [a]);
        assert.notEqual(diagram.SelectionFormatFill, undefined);

        diagram.ClearSelection();
        assert.equal(diagram.SelectionFormatFill,   undefined);
        assert.equal(diagram.SelectionFormatStroke, undefined);
    });
});
