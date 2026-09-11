import {
    type CollectionChange,
    type Disposable,
    type MuralBase,
    type Visual,
    Panel,
} from '../../../runtime/index.js';
import { Connector } from '../connector.js';
import type { Diagram } from '../diagram.js';

// Internal collaborator owned by Diagram. Materializes one Visual per
// entry in Diagram.Connectors via ConnectorTemplate (or the built-in
// `new Connector()` fallback), tracks the item → Visual mapping, and
// mounts each one onto Diagram's ItemsPanel (a single Canvas). Connectors,
// their caps and their label are all added as siblings of the figures.
//
// Diagram listens to its own Connectors / ConnectorTemplate DPs and
// forwards changes via the public _on* methods — the collaborator
// itself doesn't subscribe to Diagram's DPs to keep the dependency
// direction one-way (Diagram → collaborator).
export class DiagramConnectorsMaterializer
{
    private readonly _diagram: Diagram;
    private readonly _visuals: Map<MuralBase, Visual> = new Map();
    private _collectionUnsub: (() => void) | undefined = undefined;

    // Per-connector cap bookkeeping. `_mountedCaps` is the set of cap
    // visuals currently in the connectors layer for a given item;
    // `_capUnsubs` detaches the cap-template DP listeners that keep that
    // set in sync when a connector's Source/TargetCapTemplate flips.
    private readonly _mountedCaps: Map<MuralBase, Visual[]> = new Map();
    private readonly _capUnsubs:   Map<MuralBase, () => void> = new Map();

    // Per-connector label visual (§ Slice 5). The connector's ShapeText is
    // mounted as a connectors-layer sibling, just like a cap; the connector
    // positions it (Canvas.Left/Top) on each route recompute.
    private readonly _mountedLabels: Map<MuralBase, Visual> = new Map();

    constructor(diagram: Diagram)
    {
        this._diagram = diagram;
    }

    public get MaterializedVisuals(): ReadonlyMap<MuralBase, Visual> { return this._visuals; }

    /** @internal — called by Diagram.OnPropertyChanged on the Connectors DP. */
    public _onConnectorsCollectionChanged(): void
    {
        this._collectionUnsub?.();
        this._collectionUnsub = undefined;
        this._clearAll();

        const collection = this._diagram.Connectors;
        if (collection === undefined) return;

        for (let i = 0; i < collection.Count; i++)
        {
            const item = collection.Get(i)!;
            this._materializeAndMount(item);
        }
        this._collectionUnsub = collection.Subscribe(c => this._onCollectionChange(c));
    }

    /** @internal — called by Diagram.OnPropertyChanged on the ConnectorTemplate DP. */
    public _onTemplateChanged(): void
    {
        const collection = this._diagram.Connectors;
        if (collection === undefined) return;
        // Rebuild all current items against the new template.
        this._clearAll();
        for (let i = 0; i < collection.Count; i++)
        {
            this._materializeAndMount(collection.Get(i)!);
        }
    }

    /** @internal — Diagram calls this once its ItemsPanelInstance
     *  becomes available (the initial subscribe runs before the
     *  template materializes the panel; this re-mounts pending
     *  visuals once the panel is ready). */
    public _mountPending(): void
    {
        for (const [item, visual] of this._visuals)
        {
            this._mount(visual);
            // Caps + label couldn't mount while the panel was absent; sync now.
            if (visual instanceof Connector)
            {
                this._syncCaps(item, visual);
                this._mountLabel(item, visual);
            }
        }
    }

    private _onCollectionChange(change: CollectionChange<MuralBase>): void
    {
        switch (change.kind)
        {
            case 'inserted':
                for (const item of change.items) this._materializeAndMount(item);
                break;
            case 'removed':
                for (const item of change.items) this._unmaterialize(item);
                break;
            case 'replaced':
                this._unmaterialize(change.oldItem);
                this._materializeAndMount(change.newItem);
                break;
            case 'cleared':
                this._clearAll();
                break;
            case 'moved':
                // Visual identity preserved; nothing to rebuild.
                break;
        }
    }

