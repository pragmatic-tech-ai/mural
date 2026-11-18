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
    selectedTopLevel,
    selectedTopLevelGroups,
    isGroupShape,
} from '../board/commands/group-ops.js';

// ── Pure-helper tests ───────────────────────────────────────────────

class LeafVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(LeafVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(LeafVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(LeafVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(LeafVM, 'Height', 10, MetaData.None);
    public Parent: GroupMockVM | undefined;
}

// Mock group VM: has Members + Parent. Treated as group-shaped by
// isGroupShape because it exposes `Members`.
class GroupMockVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(GroupMockVM, 'Left',   0,  MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(GroupMockVM, 'Top',    0,  MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(GroupMockVM, 'Width',  10, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(GroupMockVM, 'Height', 10, MetaData.None);
    public Members: LeafVM[];
    public Parent:  GroupMockVM | undefined;
    constructor(members: LeafVM[])
    {
        super();
        this.Members = members;
        this.Parent  = undefined;
        for (const m of members) m.Parent = this;
    }
}

describe('commands/group-ops.ts — pure helpers', () => {

    test('selectedTopLevel filters to outermost ancestors, de-duped', () => {
        const a = new LeafVM();
        const b = new LeafVM();
        const g = new GroupMockVM([a, b]);   // a.Parent = g, b.Parent = g
        const c = new LeafVM();              // top-level on its own

        // Selecting a + b (both inside g) + c should yield [g, c].
        const result = selectedTopLevel([a, b, c]);
        assert.equal(result.length, 2);
        assert.ok(result.includes(g));
        assert.ok(result.includes(c));
    });

    test('selectedTopLevel: selecting parent + child yields just parent', () => {
        const a = new LeafVM();
        const g = new GroupMockVM([a]);
        const result = selectedTopLevel([a, g]);
        assert.equal(result.length, 1);
        assert.equal(result[0], g);
    });

    test('selectedTopLevelGroups filters to top-level group-shaped entries', () => {
        const a = new LeafVM();
        const b = new LeafVM();
        const g = new GroupMockVM([a, b]);
        const c = new LeafVM();
        const result = selectedTopLevelGroups([a, b, c]);
        assert.equal(result.length, 1);
        assert.equal(result[0], g);
    });

    test('isGroupShape returns true iff Members property is present', () => {
        assert.equal(isGroupShape(new LeafVM()),               false);
        assert.equal(isGroupShape(new GroupMockVM([])),        true);
        assert.equal(isGroupShape({ Members: [] }),            false, 'plain object is not a MuralBase');
        assert.equal(isGroupShape(undefined),                  false);
        assert.equal(isGroupShape(null),                       false);
        assert.equal(isGroupShape('not a model'),              false);
    });
});

// ── Board integration ─────────────────────────────────────────────

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

describe('Board — BoardCommands.Group / Ungroup', () => {

    test('default commands installed at construction', () => {
        const { board } = setup([]);
        assert.ok(board.GroupCommand   instanceof RelayCommand);
        assert.ok(board.UngroupCommand instanceof RelayCommand);
    });

    test('GroupCommand.CanExecute requires ≥ 2 top-level selected items', () => {
        const a = new LeafVM();
        const b = new LeafVM();
        const { board } = setup([a, b]);

        assert.equal(board.GroupCommand?.CanExecute(), false, 'empty selection');
        selectMany(board, [a]);
        assert.equal(board.GroupCommand?.CanExecute(), false, 'one item');
        selectMany(board, [a, b]);
        assert.equal(board.GroupCommand?.CanExecute(), true,  'two items');
    });

    test('UngroupCommand.CanExecute requires ≥ 1 group-shaped item selected', () => {
        const a = new LeafVM();
        const g = new GroupMockVM([new LeafVM()]);
        const { board } = setup([a, g]);

        selectMany(board, [a]);
        assert.equal(board.UngroupCommand?.CanExecute(), false, 'leaf-only');
        selectMany(board, [g]);
        assert.equal(board.UngroupCommand?.CanExecute(), true,  'group selected');
    });

    test('Execute fires GroupRequested with the top-level subset', () => {
        const a = new LeafVM();
        const b = new LeafVM();
        const c = new LeafVM();
        const { board } = setup([a, b, c]);

        const requests: Array<readonly MuralBase[]> = [];
        board.AddGroupRequestedListener(args => requests.push(args.Items));

        selectMany(board, [a, b, c]);
        board.GroupCommand?.Execute();

        assert.equal(requests.length, 1);
        assert.equal(requests[0].length, 3);
        assert.ok(requests[0].includes(a));
        assert.ok(requests[0].includes(b));
        assert.ok(requests[0].includes(c));
    });

    test('Execute fires UngroupRequested with the selected groups', () => {
        const inner1 = new LeafVM();
        const inner2 = new LeafVM();
        const g = new GroupMockVM([inner1, inner2]);
        const c = new LeafVM();
        const { board } = setup([g, c]);

        const requests: Array<readonly MuralBase[]> = [];
        board.AddUngroupRequestedListener(args => requests.push(args.Groups));

        selectMany(board, [g]);
        board.UngroupCommand?.Execute();

        assert.equal(requests.length, 1);
        assert.equal(requests[0].length, 1);
        assert.equal(requests[0][0], g);
    });

    test('RemoveGroupRequestedListener detaches the handler', () => {
        const a = new LeafVM();
        const b = new LeafVM();
        const { board } = setup([a, b]);

        let fires = 0;
        const handler = (): void => { fires++; };
        board.AddGroupRequestedListener(handler);
        selectMany(board, [a, b]);
        board.GroupCommand?.Execute();
        assert.equal(fires, 1);

        board.RemoveGroupRequestedListener(handler);
        board.GroupCommand?.Execute();
        assert.equal(fires, 1, 'detached handler must not fire again');
    });
});
