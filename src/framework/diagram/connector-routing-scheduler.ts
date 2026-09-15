import type { Connector } from './connector.js';
import type { SideEndpointRegistry } from './side-endpoint-host.js';
import type { ResolvedPortSide } from './port.js';

// Synchronous, depth-nested suspend scope for connector routing. While a Batch
// is open, Connector._scheduleRecompute and SideEndpointRegistry._fireSideRebalance
// record dirty state and return instead of routing / optimizing eagerly; the
// outermost close runs a two-pass flush that produces a state identical to eager
// wiring. Mirrors ObservableCollection.Batch.
//
// Why: wiring a graph assigns Connector.Source/Target on hundreds of connectors
// that share figure-sides. Each assignment eagerly runs the O(k³) per-side
// crossing optimizer (SideEndpointRegistry.optimizeIntersections) against every
// connector already on the shared side, so bulk load is ~O(K⁴). Deferring to one
// optimize per side collapses that to O(M + Σ per-side optimize).
//
// State is static (per the OOP rule — no module-level mutable data); the
// suspension is process-global by design because a bulk wire touches many
// connectors and shared figure-sides at once, and the choke points
// (_scheduleRecompute, _fireSideRebalance) have no natural per-diagram owner to
// route the flag through.
export class ConnectorRoutingScheduler
{
    private static _depth = 0;
    private static _inPassA = false;
    private static _inPassB = false;
    private static readonly _dirtyConnectors = new Set<Connector>();
    private static readonly _dirtySides = new Map<SideEndpointRegistry, Set<ResolvedPortSide>>();

    // Deferral predicate — read by Connector._scheduleRecompute and
    // SideEndpointRegistry._fireSideRebalance. True while a Batch is open
    // (depth > 0) AND while flush Pass A runs (so bake / re-register cascades
    // during Pass A keep collapsing into the dirty sets instead of recursing);
    // false once flush enters Pass B, where real re-routes must happen so the
    // per-side optimizer can read live geometry.
    public static get IsSuspended(): boolean { return this._depth > 0 || this._inPassA; }

    // Optimize-suppression predicate — read by Connector._scheduleRecompute to
    // gate its trailing _optimizeAnchoredSides call. True ONLY during flush
    // Pass B: there, the per-side optimizer drives re-routes (via
    // _fireSideRebalance → _scheduleRecompute) and must get fresh route geometry,
    // but each such re-route must NOT re-trigger _optimizeAnchoredSides — that is
    // exactly the O(K⁴) cascade this scheduler exists to collapse. Pass B calls
    // optimizeIntersections once per dirty side itself.
    public static get IsSuppressingOptimize(): boolean { return this._inPassB; }

    public static Batch(mutate: () => void): void
    {
        this._depth++;
        try { mutate(); }
        finally
        {
            this._depth--;
            if (this._depth === 0) this.flush();
        }
    }

    public static markConnectorDirty(c: Connector): void
    {
        this._dirtyConnectors.add(c);
    }

    public static markSideDirty(reg: SideEndpointRegistry, side: ResolvedPortSide): void
    {
        let set = this._dirtySides.get(reg);
        if (set === undefined) { set = new Set<ResolvedPortSide>(); this._dirtySides.set(reg, set); }
        set.add(side);
    }

    // Two-pass settle.
    //   Pass A (IsSuspended still true via _inPassA): drain the dirty-connector
    //     worklist, routing each once. Bake / re-register cascades re-mark dirty,
    //     so drain to a fixed point — bounded, because bake is idempotent once a
    //     side is pinned. A round cap guards against an unforeseen cycle; the
    //     outcome-identity test would catch a route that didn't settle.
    //   Pass B (_inPassA cleared): one rebalance + one optimize per dirty side,
    //     exactly the end state the eager path reaches, but computed once.
    private static flush(): void
    {
        this._inPassA = true;
        try
        {
            let rounds = 0;
            while (this._dirtyConnectors.size > 0 && rounds++ < 16)
            {
                const batch = [...this._dirtyConnectors];
                this._dirtyConnectors.clear();
                for (const c of batch) c._flushRecompute();
            }
            this._dirtyConnectors.clear();   // drop any stragglers past the cap
        }
        finally
        {
            this._inPassA = false;
        }

        // Pass B — routes stay live (IsSuspended false) so the optimizer's
        // tentative swaps re-route, but _inPassB suppresses each re-route's
        // trailing _optimizeAnchoredSides, so optimize runs exactly once per
        // dirty side here rather than cascading.
        this._inPassB = true;
        try
        {
            const sides = [...this._dirtySides];
            this._dirtySides.clear();
            for (const [reg, set] of sides)
            {
                for (const side of set)
                {
                    // A side with fewer than two connectors can't have a crossing;
                    // optimizeIntersections would early-return. Skip the call so the
                    // optimizer is invoked only where it can do work.
                    if (reg.GetSideEndpointCount(side) >= 2) reg.optimizeIntersections(side);
                }
            }
        }
        finally
        {
            this._inPassB = false;
        }
    }
}
