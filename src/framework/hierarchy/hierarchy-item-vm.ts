import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { HierarchyModel } from './hierarchy-model.js';
import {
    HierarchyItemId, HierarchyPropertyId, NodeSeverity,
    ChildAdded, ChildRemoved, ChildUpdated, type HierarchyChange,
} from './hierarchy-node.js';

// One tree row over a HierarchyModel node. Lazy: children are not loaded until the first
// OnExpand (the TreeView's expand hook). An expandable-but-unloaded row carries a single
// "Loading…" sentinel child so the framework (whose chevron is children-count-based) shows
// an expand affordance; OnExpand drops the sentinel, subscribes, and realizes. Deltas patch
// Children in place — ChildUpdated keeps the row VM so selection/expansion survive a rename.
// Domain-agnostic — OnActivate relays this VM to an injected callback; the host decides what
// activation means. Extends Observable (INPC), not MuralBase.
export class HierarchyItemVM extends Observable
{
    private static readonly CaptionProp = 'Caption';
    private static readonly IconKeyProp = 'IconKey';
    private static readonly SeverityProp = 'Severity';
    private static readonly ErrorProp = 'Error';
    private static readonly IsExpandableProp = 'IsExpandable';
    private static readonly LoadingText = 'Loading…';

    public readonly Children = new ObservableCollection<HierarchyItemVM>();
    private readonly childById = new Map<HierarchyItemId, HierarchyItemVM>();
    private off: (() => void) | undefined;
    private expanded = false;
    private placeholder: HierarchyItemVM | undefined;

    constructor(
        private readonly model: HierarchyModel,
        public readonly Id: HierarchyItemId,
        public readonly Parent: HierarchyItemVM | undefined,
        private readonly onActivate: (vm: HierarchyItemVM) => void,
        // A placeholder (sentinel) row holds fixed text and never touches the model.
        private readonly placeholderText: string | undefined = undefined,
    )
    {
        super();
        if (this.placeholderText === undefined && this.IsExpandable) this.seedPlaceholder();
    }

    public get Caption(): string
    {
        if (this.placeholderText !== undefined) return this.placeholderText;
        return this.model.GetProperty(this.Id, HierarchyPropertyId.Caption) as string;
    }

    public get IconKey(): string
    {
        if (this.placeholderText !== undefined) return '';
        return (this.model.GetProperty(this.Id, HierarchyPropertyId.IconKey) as string) ?? '';
    }

    public get IsExpandable(): boolean
    {
        if (this.placeholderText !== undefined) return false;
        return this.model.GetProperty(this.Id, HierarchyPropertyId.IsExpandable) === true;
    }

    public get Severity(): NodeSeverity
    {
        if (this.placeholderText !== undefined) return NodeSeverity.Ok;
        return (this.model.GetProperty(this.Id, HierarchyPropertyId.Severity) as NodeSeverity) ?? NodeSeverity.Ok;
    }

    public get Error(): string | undefined
    {
        if (this.placeholderText !== undefined) return undefined;
        return this.model.NodeAt(this.Id).Error;
    }

    public get Data(): unknown
    {
        if (this.placeholderText !== undefined) return undefined;
        return this.model.GetProperty(this.Id, HierarchyPropertyId.ExtObject);
    }

    // TreeView calls this on the first expand (ExpandableTreeData.OnExpand). Idempotent:
    // drop the sentinel, subscribe BEFORE realizing so a keyed regime's synchronous
    // ChildAdded deltas land, then realize.
    public OnExpand(): void
    {
        if (this.placeholderText !== undefined || this.expanded) return;
        this.expanded = true;
        this.clearPlaceholder();
        this.off = this.model.ObserveChildren(this.Id, (c) => this.patch(c));
        this.model.RealizeChildren(this.Id);
    }

    // TreeView calls this on collapse. Release the loaded subtree: drop this row's
    // child-delta subscription, tell the model to collapse (which disposes a provider
    // boundary's subscription — the last observer of a mounted store, so its file
    // watcher is released), discard the child VMs, and restore the Loading… sentinel so
    // the row stays expandable and reloads fresh on the next expand.
    public OnCollapse(): void
    {
        if (this.placeholderText !== undefined || !this.expanded) return;
        this.expanded = false;
        this.off?.();
        this.off = undefined;
        this.model.Collapse(this.Id);
        for (const child of this.Children.ToArray()) child.dispose();
        this.Children.Clear();
        this.childById.clear();
        if (this.IsExpandable) this.seedPlaceholder();
    }

    // TreeView calls this on activation (double-click / Enter). Relay to the host.
    public OnActivate(): void
    {
        if (this.placeholderText !== undefined) return;
        this.onActivate(this);
    }

    // Re-notify bindings that this row's rendered facts may have changed (id preserved).
    // Public so a parent's ChildUpdated for THIS row (keyed or provider) repaints it.
    public RefreshDisplay(): void
    {
        this.RaisePropertyChanged(HierarchyItemVM.CaptionProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.IconKeyProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.SeverityProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.ErrorProp, undefined, undefined);
        this.reconcileExpandability();
    }

    // Expandability can flip after the row exists (e.g. a member resolves Unopened→Resolved),
    // arriving as a ChildUpdated → RefreshDisplay. Keep the Loading… sentinel — and thus the
    // framework's children-count-based chevron — in step, and re-raise IsExpandable so the
    // chevron binding re-reads. Leaves an already-expanded row alone (its real children govern)
    // and never runs on a placeholder row.
    private reconcileExpandability(): void
    {
        if (this.placeholderText === undefined && !this.expanded)
        {
            if (this.IsExpandable && this.placeholder === undefined) this.seedPlaceholder();
            else if (!this.IsExpandable && this.placeholder !== undefined) this.clearPlaceholder();
        }
        this.RaisePropertyChanged(HierarchyItemVM.IsExpandableProp, undefined, undefined);
    }

    private seedPlaceholder(): void
    {
        this.placeholder = new HierarchyItemVM(this.model, HierarchyItemId.Nil, this, this.onActivate, HierarchyItemVM.LoadingText);
        this.Children.Add(this.placeholder);
    }

    private clearPlaceholder(): void
    {
        if (this.placeholder !== undefined)
        {
            this.Children.Remove(this.placeholder);
            this.placeholder = undefined;
        }
    }

    private patch(change: HierarchyChange): void
    {
        if (change instanceof ChildAdded)
        {
            const vm = new HierarchyItemVM(this.model, change.Id, this, this.onActivate);
            this.childById.set(change.Id, vm);
            const index = this.model.ChildrenOf(this.Id).indexOf(change.Id);
            if (index >= 0 && index <= this.Children.Count) this.Children.Insert(index, vm);
            else this.Children.Add(vm);
        }
        else if (change instanceof ChildUpdated)
        {
            this.childById.get(change.Id)?.RefreshDisplay();
        }
        else if (change instanceof ChildRemoved)
        {
            const vm = this.childById.get(change.Id);
            if (vm !== undefined)
            {
                this.childById.delete(change.Id);
                this.Children.Remove(vm);
                vm.dispose();
            }
        }
    }

    public dispose(): void
    {
        this.off?.();
        this.off = undefined;
        for (const child of this.Children.ToArray()) child.dispose();
        this.Children.Clear();
        this.childById.clear();
        this.placeholder = undefined;
    }
}
