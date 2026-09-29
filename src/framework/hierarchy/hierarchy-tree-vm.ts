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