    private _materializeAndMount(item: MuralBase): void
    {
        if (this._visuals.has(item)) return;
        const visual = this._instantiate(item);
        this._visuals.set(item, visual);
        this._mount(visual);
        this._wireCaps(item, visual);
        this._mountLabel(item, visual);
    }

    // Mount the connector's label ShapeText as a connectors-layer sibling.
    // Idempotent (_mountCap no-ops when already present), so _mountPending
    // can re-run it once the panel materializes. The connector positions the
    // label via Canvas.Left/Top in _placeLabel — the same absolute-canvas
    // coordinate space caps and the route line use.
    private _mountLabel(item: MuralBase, visual: Visual): void
    {
        if (!(visual instanceof Connector)) return;
        const label = visual.LabelInstance;
        this._mountCap(label);
        this._mountedLabels.set(item, label);
        // The label must land on the connector's current z-layer.
        this._mirrorZToDecor(item);
    }

    private _teardownLabel(item: MuralBase): void
    {
        const label = this._mountedLabels.get(item);
        if (label !== undefined)
        {
            this._unmountCap(label);
            this._mountedLabels.delete(item);
        }
    }

    // Mount the connector's cap visuals as siblings in the connectors
    // layer and keep that set live. Caps carry absolute diagram-host
    // coordinates via Canvas.Left/Top (placeCap) — the same space the
    // connector line paints in — so a plain sibling-in-the-Canvas mount
    // positions and rotates them correctly. The connector creates /
    // replaces its cap instances reactively (default cap in the ctor,
    // swaps when Source/TargetCapTemplate flips); we re-sync on those DP
    // changes. The connector's own OnPropertyChanged runs BEFORE this
    // listener (internal callback precedes user listeners), so the
    // *CapInstance getters already hold the fresh visuals here.
    private _wireCaps(item: MuralBase, visual: Visual): void
    {
        if (!(visual instanceof Connector)) return;
        const connector = visual;
        const onCaps = (): void => this._syncCaps(item, connector);
        const onZ    = (): void => this._mirrorZToDecor(item);
        const subs: Disposable[] = [
            connector.PropertyChanged(Connector.SourceCapTemplateKey).subscribe(onCaps),
            connector.PropertyChanged(Connector.TargetCapTemplateKey).subscribe(onCaps),
            connector.PropertyChanged(Panel.ZIndexKey).subscribe(onZ),
        ];
        this._capUnsubs.set(item, () => { for (const s of subs) s.dispose(); });
        this._syncCaps(item, connector);
    }

    // Keep a connector's mounted caps + label at the same ZIndex as the
    // connector, so a z-order command that restacks the connector moves the
    // whole assembly. Driven by the connector's own ZIndex change (wired in
    // _wireCaps) and re-applied whenever caps/label (re)mount.
    private _mirrorZToDecor(item: MuralBase): void
    {
        const visual = this._visuals.get(item);
        if (!(visual instanceof Connector)) return;
        const z = Panel.GetZIndex(visual);
        for (const cap of this._mountedCaps.get(item) ?? []) Panel.SetZIndex(cap, z);
        const label = this._mountedLabels.get(item);
        if (label !== undefined) Panel.SetZIndex(label, z);
    }

    private _syncCaps(item: MuralBase, connector: Connector): void
    {
        const panel = this._diagram.ItemsPanelInstance;
        if (panel === undefined) return;          // wait for layout (_mountPending re-runs)

        const desired: Visual[] = [];
        const src = connector.SourceCapInstance;
        const tgt = connector.TargetCapInstance;
        if (src !== undefined) desired.push(src);
        if (tgt !== undefined) desired.push(tgt);

        const prev = this._mountedCaps.get(item) ?? [];
        for (const cap of prev)
        {
            if (!desired.includes(cap)) this._unmountCap(cap);
        }
        for (const cap of desired)
        {
            if (prev.includes(cap)) continue;
            this._mountCap(cap);
        }
        if (desired.length === 0) this._mountedCaps.delete(item);
        else this._mountedCaps.set(item, desired);
        // Newly mounted caps must land on the connector's current z-layer.
        this._mirrorZToDecor(item);
    }

