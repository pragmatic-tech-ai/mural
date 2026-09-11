import {
    Element,
    MetaData,
    MuralBase,
    ObservableCollection,
    type CollectionChange,
    type PropertyDescriptor,
    type Disposable,
} from '../../runtime/index.js';
import { Canvas } from '../../basic/index.js';
import { ContentControl } from '../base/content-control.js';
import { Figure } from './figure.js';

// A group's members are geometry-bearing nodes: leaf Figures (shape / text /
// callout — all self-painting Figures) and nested Groups. Content view-models
// are NOT members: their geometry lives on their container Figure (not the VM),
// which a data-model Group can't reach — so grouping content nodes is a deferred
// capability (would track VM ids and derive bounds from containers).
type GroupMember = Figure | Group;

// First-class group entity for the framework Diagram. A Group sits in
// the Diagram's flat Items collection alongside leaf Figures and renders
// a bbox-shaped chrome (typically a dashed border when selected) over
// the union of its members. Members live in `this.Members` —
// ObservableCollection<Figure | Group> — so nested groups recurse via
// the same shape.
//
// Geometry contract (mirrors Figure's):
//   * Left / Top  — computed from the union bbox of members. Setting
//                   them shifts every member by the delta (rigid
//                   translate), matching Visio / PowerPoint group-move
//                   semantics. Members' own Left/Top change listeners
//                   then re-fire _recomputeBounds, which writes Left/Top
//                   back to the same coordinates we just chose — the
//                   value converges in one trip.
//   * Width / Height — read-only, derived from the bbox extent. Setting
//                   these is unsupported in v1 (would require scaling
//                   every member, out of scope).
//
// IsSelected mirrors Figure's — the framework's SelectionReflector marks
// the outermost ancestor when any descendant is clicked, so a selected
// group's bbox chrome paints while its members stay IsSelected=false.
//
// `Parent` is a back-reference — undefined for a top-level group, set
// to the enclosing group when this Group is itself nested. View-invisible
// structural metadata, so a plain field (per CLAUDE.md MVVM rules).
export class Group extends ContentControl
{
    static {
        MuralBase.OverrideMetadata(Group, Element.DefaultStyleKeyKey, { default_value: Group });
    }

    public static readonly LeftKey   = MuralBase.RegisterProperty<number>(
        Group, 'Left',   0, MetaData.Arrange);
    public static readonly TopKey    = MuralBase.RegisterProperty<number>(
        Group, 'Top',    0, MetaData.Arrange);
    public static override readonly WidthKey  = MuralBase.RegisterReadOnlyProperty<number>(
        Group, 'Width',  0, MetaData.Measure);
    public static override readonly HeightKey = MuralBase.RegisterReadOnlyProperty<number>(
        Group, 'Height', 0, MetaData.Measure);
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(
        Group, 'IsSelected', false, MetaData.None);

    public readonly Members: ObservableCollection<GroupMember> = new ObservableCollection();

    // Group back-reference. undefined ≡ top-level. View-invisible
    // structural metadata, so plain field.
    public Parent: Group | undefined = undefined;

    // Per-member detach thunks, keyed by member identity.
    private readonly _memberListeners: Map<GroupMember, () => void> = new Map();

    // Reentrancy gate — true during a Left/Top write shift so per-member
    // PropertyChanged callbacks skip the bbox recompute cascade. One
    // final recompute fires after every member has moved.
    private _shiftSuppressed: boolean = false;

