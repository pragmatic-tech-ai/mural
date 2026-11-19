import { ModifierKeys, toModifierKeys } from '../../../runtime/index.js';
// Step 12 / § 9 of [docs/connectors.md](../../../../docs/connectors.md):
// pins the two-channel selection API per § 7.3 — SelectConnector /
// DeselectConnector / IsConnectorSelected / SelectedConnectors live
// on Board alongside the inherited Selector's SelectedItems channel,
// and DeleteRequested fires with snapshots of both populations.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    Application,
    Key,
    KeyEventArgs,    MetaData,
    MuralBase,
    ObservableCollection,
    SetterFactory,
    Setter,
    Size,
    Style,
    Visual,
    DataContextBinding,
    type MountableTarget,
} from '../../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../../basic/index.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Board } from '../board.js';
import { Figure } from '../figure.js';
import { Point } from '../../../visual-engine/index.js';
import { SelectionMode } from '../../list/list-box.js';
import type { DeleteRequestedArgs } from '../commands/delete-ops.js';
import { RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';

// ── Test scaffolding ─────────────────────────────────────────────────

class LeafVM extends MuralBase
{
    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(LeafVM, 'Left',   0, MetaData.None);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(LeafVM, 'Top',    0, MetaData.None);
    public static readonly WidthKey  = MuralBase.RegisterProperty<number>(LeafVM, 'Width',  80, MetaData.None);
    public static readonly HeightKey = MuralBase.RegisterProperty<number>(LeafVM, 'Height', 80, MetaData.None);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(LeafVM, 'IsSelected', false, MetaData.None);
    constructor()
    {
        super();
        this.set_property_value(LeafVM.WidthKey, 80);
        this.set_property_value(LeafVM.HeightKey, 80);
    }
    public get Left(): number      { return this.get_property_value(LeafVM.LeftKey); }
    public get Top():  number      { return this.get_property_value(LeafVM.TopKey); }
    public get Width(): number     { return this.get_property_value(LeafVM.WidthKey); }
    public get Height(): number    { return this.get_property_value(LeafVM.HeightKey); }
    public get IsSelected(): boolean { return this.get_property_value(LeafVM.IsSelectedKey); }
    public set IsSelected(v: boolean) { this.set_property_value(LeafVM.IsSelectedKey, v); }
}

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void { /* noop */ }
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function setup(items: LeafVM[]): { board: Board }
{
    Application.current = null;
    new Application();
    const itemsCollection = new ObservableCollection<LeafVM>(items);
    const board = new Board();
    board.SelectionMode = SelectionMode.Extended;
    board.ItemsPanel    = new ItemsPanelTemplate(() => new Canvas());
    const style = new Style(Figure, [
        new Setter(Figure, 'Left', new SetterFactory((t: Visual) => DataContextBinding(t, 'Left'))),
        new Setter(Figure, 'Top',  new SetterFactory((t: Visual) => DataContextBinding(t, 'Top'))),
    ], undefined, [], []);
    board.ItemContainerStyle = style;
    board.ItemsSource = itemsCollection;
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = board;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(800, 600));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 800, Height: 600 } as never);
    return { board };
}

function selectFigure(board: Board, item: LeafVM): void
{
    const container = board.Generator.ContainerFromItem(item);
    if (container === undefined) throw new Error('no container for item');
    board.HandleContainerClick(container, ModifierKeys.Control);
}

function dispatchKeyDown(board: Board, key: Key): KeyEventArgs
{
    const args = new KeyEventArgs('KeyDown', board, {
        Key:       key,
        KeyText:       key,
        Code:      key,
        Modifiers: ModifierKeys.None,
        IsRepeat:    false,
    });
    (board as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
    return args;
}

function dispatchKeyDownMod(board: Board, key: Key, mods: ModifierKeys): KeyEventArgs
{
    const args = new KeyEventArgs('KeyDown', board, {
        Key:       key,
        KeyText:   key,
        Code:      key,
        Modifiers: mods,
        IsRepeat:  false,
    });
    (board as unknown as { OnKeyDown(a: KeyEventArgs): void }).OnKeyDown(args);
    return args;
}

function makeConnector(): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;       // only Straight is side-effect-imported in this file
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0,   0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    return c;
}

