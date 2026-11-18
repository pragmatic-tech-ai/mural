import { Point } from '../../../visual-engine/index.js';
import type { Board } from '../board.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import type { Figure } from '../figure.js';
import type { MuralBase } from '../../../runtime/index.js';
import type { ResolvedPortSide } from '../port.js';
import { RoutingMode } from '../routing/router.js';

// Fired when the drag-create gesture lands on a target Figure
// (PointerUp over a Figure body or one of its ports). The consumer's
// listener decides what to do with the proposed Source / Target
// endpoints — typically construct a domain-level connector entry and
// push it into `Board.Connectors`. The framework does NOT mutate the
// Connectors collection itself; same event-based contract as
// Group / Ungroup / Combine / Delete in
// [board.ts:265-289](../board.ts#L265-L289).
export interface ConnectorCreatedArgs
{
    readonly Source: ConnectorEndpoint;
    readonly Target: ConnectorEndpoint;
}

export type ConnectorCreatedListener = (args: ConnectorCreatedArgs) => void;

// State machine for the drag-create gesture per § 4.1 of
// [docs/connectors.md](../../../../docs/connectors.md).
// Imperative begin/update/end/abort API: pointer wiring (Figure-level
// PointerDown trigger + cursor coordinate translation through any
// enclosing ScrollViewer) lives one layer up and calls into the
// methods on this behavior. The split keeps the state machine fully
// testable without faking the input subsystem.
//
// During the gesture a transient `Connector` instance lives on the
// behavior — exposed via `TransientConnector` so a consumer's
// pointer-wiring layer can mount it into the board's connectors
// layer for visual feedback. On EndCreate the transient is dropped
// and the consumer's ConnectorCreated listener materializes a
// non-transient connector through the Connectors collection.
export class ConnectorCreateBehavior
{
    private readonly _board: Board;
    private _transientConnector: Connector | undefined = undefined;
    private _sourceFigure:       Figure           | undefined = undefined;
    private _sourceSide:         ResolvedPortSide | undefined = undefined;

    constructor(board: Board)
    {
        this._board = board;
    }

    public get IsActive(): boolean { return this._transientConnector !== undefined; }
    public get TransientConnector(): Connector | undefined { return this._transientConnector; }

    // Start a drag-create gesture from `sourceSide` of `sourceFigure`.
    // If a gesture is already in flight the previous transient is
    // silently dropped — same convention as a second drag-start
    // preempting a previous unreleased drag.
    public BeginCreate(sourceFigure: Figure, sourceSide: ResolvedPortSide, cursor: Point): void
    {
        if (this._transientConnector !== undefined) this.Abort();

        this._sourceFigure = sourceFigure;
        this._sourceSide   = sourceSide;

        const transient = new Connector();
        transient.RoutingMode = RoutingMode.Orthogonal;
        transient.Source = makeSideEndpoint(sourceFigure, sourceSide);
        transient.Target = new ConnectorEndpoint({ FreePoint: cursor });
        this._transientConnector = transient;
    }

    // Per-pointer-move update — bubbles the cursor through to the
    // transient connector's Target.FreePoint. The connector's existing
    // OnPropertyChanged → recompute pipeline takes care of re-routing
    // at the new free-end position.
    public UpdateCursor(cursor: Point): void
    {
        const t = this._transientConnector;
        if (t === undefined) return;
        const tgt = t.Target;
        if (tgt === undefined) return;
        tgt.FreePoint = cursor;
    }

    // Close the gesture on a Figure target. Drops the transient and
    // fires ConnectorCreated with proposed Source / Target endpoints
    // shaped as side-anchors. The consumer's listener owns the next
    // step (insert into the Connectors collection).
    public EndCreate(targetFigure: Figure, targetSide: ResolvedPortSide): void
    {
        if (this._transientConnector === undefined
            || this._sourceFigure === undefined
            || this._sourceSide === undefined) return;

        const source = makeSideEndpoint(this._sourceFigure, this._sourceSide);
        const target = makeSideEndpoint(targetFigure,       targetSide);
        this._cleanup();
        this._board._fireConnectorCreated({ Source: source, Target: target });
    }

    // PointerUp over empty space — drop the transient connector
    // silently. No event fires.
    public Abort(): void
    {
        if (this._transientConnector === undefined) return;
        this._cleanup();
    }

    private _cleanup(): void
    {
        // Clear the transient's endpoint references so Connector.OnProperty
        // Changed → _reregister*Side unregisters them from the source
        // figure's side-endpoint list. Without this the transient's
        // source endpoint stays registered forever (the side-endpoint
        // map holds a strong reference to it, which transitively holds
        // the dropped transient connector + its endpoint), inflating
        // the side-slot count on every gesture. Visible as ghost port
        // markers on the SideBarsAdorner where no real connector
        // actually attaches.
        const t = this._transientConnector;
        if (t !== undefined)
        {
            t.Source = undefined;
            t.Target = undefined;
        }
        this._transientConnector = undefined;
        this._sourceFigure       = undefined;
        this._sourceSide         = undefined;
    }
}

// The endpoint host for a figure. The container Figure is now the sole geometry
// owner + side-endpoint host for every node kind (shape / text / callout figures
// ARE their own container; a content VM's container wraps it and mirrors its Id),
// so connectors reference the FIGURE — never the VM, which no longer hosts side
// endpoints or carries geometry. Kept as a named seam (rather than inlined) so
// the CREATE path (makeSideEndpoint) and the REPOSITION path (edit adorner) are
// provably referencing the same object: both live on the one container-side
// registry and fan, instead of stacking on two registries.
export function itemOf(figure: Figure): MuralBase
{
    return figure;
}

// Side-anchored endpoint constructor. The slot index on the side is
// not assigned here — Figure's side-endpoint registration (invoked
// when the Connector's Source / Target DPs settle) assigns slots
// dynamically, and PortResolver's side-slot path picks the position
// off the figure's current slot list at every resolve.
function makeSideEndpoint(figure: Figure, side: ResolvedPortSide): ConnectorEndpoint
{
    return new ConnectorEndpoint({ Node: itemOf(figure), PortSide: side });
}

// Convenience attach function mirroring the canvas-drop / mutator
// pattern. v1 wires only the behavior instance — pointer wiring is
// the consumer's responsibility, but the detach thunk drops the
// transient if one's still in flight when the behavior tears down.
export function attachConnectorCreate(board: Board): { behavior: ConnectorCreateBehavior; detach: () => void }
{
    const behavior = new ConnectorCreateBehavior(board);
    return {
        behavior,
        detach: (): void => behavior.Abort(),
    };
}