    private _mountCap(cap: Visual): void
    {
        this._addToPanel(cap);
    }

    private _unmountCap(cap: Visual): void
    {
        this._removeFromPanel(cap);
    }

    // Add a connector / cap / label visual to the diagram canvas once.
    // Reclaims a Visual still parented to a discarded prior diagram's panel
    // (tab-swap reuse) before AddChild's single-parent guard would reject it.
    private _addToPanel(visual: Visual): void
    {
        const panel = this._diagram.ItemsPanelInstance;
        if (panel === undefined) return;          // wait for layout — _mountPending re-runs
        if (panel.Children.IndexOf(visual) !== -1) return;
        this._reclaim(visual);
        panel.AddChild(visual);
    }

    private _removeFromPanel(visual: Visual): void
    {
        const panel = this._diagram.ItemsPanelInstance;
        if (panel === undefined) return;
        panel.RemoveChild(visual);
    }

    private _instantiate(item: MuralBase): Visual
    {
        // Items-are-Connectors convention (§ 1a). A Connector entry
        // IS the Visual that renders; skip template wrap so the same
        // model instance the consumer pushed into Connectors stays
        // the one on screen. Mirrors the items-are-Figures branch in
        // [diagram.ts]'s GetContainerForItemOverride.
        let visual: Visual;
        if (item instanceof Connector)
        {
            visual = item;
        }
        else
        {
            const template = this._diagram.ConnectorTemplate;
            visual = template !== undefined ? template.Apply(item) : new Connector();
            visual.DataContext = item;
        }
        return visual;
    }

    private _mount(visual: Visual): void
    {
        this._addToPanel(visual);
        // Stamp the behind-figures default only while the z is still unset (0);
        // a connector already reordered (non-zero z) keeps its place across a
        // re-mount (tab reuse / _mountPending).
        if (visual instanceof Connector && Panel.GetZIndex(visual) === 0)
            Panel.SetZIndex(visual, Connector.DefaultZIndex);
    }

    // Reclaim a shared connector / cap / label Visual from a now-discarded prior
    // Diagram's layer before mounting it here. A Connector item IS its Visual
    // (items-are-Connectors, § _instantiate) and its caps + label hang off it —
    // all owned by the document, not the view. A tab swap discards the outgoing
    // Diagram without unmounting them, so they stay parented to its (dead)
    // connectors layer; re-showing the document trips AddChild's single-parent
    // guard ("Visual already has a visual parent"). Same reclaim as
    // ItemsControl.rebuildContainers does for the node Figures.
    private _reclaim(visual: Visual): void
    {
        visual._release_from_visual_parent();
        visual._release_from_logical_parent();
    }

    private _unmaterialize(item: MuralBase): void
    {
        const visual = this._visuals.get(item);
        if (visual === undefined) return;
        this._teardownCaps(item);
        this._teardownLabel(item);
        this._unmount(visual);
        this._visuals.delete(item);
    }

    // Detach the cap-template listeners and unmount any cap visuals this
    // item had in the connectors layer.
    private _teardownCaps(item: MuralBase): void
    {
        this._capUnsubs.get(item)?.();
        this._capUnsubs.delete(item);
        const caps = this._mountedCaps.get(item);
        if (caps !== undefined)
        {
            for (const cap of caps) this._unmountCap(cap);
            this._mountedCaps.delete(item);
        }
    }

    private _unmount(visual: Visual): void
    {
        this._removeFromPanel(visual);
    }

    private _clearAll(): void
    {
        for (const item of this._visuals.keys())
        {
            this._teardownCaps(item);
            this._teardownLabel(item);
        }
        for (const visual of this._visuals.values()) this._unmount(visual);
        this._visuals.clear();
    }
}