// ── Connector-selection state API ────────────────────────────────────

describe('Board — connector-selection API', () => {
    test('SelectConnector + IsConnectorSelected roundtrip', () => {
        const { board } = setup([]);
        const c = makeConnector();
        assert.equal(board.IsConnectorSelected(c), false);
        board.SelectConnector(c);
        assert.equal(board.IsConnectorSelected(c), true);
    });

    test('DeselectConnector clears that entry only', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        board.SelectConnector(a);
        board.SelectConnector(b);
        board.DeselectConnector(a);
        assert.equal(board.IsConnectorSelected(a), false);
        assert.equal(board.IsConnectorSelected(b), true);
    });

    test('ClearConnectorSelection wipes the whole connector channel', () => {
        const { board } = setup([]);
        board.SelectConnector(makeConnector());
        board.SelectConnector(makeConnector());
        board.SelectConnector(makeConnector());
        board.ClearConnectorSelection();
        assert.equal(board.SelectedConnectors.length, 0);
    });

    test('SelectedConnectors returns a snapshot — outer mutation does not affect internal state', () => {
        const { board } = setup([]);
        const c = makeConnector();
        board.SelectConnector(c);
        const snap = board.SelectedConnectors;
        (snap as Connector[]).push(makeConnector());
        assert.equal(board.SelectedConnectors.length, 1);
    });

    test('connector-selection channel is INDEPENDENT of the items-selection channel', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        const conn = makeConnector();
        selectFigure(board, a);
        board.SelectConnector(conn);
        assert.equal(board.SelectedItems.length, 1);
        assert.equal(board.SelectedConnectors.length, 1);
        board.ClearConnectorSelection();
        assert.equal(board.SelectedItems.length, 1);
        assert.equal(board.SelectedConnectors.length, 0);
    });
});

// ── Selection prunes when a connector leaves Connectors ──────────────

describe('Board — connector selection prunes on removal from Connectors', () => {
    test('removing a selected connector drops it from SelectedConnectors + fires once', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const coll = new ObservableCollection<MuralBase>([a, b]);
        board.Connectors = coll;
        board.SelectConnector(a);
        board.SelectConnector(b);

        let fires = 0;
        board.AddConnectorSelectionChangedListener(() => fires++);

        coll.Remove(a);

        assert.equal(board.IsConnectorSelected(a), false, 'removed connector pruned');
        assert.equal(board.IsConnectorSelected(b), true,  'survivor stays selected');
        assert.equal(board.SelectedConnectors.length, 1);
        assert.equal(fires, 1, 'ConnectorSelectionChanged fired exactly once');
    });

    test('clearing the Connectors collection wipes the connector selection', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const coll = new ObservableCollection<MuralBase>([a]);
        board.Connectors = coll;
        board.SelectConnector(a);
        coll.Clear();
        assert.equal(board.SelectedConnectors.length, 0);
    });

    test('removing an UNSELECTED connector does not fire ConnectorSelectionChanged', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const coll = new ObservableCollection<MuralBase>([a, b]);
        board.Connectors = coll;
        board.SelectConnector(a);
        let fires = 0;
        board.AddConnectorSelectionChangedListener(() => fires++);
        coll.Remove(b);                       // b was never selected
        assert.equal(fires, 0);
        assert.equal(board.IsConnectorSelected(a), true);
    });

    test('swapping the Connectors DP prunes selection absent from the new collection', () => {
        const { board } = setup([]);
        const a = makeConnector();
        board.Connectors = new ObservableCollection<MuralBase>([a]);
        board.SelectConnector(a);
        board.Connectors = new ObservableCollection<MuralBase>([]);   // a gone
        assert.equal(board.IsConnectorSelected(a), false);
    });
});

