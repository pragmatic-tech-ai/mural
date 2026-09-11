import {
    DataContextBinding,
    Element,
    EventTrigger,
    NameScope,
    ResourceDictionary,
    Setter,
    triggerConditionMet,
    type TriggerAction,
    type Visual,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';
import { registerNamedVisuals } from './control-template.js';

// Factory signature for a DataTemplate. Constructs a fresh visual
// subtree for one item of data — typically run once per item by
// ItemsControl's container generator.
//
// The data is opaque to the framework — it can be a MuralBase (so the
// factory can wire Bindings against it), a plain object, a primitive,
// or anything else. The factory is responsible for knowing what shape
// the data is in.
export type DataTemplateFactory = (data: unknown) => Visual;

// A DataTemplate describes how to render a single data item as a
// Visual. Distinct from ControlTemplate (which builds a control's
// visual structure from its properties) — DataTemplate is data-driven,
// applied once per item.
//
// WPF parity is intentionally partial:
//   * No DataType field — selecting a template by data type (the
//     `{x:Type customer}` form) requires a registry; can be layered
//     on later as DataTemplateSelector if needed.
//   * No template caching across instances — each Apply call runs
//     the factory and produces a fresh Visual subtree.
//   * No DataTrigger.
//
// Used by ItemsControl.ItemTemplate to render each item in its Items
// collection.
//
// `DataType` (optional) names the data type this template renders. When
// set, ContentPresenter / PageView / ItemsControl look up an applicable
// template for non-Visual Content by walking ancestor resources and
// matching this field against the content's runtime constructor.
// Function-identity match — matches WPF's `{x:Type}` shape; the .mu
// compiler emits the real class reference (backed by an `import` clause
// at the top of the source) so the lookup is robust against renames and
// minification.
//
// `Triggers` / `DataTriggers` / `EventTriggers`: wired during Apply
// against the freshly-produced visual subtree. Each trigger's setters
// carry an optional `targetName` — resolved at Apply time against the
// template root's NameScope to pick which descendant Visual receives
// the setter. When `targetName` is undefined, the setter targets the
// template root itself. Counterpart to WPF's `DataTemplate.Triggers`
// with `<Setter TargetName="…" />`.
export class DataTemplate
{
    public DataType: Function | undefined;
    public readonly Triggers:          readonly TemplatePropertyTrigger[];
    public readonly DataTriggers:      readonly TemplateDataTrigger[];
    public readonly MultiDataTriggers: readonly TemplateMultiDataTrigger[];
    /** `on <Event> { … }` triggers in the template body. Routed events
     *  fire on a per-instance basis once per Apply — every call gets
     *  its own AddEventTrigger registration on the freshly-built root,
     *  matching WPF's `<DataTemplate.Triggers><EventTrigger…>` shape. */
    public readonly EventTriggers:     readonly EventTrigger[];

    constructor(
        public readonly factory: DataTemplateFactory,
        dataType?: Function,
        triggers:          readonly TemplatePropertyTrigger[]  = [],
        dataTriggers:      readonly TemplateDataTrigger[]      = [],
        eventTriggers:     readonly EventTrigger[]             = [],
        multiDataTriggers: readonly TemplateMultiDataTrigger[] = [],
    )
    {
        this.DataType          = dataType;
        this.Triggers          = triggers;
        this.DataTriggers      = dataTriggers;
        this.EventTriggers     = eventTriggers;
        this.MultiDataTriggers = multiDataTriggers;
    }

    public Apply(data: unknown): Visual
    {
        const root = this.factory(data);
        // Each Apply call materialises a fresh subtree, so each call
        // gets its own NameScope on the root. The walk-and-register
        // mirrors ControlTemplate.Apply — the factory itself no longer
        // emits Register() calls for `x:name`, so this is the only
        // place template-local names become resolvable via FindName.
        const nameScope = new NameScope();
        root.SetNameScope(nameScope);
        registerNamedVisuals(root, nameScope);
        for (const t of this.Triggers)          t.AttachTo(root);
        for (const t of this.DataTriggers)      t.AttachTo(root);
        for (const t of this.MultiDataTriggers) t.AttachTo(root);
        // Routed-event triggers attach to the template root —
        // AddEventTrigger walks the per-event subscription pathway
        // (e.g. `Click` → Button.AddClickHandler). The hook is FE-tier
        // (§ Phase B / B3); non-Element roots silently skip event-
        // trigger wiring. Unrecognised routed events warn instead of
        // throwing, so a misnamed event in a template doesn't blow up
        // the whole subtree's render.
        if (root instanceof Element)
        {
            for (const t of this.EventTriggers) root.AddEventTrigger(t);
        }
        return root;
    }

    // Walk `klass`'s prototype chain most-specific-first (stopping at Object),
    // returning the first non-undefined `lookup(cursor)`. The single home of the
    // type-match policy — shared by implicit DataType resolution
    // (matchDataTemplateInDict) and TypeTemplateSelector, so both behave
    // identically (`[DataType=Derived]` wins over `[DataType=Base]`).
    public static walkTypeChain<T>(klass: Function, lookup: (t: Function) => T | undefined): T | undefined
    {
        let cursor: Function = klass;
        while (typeof cursor === 'function' && cursor !== Object)
        {
            const hit = lookup(cursor);
            if (hit !== undefined) return hit;
            cursor = Object.getPrototypeOf(cursor);
        }
        return undefined;
    }

    // Public, base-walking, scope-aware type resolution: the DataTemplate for
    // `klass` reachable from `start`, walking the resource chain (nearest-wins)
    // and, within each scope, `klass`'s prototype chain (most-derived-first).
    // The programmatic counterpart to what ContentPresenter / ItemsControl do
    // for non-Visual content — exact-key `TryFindResource(klass)` does NOT walk
    // base types; this does.
    public static resolveForType(klass: Function, start: Element): DataTemplate | undefined
    {
        return findDataTemplateForType(klass, start);
    }
}

// Setter variant for use inside DataTemplate triggers. `targetName`
// references an x:name on a descendant of the template's root; when
// undefined the template root itself receives the setter. The base
// `Setter` carries (owner, property, value), so the apply machinery
// at the resolved target visual sees a plain Setter and doesn't need
// to know about the targeting wrap.
export class TargetedSetter extends Setter
{
    constructor(
        owner: Function,
        property: string,
        value: unknown,
        public readonly targetName: string | undefined = undefined,
    )
    {
        super(owner, property, value);
    }
}

// Resolves each TargetedSetter's `targetName` to an Element under `root`.
// Setters whose target can't be resolved — or whose target isn't an
// Element (so it can't carry trigger-tier setters) — are silently
// dropped, mirroring WPF's "Setter is ignored" semantics for a missing
// TargetName. `ApplyTriggerSetter` / `ClearTriggerSetter` are FE-tier
// hooks on `Element` (§ Phase B), so a non-Element target couldn't be
// driven anyway.
function resolveTargets(
    root: Visual, setters: readonly TargetedSetter[],
): Array<{ target: Element; setter: TargetedSetter }>
{
    const out: Array<{ target: Element; setter: TargetedSetter }> = [];
    for (const s of setters)
    {
        const target = s.targetName === undefined ? root : root.FindName(s.targetName);
        if (target instanceof Element) out.push({ target, setter: s });
    }
    return out;
}

// Property-trigger flavour of a DataTemplate trigger. The watched
// property lives on a specific source Visual — by default the template
// root, but `sourceName` can target a named descendant. Setters fire on
// each resolved target visual at the Trigger priority tier and unwind
// on the deactivation edge.
//
// Mirrors WPF's Trigger inside <DataTemplate.Triggers> with optional
// SourceName + per-Setter TargetName. The condition itself doesn't
// chain into the styled-target trigger machinery — it owns its own
// per-template subscription via add/remove property-change listener
// on the resolved source visual.
export class TemplatePropertyTrigger
{
    constructor(
        public readonly propertyOwner: Function,
        public readonly propertyName:  string,
        public readonly value:         unknown,
        public readonly setters:       readonly TargetedSetter[],
        public readonly sourceName:    string | undefined = undefined,
        // Same edge semantics as Style triggers — fired only on
        // genuine transitions (not on initial-state match), not on
        // template teardown. Behaviors block lowering routes through
        // AttachBehaviorAction / DetachBehaviorAction pairs.
        public readonly enterActions: readonly TriggerAction[] = [],
        public readonly exitActions:  readonly TriggerAction[] = [],
    ) {}

    // `templatedParent` is the default source when the trigger is
    // attached from a ControlTemplate (WPF: `Trigger.Property` on the
    // template targets the templated control's properties). DataTemplate
    // callers don't supply it; the default source is the template root.
    public AttachTo(root: Visual, templatedParent?: Visual): void
    {
        const defaultSource = templatedParent ?? root;
        const source = this.sourceName === undefined
            ? defaultSource
            : root.FindName(this.sourceName);
        if (source === undefined) return;
        const resolved = resolveTargets(root, this.setters);
        let active = false;
        let initial = true;
        const enterActions = this.enterActions;
        const exitActions  = this.exitActions;
        const actionTarget = templatedParent ?? root;
        const key = resolveKey(source, this.propertyOwner, this.propertyName);
        const evaluate = (): void => {
            const current = source.get_property_value(key);
            const matched = triggerConditionMet(current, this.value);
            if (matched && !active)
            {
                for (const r of resolved) r.target.ApplyTriggerSetter(r.setter);
                active = true;
                if (!initial)
                {
                    for (const a of enterActions) a.Invoke(actionTarget);
                }
            }
            else if (!matched && active)
            {
                for (const r of resolved) r.target.ClearTriggerSetter(r.setter);
                active = false;
                if (!initial)
                {
                    for (const a of exitActions) a.Invoke(actionTarget);
                }
            }
            initial = false;
        };
        source.PropertyChanged(key).subscribe(evaluate);
        evaluate();
    }
}

// Data-trigger flavour. The condition is a DataContextBinding installed
// against the template root (or a named source), so the trigger fires
// based on the data behind the template — typically the per-item view-
// model — rather than a DP on a Visual. Setters apply to resolved
// targets just like TemplatePropertyTrigger.
export class TemplateDataTrigger
{
    constructor(
        public readonly path:    string,
        public readonly value:   unknown,
        public readonly setters: readonly TargetedSetter[],
        public readonly sourceName: string | undefined = undefined,
        // Same edge semantics as TemplatePropertyTrigger.enterActions
        // — activation transitions only, no initial-state replay.
        public readonly enterActions: readonly TriggerAction[] = [],
        public readonly exitActions:  readonly TriggerAction[] = [],
    ) {}

    public AttachTo(root: Visual): void
    {
        const source = this.sourceName === undefined ? root : root.FindName(this.sourceName);
        if (source === undefined) return;
        const resolved = resolveTargets(root, this.setters);
        const binding = DataContextBinding(source, this.path);
        let active = false;
        let initial = true;
        const enterActions = this.enterActions;
        const exitActions  = this.exitActions;
        const evaluate = (): void => {
            const current = binding.get_value();
            const matched = triggerConditionMet(current, this.value);
            if (matched && !active)
            {
                for (const r of resolved) r.target.ApplyTriggerSetter(r.setter);
                active = true;
                if (!initial)
                {
                    for (const a of enterActions) a.Invoke(root);
                }
            }
            else if (!matched && active)
            {
                for (const r of resolved) r.target.ClearTriggerSetter(r.setter);
                active = false;
                if (!initial)
                {
                    for (const a of exitActions) a.Invoke(root);
                }
            }
            initial = false;
        };
        binding.setOnValueChanged(evaluate);
        evaluate();
    }
}

// One conjunct condition inside a TemplateMultiDataTrigger — a
// DataContext path + expected value pair. Mirrors the runtime-side
// DataTriggerCondition shape, but the binding is sourced from the
// template root (or the named sourceName).
export interface TemplateDataTriggerCondition
{
    path:  string;
    value: unknown;
}

// Multi-binding AND-trigger for DataTemplate / ControlTemplate
// bodies. Watches each condition's DataContext path on the template
// root (or `sourceName`); setters apply at the Trigger priority tier
// only when every binding's resolved value === its expected, and
// unwind when any condition flips. Counterpart to MultiDataTrigger at
// the Style level.
//
// Authored by `when ( $A and $B ) { … }` inside DataTemplate or
// ControlTemplate bodies. Setters use the same TargetedSetter shape
// (named-element form via `Name.Property = …`); the resolved targets
// receive ApplyTriggerSetter / ClearTriggerSetter on the activation /
// deactivation edges. enterActions / exitActions follow the same
// no-initial-replay edge semantics as TemplatePropertyTrigger.
export class TemplateMultiDataTrigger
{
    constructor(
        public readonly conditions: readonly TemplateDataTriggerCondition[],
        public readonly setters:    readonly TargetedSetter[],
        public readonly sourceName: string | undefined = undefined,
        public readonly enterActions: readonly TriggerAction[] = [],
        public readonly exitActions:  readonly TriggerAction[] = [],
    ) {}

    public AttachTo(root: Visual): void
    {
        const source = this.sourceName === undefined ? root : root.FindName(this.sourceName);
        if (source === undefined) return;
        const resolved = resolveTargets(root, this.setters);
        const bindings = this.conditions.map(c => DataContextBinding(source, c.path));
        let active = false;
        let initial = true;
        const enterActions = this.enterActions;
        const exitActions  = this.exitActions;
        const evaluate = (): void => {
            const allMatch = this.conditions.every((c, i) => triggerConditionMet(bindings[i]!.get_value(), c.value));
            if (allMatch && !active)
            {
                for (const r of resolved) r.target.ApplyTriggerSetter(r.setter);
                active = true;
                if (!initial)
                {
                    for (const a of enterActions) a.Invoke(root);
                }
            }
            else if (!allMatch && active)
            {
                for (const r of resolved) r.target.ClearTriggerSetter(r.setter);
                active = false;
                if (!initial)
                {
                    for (const a of exitActions) a.Invoke(root);
                }
            }
            initial = false;
        };
        for (const b of bindings) b.setOnValueChanged(evaluate);
        evaluate();
    }
}

// Selector that extracts the child-items iterable from a parent data
// item, used by HierarchicalDataTemplate. Returning undefined means
// "leaf" — the item has no children. Returning an iterable (array,
// ObservableCollection, etc.) means the consumer (a TreeView-style
// ItemsControl) should recursively realize containers for each child.
export type HierarchicalChildSelector = (data: unknown) => Iterable<unknown> | undefined;

// DataTemplate variant that announces a child-items relationship in
// addition to building the parent container. Used by hierarchical
// ItemsControls (TreeView and friends) to discover sub-items without
// the data model needing a fixed interface.
//
// Three fields beyond DataTemplate's factory:
//   * `itemsSelector` — pulls children off the parent data
//   * `itemTemplate`  — DataTemplate for the children; when undefined,
//     consumers typically fall back to the same HierarchicalDataTemplate
//     (recursive realization with one template throughout the tree).
//   * `itemContainerStyle` — optional Style applied to each child
//     container (TreeView passes this down to nested ItemsControls).
//
// The template itself doesn't realize children — that's the consumer's
// responsibility. HierarchicalDataTemplate just carries the policy.
export class HierarchicalDataTemplate extends DataTemplate
{
    constructor(
        factory: DataTemplateFactory,
        public readonly itemsSelector: HierarchicalChildSelector,
        public readonly itemTemplate: DataTemplate | undefined = undefined,
        public readonly itemContainerStyle: unknown | undefined = undefined,
        dataType?: Function,
        // Body `when()` triggers — forwarded to the DataTemplate base so
        // Apply() wires them against the freshly-built row subtree, exactly
        // like a plain DataTemplate. (Historically dropped: the compiler's
        // hierarchical form passed no triggers and this ctor didn't accept
        // any, so a `when()` on a TreeView row template silently no-op'd.)
        triggers:          readonly TemplatePropertyTrigger[]  = [],
        dataTriggers:      readonly TemplateDataTrigger[]      = [],
        eventTriggers:     readonly EventTrigger[]             = [],
        multiDataTriggers: readonly TemplateMultiDataTrigger[] = [],
    )
    {
        super(factory, dataType, triggers, dataTriggers, eventTriggers, multiDataTriggers);
    }

    // Walk the child-items pulled from `data` via itemsSelector.
    // Returns an empty iterable when the selector returns undefined,
    // so callers can iterate uniformly without an extra branch.
    public *ItemsOf(data: unknown): Iterable<unknown>
    {
        const it = this.itemsSelector(data);
        if (it === undefined) return;
        yield* it;
    }
}

// Find the implicit DataTemplate for the data class `klass`, resolved from the
// perspective of `start` (the presenting Element). Walks `start`'s resource-
// scope chain — local ancestor dictionaries first, then Application.Resources —
// exactly like every other resource, so a DataTemplate placed in ANY dictionary
// in scope applies, not only the app-global one. Closer scopes shadow farther
// ones (nearest-wins). Used by ContentControl / ContentPresenter / PageView /
// ListBox / navigation rails to auto-resolve a template for non-Visual Content
// from the data's runtime class.
//
// Within each scope the match policy mirrors WPF: walk the data class's
// prototype chain from most specific to most general, returning the first hit.
// A `[DataType=RelayCommand]` template wins over `[DataType=CommandBase]` for a
// RelayCommand instance; a CommandBase template still catches arbitrary
// CommandBase subclasses that don't have their own entry. Stops once the chain
// reaches Object — DataTemplates keyed by `Object` (or root MuralBase) would be
// ambiguous and aren't allowed.
export function findDataTemplateForType(klass: Function, start: Element): DataTemplate | undefined
{
    return start.FindInResourceChain(rd => matchDataTemplateInDict(rd, klass));
}

// One scope's contribution: walk `klass`'s prototype chain most-specific-first,
// returning the first DataTemplate registered in `rd` for a class in the chain.
// Uses the shared DataTemplate.walkTypeChain so the match policy lives once.
function matchDataTemplateInDict(rd: ResourceDictionary, klass: Function): DataTemplate | undefined
{
    return DataTemplate.walkTypeChain(klass, (cursor) => walkResourcesForDataTemplate(rd, cursor));
}

// Look up the IMPLICIT DataTemplate for `klass` in one dictionary (own entry
// first, then merged dictionaries recursively).
//
// Only a template registered under the data-type KEY itself counts — the
// `Set(Klass, tmpl)` a keyless `DataTemplate [DataType=Klass]` emits. A template
// given an `x:key` is stored under that STRING key and is reachable ONLY by
// explicit reference (`ItemTemplate=@K` / `ContentTemplate=@K`), exactly like
// WPF: an x:Key'd template is NOT implicit. Matching by `.DataType` instead would
// also return keyed templates, letting a `DataTemplate x:key="…" [DataType=X]`
// shadow the implicit `[DataType=X]` one purely by declaration order.
function walkResourcesForDataTemplate(rd: ResourceDictionary, klass: Function): DataTemplate | undefined
{
    const own = rd.Get(klass);
    if (own instanceof DataTemplate) return own;
    for (const merged of rd.MergedDictionaries)
    {
        const r = walkResourcesForDataTemplate(merged, klass);
        if (r !== undefined) return r;
    }
    return undefined;
}
