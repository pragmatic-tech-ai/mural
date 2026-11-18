import { ModifierKeys } from '../../runtime/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    SetterFactory,
    Setter,
    Size,
    Style,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { Board } from '../board/board.js';
import { Figure } from '../board/figure.js';
import { SelectionMode } from '../list/list-box.js';
import {
    GeometryCombineMode,
    isGeometricItem,
    type CombineRequestedArgs,
} from '../board/commands/combine.js';

// IFigure-shaped FigureVM with a Geometry property. Geometry's value
// is opaque to the framework (combine() is called consumer-side); a
// non-undefined value is enough for isGeometricItem to return true.
class FigureWithGeometryVM extends MuralBase
{
    public static readonly LeftKey      = MuralBase.RegisterProperty<number>(FigureWithGeometryVM, 'Left',     0,  MetaData.None);
    public static readonly TopKey       = MuralBase.RegisterProperty<number>(FigureWithGeometryVM, 'Top',      0,  MetaData.None);
    public static readonly WidthKey     = MuralBase.RegisterProperty<number>(FigureWithGeometryVM, 'Width',   10, MetaData.None);
    public static readonly HeightKey    = MuralBase.RegisterProperty<number>(FigureWithGeometryVM, 'Height',  10, MetaData.None);
    // Use a non-DP plain field for Geometry — the duck-type check looks
    // at the property, not the descriptor table. Real consumers can
    // use a DP if they want notifications; not required by the contract.
    public Geometry: unknown;
    constructor(left: number, top: number, geometry: unknown)
    {
        super();
        this.set_property_value(FigureWithGeometryVM.LeftKey, left);
        this.set_property_value(FigureWithGeometryVM.TopKey,  top);
        this.Geometry = geometry;
    }
}

class FigureWithoutGeometryVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(FigureWithoutGeometryVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(FigureWithoutGeometryVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(FigureWithoutGeometryVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(FigureWithoutGeometryVM, 'Height', 10, MetaData.None);
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: MuralBase[]): { board: Board }
{
    Application.current = null;
    new Application();
    const coll = new ObservableCollection<MuralBase>();
    for (const i of items) coll.Add(i);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    board.ItemContainerStyle = style;
    board.ItemsSource = coll;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { board };
}

function cont(board: Board, item: unknown): Figure
{
    const gen = (board as unknown as { _generator: { ContainerFromItem(item: unknown): Visual | undefined } })._generator;
    const c = gen.ContainerFromItem(item);
    assert.ok(c instanceof Figure, 'container should be Figure');
    return c;
}

function selectMany(board: Board, items: unknown[]): void
{
    for (let i = 0; i < items.length; i++)
    {
        const c = cont(board, items[i]);
        const mods = i === 0
            ? ModifierKeys.None
            : ModifierKeys.Control;
        board.HandleContainerClick(c, mods);
    }
}

describe('commands/combine.ts — isGeometricItem', () => {

    test('returns true for MuralBase with non-undefined Geometry', () => {
        const v = new FigureWithGeometryVM(0, 0, { /* opaque geometry */ });
        assert.equal(isGeometricItem(v), true);
    });

    test('returns false for MuralBase without Geometry', () => {
        const v = new FigureWithoutGeometryVM();
        assert.equal(isGeometricItem(v), false);
    });

    test('returns false for non-MuralBase values', () => {
        assert.equal(isGeometricItem(undefined), false);
        assert.equal(isGeometricItem(null),      false);
        assert.equal(isGeometricItem('string'),  false);
        assert.equal(isGeometricItem({ Geometry: {} }), false, 'plain object is not a MuralBase');
    });
});

describe('Board — BoardCommands.CombineXxx', () => {

    test('all 4 combine commands installed at construction', () => {
        const { board } = setup([]);
        assert.ok(board.CombineUnionCommand     instanceof RelayCommand);
        assert.ok(board.CombineIntersectCommand instanceof RelayCommand);
        assert.ok(board.CombineSubtractCommand  instanceof RelayCommand);
        assert.ok(board.CombineExcludeCommand   instanceof RelayCommand);
    });

    test('CanExecute requires ≥ 2 geometric items selected', () => {
        const g1 = new FigureWithGeometryVM(0,  0, {});
        const g2 = new FigureWithGeometryVM(50, 0, {});
        const nonGeo = new FigureWithoutGeometryVM();
        const { board } = setup([g1, g2, nonGeo]);

        selectMany(board, [g1]);
        assert.equal(board.CombineUnionCommand?.CanExecute(), false, 'one geometric item');
        selectMany(board, [g1, nonGeo]);
        assert.equal(board.CombineUnionCommand?.CanExecute(), false, 'geometric + non-geometric');
        selectMany(board, [g1, g2]);
        assert.equal(board.CombineUnionCommand?.CanExecute(), true,  'two geometric items');
    });

    test('Execute fires CombineRequested with correct mode and items', () => {
        const g1 = new FigureWithGeometryVM(0,  0, { tag: 'shape1' });
        const g2 = new FigureWithGeometryVM(50, 0, { tag: 'shape2' });
        const { board } = setup([g1, g2]);

        const requests: CombineRequestedArgs[] = [];
        board.AddCombineRequestedListener(args => requests.push(args));

        selectMany(board, [g1, g2]);

        board.CombineUnionCommand?.Execute();
        board.CombineIntersectCommand?.Execute();
        board.CombineSubtractCommand?.Execute();
        board.CombineExcludeCommand?.Execute();

        assert.equal(requests.length, 4);
        assert.equal(requests[0].Mode, GeometryCombineMode.Union);
        assert.equal(requests[1].Mode, GeometryCombineMode.Intersect);
        // CombineSubtract → Exclude (= path difference), CombineExclude → Xor.
        // The names are inherited from the existing demo convention; the
        // important thing is each command maps to a distinct mode.
        assert.equal(requests[2].Mode, GeometryCombineMode.Exclude);
        assert.equal(requests[3].Mode, GeometryCombineMode.Xor);

        // Every request carries both selected items (filtered to geometric).
        for (const r of requests)
        {
            assert.equal(r.Items.length, 2);
            assert.ok(r.Items.includes(g1));
            assert.ok(r.Items.includes(g2));
        }
    });

    test('Non-geometric items in the selection are filtered out of Items', () => {
        const g1 = new FigureWithGeometryVM(0,  0, {});
        const g2 = new FigureWithGeometryVM(50, 0, {});
        const nonGeo = new FigureWithoutGeometryVM();
        const { board } = setup([g1, g2, nonGeo]);

        const requests: CombineRequestedArgs[] = [];
        board.AddCombineRequestedListener(args => requests.push(args));

        selectMany(board, [g1, g2, nonGeo]);
        board.CombineUnionCommand?.Execute();

        assert.equal(requests.length, 1);
        assert.equal(requests[0].Items.length, 2, 'non-geometric VM excluded from Items');
        assert.ok(!requests[0].Items.includes(nonGeo as never));
    });
});
