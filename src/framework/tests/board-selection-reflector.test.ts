import { ModifierKeys, toModifierKeys } from '../../runtime/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Key,
    KeyEventArgs,    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    Setter,
    SetterFactory,
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

// Leaf VM with the conventional Left/Top/Width/Height + IsSelected
// quintet. Parent points up the tree (undefined = top-level).
class LeafVM extends MuralBase
{
    public static readonly LeftKey       = MuralBase.RegisterProperty<number>(LeafVM, 'Left',       0,  MetaData.None);
    public static readonly TopKey        = MuralBase.RegisterProperty<number>(LeafVM, 'Top',        0,  MetaData.None);
    public static readonly WidthKey      = MuralBase.RegisterProperty<number>(LeafVM, 'Width',      10, MetaData.None);
    public static readonly HeightKey     = MuralBase.RegisterProperty<number>(LeafVM, 'Height',     10, MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(LeafVM, 'IsSelected', false, MetaData.None);
    public Parent: GroupMockVM | undefined = undefined;
    public get Left():        number  { return this.get_property_value(LeafVM.LeftKey); }
    public set Left(v:        number) { this.set_property_value(LeafVM.LeftKey, v); }
    public get Top():         number  { return this.get_property_value(LeafVM.TopKey); }
    public set Top(v:         number) { this.set_property_value(LeafVM.TopKey, v); }
    public get IsSelected():  boolean { return this.get_property_value(LeafVM.IsSelectedKey); }
    public set IsSelected(v:  boolean) { this.set_property_value(LeafVM.IsSelectedKey, v); }
}

// Group VM with IsSelected + Members. Members presence triggers
// isGroupShape duck-type (used for chrome dispatch in the demo).
class GroupMockVM extends MuralBase
{
    public static readonly LeftKey       = MuralBase.RegisterProperty<number>(GroupMockVM, 'Left',       0,  MetaData.None);
    public static readonly TopKey        = MuralBase.RegisterProperty<number>(GroupMockVM, 'Top',        0,  MetaData.None);
    public static readonly WidthKey      = MuralBase.RegisterProperty<number>(GroupMockVM, 'Width',      10, MetaData.None);
    public static readonly HeightKey     = MuralBase.RegisterProperty<number>(GroupMockVM, 'Height',     10, MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(GroupMockVM, 'IsSelected', false, MetaData.None);
    public Members: LeafVM[];
    public Parent:  GroupMockVM | undefined = undefined;
    constructor(members: LeafVM[])
    {
        super();
        this.Members = members;
        for (const m of members) m.Parent = this;
    }
    public get IsSelected():  boolean { return this.get_property_value(GroupMockVM.IsSelectedKey); }
    public set IsSelected(v:  boolean) { this.set_property_value(GroupMockVM.IsSelectedKey, v); }
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

describe('Board — SelectionReflector (ReflectSelectionToItems)', () => {

    test('default OFF — IsSelected on items stays unchanged on selection', () => {
        const a = new LeafVM(), b = new LeafVM();
        const { board } = setup([a, b]);
        selectMany(board, [a]);
        assert.equal(a.IsSelected, false, 'reflector inactive — IsSelected stays at default');
    });

    test('ON — single-leaf selection flips its IsSelected to true', () => {
        const a = new LeafVM(), b = new LeafVM();
        const { board } = setup([a, b]);
        board.ReflectSelectionToItems = true;
        selectMany(board, [a]);
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, false);
    });

    test('ON — clicking inside a group elevates IsSelected to the group, not the leaf', () => {
        const leaf1 = new LeafVM(), leaf2 = new LeafVM();
        const g = new GroupMockVM([leaf1, leaf2]);
        const { board } = setup([g, leaf1, leaf2]);
        board.ReflectSelectionToItems = true;
        selectMany(board, [leaf1]);
        assert.equal(g.IsSelected,    true,  'group is elevated and marked');
        assert.equal(leaf1.IsSelected, false, 'leaf is NOT marked (group chrome covers it)');
        assert.equal(leaf2.IsSelected, false);
    });

    test('ON — selection change clears IsSelected on previously-reflected items', () => {
        const a = new LeafVM(), b = new LeafVM();
        const { board } = setup([a, b]);
        board.ReflectSelectionToItems = true;
        selectMany(board, [a]);
        assert.equal(a.IsSelected, true);
        selectMany(board, [b]);                  // replaces selection
        assert.equal(a.IsSelected, false, 'a left the selection, IsSelected cleared');
        assert.equal(b.IsSelected, true);
    });

    test('ON — multi-select with Ctrl-click reflects both leaves', () => {
        const a = new LeafVM(), b = new LeafVM(), c = new LeafVM();
        const { board } = setup([a, b, c]);
        board.ReflectSelectionToItems = true;
        selectMany(board, [a, b]);
        assert.equal(a.IsSelected, true);
        assert.equal(b.IsSelected, true);
        assert.equal(c.IsSelected, false);
    });
});

// `protected` is a TypeScript-only annotation; reach through `any` for
// direct OnKeyDown invocation in tests. Mirrors patterns elsewhere in
// the framework test suite.
function dispatchKeyDown(board: Board, key: Key, mods: { Control?: boolean; Shift?: boolean; Meta?: boolean }): KeyEventArgs
{
    const args = new KeyEventArgs('KeyDown', board, {
        Key:       key,
        KeyText:       key,
        Code:      key,
        Modifiers: toModifierKeys({ control: !!mods.Control, shift: !!mods.Shift, meta: !!mods.Meta }),
        IsRepeat:    false,
    });
    (board as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
    return args;
}

describe('Board — keyboard shortcuts (Delete / Ctrl+G / Ctrl+Shift+G)', () => {

    test('Delete fires DeleteRequested with a SelectedItems snapshot', () => {
        const a = new LeafVM(), b = new LeafVM(), c = new LeafVM();
        const { board } = setup([a, b, c]);
        const fired: Array<readonly unknown[]> = [];
        board.AddDeleteRequestedListener(args => fired.push(args.Items));
        selectMany(board, [a, b]);

        const args = dispatchKeyDown(board, Key.Delete, {});

        assert.equal(fired.length, 1);
        assert.equal(fired[0].length, 2);
        assert.ok(fired[0].includes(a));
        assert.ok(fired[0].includes(b));
        assert.equal(args.Handled, true);
    });

    test('Backspace fires DeleteRequested too (same shortcut)', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        let fired = 0;
        board.AddDeleteRequestedListener(() => { fired++; });
        selectMany(board, [a]);

        dispatchKeyDown(board, Key.Back, {});
        assert.equal(fired, 1);
    });

    test('Delete with empty selection is a no-op (no fire, not handled)', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        let fired = 0;
        board.AddDeleteRequestedListener(() => { fired++; });

        const args = dispatchKeyDown(board, Key.Delete, {});
        assert.equal(fired, 0);
        assert.equal(args.Handled, false);
    });

    test('Ctrl+G executes GroupCommand when CanExecute is true', () => {
        const a = new LeafVM(), b = new LeafVM();
        const { board } = setup([a, b]);
        selectMany(board, [a, b]);
        let fired = 0;
        const original = board.GroupCommand;
        const probe = new RelayCommand(() => { fired++; }, () => true);
        board.set_property_value(Board.GroupCommandKey, probe);

        dispatchKeyDown(board, Key.G, { Control: true });
        assert.equal(fired, 1, 'Ctrl+G executed the GroupCommand');
        assert.ok(original instanceof RelayCommand, 'original GroupCommand was present');
    });

    test('Ctrl+Shift+G executes UngroupCommand', () => {
        const inner = new LeafVM();
        const g = new GroupMockVM([inner]);
        const { board } = setup([g]);
        selectMany(board, [g]);
        let fired = 0;
        const probe = new RelayCommand(() => { fired++; }, () => true);
        board.set_property_value(Board.UngroupCommandKey, probe);

        dispatchKeyDown(board, Key.G, { Control: true, Shift: true });
        assert.equal(fired, 1);
    });

    test('Ctrl+G is a silent no-op when CanExecute is false', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        selectMany(board, [a]);          // only one item — Group needs ≥ 2
        let fired = 0;
        const probe = new RelayCommand(() => { fired++; }, () => false);
        board.set_property_value(Board.GroupCommandKey, probe);

        const args = dispatchKeyDown(board, Key.G, { Control: true });
        assert.equal(fired, 0);
        assert.equal(args.Handled, true, 'still consumed — bubble would steal it');
    });
});
