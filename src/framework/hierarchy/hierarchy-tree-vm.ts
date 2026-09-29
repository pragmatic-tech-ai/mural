import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { HierarchyModel } from './hierarchy-model.js';
import type { HierarchyHost } from './hierarchy-host.js';
import { HierarchyItemVM } from './hierarchy-item-vm.js';
import {
    HierarchyItemId, ChildAdded, ChildRemoved, ChildUpdated, type HierarchyChange,
} from './hierarchy-node.js';

// The tree root a TreeView's ItemsSource binds. Roots are the realized children of the
// seeded root node (the seeded node itself is the invisible anchor). Subscribes at
// construction — the root is always "expanded" — and patches Roots on the model's deltas.
export class HierarchyTreeVM extends Observable
{
    public readonly Roots = new ObservableCollection<HierarchyItemVM>();
    private readonly rootById = new Map<HierarchyItemId, HierarchyItemVM>();
    private off: (() => void) | undefined;

    // The global selection surface (design §11). Delta-safe: a renamed node keeps its VM
    // (stays selected via ChildUpdated); a ChildRemoved/dispose prunes it (Deselect). Anchor
    // is what a HierarchyActionContext reports.
    public readonly Selection = new ObservableCollection<HierarchyItemVM>();
    private _anchor: HierarchyItemVM | undefined;
    public get Anchor(): HierarchyItemVM | undefined { return this._anchor; }

    constructor(
        private readonly model: HierarchyModel,
        private readonly root: HierarchyItemId,
        private readonly host: HierarchyHost,
    )
    {
        super();
        this.off = this.model.ObserveChildren(this.root, (c) => this.patch(c));
        this.model.RealizeChildren(this.root);
    }

    public SelectSingle(vm: HierarchyItemVM): void
    {
        this.Selection.Clear();
        this.Selection.Add(vm);
        this._anchor = vm;
    }

    public Toggle(vm: HierarchyItemVM): void
    {
        if (this.Selection.IndexOf(vm) >= 0) { this.Selection.Remove(vm); if (this._anchor === vm) this._anchor = undefined; }
        else { this.Selection.Add(vm); this._anchor = vm; }
    }

    public Deselect(vm: HierarchyItemVM): void
    {
        this.Selection.Remove(vm);
        if (this._anchor === vm) this._anchor = undefined;
    }

    public ClearSelection(): void { this.Selection.Clear(); this._anchor = undefined; }

    // Replace the whole selection + anchor in one shot — how a view's multi-select
    // control (a Selector) pushes its SelectedItems/SelectedItem into the VM surface.
    public SyncSelection(items: readonly HierarchyItemVM[], anchor: HierarchyItemVM | undefined): void
    {
        this.Selection.Clear();
        for (const item of items) this.Selection.Add(item);
        this._anchor = anchor;
    }

    private patch(change: HierarchyChange): void
    {
        if (change instanceof ChildAdded)
        {
            const vm = new HierarchyItemVM(this.model, change.Id, undefined, this.host);
            this.rootById.set(change.Id, vm);
            const index = this.model.ChildrenOf(this.root).indexOf(change.Id);
            if (index >= 0 && index <= this.Roots.Count) this.Roots.Insert(index, vm);
            else this.Roots.Add(vm);
        }
        else if (change instanceof ChildUpdated)
        {
            this.rootById.get(change.Id)?.RefreshDisplay();
        }
        else if (change instanceof ChildRemoved)
        {
            const vm = this.rootById.get(change.Id);
            if (vm !== undefined)
            {
                this.rootById.delete(change.Id);
                this.Deselect(vm);
                this.Roots.Remove(vm);
                vm.dispose();
            }
        }
    }

    public dispose(): void
    {
        this.off?.();
        this.off = undefined;
        for (const vm of this.Roots.ToArray()) vm.dispose();
        this.Roots.Clear();
        this.rootById.clear();
    }
}