// ── Delete delivers both arrays ──────────────────────────────────────

describe('Board — Delete with mixed selection fires DeleteRequested with both arrays', () => {
    test('only Items selected: Connectors is empty, Items carries the snapshot', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        const captured: DeleteRequestedArgs[] = [];
        board.AddDeleteRequestedListener(args => captured.push(args));
        selectFigure(board, a);

        dispatchKeyDown(board, Key.Delete);
        assert.equal(captured.length, 1);
        assert.equal(captured[0]!.Items.length, 1);
        assert.equal(captured[0]!.Items[0], a);
        assert.equal(captured[0]!.Connectors.length, 0);
    });

    test('only Connectors selected: Items is empty, Connectors carries the snapshot', () => {
        const { board } = setup([]);
        const captured: DeleteRequestedArgs[] = [];
        board.AddDeleteRequestedListener(args => captured.push(args));
        const conn = makeConnector();
        board.SelectConnector(conn);

        const args = dispatchKeyDown(board, Key.Delete);
        assert.equal(captured.length, 1);
        assert.equal(captured[0]!.Items.length, 0);
        assert.equal(captured[0]!.Connectors.length, 1);
        assert.equal(captured[0]!.Connectors[0], conn);
        assert.equal(args.Handled, true);
    });

    test('mixed selection delivers both populations to a single listener', () => {
        const a = new LeafVM(), b = new LeafVM();
        const { board } = setup([a, b]);
        let captured: DeleteRequestedArgs | undefined;
        board.AddDeleteRequestedListener(args => { captured = args; });

        selectFigure(board, a);
        selectFigure(board, b);
        const conn1 = makeConnector();
        const conn2 = makeConnector();
        board.SelectConnector(conn1);
        board.SelectConnector(conn2);

        dispatchKeyDown(board, Key.Delete);
        assert.ok(captured !== undefined);
        assert.equal(captured!.Items.length, 2);
        assert.equal(captured!.Connectors.length, 2);
        assert.ok(captured!.Items.includes(a) && captured!.Items.includes(b));
        assert.ok(captured!.Connectors.includes(conn1) && captured!.Connectors.includes(conn2));
    });

    test('Delete without Shift fires with Shift=false', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        let captured: DeleteRequestedArgs | undefined;
        board.AddDeleteRequestedListener(args => { captured = args; });
        selectFigure(board, a);
        dispatchKeyDownMod(board, Key.Delete, ModifierKeys.None);
        assert.equal(captured?.Shift, false);
    });

    test('Shift+Delete fires with Shift=true', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        let captured: DeleteRequestedArgs | undefined;
        board.AddDeleteRequestedListener(args => { captured = args; });
        selectFigure(board, a);
        dispatchKeyDownMod(board, Key.Delete, ModifierKeys.Shift);
        assert.equal(captured?.Shift, true);
    });

    test('empty Items + empty Connectors → no fire, not handled', () => {
        const { board } = setup([]);
        let fired = 0;
        board.AddDeleteRequestedListener(() => { fired++; });
        const args = dispatchKeyDown(board, Key.Delete);
        assert.equal(fired, 0);
        assert.equal(args.Handled, false);
    });

    test('Backspace path covers connectors too', () => {
        const { board } = setup([]);
        let captured: DeleteRequestedArgs | undefined;
        board.AddDeleteRequestedListener(args => { captured = args; });
        board.SelectConnector(makeConnector());

        dispatchKeyDown(board, Key.Back);
        assert.ok(captured !== undefined);
        assert.equal(captured!.Connectors.length, 1);
    });

    test('snapshot stability — Items / Connectors arrays survive listener mutation', () => {
        const a = new LeafVM();
        const { board } = setup([a]);
        const conn = makeConnector();
        let captured: DeleteRequestedArgs | undefined;
        board.AddDeleteRequestedListener(args => {
            captured = args;
            // Simulate the consumer's typical "clear selection as
            // part of removal" pattern. The captured args' arrays
            // must remain populated after the clear.
            board.ClearSelection();
            board.ClearConnectorSelection();
        });
        selectFigure(board, a);
        board.SelectConnector(conn);

        dispatchKeyDown(board, Key.Delete);
        assert.ok(captured !== undefined);
        assert.equal(captured!.Items.length, 1);
        assert.equal(captured!.Connectors.length, 1);
    });
});

