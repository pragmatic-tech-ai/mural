import {
    Rect,
    findAlignmentGuides,
    type AlignmentGuide,
    type PointerEventArgs,
    type Visual,
} from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import type { Board } from '../board.js';

// Promoted from the demo's align-edges-behavior.mjs. Owns the
// pointer-driven alignment-guide computation that lights up dashed
// guide lines while a Figure is being dragged. Also installs a
// PositionSnap callback on the Board so the in-progress drag snaps
// to the nearest peer edge (per axis, within the kernel's tolerance).
//
// Lifecycle owned by Board — see Board constructor's subscription
// to AlignmentGuidesEnabledKey. Not exported as an attachThing/detach
// pair for consumer use; the public surface is the
// `Board.AlignmentGuidesEnabled` DP. Internal `@internal` API so the
// framework can install + uninstall it from a single place.
//
// Preview-phase delivery is non-negotiable: Figure.OnPointerDown / Move /
// Up all set args.Handled = true, which short-circuits the BUBBLE route
// walk before any Board-level bubble listener runs (this behavior used
// to listen there — so guides never appeared). The Board forwards its
// tunnel (preview) pointer virtuals to the handler bundle we install; the
// tunnel fires root -> target, so we bracket the drag BEFORE the Figure
// consumes the gesture. Guide COMPUTATION rides the PositionSnap callback
// instead: it runs during the Figure's own move with the candidate rect,
// so guides track the snapped position with no stale frame.
//
// On attach: installs the preview handler bundle + the PositionSnap.
// On detach: withdraws the bundle; restores the prior PositionSnap.

/** @internal */
export function attachAlignmentGuides(board: Board): () => void
{
    let activeFigure: Figure | undefined = undefined;

    // Compose over any snap already installed rather than dropping it. When a
    // figure is being dragged, compute + publish the guides for the (already
    // snapped-by-any-prior-callback) rect and return the alignment snap.
    const previousSnap = board.PositionSnap;
    board.PositionSnap = (rect: Rect): Rect => {
        const base = previousSnap !== undefined ? previousSnap(rect) : rect;
        if (activeFigure === undefined) return base;
        const others = collectOtherRects(board, activeFigure);
        const { snapped, guides } = findAlignmentGuides(base, others);
        board._setAlignmentGuides(guides);
        return snapped;
    };

    const onPreviewPointerDown = (args: PointerEventArgs): void => {
        if (args.Handled) return;   // a connector / edit-handle gesture already claimed it
        const fig = findFigureAncestor(args.Source);
        if (fig === undefined) return;
        activeFigure = fig;
        board._setAlignmentGuides([]);   // nothing has moved yet
    };

    const onPreviewPointerUp = (_args: PointerEventArgs): void => {
        if (activeFigure === undefined) return;
        activeFigure = undefined;
        board._setAlignmentGuides([]);
    };

    board._setAlignmentGuidesHandlers({
        OnPreviewPointerDown: onPreviewPointerDown,
        OnPreviewPointerUp:   onPreviewPointerUp,
    });

    return (): void => {
        board._setAlignmentGuidesHandlers(undefined);
        board.PositionSnap = previousSnap;
        if (board.AlignmentGuides.length > 0) board._setAlignmentGuides([]);
    };
}

// Handler bundle the Board delegates its preview pointer virtuals to.
// Only down / up are needed — guide computation happens in the PositionSnap
// callback (which the Figure's move drives with the candidate rect). The
// method names match the framework's pointer virtual conventions for clarity
// at the dispatch site; `unknown` args mirror ConnectorInteractionsHandlers
// so the Board and this behavior stay decoupled from the args type here.
export interface AlignmentGuidesHandlers
{
    OnPreviewPointerDown(args: unknown): void;
    OnPreviewPointerUp  (args: unknown): void;
}

// Walk up the visual parent chain from the event source to the
// enclosing Figure container. Captured-pointer events bubble through
// the container that owns the gesture first.
function findFigureAncestor(visual: unknown): Figure | undefined
{
    let cur = visual as { GetVisualParent?(): Visual | undefined } | undefined;
    while (cur !== undefined && cur !== null)
    {
        if (cur instanceof Figure) return cur;
        cur = (cur as { GetVisualParent?(): Visual | undefined }).GetVisualParent?.();
    }
    return undefined;
}

// Walk Board's items, look up each one's container via the
// ItemContainerGenerator, snapshot its current rect. Excludes the dragged
// figure by CONTAINER identity: post-migration an item can BE a Figure
// (Items-are-Figures) or a VM wrapped in a container Figure, so comparing
// DataContext is unreliable — a Figure item has no separate DataContext.
function collectOtherRects(board: Board, excludedFigure: Figure): Rect[]
{
    const out: Rect[] = [];
    const items = board.ItemsSource;
    if (items === undefined) return out;
    for (const peer of items as Iterable<unknown>)
    {
        const container = board.Generator.ContainerFromItem(peer);
        if (!(container instanceof Figure)) continue;
        if (container === excludedFigure) continue;
        const rect = container.ArrangedRect;
        if (rect === undefined || rect.Width <= 0) continue;
        out.push(new Rect(container.Left, container.Top, rect.Width, rect.Height));
    }
    return out;
}

// Re-export AlignmentGuide for consumers binding to Board.AlignmentGuides.
export type { AlignmentGuide };
