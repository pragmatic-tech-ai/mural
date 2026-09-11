import {
    MetaData,
    MuralBase,
    ObservableCollection,
    Element, Visual,
    type CollectionChange,
    type Disposable,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { Border } from '../../basic/border.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { TextBlock } from '../../basic/text-block.js';
import { ScrollViewer } from '../surfaces/scroll-viewer.js';

// Material 3 Top App Bar size variants. Each ships its own
// ControlTemplate in framework.resources.mu; the default Style picks
// the template that matches the Variant DP via a property trigger.
//
// Small / CenterAligned are single-row (64dp tall) — they differ only
// in title alignment (leading vs. centered).
// Medium / Large are two-row layouts: row 1 holds nav + actions, row 2
// holds a larger title (HeadlineSmall on Medium, HeadlineMedium on
// Large). Mural's variants are STATIC heights — M3's scroll-collapse
// behaviour (where Large shrinks to Small as the page scrolls) isn't
// wired up yet because mural has no scroll-position infrastructure.
// Adding that later wouldn't change the variant set; it'd just animate
// the Variant DP from Large → Small in response to a scroll signal.
export enum TopAppBarVariant
{
    Small         = 'Small',
    CenterAligned = 'CenterAligned',
    Medium        = 'Medium',
    Large         = 'Large',
}

// M3 Top App Bar — the header strip at the top of a screen. Carries a
// leading navigation slot, a title, and a trailing action stack.
//
// Mural's TopAppBar extends TemplatedControl (not Control) because the
// chrome lives entirely inside a ControlTemplate; the class manages
// three named template parts (PART_NavSlot / PART_TitleText /
// PART_ActionsStack) and syncs the public DPs into them on change.
//
// Slot model:
//   * NavigationIcon — single Visual. The ctor sets it as the child of
//     PART_NavSlot; clearing the DP detaches the previous child.
//     Typically an IconButton (the "menu" or "back" affordance).
//   * Title          — string. Pumped into PART_TitleText.Text. The
//     title TextBlock's typography is wired in the template per-variant
//     (TitleLarge for Small / CenterAligned, HeadlineSmall for Medium,
//     HeadlineMedium for Large).
//   * Actions        — ObservableCollection<Visual>. The class observes
//     CollectionChanged and mirrors adds / removes into
//     PART_ActionsStack.Children. ALSO the default markup slot for the
//     control (kind: 'list' in DEFAULT_SLOT_INFO), so:
//
//         TopAppBar [Title="Mural"] { ThemeSelector }
//
//     is the same as topAppBar.Actions.Add(themeSelector).
//
// Variant DP picks the template; default is Small.
export class TopAppBar extends TemplatedControl
{
    public static readonly VariantKey = MuralBase.RegisterProperty<TopAppBarVariant>(
        TopAppBar, 'Variant', TopAppBarVariant.Small, MetaData.None,
    );
    public static readonly NavigationIconKey = MuralBase.RegisterProperty<Visual | undefined>(
        TopAppBar, 'NavigationIcon', undefined, MetaData.None,
    );
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        TopAppBar, 'Title', '', MetaData.None,
    );
    public static readonly ActionsKey = MuralBase.RegisterProperty<ObservableCollection<Visual>>(
        TopAppBar, 'Actions', undefined as unknown as ObservableCollection<Visual>,
        MetaData.None,
    );

    // Reference to the ScrollViewer whose scroll-state drives this bar's
    // scroll-tint behaviour. When the source's IsScrolled flips, this
    // bar's own IsScrolled DP mirrors the flip and the @Surface →
    // @SurfaceContainer template trigger fires.
    //
    // Undefined (the default) leaves the bar at @Surface always — the
    // appropriate behaviour for the demo platform's static header
    // before scroll integration ships per-screen.
    public static readonly ScrollSourceKey = MuralBase.RegisterProperty<ScrollViewer | undefined>(
        TopAppBar, 'ScrollSource', undefined, MetaData.None,
    );

    // Read-only mirror of `ScrollSource.IsScrolled` (or false when no
    // source is set). Template triggers reach this for the scroll-tint
    // Fill flip.
    private static readonly _IsScrolledPriv = MuralBase.RegisterReadOnlyProperty<boolean>(
        TopAppBar, 'IsScrolled', false, MetaData.None,
    );
    public static readonly IsScrolledKey = TopAppBar._IsScrolledPriv;

    // Read-only derived DP: the Variant value the Style's Template-
    // picker actually keys on. Equals `Variant` except when scroll-
    // collapse is engaged (IsScrolled + Variant in {Medium, Large}),
    // in which case it falls to `Small`. The class re-computes this
    // on every Variant / IsScrolled change.
    //
    // This indirection exists because the Style's TriggerValue tier
    // holds a single slot per DP, so a multi-condition Style trigger
    // overriding the Variant trigger wouldn't correctly resume the
    // Variant value on IsScrolled releasing (ClearTriggerValue empties
    // the slot). Driving EffectiveVariant as the trigger key sidesteps
    // that limitation entirely — there's only ever one active trigger
    // matching the current EffectiveVariant.
    private static readonly _EffectiveVariantPriv = MuralBase.RegisterReadOnlyProperty<TopAppBarVariant>(
        TopAppBar, 'EffectiveVariant', TopAppBarVariant.Small, MetaData.None,
    );
    public static readonly EffectiveVariantKey = TopAppBar._EffectiveVariantPriv;

    static
    {
        MuralBase.OverrideMetadata(
            TopAppBar, Element.DefaultStyleKeyKey,
            { default_value: TopAppBar },
        );
    }

    private _navSlot:      Border     | undefined;
    private _titleText:    TextBlock  | undefined;
    private _actionsStack: StackPanel | undefined;
    private _actionsSubscription:      (() => void) | undefined;
    private _scrollSourceSubscription: Disposable   | undefined;

    constructor()
    {
        super();
        // Auto-instantiate the Actions collection per-instance so the
        // markup body `TopAppBar { … }` always has a target to push into.
        this.set_property_value(TopAppBar.ActionsKey, new ObservableCollection<Visual>());

        // Seed EffectiveVariant BEFORE the Style applies so the
        // Variant-driven Template trigger picks the right template on
        // the first pass.
        this.updateEffectiveVariant();
        // applyDefaultStyle → Template DP → rebuildTemplate fires → the
        // template tree is materialised under us before we FindName the
        // parts and seed them with the current DP values.
        this.applyDefaultStyle();
        this.adoptTemplateParts();
        this.syncNavigationIcon();
        this.syncTitle();
        this.attachActionsSubscription();
        this.syncActions();
    }

    public get Variant():  TopAppBarVariant { return this.get_property_value(TopAppBar.VariantKey); }
    public set Variant(v: TopAppBarVariant) { this.set_property_value(TopAppBar.VariantKey, v); }

    public get NavigationIcon():  Visual | undefined { return this.get_property_value(TopAppBar.NavigationIconKey); }
    public set NavigationIcon(v: Visual | undefined) { this.set_property_value(TopAppBar.NavigationIconKey, v); }

    public get Title():  string { return this.get_property_value(TopAppBar.TitleKey); }
    public set Title(v: string) { this.set_property_value(TopAppBar.TitleKey, v); }

    public get Actions(): ObservableCollection<Visual>
    {
        return this.get_property_value(TopAppBar.ActionsKey);
    }

    public get ScrollSource():  ScrollViewer | undefined { return this.get_property_value(TopAppBar.ScrollSourceKey); }
    public set ScrollSource(v: ScrollViewer | undefined) { this.set_property_value(TopAppBar.ScrollSourceKey, v); }

    public get IsScrolled():       boolean          { return this.get_property_value(TopAppBar.IsScrolledKey); }
    public get EffectiveVariant(): TopAppBarVariant { return this.get_property_value(TopAppBar.EffectiveVariantKey); }

    // Markup default-slot routing — `TopAppBar { ThemeSelector }` lands
    // here via the compiler's `parent.AddChild(child)` emit for
    // `kind: 'list'` slots. Pushes the child into the Actions
    // collection; the CollectionChanged listener picks it up and mirrors
    // it into PART_ActionsStack.
    public AddChild(child: Visual): void
    {
        this.Actions.Add(child);
    }

    // ── Template-part management ───────────────────────────────────

    // Detach the slotted children from the OLD template's parts so
    // they can be re-AddChild'd onto the new template's parts without
    // tripping the single-parent guard. No-op when called from the
    // ctor (the parts fields are still undefined).
    private releaseFromOldParts(): void
    {
        if (this._navSlot !== undefined)
        {
            this._navSlot.SetChild(undefined);
        }
        if (this._actionsStack !== undefined)
        {
            for (const c of [...this._actionsStack.visualChildren])
            {
                this._actionsStack.RemoveChild(c);
            }
        }
    }

    private adoptTemplateParts(): void
    {
        const root = this.templateRoot;
        if (root === undefined)
        {
            throw new Error(
                'TopAppBar template did not materialise. Did the default Style ' +
                'in framework.resources.mu set `Template = @DefaultSmallTopAppBar` ' +
                '(or another @DefaultXxxTopAppBar)?');
        }
        this._navSlot      = root.FindName('PART_NavSlot')      as Border     | undefined;
        this._titleText    = root.FindName('PART_TitleText')    as TextBlock  | undefined;
        this._actionsStack = root.FindName('PART_ActionsStack') as StackPanel | undefined;
        // Strict: every variant template MUST carry these three parts.
        // A missing part is a template-authoring bug, not a runtime
        // condition the consumer can recover from, so fail loudly.
        if (this._navSlot      === undefined) throw new Error('TopAppBar template missing PART_NavSlot');
        if (this._titleText    === undefined) throw new Error('TopAppBar template missing PART_TitleText');
        if (this._actionsStack === undefined) throw new Error('TopAppBar template missing PART_ActionsStack');
    }

    private syncNavigationIcon(): void
    {
        const slot = this._navSlot;
        if (slot === undefined) return;
        // Border holds one Child — Visual or undefined.
        slot.SetChild(this.NavigationIcon);
    }

    private syncTitle(): void
    {
        const t = this._titleText;
        if (t === undefined) return;
        t.Text = this.Title ?? '';
    }

    private attachActionsSubscription(): void
    {
        // Remove the prior listener (if any — defensive in case the
        // Actions DP is ever replaced wholesale; today we don't support
        // that but the bookkeeping is cheap).
        this._actionsSubscription?.();
        const col = this.Actions;
        const unsubscribe = col.Subscribe((ev: CollectionChange<Visual>) =>
        {
            this.handleActionsChange(ev);
        });
        this._actionsSubscription = unsubscribe;
    }

    private syncActions(): void
    {
        const stack = this._actionsStack;
        if (stack === undefined) return;
        // Reset path — used during ctor initial sync. Clear any prior
        // children (the template authors PART_ActionsStack empty, but
        // a future re-template would land here too).
        for (const c of [...stack.visualChildren])
        {
            stack.RemoveChild(c);
        }
        for (const v of this.Actions) stack.AddChild(v);
    }

    // ── Scroll-tint plumbing ───────────────────────────────────────

    // Subscribe to the new ScrollSource's IsScrolled DP. Pulls the
    // current value through immediately so the bar reflects the
    // source's resting state without waiting for the first change.
    private rebindScrollSource(_prev: ScrollViewer | undefined, next: ScrollViewer | undefined): void
    {
        this._scrollSourceSubscription?.dispose();
        this._scrollSourceSubscription = undefined;

        if (next === undefined)
        {
            this.writeIsScrolled(false);
            return;
        }

        // Initial pull from the source's current state.
        this.writeIsScrolled(next.IsScrolled);

        this._scrollSourceSubscription = next.PropertyChanged(ScrollViewer.IsScrolledKey).subscribe(
            ({ newValue }): void => { this.writeIsScrolled(newValue as boolean); },
        );
    }

    private writeIsScrolled(v: boolean): void
    {
        if (this.IsScrolled === v) return;
        this.set_property_value_with_key(TopAppBar._IsScrolledPriv, v);
        // Read-only DP writes go through SetReadOnlyValue, which dispatches
        // the property-change pipeline, so OnPropertyChanged below picks
        // up the IsScrolled flip and calls updateEffectiveVariant. The
        // explicit call here is belt-and-braces against any future write
        // path that skips dispatch.
        this.updateEffectiveVariant();
    }

    // Two-row variants (Medium, Large) collapse to the Small chrome
    // when the bound ScrollSource reports IsScrolled. Implemented by
    // recomputing the derived EffectiveVariant DP — the Style's
    // Template-picker triggers key on EffectiveVariant, so the Template
    // swap rides through the regular trigger pipeline.
    //
    // EffectiveVariant defaults to the consumer's Variant; collapse-
    // engagement maps Medium / Large to Small while the source is
    // scrolled. CenterAligned never collapses per M3 spec — only the
    // two-row variants do.
    private updateEffectiveVariant(): void
    {
        const variant = this.Variant;
        const collapses = (variant === TopAppBarVariant.Medium || variant === TopAppBarVariant.Large);
        const effective = this.IsScrolled && collapses
            ? TopAppBarVariant.Small
            : variant;
        if (effective === this.EffectiveVariant) return;
        this.set_property_value_with_key(TopAppBar._EffectiveVariantPriv, effective);
    }

    private handleActionsChange(ev: CollectionChange<Visual>): void
    {
        const stack = this._actionsStack;
        if (stack === undefined) return;
        switch (ev.kind)
        {
            case 'inserted':
                for (const v of ev.items) stack.AddChild(v);
                return;
            case 'removed':
                for (const v of ev.items) stack.RemoveChild(v);
                return;
            case 'replaced':
                // Position-preserving swap. Remove the old at index,
                // insert the new at the same index.
                stack.RemoveChild(ev.oldItem);
                stack.AddChild(ev.newItem);
                return;
            case 'moved':
                // StackPanel children rebuild via Remove + Add at end is
                // O(N) but cheap for the 1-3 action icons a TopAppBar
                // realistically holds.
                stack.RemoveChild(ev.item);
                stack.AddChild(ev.item);
                return;
            case 'cleared':
                this.syncActions();
                return;
        }
    }

    // ── Template re-apply hook ─────────────────────────────────────
    // When Variant changes, the Style trigger swaps Template to a
    // different @DefaultXxxTopAppBar, TemplatedControl.rebuildTemplate
    // tears down the old root and stamps the new one. We need to
    // re-locate the named parts and re-seed them from the current DPs
    // — the same flow the ctor does after applyDefaultStyle.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'Template' && newValue !== oldValue)
        {
            // TemplatedControl's OnPropertyChanged already ran
            // rebuildTemplate — old template root is detached, new root
            // is attached. But the OLD PART_NavSlot still owns the
            // current NavigationIcon as its child, and the OLD
            // PART_ActionsStack still owns each action visual. Detach
            // them from the old parts BEFORE we re-point _navSlot /
            // _actionsStack to the new template's parts; otherwise
            // re-AddChild into the new stack hits the "Visual already
            // has a visual parent" guard.
            this.releaseFromOldParts();
            this.adoptTemplateParts();
            this.syncNavigationIcon();
            this.syncTitle();
            this.syncActions();
            return;
        }
        if (name === 'NavigationIcon')
        {
            this.syncNavigationIcon();
            return;
        }
        if (name === 'Title')
        {
            this.syncTitle();
            return;
        }
        if (name === 'ScrollSource')
        {
            this.rebindScrollSource(
                oldValue as ScrollViewer | undefined,
                newValue as ScrollViewer | undefined,
            );
            return;
        }
        if (name === 'Variant' || name === 'IsScrolled')
        {
            this.updateEffectiveVariant();
            return;
        }
    }
}