    constructor(initialMembers?: readonly GroupMember[])
    {
        super();
        // Default Template flows from the bundled diagram theme entry
        // under TargetType=Group (see diagram.template.mu): a Border
        // sized to this Group's Width / Height, transparent at rest and
        // outlined when IsSelected fires.
        this.applyDefaultStyle();
        // The Group is purely a bbox-chrome host — clicks should reach
        // the member Figures painted on top (or fall through to the
        // Diagram canvas when the user presses in empty bbox space).
        // The Group's own outer carries a mural-hit pad with pointer-
        // events:all by default; combined with the Visio convention of
        // a transparent bbox interior, that pad would otherwise swallow
        // every press inside the union and prevent group-drag via a
        // member press. The Border template child sets IsHitTestVisible
        // =false for the same reason; doing it here on the Group itself
        // covers the outer `<g>`'s mural-hit pad.
        this.IsHitTestVisible = false;

        this.Members.Subscribe(change => this._handleMembersChange(change));
        if (initialMembers !== undefined)
        {
            for (const m of initialMembers)
            {
                // Detach from current parent first to avoid double-membership.
                if (m.Parent !== undefined) m.Parent.Members.Remove(m);
                m.Parent = this;
                this.Members.Add(m);
            }
        }
    }

    // Mirror Left / Top onto Canvas.Left / Canvas.Top so the enclosing
    // Canvas ItemsPanel re-positions the Group chrome on its next Arrange
    // pass. Same pattern Figure uses (see figure.ts) — without it the
    // bbox border renders at panel-local (0, 0) regardless of where the
    // members actually live.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor === Group.LeftKey.descriptor && typeof newValue === 'number')
        {
            Canvas.SetLeft(this, newValue);
        }
        else if (descriptor === Group.TopKey.descriptor && typeof newValue === 'number')
        {
            Canvas.SetTop(this, newValue);
        }
    }

    public get Left():            number  { return this.get_property_value(Group.LeftKey); }
    public get Top():             number  { return this.get_property_value(Group.TopKey); }
    public override get Width():  number  { return this.get_property_value(Group.WidthKey); }
    public override get Height(): number  { return this.get_property_value(Group.HeightKey); }
    public get IsSelected():      boolean { return this.get_property_value(Group.IsSelectedKey); }
    public set IsSelected(v: boolean)     { this.set_property_value(Group.IsSelectedKey, v); }

    // Writing Left / Top shifts every member by the delta. Members'
    // own Left/Top change listeners would normally re-fire _recomputeBounds
    // per member — _shiftSuppressed gates that cascade so we only
    // recompute once at the end.
    public set Left(v: number)
    {
        const cur = this.get_property_value(Group.LeftKey);
        const dx  = v - cur;
        if (dx === 0) return;
        this._shiftBy(dx, 0);
    }

    public set Top(v: number)
    {
        const cur = this.get_property_value(Group.TopKey);
        const dy  = v - cur;
        if (dy === 0) return;
        this._shiftBy(0, dy);
    }

    /** Shift every member by (dx, dy) in lock-step, suppressing the
     *  per-member bbox recompute cascade. One final recompute fires
     *  at the end. */
    public Translate(dx: number, dy: number): void
    {
        if (dx === 0 && dy === 0) return;
        this._shiftBy(dx, dy);
    }

    /** Recursively enumerate every leaf Figure contained (transitively). */
    public *EnumerateLeaves(): Iterable<Figure>
    {
        for (let i = 0; i < this.Members.Count; i++)
        {
            const m = this.Members.Get(i)!;
            if (m instanceof Group) yield* m.EnumerateLeaves();
            else                    yield m;
        }
    }

    /** Recursively enumerate every descendant Group (excluding self). */
    public *EnumerateSubGroups(): Iterable<Group>
    {
        for (let i = 0; i < this.Members.Count; i++)
        {
            const m = this.Members.Get(i)!;
            if (m instanceof Group)
            {
                yield m;
                yield* m.EnumerateSubGroups();
            }
        }
    }

    // Translate every member by (dx, dy). Members' Left/Top setters
    // propagate naturally — leaf Figures write their DPs; nested Groups
    // recurse through this same setter, gating their own shifts to one
    // recompute. The outermost group's _recomputeBounds fires once at
    // the end with the post-shift bbox.
    private _shiftBy(dx: number, dy: number): void
    {
        this._shiftSuppressed = true;
        try
        {
            for (let i = 0; i < this.Members.Count; i++)
            {
                const m = this.Members.Get(i)!;
                if (dx !== 0) m.Left = m.Left + dx;
                if (dy !== 0) m.Top  = m.Top  + dy;
            }
        }
        finally
        {
            this._shiftSuppressed = false;
        }
        this._recomputeBounds();
    }

    private _handleMembersChange(change: CollectionChange<GroupMember>): void
    {
        switch (change.kind)
        {
            case 'inserted':
                for (const m of change.items)
                {
                    if (!this._memberListeners.has(m))
                    {
                        this._memberListeners.set(m, this._listenMember(m));
                    }
                }
                break;
            case 'removed':
                for (const m of change.items)
                {
                    this._memberListeners.get(m)?.();
                    this._memberListeners.delete(m);
                }
                break;
            case 'replaced':
                this._memberListeners.get(change.oldItem)?.();
                this._memberListeners.delete(change.oldItem);
                if (!this._memberListeners.has(change.newItem))
                {
                    this._memberListeners.set(change.newItem, this._listenMember(change.newItem));
                }
                break;
            case 'cleared':
                for (const detach of this._memberListeners.values()) detach();
                this._memberListeners.clear();
                break;
        }
        if (change.kind !== 'moved') this._recomputeBounds();
    }

    private _listenMember(m: GroupMember): () => void
    {
        // The four geometry DPs share the same name across Figure and Group, but
        // the key objects differ. Pick the right keys based on the member's class.
        const keys =
            m instanceof Group
                ? { l: Group.LeftKey, t: Group.TopKey, w: Group.WidthKey, h: Group.HeightKey }
                : { l: Figure.LeftKey, t: Figure.TopKey, w: Figure.WidthKey, h: Figure.HeightKey };
        const handler = (): void => { if (this._shiftSuppressed) return; this._recomputeBounds(); };
        const subL: Disposable = m.PropertyChanged(keys.l).subscribe(handler);
        const subT: Disposable = m.PropertyChanged(keys.t).subscribe(handler);
        const subW: Disposable = m.PropertyChanged(keys.w).subscribe(handler);
        const subH: Disposable = m.PropertyChanged(keys.h).subscribe(handler);
        return (): void => {
            subL.dispose();
            subT.dispose();
            subW.dispose();
            subH.dispose();
        };
    }

    // Internal — used by sibling Groups during a re-parenting flow
    // (Ungroup / Group restructure) to relocate a member without firing
    // extra events. Members.Remove fires Subscribe's removed-change,
    // which detaches listeners via the normal path.
    /** @internal */
    public _removeMember(m: GroupMember): void
    {
        const idx = this.Members.IndexOf(m);
        if (idx >= 0) this.Members.RemoveAt(idx);
    }

    private _recomputeBounds(): void
    {
        if (this.Members.Count === 0)
        {
            this.set_property_value(Group.LeftKey,   0);
            this.set_property_value(Group.TopKey,    0);
            this.set_property_value_with_key(Group.WidthKey,  0);
            this.set_property_value_with_key(Group.HeightKey, 0);
            return;
        }
        let minLeft = Number.POSITIVE_INFINITY;
        let minTop  = Number.POSITIVE_INFINITY;
        let maxRight  = Number.NEGATIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < this.Members.Count; i++)
        {
            const m = this.Members.Get(i)!;
            const left = m.Left, top = m.Top, w = m.Width, h = m.Height;
            if (left < minLeft) minLeft = left;
            if (top  < minTop)  minTop  = top;
            if (left + w > maxRight)  maxRight  = left + w;
            if (top  + h > maxBottom) maxBottom = top  + h;
        }
        this.set_property_value(Group.LeftKey,   minLeft);
        this.set_property_value(Group.TopKey,    minTop);
        this.set_property_value_with_key(Group.WidthKey,  maxRight  - minLeft);
        this.set_property_value_with_key(Group.HeightKey, maxBottom - minTop);
    }
}