// ── Multi-select / ConnectorSelectionChanged ─────────────────────────

describe('Board — connector multi-select', () => {
    function pushConnector(board: Board, c: Connector): void
    {
        let col = board.Connectors;
        if (col === undefined)
        {
            col = new ObservableCollection<MuralBase>([]);
            board.Connectors = col;
        }
        col.Add(c);
    }

    test('SelectConnector fires ConnectorSelectionChanged exactly once on first add', () => {
        const { board } = setup([]);
        const c = makeConnector();
        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnector(c);
        assert.equal(fired, 1);
    });

    test('SelectConnector is idempotent — re-selecting already-selected does not fire', () => {
        const { board } = setup([]);
        const c = makeConnector();
        board.SelectConnector(c);
        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnector(c);
        assert.equal(fired, 0);
    });

    test('DeselectConnector fires only when the entry was selected', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        board.SelectConnector(a);
        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.DeselectConnector(b);  // not selected — no fire
        assert.equal(fired, 0);
        board.DeselectConnector(a);  // was selected — fires
        assert.equal(fired, 1);
    });

    test('ClearConnectorSelection is idempotent on empty', () => {
        const { board } = setup([]);
        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.ClearConnectorSelection();
        assert.equal(fired, 0);
    });

    test('SelectConnectorRange picks inclusive slice in Connectors index order', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const c = makeConnector();
        const d = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);
        pushConnector(board, c);
        pushConnector(board, d);

        board.SelectConnectorRange(b, d);
        const sel = board.SelectedConnectors;
        assert.equal(sel.length, 3);
        assert.ok(sel.includes(b) && sel.includes(c) && sel.includes(d));
        assert.ok(!sel.includes(a));
    });

    test('SelectConnectorRange order-independent: from > to swaps endpoints', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const c = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);
        pushConnector(board, c);

        board.SelectConnectorRange(c, a);
        assert.equal(board.SelectedConnectors.length, 3);
    });

    test('SelectConnectorRange replaces — entries outside the slice are deselected', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const c = makeConnector();
        const d = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);
        pushConnector(board, c);
        pushConnector(board, d);

        board.SelectConnector(a);
        board.SelectConnectorRange(c, d);
        const sel = board.SelectedConnectors;
        assert.equal(sel.length, 2);
        assert.ok(sel.includes(c) && sel.includes(d));
        assert.ok(!sel.includes(a));
    });

    test('SelectConnectorRange fires ConnectorSelectionChanged exactly once for the diff', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const c = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);
        pushConnector(board, c);

        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnectorRange(a, c);
        assert.equal(fired, 1);
    });

    test('SelectConnectorRange — already-matching selection emits no event', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);
        board.SelectConnectorRange(a, b);

        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnectorRange(a, b);
        assert.equal(fired, 0);
    });

    test('SelectConnectorRange — endpoint missing from Connectors is a no-op', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        const orphan = makeConnector();
        pushConnector(board, a);
        pushConnector(board, b);

        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnectorRange(a, orphan);
        assert.equal(fired, 0);
        assert.equal(board.SelectedConnectors.length, 0);
    });

    test('SelectConnectorRange — undefined Connectors collection is a no-op', () => {
        const { board } = setup([]);
        const a = makeConnector();
        const b = makeConnector();
        // Don't push — Connectors stays undefined
        let fired = 0;
        board.AddConnectorSelectionChangedListener(() => { fired++; });
        board.SelectConnectorRange(a, b);
        assert.equal(fired, 0);
        assert.equal(board.SelectedConnectors.length, 0);
    });
});
