# Hierarchy Consolidation (Milestone B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dissolve Mural's four hierarchy types into two observable types (`HierarchyItem`, `Hierarchy`) with integer ids, replace the delta/observe-children protocol with providers that mutate observable `Children` through an `IDisposable` realize handle, make every parent compose multiple contributions under one owner, and move node actions onto Milestone A's command machinery — shipping a breaking mural release.

**Architecture:** The hierarchy subsystem in `src/framework/hierarchy/` is dormant scaffolding: outside that directory the only production touchpoints are the `src/framework/index.ts` barrel, two `ShellModule` collections, two `src/compiler/symbol-table.ts` rows, and two `src/compiler/compiler.ts` member-block remaps (Plexus is the real consumer and is **out of scope** — Milestone C2). So B is a clean-room rewrite of the directory plus those four integration points, with the subsystem's own headless `node:test` suite rewritten alongside. `HierarchyItem extends Observable` is its own identity (no node/VM pairing) and carries its display facts as live observable properties the provider mutates directly. `Hierarchy extends Observable` owns the realize engine, roots, selection, reveal, canonical names, lifecycle, and the per-open command-menu builder.

**Tech Stack:** TypeScript, Mural runtime (`Observable`, `ObservableCollection`, `ServiceKey`/`ServiceProvider`), todl-runtime `IDisposable`/`Disposable`/`CompositeDisposable` (mural 0.58.0 already adopts 0.6.0), Milestone A command machinery (`CommandDefinition`/`CommandRegistry`/`ICommandDispatcher`/`CommandContext`/`CommandMenuBuilder`/`CommandViewModel`). Tests: Node's built-in test runner (`node:test` + `node:assert/strict`), headless — no app bootstrap. Run a single file with `npx tsx --conditions=development --test --test-force-exit <file>`; full suite `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-01-hierarchy-consolidation-design.md`

## Global Constraints

- **House style (CLAUDE.md):** OOP only — every function is a class member; no module-level free functions or mutable module state (compile-time `const`/`enum`/`type` and sanctioned type-guard functions like `isCommandDispatcher` are the only exceptions). Allman braces (opening brace on its own line for class/interface/enum/method/control-flow; object literals, inline arrows, and genuine one-liners stay inline). PascalCase for all interfaces and public methods; `dispose()` stays lowercase (IDisposable contract).
- **No inline string literals** for reused/user-facing text: hoist to `private static readonly` PascalCase constants (e.g. `LoadingText`, property-name constants). Structural single-use tokens (`'/'` path separator, `typeof x === 'string'`) may stay inline.
- **View models extend `Observable`, not `MuralBase`.** `HierarchyItem` and `Hierarchy` both extend `Observable`. Only the DP-backed authoring schema `HierarchyContributorDefinition` stays on `MuralBase`.
- **Enums over string-literal unions.** `NodeSeverity` stays an enum.
- **Teardown is typed `IDisposable`**, never a bare `() => void`: wrap cleanup in `new Disposable(() => …)`, aggregate with `CompositeDisposable` (`.add(child)`), release via `dispose()`. No `off?: () => void` closures (the pattern B removes). No lambda "seams" — collaborators are real interfaces (`IHierarchyItemOwner`, `IRealizeContext`, `IHierarchyProvider`, `IHierarchyContributor`, `HierarchyHost`), passed as constructor/method dependencies.
- **Tests live in a `tests/` subfolder** beside source (`src/framework/hierarchy/tests/`), one behavior per test, real code over mocks, watched to fail first.
- **Integer ids:** `type ItemId = number` (plain, no branding); `0 = NoneId`; a per-`Hierarchy` monotonic allocator mints from 1. `CanonicalName` (string) is the durable cross-session identity; `ItemId` is a transient within-tree handle.
- **No new command machinery** — B consumes Milestone A's. Command scoping reuses A's shipped `CommandDefinition.Context: ServiceToken<unknown>` tag + `CommandRegistry.Commands` iteration (the exact pattern `ToolbarService.Rebuild` uses), matched by token reference identity.
- **Breaking mural release at the end** (minor bump; the dissolved API replaces the four types and the action stack). Full suite + `typecheck` + `typecheck:demos` + `test:demo` green, then **push `main` first**, then publish. Publish/push are human-gated stop points — do not publish autonomously.

## Architecture / Design rulings (resolve spec ambiguity — binding for all tasks)

These resolve points the spec (a vision document) left open; they are the authority the tasks implement. The spec remains binding where it is explicit.

- **DR1 — `HierarchyItem` is self-describing.** The old `model.GetProperty(id, prop)` indirection is deleted. `HierarchyItem` carries `Caption`/`IconKey`/`Severity`/`Error`/`IsExpandable` as live observable properties (get/set raising `PropertyChanged`); `Key`/`CanonicalSegment`/`Id` are set at construction; `ExtObject` is the interning identity for keyed children. A provider updates a child by setting these properties directly (replaces `ChildUpdated`).
- **DR2 — The item's owner is a narrow interface `IHierarchyItemOwner`** that `Hierarchy` implements. `HierarchyItem` holds `owner: IHierarchyItemOwner` (structure/realize/canonical/commands) and `host: HierarchyHost` (domain routing: activate/rename/delete/drop/removed). This mirrors the old VM holding `model` + `host`, modernized. Not a lambda seam — a real interface, faked in item tests.
- **DR3 — Providers mutate `item.Children` through an Order-scoped realize context.** The spec's "provider mutates `item.Children` directly" is honored by giving the provider an `IRealizeContext` bound to its `Order` segment on the parent; `context.InsertChild`/`RemoveChild` operate on the *same* observable `item.Children`, computing the flat index from the provider's segment so multiple contributions stay ordered by `Order` (a raw unordered `Add` cannot satisfy B4's Order-slot requirement or the async-arrival Review-Focus case). Child items are minted via `context.NewItem(...)` so the `Hierarchy` allocates the `ItemId` and wires the owner.
- **DR4 — Command dispatch for a node uses a single injected `ICommandDispatcher` on the `Hierarchy`** (`Dispatcher`), defaulting to a `NoOpCommandDispatcher` when none is supplied. This satisfies B5's "owner dispatches" — the consumer injects the owner's dispatcher — without B inventing the contributor-composition policy that belongs to C1/C2. `IHierarchyContributor extends ICommandDispatcher` so a contributor *can* serve as that dispatcher.
- **DR5 — Command scoping is a `ReadonlyMap<string, ServiceToken<unknown>>` (node `Key` → context tag) injected into the `Hierarchy` (`commandContexts`).** `BuildActions` matches that tag against `CommandRegistry.Commands` by reference identity (as `ToolbarService` does). In B the consumer supplies the map explicitly; C1's `Hierarchy { Actions … }` sugar makes it implicit. No node-key string filtering is added to `CommandRegistry`.
- **DR6 — There is no `@HierarchyContextMenu` resource in Mural** (the spec's "remove the singleton" is a no-op here). B provides `Hierarchy.BuildActions`/`HierarchyItem.BuildActions` as the per-open builder; the right-click *behavior* that calls it and the default `TreeView` land in C1.
- **DR7 — `Contribute(parent)` returns one `HierarchyContribution`** (a `NodeContribution` carrying N `HierarchyNodeSpec`s, or a `ProviderContribution`), as today. The engine processes **all** contributors for a parent `Key` in `Order` with no first-provider short-circuit.

## Review Focus

The five inputs the spec implies that no single task's happy-path test targets — each pinned to a test in the owning task:

- **Async provider arrival inserts late children into the correct `Order` slot, not appended at the end** → Task 5, `test('late provider child lands in its Order slot, before a higher-Order contribution')`.
- **Canonical-name collision across two sibling providers, and between a provider child and a keyed sibling, stays deterministic** → Task 6, `test('canonical names disambiguate colliding sibling segments')`.
- **Re-realization churn (add one provider, remove another) leaves surviving providers' subtrees and subscriptions intact** → Task 7, `test('re-realization does not tear down a surviving provider')`.
- **`dispose()` idempotency and leak-freedom across collapse/expand/collapse of a provider-owned parent (subscription counts return to baseline)** → Task 9, `test('collapse/expand/collapse returns subscriber count to baseline')`.
- **`Reveal` of a node inside a provider-owned subtree (canonical path crosses the provider boundary)** → Task 8, `test('Reveal descends across a provider boundary')`.

---

## File Structure

**Created** (all under `src/framework/hierarchy/`):
- `item-id.ts` — `type ItemId`, `NoneId`, `ItemIdAllocator`.
- `node-severity.ts` — `NodeSeverity` enum (moved out of the deleted `hierarchy-node.ts`).
- `hierarchy-item.ts` — `HierarchyItem extends Observable`, `HierarchyItemInit`, `IHierarchyItemOwner`.
- `hierarchy-provider.ts` — `IHierarchyProvider`, `IRealizeContext`, `DropData`.
- `hierarchy-contribution.ts` — `HierarchyContribution`/`NodeContribution`/`ProviderContribution`, `HierarchyNodeSpec`, `IHierarchyContributor`.
- `hierarchy.ts` — `Hierarchy extends Observable implements IHierarchyItemOwner`.
- `hierarchy-action-context.ts` — `HierarchyActionContext extends CommandContext`.

**Modified:**
- `hierarchy-host.ts` — drop `ActionsFor`; retype members from `HierarchyItemVM` to `HierarchyItem`.
- `hierarchy-contributor-registry.ts` — retype to the new `IHierarchyContributor`; `For` returns all contributors for a key ordered by `Order`.
- `hierarchy-contributor-definition.ts` — unchanged (authoring schema kept).
- `node-key.ts`, `node-key-registry.ts`, `hierarchy-drop.ts` — retype `HierarchyItemVM` references to `HierarchyItem` where present; otherwise unchanged.
- `index.ts` — rewrite the barrel to the new module set.
- `src/framework/shell/module.ts` — delete the `HierarchyActions` collection + its import; keep `HierarchyContributors`.
- `src/compiler/symbol-table.ts` — delete the `HierarchyActionDefinition` row (line ~132); keep `HierarchyContributorDefinition`.
- `src/compiler/compiler.ts` — delete the `.hierarchyActions` member-block remap (line ~3876); keep `.hierarchyContributors`.

**Deleted:**
- `hierarchy-node.ts` (split into `item-id.ts` + `node-severity.ts` + `hierarchy-item.ts` + `hierarchy-contribution.ts` + `hierarchy-provider.ts`), `hierarchy-item-vm.ts`, `hierarchy-model.ts`, `hierarchy-tree-vm.ts`, `hierarchy-action.ts`, `hierarchy-action-contributor.ts`, `hierarchy-action-contributor-registry.ts`.
- Their test files are rewritten against the new types (Task-by-task); `src/framework/shell/tests/module-hierarchy-actions.test.ts` is deleted (Task 11).

---

### Task 1: `ItemId` + `ItemIdAllocator`

**Files:**
- Create: `src/framework/hierarchy/item-id.ts`
- Test: `src/framework/hierarchy/tests/item-id.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ItemId = number`; `const NoneId: ItemId = 0`; `class ItemIdAllocator { Mint(): ItemId }` (monotonic, first mint returns 1).

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ItemIdAllocator, NoneId } from '../item-id.js';

describe('ItemIdAllocator', () =>
{
    test('mints monotonic ids from 1; NoneId is 0 and is never minted', () =>
    {
        assert.equal(NoneId, 0);
        const alloc = new ItemIdAllocator();
        const a = alloc.Mint();
        const b = alloc.Mint();
        const c = alloc.Mint();
        assert.equal(a, 1);
        assert.equal(b, 2);
        assert.equal(c, 3);
        assert.notEqual(a, NoneId);
    });

    test('separate allocators are independent', () =>
    {
        const first = new ItemIdAllocator();
        const second = new ItemIdAllocator();
        assert.equal(first.Mint(), 1);
        assert.equal(second.Mint(), 1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/item-id.test.ts`
Expected: FAIL — cannot find module `../item-id.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// A transient, within-tree item handle. CanonicalName (string) is the durable
// cross-session identity; ItemId only identifies an item inside one live tree.
export type ItemId = number;

// The reserved "no item" handle. The allocator never mints it.
export const NoneId: ItemId = 0;

// Per-Hierarchy monotonic id source. Mints from 1 so NoneId (0) is always free.
export class ItemIdAllocator
{
    private next: ItemId = 1;

    public Mint(): ItemId
    {
        const id = this.next;
        this.next += 1;
        return id;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/item-id.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/item-id.ts src/framework/hierarchy/tests/item-id.test.ts
git commit -m "feat(hierarchy): ItemId + monotonic ItemIdAllocator (Milestone B)"
```

---

### Task 2: `HierarchyItem` + `NodeSeverity` + `IHierarchyItemOwner`

**Files:**
- Create: `src/framework/hierarchy/node-severity.ts`, `src/framework/hierarchy/hierarchy-item.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-item.test.ts`

**Interfaces:**
- Consumes: `ItemId`, `NoneId` (Task 1); `Observable`, `ObservableCollection` (`../../runtime/index.js`).
- Produces:
  - `enum NodeSeverity { Ok, Warning, Error }`
  - `interface HierarchyItemInit { Caption?: string; IconKey?: string; Severity?: NodeSeverity; Error?: string; IsExpandable?: boolean; CanonicalSegment?: string; ExtObject?: unknown; }`
  - `interface IHierarchyItemOwner { NewItem(key: string, init?: HierarchyItemInit): HierarchyItem; Realize(item: HierarchyItem): void; Collapse(item: HierarchyItem): void; CanonicalNameOf(item: HierarchyItem): string; BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>; OnItemDisposed(item: HierarchyItem): void; }` (the `HierarchyActionContext`/`CommandViewModel` types arrive in Tasks 10/pre-existing; in this task `BuildActions` is typed with `unknown` placeholders — see Step 3 note and Task 10 which tightens it).
  - `class HierarchyItem extends Observable` with: `readonly Id: ItemId`, `readonly Key: string`, `readonly CanonicalSegment: string | undefined`, `ExtObject: unknown`, `readonly Children: ObservableCollection<HierarchyItem>`, `Parent: HierarchyItem | undefined`, get/set `Caption`/`IconKey`/`Severity`/`Error`/`IsExpandable`/`IsEditing`/`EditingName`/`IsExpanded`, `get CanonicalName`, `OnExpand()`, `OnCollapse()`, `OnActivate()`, `BeginEdit()`, `CommitEdit()`, `CancelEdit()`, `dispose()`, `static readonly LoadingText`.

> Dependency note: `HierarchyItem` references `HierarchyHost` (Task 11 reshapes it; it currently exists typed against `HierarchyItemVM`). To keep Task 2 self-contained, define the host dependency here as a local structural type `IHierarchyItemHost` with the members this task uses (`Activate`, `CommitRename`, `OnItemRemoved`) and have Task 11 reconcile `HierarchyHost` to extend/match it. This avoids a cross-task import cycle while the old `HierarchyHost` (typed on `HierarchyItemVM`) still exists.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyItem, NodeSeverity, type IHierarchyItemOwner, type IHierarchyItemHost } from '../hierarchy-item.js';
import { ItemIdAllocator } from '../item-id.js';

function fakeHost(over: Partial<IHierarchyItemHost> = {}): IHierarchyItemHost
{
    return {
        Activate: () => {},
        CommitRename: () => {},
        OnItemRemoved: () => {},
        ...over,
    };
}

function fakeOwner(over: Partial<IHierarchyItemOwner> = {}): IHierarchyItemOwner
{
    return {
        NewItem: (key, init) => new HierarchyItem(alloc.Mint(), key, fakeOwner(), fakeHost(), init),
        Realize: () => {},
        Collapse: () => {},
        CanonicalNameOf: () => '/',
        BuildActions: () => new (require('../../../runtime/index.js').ObservableCollection)(),
        OnItemDisposed: () => {},
        ...over,
    };
}

const alloc = new ItemIdAllocator();

describe('HierarchyItem', () =>
{
    test('display properties raise PropertyChanged when set', () =>
    {
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost(), { Caption: 'A' });
        let fired = 0;
        item.PropertyChanged('Caption').subscribe(() => { fired += 1; });
        assert.equal(item.Caption, 'A');
        item.Caption = 'B';
        assert.equal(item.Caption, 'B');
        assert.equal(fired, 1);
    });

    test('OnExpand asks the owner to realize; OnCollapse asks it to collapse', () =>
    {
        let realized = 0;
        let collapsed = 0;
        const owner = fakeOwner({ Realize: () => { realized += 1; }, Collapse: () => { collapsed += 1; } });
        const item = new HierarchyItem(alloc.Mint(), 'project', owner, fakeHost(), { IsExpandable: true });
        item.OnExpand();
        assert.equal(item.IsExpanded, true);
        assert.equal(realized, 1);
        item.OnCollapse();
        assert.equal(item.IsExpanded, false);
        assert.equal(collapsed, 1);
    });

    test('an expandable collapsed item seeds a single Loading… placeholder child', () =>
    {
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost(), { IsExpandable: true });
        assert.equal(item.Children.Count, 1);
        assert.equal(item.Children.ToArray()[0].Caption, HierarchyItem.LoadingText);
    });

    test('CommitEdit routes the new name to the host and ends editing', () =>
    {
        let committed = '';
        const item = new HierarchyItem(alloc.Mint(), 'project', fakeOwner(), fakeHost({ CommitRename: (_i, name) => { committed = name; } }), {});
        item.BeginEdit();
        item.EditingName = 'renamed';
        item.CommitEdit();
        assert.equal(committed, 'renamed');
        assert.equal(item.IsEditing, false);
    });

    test('dispose notifies the host and the owner and disposes children', () =>
    {
        let removed = 0;
        let ownerNotified = 0;
        const owner = fakeOwner({ OnItemDisposed: () => { ownerNotified += 1; } });
        const item = new HierarchyItem(alloc.Mint(), 'project', owner, fakeHost({ OnItemRemoved: () => { removed += 1; } }), {});
        item.dispose();
        assert.equal(removed, 1);
        assert.equal(ownerNotified, 1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-item.test.ts`
Expected: FAIL — cannot find module `../hierarchy-item.js`.

- [ ] **Step 3: Write minimal implementation**

`node-severity.ts`:

```ts
// Decoration severity for a hierarchy row (drives the error/warning glyph).
export enum NodeSeverity
{
    Ok,
    Warning,
    Error,
}
```

`hierarchy-item.ts` (note: `BuildActions`'s precise `HierarchyActionContext`/`CommandViewModel` types are tightened in Task 10; here the owner interface uses the runtime `ObservableCollection` return and `unknown` for the context so Task 2 stands alone):

```ts
import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { ItemId } from './item-id.js';
import type { NodeSeverity } from './node-severity.js';

// The domain seam HierarchyItem routes user intent through (activation, rename
// commit, removal). Task 11 reconciles the full HierarchyHost to this shape.
export interface IHierarchyItemHost
{
    Activate(item: HierarchyItem): void;
    CommitRename(item: HierarchyItem, newName: string): void;
    OnItemRemoved(item: HierarchyItem): void;
}

// The structural owner (a Hierarchy) that allocates ids, realizes children,
// computes canonical names, and builds the per-open command menu.
export interface IHierarchyItemOwner
{
    NewItem(key: string, init?: HierarchyItemInit): HierarchyItem;
    Realize(item: HierarchyItem): void;
    Collapse(item: HierarchyItem): void;
    CanonicalNameOf(item: HierarchyItem): string;
    BuildActions(item: HierarchyItem, context: unknown): ObservableCollection<unknown>;
    OnItemDisposed(item: HierarchyItem): void;
}

export interface HierarchyItemInit
{
    Caption?: string;
    IconKey?: string;
    Severity?: NodeSeverity;
    Error?: string;
    IsExpandable?: boolean;
    CanonicalSegment?: string;
    ExtObject?: unknown;
}

export class HierarchyItem extends Observable
{
    public static readonly LoadingText = 'Loading…';

    private static readonly CaptionProp = 'Caption';
    private static readonly IconKeyProp = 'IconKey';
    private static readonly SeverityProp = 'Severity';
    private static readonly ErrorProp = 'Error';
    private static readonly IsExpandableProp = 'IsExpandable';
    private static readonly IsEditingProp = 'IsEditing';
    private static readonly EditingNameProp = 'EditingName';
    private static readonly IsExpandedProp = 'IsExpanded';

    public readonly Children = new ObservableCollection<HierarchyItem>();
    public readonly CanonicalSegment: string | undefined;
    public Parent: HierarchyItem | undefined;
    public ExtObject: unknown;

    private _caption: string;
    private _iconKey: string;
    private _severity: NodeSeverity;
    private _error: string | undefined;
    private _isExpandable: boolean;
    private _isEditing = false;
    private _editingName = '';
    private _isExpanded = false;
    private _placeholder: HierarchyItem | undefined;

    constructor(
        public readonly Id: ItemId,
        public readonly Key: string,
        private readonly owner: IHierarchyItemOwner,
        private readonly host: IHierarchyItemHost,
        init: HierarchyItemInit = {},
    )
    {
        super();
        this._caption = init.Caption ?? '';
        this._iconKey = init.IconKey ?? '';
        this._severity = init.Severity ?? (0 as NodeSeverity);
        this._error = init.Error;
        this._isExpandable = init.IsExpandable ?? false;
        this.CanonicalSegment = init.CanonicalSegment;
        this.ExtObject = init.ExtObject;
        if (this._isExpandable)
        {
            this.seedPlaceholder();
        }
    }

    public get Caption(): string { return this._caption; }
    public set Caption(v: string)
    {
        const old = this._caption;
        if (old === v) return;
        this._caption = v;
        this.RaisePropertyChanged(HierarchyItem.CaptionProp, old, v);
    }

    public get IconKey(): string { return this._iconKey; }
    public set IconKey(v: string)
    {
        const old = this._iconKey;
        if (old === v) return;
        this._iconKey = v;
        this.RaisePropertyChanged(HierarchyItem.IconKeyProp, old, v);
    }

    public get Severity(): NodeSeverity { return this._severity; }
    public set Severity(v: NodeSeverity)
    {
        const old = this._severity;
        if (old === v) return;
        this._severity = v;
        this.RaisePropertyChanged(HierarchyItem.SeverityProp, old, v);
    }

    public get Error(): string | undefined { return this._error; }
    public set Error(v: string | undefined)
    {
        const old = this._error;
        if (old === v) return;
        this._error = v;
        this.RaisePropertyChanged(HierarchyItem.ErrorProp, old, v);
    }

    public get IsExpandable(): boolean { return this._isExpandable; }
    public set IsExpandable(v: boolean)
    {
        const old = this._isExpandable;
        if (old === v) return;
        this._isExpandable = v;
        this.RaisePropertyChanged(HierarchyItem.IsExpandableProp, old, v);
        if (v && !this._isExpanded && this._placeholder === undefined)
        {
            this.seedPlaceholder();
        }
        else if (!v)
        {
            this.clearPlaceholder();
        }
    }

    public get IsEditing(): boolean { return this._isEditing; }

    public get EditingName(): string { return this._editingName; }
    public set EditingName(v: string)
    {
        const old = this._editingName;
        if (old === v) return;
        this._editingName = v;
        this.RaisePropertyChanged(HierarchyItem.EditingNameProp, old, v);
    }

    public get IsExpanded(): boolean { return this._isExpanded; }

    public get CanonicalName(): string { return this.owner.CanonicalNameOf(this); }

    public OnExpand(): void
    {
        if (this._isExpanded) return;
        this.clearPlaceholder();
        this.setExpanded(true);
        this.owner.Realize(this);
    }

    public OnCollapse(): void
    {
        if (!this._isExpanded) return;
        this.setExpanded(false);
        this.owner.Collapse(this);
        if (this._isExpandable)
        {
            this.seedPlaceholder();
        }
    }

    public OnActivate(): void
    {
        this.host.Activate(this);
    }

    public BeginEdit(): void
    {
        this._editingName = this._caption;
        this.setEditing(true);
    }

    public CommitEdit(): void
    {
        this.host.CommitRename(this, this._editingName);
        this.setEditing(false);
    }

    public CancelEdit(): void
    {
        this.setEditing(false);
    }

    public dispose(): void
    {
        this.host.OnItemRemoved(this);
        this.owner.OnItemDisposed(this);
        for (const child of this.Children.ToArray())
        {
            child.dispose();
        }
        this.Children.Clear();
    }

    private setExpanded(v: boolean): void
    {
        const old = this._isExpanded;
        if (old === v) return;
        this._isExpanded = v;
        this.RaisePropertyChanged(HierarchyItem.IsExpandedProp, old, v);
    }

    private setEditing(v: boolean): void
    {
        const old = this._isEditing;
        if (old === v) return;
        this._isEditing = v;
        this.RaisePropertyChanged(HierarchyItem.IsEditingProp, old, v);
    }

    private seedPlaceholder(): void
    {
        if (this._placeholder !== undefined) return;
        const placeholder = this.owner.NewItem(this.Key, { Caption: HierarchyItem.LoadingText });
        this._placeholder = placeholder;
        this.Children.Add(placeholder);
    }

    private clearPlaceholder(): void
    {
        if (this._placeholder === undefined) return;
        const index = this.Children.IndexOf(this._placeholder);
        if (index >= 0) this.Children.RemoveAt(index);
        this._placeholder = undefined;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-item.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/node-severity.ts src/framework/hierarchy/hierarchy-item.ts src/framework/hierarchy/tests/hierarchy-item.test.ts
git commit -m "feat(hierarchy): HierarchyItem (merged Observable item) + NodeSeverity"
```

---

### Task 3: Provider + contribution contracts; retype the contributor registry

**Files:**
- Create: `src/framework/hierarchy/hierarchy-provider.ts`, `src/framework/hierarchy/hierarchy-contribution.ts`
- Modify: `src/framework/hierarchy/hierarchy-contributor-registry.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-contribution.test.ts`, and update `src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`

**Interfaces:**
- Consumes: `HierarchyItem`, `HierarchyItemInit` (Task 2); `ICommandDispatcher`, `CommandContext` (`../shell/commands/...` — exact: `ICommandDispatcher` from `../shell/commands/command-dispatcher.js`, `CommandContext` from `../shell/commands/command-context.js`); `ServiceKey`, `ServiceProvider`, `IServiceProvider` (`../../runtime/index.js`); `HierarchyContributorDefinition` (unchanged file).
- Produces:
  - `interface DropData { readonly Kind: string; readonly Payload: unknown; }`
  - `interface IRealizeContext { NewItem(key: string, init?: HierarchyItemInit): HierarchyItem; InsertChild(child: HierarchyItem): void; RemoveChild(child: HierarchyItem): void; }`
  - `interface IHierarchyProvider { readonly ProviderId: string; Realize(item: HierarchyItem, context: IRealizeContext): IDisposable; Integrate(item: HierarchyItem, contributions: readonly NodeContribution[]): void; GetCanonicalName(item: HierarchyItem): string; ParseCanonicalName(name: string): HierarchyItem | undefined; CanAccept(target: HierarchyItem, drop: DropData): boolean; }`
  - `interface HierarchyNodeSpec extends HierarchyItemInit { readonly Key: string; readonly ExtObject: unknown; }`
  - `abstract class HierarchyContribution {}`; `class NodeContribution extends HierarchyContribution { constructor(readonly Nodes: readonly HierarchyNodeSpec[]) }`; `class ProviderContribution extends HierarchyContribution { constructor(readonly Provider: IHierarchyProvider) }`
  - `interface IHierarchyContributor extends ICommandDispatcher { readonly ParentKeys: readonly string[]; readonly Order: number; Contribute(parent: HierarchyItem): HierarchyContribution; }`
  - `HierarchyContributorRegistry.For(parentKey: string): readonly IHierarchyContributor[]` (ordered by `Order` ascending), plus retained `Register(def): IDisposable`, `RegisterInstance(contributor): IDisposable`, `PopulateFromModules()`, `NotifyContributionsChanged()`, `PropertyChanged('Contributors')`.

> Note: `Register`/`RegisterInstance` now return `IDisposable` (was `() => void`) per the teardown constraint. Update their call sites in tests accordingly (`const sub = registry.Register(d); … sub.dispose();`).

- [ ] **Step 1: Write the failing test** (`hierarchy-contribution.test.ts`)

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function contributor(parentKeys: readonly string[], order: number, contribution: NodeContribution | ProviderContribution): IHierarchyContributor
{
    return {
        ParentKeys: parentKeys,
        Order: order,
        Contribute: (_parent: HierarchyItem) => contribution,
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    };
}

describe('HierarchyContributorRegistry (new contributor contract)', () =>
{
    test('For returns every contributor for a parent key, ordered by Order ascending', () =>
    {
        const provider = new ServiceProvider();
        const low = new ServiceKey<IHierarchyContributor>('low');
        const high = new ServiceKey<IHierarchyContributor>('high');
        provider.registerInstance(low, contributor(['project'], 10, new NodeContribution([])));
        provider.registerInstance(high, contributor(['project'], 20, new NodeContribution([])));
        const registry = new HierarchyContributorRegistry(provider);

        const defHigh = new HierarchyContributorDefinition();
        defHigh.ParentKeys = ['project']; defHigh.Contributor = high; defHigh.Order = 20;
        const defLow = new HierarchyContributorDefinition();
        defLow.ParentKeys = ['project']; defLow.Contributor = low; defLow.Order = 10;
        registry.Register(defHigh);
        registry.Register(defLow);

        const got = registry.For('project');
        assert.equal(got.length, 2);
        assert.equal(got[0].Order, 10);
        assert.equal(got[1].Order, 20);
    });

    test('a contributor is also an ICommandDispatcher (Resolve is callable)', () =>
    {
        const c = contributor(['project'], 0, new ProviderContribution({
            ProviderId: 'p', Realize: () => ({ dispose: () => {} }),
            Integrate: () => {}, GetCanonicalName: () => '', ParseCanonicalName: () => undefined, CanAccept: () => false,
        }));
        assert.equal(c.Resolve('any', new CommandContext()), undefined);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-contribution.test.ts`
Expected: FAIL — cannot find module `../hierarchy-contribution.js`.

- [ ] **Step 3: Write minimal implementation**

`hierarchy-provider.ts`:

```ts
import type { IDisposable } from '../../runtime/index.js';
import type { HierarchyItem, HierarchyItemInit } from './hierarchy-item.js';
import type { NodeContribution } from './hierarchy-contribution.js';

// A drag payload offered to a provider's CanAccept.
export interface DropData
{
    readonly Kind: string;
    readonly Payload: unknown;
}

// The Order-scoped child sink a provider receives in Realize. InsertChild /
// RemoveChild operate on the parent's own observable Children, placing children
// inside this provider's Order segment (see DR3). NewItem mints a child item
// bound to the owning Hierarchy (id allocation + owner wiring).
export interface IRealizeContext
{
    NewItem(key: string, init?: HierarchyItemInit): HierarchyItem;
    InsertChild(child: HierarchyItem): void;
    RemoveChild(child: HierarchyItem): void;
}

// A provider owns a sub-branch: it populates and maintains item.Children via the
// realize context and returns an IDisposable that tears its watches down.
export interface IHierarchyProvider
{
    readonly ProviderId: string;
    Realize(item: HierarchyItem, context: IRealizeContext): IDisposable;
    Integrate(item: HierarchyItem, contributions: readonly NodeContribution[]): void;
    GetCanonicalName(item: HierarchyItem): string;
    ParseCanonicalName(name: string): HierarchyItem | undefined;   // undefined if not found
    CanAccept(target: HierarchyItem, drop: DropData): boolean;
}
```

`hierarchy-contribution.ts`:

```ts
import type { ICommandDispatcher } from '../shell/commands/command-dispatcher.js';
import type { HierarchyItem, HierarchyItemInit } from './hierarchy-item.js';
import type { IHierarchyProvider } from './hierarchy-provider.js';

// A node a NodeContribution asks the model to intern as a keyed child. ExtObject
// is the interning identity (one HierarchyItem per (parent, ExtObject)).
export interface HierarchyNodeSpec extends HierarchyItemInit
{
    readonly Key: string;
    readonly ExtObject: unknown;
}

export abstract class HierarchyContribution
{
}

export class NodeContribution extends HierarchyContribution
{
    constructor(public readonly Nodes: readonly HierarchyNodeSpec[])
    {
        super();
    }
}

export class ProviderContribution extends HierarchyContribution
{
    constructor(public readonly Provider: IHierarchyProvider)
    {
        super();
    }
}

// Contributes children for its ParentKeys and, as the owner of those node keys,
// dispatches their commands (ICommandDispatcher.Resolve).
export interface IHierarchyContributor extends ICommandDispatcher
{
    readonly ParentKeys: readonly string[];
    readonly Order: number;
    Contribute(parent: HierarchyItem): HierarchyContribution;
}
```

Then retype `hierarchy-contributor-registry.ts`: change every `IHierarchyContributor` import to come from `./hierarchy-contribution.js`; change `Register`/`RegisterInstance` return type from `() => void` to `IDisposable` (wrap the existing unregister closure: `return new Disposable(() => { … })`, importing `Disposable` from `../../runtime/index.js`); keep `For(parentKey): readonly IHierarchyContributor[]` returning the `Order`-sorted list; keep `PopulateFromModules`, `NotifyContributionsChanged`, and the `PropertyChanged('Contributors')` signal. (The body logic is unchanged; only the contributor type's origin and the teardown return types change.)

- [ ] **Step 4: Run test to verify it passes + update the existing registry test**

Update `src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`: import `IHierarchyContributor`/`NodeContribution`/`ProviderContribution` from `../hierarchy-contribution.js`; give every fake contributor a `Resolve: (_id, _ctx) => undefined` member; change `Contribute(parent: HierarchyNode)` fakes to `Contribute(parent: HierarchyItem)`; change `const off = registry.Register(d); off()` to `const sub = registry.Register(d); sub.dispose()`.

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-contribution.test.ts src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-provider.ts src/framework/hierarchy/hierarchy-contribution.ts src/framework/hierarchy/hierarchy-contributor-registry.ts src/framework/hierarchy/tests/hierarchy-contribution.test.ts src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts
git commit -m "feat(hierarchy): provider Realize contract + contribution types; retype registry"
```

---

### Task 4: `Hierarchy` core — seed root, keyed realization, Roots

**Files:**
- Create: `src/framework/hierarchy/hierarchy.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-keyed.test.ts`

**Interfaces:**
- Consumes: `ItemId`/`NoneId`/`ItemIdAllocator` (T1); `HierarchyItem`/`HierarchyItemInit`/`IHierarchyItemOwner` (T2); `NodeContribution`/`ProviderContribution`/`HierarchyNodeSpec`/`IHierarchyContributor` (T3); `HierarchyContributorRegistry` (T3); `HierarchyHost` (current file, used structurally); `Observable`/`ObservableCollection`/`IDisposable`/`CompositeDisposable` (`../../runtime/index.js`).
- Produces: `class Hierarchy extends Observable implements IHierarchyItemOwner` with: ctor `(registry: HierarchyContributorRegistry, host: HierarchyHost)` (T10 adds optional command params); `readonly Roots: ObservableCollection<HierarchyItem>`; `SeedRoot(key, init?): HierarchyItem`; `NewItem(key, init?): HierarchyItem`; `Realize(item): void`; `Collapse(item): void`; `ChildrenOf(item): readonly HierarchyItem[]`; `CanonicalNameOf(item): string` (stub → T8/T6); `BuildActions(item, context): ObservableCollection<unknown>` (stub → T10); `OnItemDisposed(item): void`; `dispose(): void`. Internal classes `Segment`, `ParentComposition`; `private readonly composition: Map<HierarchyItem, ParentComposition>`; `private readonly internedByParent: Map<HierarchyItem, Map<unknown, HierarchyItem>>`; `protected insertIntoSegment`, `protected removeFromSegment`, `private insertSegment`, `private flatBaseOf`.

**Design (binding for T4–T7):** Each realized parent gets a `ParentComposition` holding an `Order`-sorted `Segment[]` plus a `CompositeDisposable teardown`. One `Segment` per contributor. The parent's flat `Children` is the concatenation of segments' `items` in `Order`; `insertIntoSegment` computes the flat index as (sum of earlier segments' item counts) + (position within this segment). Keyed interning is retained on the Hierarchy (`internedByParent`), not on the discarded segment, so a `Collapse`→`Realize` reuses the prior item for a surviving `ExtObject`. Task 4 implements only the `NodeContribution` path; `attachProvider` is a no-op stub until Task 5.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost
{
    return {
        Activate: () => {}, CommitRename: () => {}, Delete: () => {},
        CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {},
    } as unknown as HierarchyHost;
}
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec
{
    return { Key: key, ExtObject: ext, Caption: caption, IsExpandable: false };
}
function nodeContributor(parentKeys: readonly string[], order: number, nodes: readonly HierarchyNodeSpec[]): IHierarchyContributor
{
    return {
        ParentKeys: parentKeys, Order: order,
        Contribute: (_p: HierarchyItem) => new NodeContribution(nodes),
        Resolve: (_id: string, _ctx: CommandContext) => undefined,
    };
}
function hierarchyWith(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const provider = new ServiceProvider();
    for (const e of entries) provider.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(provider);
    for (const e of entries)
    {
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order;
        registry.Register(d);
    }
    return new Hierarchy(registry, noopHost());
}

describe('Hierarchy — keyed realization', () =>
{
    test('SeedRoot realizes keyed children into Roots, interned by ExtObject identity', () =>
    {
        const extA = {}; const extB = {};
        const key = new ServiceKey<IHierarchyContributor>('projects');
        const h = hierarchyWith([{ key, c: nodeContributor(['solution'], 0, [spec('project', extA, 'A'), spec('project', extB, 'B')]) }]);
        const root = h.SeedRoot('solution');
        assert.equal(h.Roots.Count, 2);
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['A', 'B']);
        assert.equal(root.Key, 'solution');
    });

    test('two NodeContributors compose in Order (low Order first)', () =>
    {
        const kHi = new ServiceKey<IHierarchyContributor>('hi');
        const kLo = new ServiceKey<IHierarchyContributor>('lo');
        const h = hierarchyWith([
            { key: kHi, c: nodeContributor(['solution'], 20, [spec('ref', {}, 'Refs')]) },
            { key: kLo, c: nodeContributor(['solution'], 10, [spec('proj', {}, 'Projects')]) },
        ]);
        h.SeedRoot('solution');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'Refs']);
    });

    test('re-realizing a parent reuses the interned item for a surviving ExtObject', () =>
    {
        const ext = {};
        const key = new ServiceKey<IHierarchyContributor>('files');
        const h = hierarchyWith([{ key, c: nodeContributor(['folder'], 0, [spec('file', ext, 'f.ts')]) }]);
        const parent = h.SeedRoot('folder');
        const first = h.Roots.ToArray()[0];
        h.Collapse(parent);
        h.Realize(parent);
        const second = h.Roots.ToArray().filter(i => i.Caption === 'f.ts')[0];
        assert.equal(second, first, 'same ExtObject re-interns to the same HierarchyItem instance');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-keyed.test.ts`
Expected: FAIL — cannot find module `../hierarchy.js`.

- [ ] **Step 3: Write minimal implementation** (`hierarchy.ts` — Task-4 scope; T5–T7 extend the marked methods)

```ts
import { Observable, ObservableCollection, CompositeDisposable, type IDisposable } from '../../runtime/index.js';
import { ItemIdAllocator } from './item-id.js';
import { HierarchyItem, type HierarchyItemInit, type IHierarchyItemOwner } from './hierarchy-item.js';
import { HierarchyContributorRegistry } from './hierarchy-contributor-registry.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor } from './hierarchy-contribution.js';
import type { HierarchyHost } from './hierarchy-host.js';

class Segment
{
    public readonly items: HierarchyItem[] = [];
    public contributor: IHierarchyContributor | undefined;
    public provider: unknown;            // IHierarchyProvider — typed in T5
    public providerHandle: IDisposable | undefined;

    constructor(public readonly Order: number)
    {
    }
}

class ParentComposition
{
    public readonly segments: Segment[] = [];
    public readonly teardown = new CompositeDisposable();
}

export class Hierarchy extends Observable implements IHierarchyItemOwner
{
    public readonly Roots = new ObservableCollection<HierarchyItem>();
    private readonly allocator = new ItemIdAllocator();
    private readonly composition = new Map<HierarchyItem, ParentComposition>();
    private readonly internedByParent = new Map<HierarchyItem, Map<unknown, HierarchyItem>>();
    private root: HierarchyItem | undefined;
    private readonly contributorsSub: IDisposable;

    constructor(
        private readonly registry: HierarchyContributorRegistry,
        private readonly host: HierarchyHost,
    )
    {
        super();
        this.contributorsSub = this.registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeAll());
    }

    public SeedRoot(key: string, init: HierarchyItemInit = {}): HierarchyItem
    {
        const root = this.NewItem(key, { ...init, IsExpandable: true });
        this.root = root;
        this.Realize(root);
        return root;
    }

    public NewItem(key: string, init: HierarchyItemInit = {}): HierarchyItem
    {
        return new HierarchyItem(this.allocator.Mint(), key, this, this.host, init);
    }

    public CanonicalNameOf(_item: HierarchyItem): string
    {
        return '/';   // T6/T8 implement owner-aware canonical names
    }

    public BuildActions(_item: HierarchyItem, _context: unknown): ObservableCollection<unknown>
    {
        return new ObservableCollection<unknown>();   // T10 implements command-driven actions
    }

    public OnItemDisposed(item: HierarchyItem): void
    {
        this.composition.delete(item);
        this.internedByParent.delete(item);
    }

    public Realize(item: HierarchyItem): void
    {
        if (this.composition.has(item)) return;
        const comp = new ParentComposition();
        this.composition.set(item, comp);
        for (const contributor of this.registry.For(item.Key))
        {
            const segment = new Segment(contributor.Order);
            segment.contributor = contributor;
            this.insertSegment(comp, segment);
            this.applyContribution(item, segment, contributor.Contribute(item));
        }
    }

    public Collapse(item: HierarchyItem): void
    {
        const comp = this.composition.get(item);
        if (comp === undefined) return;
        for (const segment of [...comp.segments])
        {
            for (const child of [...segment.items]) this.removeFromSegment(item, segment, child);
        }
        comp.teardown.dispose();
        this.composition.delete(item);
    }

    public ChildrenOf(item: HierarchyItem): readonly HierarchyItem[]
    {
        return item === this.root ? this.Roots.ToArray() : item.Children.ToArray();
    }

    public dispose(): void
    {
        this.contributorsSub.dispose();
        for (const comp of this.composition.values()) comp.teardown.dispose();
        this.composition.clear();
        this.internedByParent.clear();
        this.Roots.Clear();
    }

    // --- internals shared by T5–T7 ---

    protected applyContribution(parent: HierarchyItem, segment: Segment, contribution: NodeContribution | ProviderContribution): void
    {
        if (contribution instanceof NodeContribution)
        {
            const interned = this.internedFor(parent);
            for (const node of contribution.Nodes)
            {
                const existing = interned.get(node.ExtObject);
                const child = existing ?? this.NewItem(node.Key, node);
                child.ExtObject = node.ExtObject;
                child.Parent = parent;
                interned.set(node.ExtObject, child);
                this.insertIntoSegment(parent, segment, child);
            }
        }
        else if (contribution instanceof ProviderContribution)
        {
            this.attachProvider(parent, segment, contribution);   // T5
        }
    }

    protected attachProvider(_parent: HierarchyItem, _segment: Segment, _contribution: ProviderContribution): void
    {
        // T5 implements provider attachment.
    }

    private reRealizeAll(): void
    {
        // T7 replaces this with a non-destructive diff. T4 stub: re-realize root.
        if (this.root === undefined) return;
        this.Collapse(this.root);
        this.Realize(this.root);
    }

    private internedFor(parent: HierarchyItem): Map<unknown, HierarchyItem>
    {
        let m = this.internedByParent.get(parent);
        if (m === undefined) { m = new Map(); this.internedByParent.set(parent, m); }
        return m;
    }

    private insertSegment(comp: ParentComposition, segment: Segment): void
    {
        let i = 0;
        while (i < comp.segments.length && comp.segments[i].Order <= segment.Order) i += 1;
        comp.segments.splice(i, 0, segment);
    }

    private flatBaseOf(comp: ParentComposition, segment: Segment): number
    {
        let base = 0;
        for (const s of comp.segments)
        {
            if (s === segment) break;
            base += s.items.length;
        }
        return base;
    }

    protected insertIntoSegment(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        const comp = this.composition.get(parent);
        if (comp === undefined || segment.items.includes(child)) return;
        const within = segment.items.length;
        segment.items.push(child);
        const target = parent === this.root ? this.Roots : parent.Children;
        target.Insert(this.flatBaseOf(comp, segment) + within, child);
    }

    protected removeFromSegment(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
    {
        const at = segment.items.indexOf(child);
        if (at < 0) return;
        segment.items.splice(at, 1);
        const target = parent === this.root ? this.Roots : parent.Children;
        const flatAt = target.IndexOf(child);
        if (flatAt >= 0) target.RemoveAt(flatAt);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-keyed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-keyed.test.ts
git commit -m "feat(hierarchy): Hierarchy core — seed root, keyed Order-composed realization, Roots"
```

---

### Task 5: Provider attachment + Order-slot composition (async arrival)

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.ts` (implement `attachProvider`; add the `RealizeContext` class + shims; type `Segment.provider` as `IHierarchyProvider | undefined`)
- Test: `src/framework/hierarchy/tests/hierarchy-providers.test.ts`

**Interfaces:**
- Consumes: T4 internals; `IHierarchyProvider`/`IRealizeContext`/`ProviderContribution` (T3).
- Produces: `attachProvider` builds a `RealizeContext` bound to `segment`, calls `provider.Realize(parent, ctx)`, stores the handle on `segment.providerHandle`, and `comp.teardown.add(handle)`. `class RealizeContext implements IRealizeContext` with `NewItem`/`InsertChild`/`RemoveChild` delegating to the Hierarchy via `public insertIntoSegmentPublic`/`removeFromSegmentPublic` shims.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec { return { Key: key, ExtObject: ext, Caption: caption }; }

class CapturingProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'capturing';
    public Ctx: IRealizeContext | undefined;
    public Disposed = false;
    public Realize(_item: HierarchyItem, context: IRealizeContext): IDisposable { this.Ctx = context; return { dispose: () => { this.Disposed = true; } }; }
    public Integrate(): void {}
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

function build(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const provider = new ServiceProvider();
    for (const e of entries) provider.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(provider);
    for (const e of entries) { const d = new HierarchyContributorDefinition(); d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order; registry.Register(d); }
    return new Hierarchy(registry, noopHost());
}

describe('Hierarchy — providers + composition', () =>
{
    test('a provider child and a keyed sibling compose in Order under one parent', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kKeyed = new ServiceKey<IHierarchyContributor>('keyed');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 20, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kKeyed, c: { ParentKeys: ['solution'], Order: 10, Contribute: () => new NodeContribution([spec('proj', {}, 'Projects')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        prov.Ctx!.InsertChild(prov.Ctx!.NewItem('conn', { Caption: 'Connections' }));
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'Connections']);
    });

    test('late provider child lands in its Order slot, before a higher-Order contribution', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kTail = new ServiceKey<IHierarchyContributor>('tail');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 10, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kTail, c: { ParentKeys: ['solution'], Order: 20, Contribute: () => new NodeContribution([spec('ref', {}, 'References')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['References']);
        prov.Ctx!.InsertChild(prov.Ctx!.NewItem('proj', { Caption: 'Projects' }));
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Projects', 'References']);
    });

    test('collapsing a parent disposes its provider handle', () =>
    {
        const prov = new CapturingProvider();
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const h = build([{ key: kProv, c: { ParentKeys: ['folder'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor }]);
        const root = h.SeedRoot('folder');
        assert.equal(prov.Disposed, false);
        h.Collapse(root);
        assert.equal(prov.Disposed, true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-providers.test.ts`
Expected: FAIL — provider children never appear (the `attachProvider` stub is a no-op).

- [ ] **Step 3: Implement `attachProvider` + `RealizeContext`**

Add to imports: `import type { IHierarchyProvider, IRealizeContext } from './hierarchy-provider.js';`. Type `Segment.provider: IHierarchyProvider | undefined`. Replace the stub and add the context class + shims:

```ts
protected attachProvider(parent: HierarchyItem, segment: Segment, contribution: ProviderContribution): void
{
    const comp = this.composition.get(parent);
    if (comp === undefined) return;
    segment.provider = contribution.Provider;
    const ctx = new RealizeContext(this, parent, segment);
    const handle = contribution.Provider.Realize(parent, ctx);
    segment.providerHandle = handle;
    comp.teardown.add(handle);
}

public insertIntoSegmentPublic(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
{
    this.insertIntoSegment(parent, segment, child);
}

public removeFromSegmentPublic(parent: HierarchyItem, segment: Segment, child: HierarchyItem): void
{
    this.removeFromSegment(parent, segment, child);
}
```

At module scope (same file), a real class — not a lambda seam:

```ts
class RealizeContext implements IRealizeContext
{
    constructor(
        private readonly hierarchy: Hierarchy,
        private readonly parent: HierarchyItem,
        private readonly segment: Segment,
    )
    {
    }

    public NewItem(key: string, init?: HierarchyItemInit): HierarchyItem
    {
        return this.hierarchy.NewItem(key, init);
    }

    public InsertChild(child: HierarchyItem): void
    {
        child.Parent = this.parent;
        this.hierarchy.insertIntoSegmentPublic(this.parent, this.segment, child);
    }

    public RemoveChild(child: HierarchyItem): void
    {
        this.hierarchy.removeFromSegmentPublic(this.parent, this.segment, child);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-providers.test.ts`
Expected: PASS (3 tests). Re-run `hierarchy-keyed.test.ts` to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-providers.test.ts
git commit -m "feat(hierarchy): provider attachment + Order-slot composition (async arrival)"
```

---

### Task 6: One owner per subtree + provider-integration hook + canonical-name disambiguation

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-ownership.test.ts`

**Interfaces:**
- Consumes: T5 (`attachProvider`, `RealizeContext`).
- Produces: `private readonly ownerProvider: Map<HierarchyItem, IHierarchyProvider>` recording provider-minted items; a provider-owned branch in `Realize` that calls `provider.Realize` for the owned item's children and routes registry `NodeContribution`s for the item's `Key` through `provider.Integrate(item, contribs)` (no model keyed interning for owned items); `CanonicalNameOf` composing `/`-joined `segmentOf(item)` with a provider-id prefix (`ProviderId:segment`) so colliding sibling segments stay distinct; `private segmentOf(item): string`.

- [ ] **Step 1: Write the failing test** — (as specified in the main design; full file:)

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec { return { Key: key, ExtObject: ext, Caption: caption }; }

class OwningProvider implements IHierarchyProvider
{
    public Integrated: readonly NodeContribution[] = [];
    public Child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string, private readonly childCaption: string) {}
    public Realize(_item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (this.Child === undefined)
        {
            this.Child = context.NewItem('provchild', { Caption: this.childCaption, CanonicalSegment: this.childCaption, IsExpandable: true });
        }
        context.InsertChild(this.Child);
        return { dispose: () => {} };
    }
    public Integrate(_item: HierarchyItem, contributions: readonly NodeContribution[]): void { this.Integrated = contributions; }
    public GetCanonicalName(item: HierarchyItem): string { return item.CanonicalSegment ?? item.Key; }
    public ParseCanonicalName(): HierarchyItem | undefined { return undefined; }
    public CanAccept(): boolean { return false; }
}

function build(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const provider = new ServiceProvider();
    for (const e of entries) provider.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(provider);
    for (const e of entries) { const d = new HierarchyContributorDefinition(); d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order; registry.Register(d); }
    return new Hierarchy(registry, noopHost());
}

describe('Hierarchy — ownership + integration + canonical disambiguation', () =>
{
    test('registry NodeContributions for a provider-owned node route through provider.Integrate', () =>
    {
        const prov = new OwningProvider('p', 'Branch');
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kInject = new ServiceKey<IHierarchyContributor>('inject');
        const h = build([
            { key: kProv, c: { ParentKeys: ['solution'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kInject, c: { ParentKeys: ['provchild'], Order: 0, Contribute: () => new NodeContribution([spec('leaf', {}, 'Injected')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('solution');
        h.Realize(prov.Child!);
        assert.equal(prov.Integrated.length, 1);
        assert.equal(prov.Integrated[0].Nodes[0].Caption, 'Injected');
    });

    test('canonical names disambiguate colliding sibling segments', () =>
    {
        const a = new OwningProvider('a', 'x');
        const b = new OwningProvider('b', 'x');
        const kA = new ServiceKey<IHierarchyContributor>('a');
        const kB = new ServiceKey<IHierarchyContributor>('b');
        const h = build([
            { key: kA, c: { ParentKeys: ['root'], Order: 10, Contribute: () => new ProviderContribution(a), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kB, c: { ParentKeys: ['root'], Order: 20, Contribute: () => new ProviderContribution(b), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
        ]);
        h.SeedRoot('root');
        const names = h.Roots.ToArray().map(i => h.CanonicalNameOf(i));
        assert.equal(new Set(names).size, 2);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-ownership.test.ts`
Expected: FAIL — `Integrated.length` is 0 and the two canonical names collide (`/x`).

- [ ] **Step 3: Implement ownership + integration + disambiguation**

- Add `private readonly ownerProvider = new Map<HierarchyItem, IHierarchyProvider>();`.
- In `insertIntoSegment` (or the `RealizeContext.InsertChild` shim), when `segment.provider !== undefined` record `this.ownerProvider.set(child, segment.provider)`.
- In `Realize(item)`, before the normal loop:

```ts
const owner = this.ownerProvider.get(item);
if (owner !== undefined)
{
    const comp = new ParentComposition();
    this.composition.set(item, comp);
    const segment = new Segment(0);
    segment.provider = owner;
    this.insertSegment(comp, segment);
    const ctx = new RealizeContext(this, item, segment);
    const handle = owner.Realize(item, ctx);
    segment.providerHandle = handle;
    comp.teardown.add(handle);
    const injected = this.registry.For(item.Key)
        .map(c => c.Contribute(item))
        .filter((x): x is NodeContribution => x instanceof NodeContribution);
    if (injected.length > 0) owner.Integrate(item, injected);
    return;
}
```

- Replace `CanonicalNameOf` and add `segmentOf`:

```ts
public CanonicalNameOf(item: HierarchyItem): string
{
    if (this.root === undefined || item === this.root || item.Parent === undefined) return '/';
    const parts: string[] = [];
    let cur: HierarchyItem | undefined = item;
    while (cur !== undefined && cur !== this.root)
    {
        parts.unshift(this.segmentOf(cur));
        cur = cur.Parent;
    }
    return '/' + parts.join('/');
}

private segmentOf(item: HierarchyItem): string
{
    const base = item.CanonicalSegment ?? item.Key;
    const owner = this.ownerProvider.get(item);
    return owner !== undefined ? owner.ProviderId + ':' + base : base;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-ownership.test.ts`
Expected: PASS (2 tests). Re-run T4/T5 suites.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-ownership.test.ts
git commit -m "feat(hierarchy): one-owner subtrees + provider Integrate hook + canonical disambiguation"
```

---

### Task 7: Non-destructive re-realization

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.ts` (replace the `reRealizeAll` stub)
- Test: `src/framework/hierarchy/tests/hierarchy-rerealize.test.ts`

**Interfaces:**
- Consumes: T4–T6 internals (`Segment.contributor`, `composition`, `applyContribution`, `removeFromSegment`).
- Produces: `private reRealize(parent): void` — diff `registry.For(parent.Key)` against live segments: dispose+remove segments whose contributor departed (`disposeSegment`), attach segments for new contributors, leave survivors (and their `providerHandle`) untouched. `reRealizeAll` snapshots `[...this.composition.keys()]` and calls `reRealize` on each.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { ProviderContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }

class MarkProvider implements IHierarchyProvider
{
    public Disposed = false;
    private child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string, private readonly caption: string) {}
    public Realize(_i: HierarchyItem, ctx: IRealizeContext): IDisposable
    {
        if (this.child === undefined) this.child = ctx.NewItem('c', { Caption: this.caption });
        ctx.InsertChild(this.child);
        return { dispose: () => { this.Disposed = true; } };
    }
    public Integrate(): void {} public GetCanonicalName(): string { return ''; } public ParseCanonicalName(): HierarchyItem | undefined { return undefined; } public CanAccept(): boolean { return false; }
}

describe('Hierarchy — non-destructive re-realization', () =>
{
    test('re-realization adds/removes providers without disposing the survivor', () =>
    {
        const survivor = new MarkProvider('survivor', 'Survivor');
        const departing = new MarkProvider('departing', 'Departing');
        const kSurv = new ServiceKey<IHierarchyContributor>('surv');
        const kDep = new ServiceKey<IHierarchyContributor>('dep');
        const sp = new ServiceProvider();
        sp.registerInstance(kSurv, { ParentKeys: ['root'], Order: 10, Contribute: () => new ProviderContribution(survivor), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
        sp.registerInstance(kDep, { ParentKeys: ['root'], Order: 20, Contribute: () => new ProviderContribution(departing), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
        const registry = new HierarchyContributorRegistry(sp);
        const dS = new HierarchyContributorDefinition(); dS.ParentKeys = ['root']; dS.Contributor = kSurv; dS.Order = 10;
        const dD = new HierarchyContributorDefinition(); dD.ParentKeys = ['root']; dD.Contributor = kDep; dD.Order = 20;
        registry.Register(dS);
        const depSub = registry.Register(dD);
        const h = new Hierarchy(registry, noopHost());
        h.SeedRoot('root');
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Survivor', 'Departing']);

        depSub.dispose();
        registry.NotifyContributionsChanged();

        assert.equal(survivor.Disposed, false);
        assert.equal(departing.Disposed, true);
        assert.deepEqual(h.Roots.ToArray().map(i => i.Caption), ['Survivor']);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-rerealize.test.ts`
Expected: FAIL — the T4 stub collapses+re-realizes the whole root, so `survivor.Disposed` is `true`.

- [ ] **Step 3: Implement non-destructive re-realization**

```ts
private reRealizeAll(): void
{
    for (const parent of [...this.composition.keys()]) this.reRealize(parent);
}

private reRealize(parent: HierarchyItem): void
{
    const comp = this.composition.get(parent);
    if (comp === undefined) return;
    const desired = this.registry.For(parent.Key);
    const desiredSet = new Set(desired);
    for (const segment of [...comp.segments])
    {
        if (segment.contributor !== undefined && !desiredSet.has(segment.contributor))
        {
            this.disposeSegment(parent, comp, segment);
        }
    }
    const present = new Set(comp.segments.map(s => s.contributor));
    for (const contributor of desired)
    {
        if (present.has(contributor)) continue;
        const segment = new Segment(contributor.Order);
        segment.contributor = contributor;
        this.insertSegment(comp, segment);
        this.applyContribution(parent, segment, contributor.Contribute(parent));
    }
}

private disposeSegment(parent: HierarchyItem, comp: ParentComposition, segment: Segment): void
{
    for (const child of [...segment.items]) this.removeFromSegment(parent, segment, child);
    segment.providerHandle?.dispose();
    const at = comp.segments.indexOf(segment);
    if (at >= 0) comp.segments.splice(at, 1);
}
```

> `disposeSegment` disposes only the departed segment's own `providerHandle`, never `comp.teardown`, so survivors' handles are untouched. (The provider handles still live in `comp.teardown` for whole-parent collapse; disposing one early is idempotent via `Disposable`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-rerealize.test.ts`
Expected: PASS (1 test). Re-run T4–T6 suites to confirm the refactor held.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-rerealize.test.ts
git commit -m "feat(hierarchy): non-destructive re-realization (survivors keep subscriptions)"
```

---

### Task 8: Selection / Anchor + Reveal / CanonicalName

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.ts` (add `Selection`/`Anchor` + selection ops + prune-on-remove; implement `Reveal`)
- Test: `src/framework/hierarchy/tests/hierarchy-selection.test.ts`

**Interfaces:**
- Consumes: T4–T7 internals; `CanonicalNameOf`/`segmentOf` (T6).
- Produces: `readonly Selection: ObservableCollection<HierarchyItem>`; `get Anchor(): HierarchyItem | undefined`; `SelectSingle(item): void`; `Toggle(item): void`; `Deselect(item): void`; `ClearSelection(): void`; `SyncSelection(items: readonly HierarchyItem[], anchor: HierarchyItem | undefined): void`; `Reveal(canonicalName: string): HierarchyItem | undefined`. `removeFromSegment` additionally `Deselect`s a removed item.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, ProviderContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }
function spec(key: string, ext: unknown, caption: string, seg?: string): HierarchyNodeSpec { return { Key: key, ExtObject: ext, Caption: caption, CanonicalSegment: seg, IsExpandable: false }; }
function nc(parentKeys: readonly string[], order: number, nodes: readonly HierarchyNodeSpec[]): IHierarchyContributor { return { ParentKeys: parentKeys, Order: order, Contribute: () => new NodeContribution(nodes), Resolve: (_i: string, _c: CommandContext) => undefined }; }
function build(entries: readonly { key: ServiceKey<IHierarchyContributor>; c: IHierarchyContributor }[]): Hierarchy
{
    const sp = new ServiceProvider();
    for (const e of entries) sp.registerInstance(e.key, e.c);
    const registry = new HierarchyContributorRegistry(sp);
    for (const e of entries) { const d = new HierarchyContributorDefinition(); d.ParentKeys = e.c.ParentKeys as string[]; d.Contributor = e.key; d.Order = e.c.Order; registry.Register(d); }
    return new Hierarchy(registry, noopHost());
}

// A provider that owns a child that itself lazily exposes a grandchild via keyed contribution.
class BranchProvider implements IHierarchyProvider
{
    public Child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string) {}
    public Realize(_i: HierarchyItem, ctx: IRealizeContext): IDisposable
    {
        if (this.Child === undefined) this.Child = ctx.NewItem('branch', { Caption: 'Branch', CanonicalSegment: 'branch', IsExpandable: true });
        ctx.InsertChild(this.Child);
        return { dispose: () => {} };
    }
    public Integrate(): void {} public GetCanonicalName(i: HierarchyItem): string { return i.CanonicalSegment ?? i.Key; } public ParseCanonicalName(): HierarchyItem | undefined { return undefined; } public CanAccept(): boolean { return false; }
}

describe('Hierarchy — selection + reveal', () =>
{
    test('SelectSingle sets Selection + Anchor; Toggle adds/removes; ClearSelection empties', () =>
    {
        const k = new ServiceKey<IHierarchyContributor>('x');
        const h = build([{ key: k, c: nc(['root'], 0, [spec('a', {}, 'A'), spec('b', {}, 'B')]) }]);
        h.SeedRoot('root');
        const [a, b] = h.Roots.ToArray();
        h.SelectSingle(a);
        assert.deepEqual(h.Selection.ToArray(), [a]);
        assert.equal(h.Anchor, a);
        h.Toggle(b);
        assert.deepEqual(h.Selection.ToArray(), [a, b]);
        h.Toggle(a);
        assert.deepEqual(h.Selection.ToArray(), [b]);
        h.ClearSelection();
        assert.equal(h.Selection.Count, 0);
    });

    test('removing a selected item prunes it from Selection', () =>
    {
        const k = new ServiceKey<IHierarchyContributor>('x');
        const ext = {};
        const members: HierarchyNodeSpec[] = [spec('a', ext, 'A')];
        const contributor: IHierarchyContributor = { ParentKeys: ['root'], Order: 0, Contribute: () => new NodeContribution(members), Resolve: (_i: string, _c: CommandContext) => undefined };
        const sp = new ServiceProvider(); sp.registerInstance(k, contributor);
        const registry = new HierarchyContributorRegistry(sp);
        const d = new HierarchyContributorDefinition(); d.ParentKeys = ['root']; d.Contributor = k; d.Order = 0; registry.Register(d);
        const h = new Hierarchy(registry, noopHost());
        const root = h.SeedRoot('root');
        const a = h.Roots.ToArray()[0];
        h.SelectSingle(a);
        members.length = 0;                    // 'a' departs on re-realize
        h.Collapse(root); h.Realize(root);
        assert.equal(h.Selection.Count, 0, 'the removed item was pruned from Selection');
    });

    test('Reveal descends across a provider boundary', () =>
    {
        const prov = new BranchProvider('fs');
        const kProv = new ServiceKey<IHierarchyContributor>('prov');
        const kLeaf = new ServiceKey<IHierarchyContributor>('leaf');
        const h = build([
            { key: kProv, c: { ParentKeys: ['root'], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor },
            { key: kLeaf, c: nc(['branch'], 0, [spec('leaf', {}, 'Leaf', 'leaf.ts')]) },
        ]);
        h.SeedRoot('root');
        const branch = h.Roots.ToArray()[0];
        const canonical = h.CanonicalNameOf(branch) + '/leaf.ts';   // crosses the provider boundary
        const revealed = h.Reveal(canonical);
        assert.notEqual(revealed, undefined);
        assert.equal(revealed!.Caption, 'Leaf');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-selection.test.ts`
Expected: FAIL — `Selection`/`SelectSingle`/`Reveal` do not exist.

- [ ] **Step 3: Implement selection + reveal** in `hierarchy.ts`

```ts
// fields
public readonly Selection = new ObservableCollection<HierarchyItem>();
private _anchor: HierarchyItem | undefined;

public get Anchor(): HierarchyItem | undefined { return this._anchor; }

public SelectSingle(item: HierarchyItem): void
{
    this.Selection.Clear();
    this.Selection.Add(item);
    this._anchor = item;
}

public Toggle(item: HierarchyItem): void
{
    const at = this.Selection.IndexOf(item);
    if (at >= 0) { this.Selection.RemoveAt(at); }
    else { this.Selection.Add(item); this._anchor = item; }
}

public Deselect(item: HierarchyItem): void
{
    const at = this.Selection.IndexOf(item);
    if (at >= 0) this.Selection.RemoveAt(at);
    if (this._anchor === item) this._anchor = undefined;
}

public ClearSelection(): void
{
    this.Selection.Clear();
    this._anchor = undefined;
}

public SyncSelection(items: readonly HierarchyItem[], anchor: HierarchyItem | undefined): void
{
    this.Selection.Clear();
    for (const i of items) this.Selection.Add(i);
    this._anchor = anchor;
}

public Reveal(canonicalName: string): HierarchyItem | undefined
{
    if (this.root === undefined) return undefined;
    if (canonicalName === '/') return this.root;
    const segments = canonicalName.replace(/^\//, '').split('/');
    let current: HierarchyItem = this.root;
    for (const seg of segments)
    {
        if (!current.IsExpanded && current !== this.root) current.OnExpand();
        else if (current === this.root && !this.composition.has(current)) this.Realize(current);
        const children = current === this.root ? this.Roots.ToArray() : current.Children.ToArray();
        const next = children.find(c => this.segmentOf(c) === seg);
        if (next === undefined) return undefined;
        current = next;
    }
    return current;
}
```

Add to `removeFromSegment`, after removing from the target collection: `this.Deselect(child);`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-selection.test.ts`
Expected: PASS (3 tests). Re-run T4–T7 suites.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-selection.test.ts
git commit -m "feat(hierarchy): selection/anchor + Reveal across provider boundary"
```

---

### Task 9: Lifecycle / disposal (CompositeDisposable; leak-free collapse/expand)

**Files:**
- Modify: `src/framework/hierarchy/hierarchy.ts` (make `dispose()` idempotent; confirm collapse releases provider handles; add `dispose()` on items threaded through)
- Test: `src/framework/hierarchy/tests/hierarchy-lifecycle.test.ts`

**Interfaces:**
- Consumes: T4–T8 internals; `Disposable`/`CompositeDisposable`/`Signal.subscriberCount` (`../../runtime/index.js`).
- Produces: idempotent `Hierarchy.dispose()` (second call is a no-op); `Collapse` releases exactly the parent's provider handles; a verified baseline-return of a provider's live-subscription count across collapse/expand/collapse.

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, Disposable, type IDisposable } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { ProviderContribution, type IHierarchyContributor } from '../hierarchy-contribution.js';
import type { IHierarchyProvider, IRealizeContext } from '../hierarchy-provider.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandContext } from '../../shell/commands/command-context.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }

// Tracks how many live subscriptions it currently holds.
class CountingProvider implements IHierarchyProvider
{
    public Live = 0;
    private child: HierarchyItem | undefined;
    constructor(public readonly ProviderId: string) {}
    public Realize(_i: HierarchyItem, ctx: IRealizeContext): IDisposable
    {
        if (this.child === undefined) this.child = ctx.NewItem('c', { Caption: 'C' });
        ctx.InsertChild(this.child);
        this.Live += 1;
        return new Disposable(() => { this.Live -= 1; });
    }
    public Integrate(): void {} public GetCanonicalName(): string { return ''; } public ParseCanonicalName(): HierarchyItem | undefined { return undefined; } public CanAccept(): boolean { return false; }
}

function build(prov: IHierarchyProvider, parentKey: string): { h: Hierarchy }
{
    const k = new ServiceKey<IHierarchyContributor>('prov');
    const sp = new ServiceProvider();
    sp.registerInstance(k, { ParentKeys: [parentKey], Order: 0, Contribute: () => new ProviderContribution(prov), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(sp);
    const d = new HierarchyContributorDefinition(); d.ParentKeys = [parentKey]; d.Contributor = k; d.Order = 0; registry.Register(d);
    return { h: new Hierarchy(registry, noopHost()) };
}

describe('Hierarchy — lifecycle / disposal', () =>
{
    test('collapse/expand/collapse returns subscriber count to baseline', () =>
    {
        const prov = new CountingProvider('p');
        const { h } = build(prov, 'folder');
        const root = h.SeedRoot('folder');
        assert.equal(prov.Live, 1, 'realized once');
        h.Collapse(root);
        assert.equal(prov.Live, 0, 'collapse released the provider subscription');
        h.Realize(root);
        assert.equal(prov.Live, 1, 're-expand re-subscribes');
        h.Collapse(root);
        assert.equal(prov.Live, 0, 'back to baseline');
    });

    test('dispose() is idempotent and releases provider subscriptions', () =>
    {
        const prov = new CountingProvider('p');
        const { h } = build(prov, 'folder');
        h.SeedRoot('folder');
        assert.equal(prov.Live, 1);
        h.dispose();
        assert.equal(prov.Live, 0);
        h.dispose();   // must not throw or double-release
        assert.equal(prov.Live, 0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-lifecycle.test.ts`
Expected: the collapse/expand/collapse test likely PASSES already (CompositeDisposable + per-segment handles from T5). The idempotency test FAILS if `dispose()` is not guarded (a second `dispose()` re-walks a cleared composition without error, but `contributorsSub.dispose()` twice is safe via `Disposable`; the real gap to pin is a guard flag). If both already pass, add the guard anyway (Step 3) so the contract is explicit and the RED is the guard's absence under a stricter assertion — assert `h.dispose()` twice leaves `Live === 0` and add an internal `disposed` flag the test can read is unnecessary; keep the behavioral assertions above.

> If Step 1 is green on arrival, this task still earns its commit by making the lifecycle contract explicit (Step 3) and keeping the regression tests. Note in the ledger that the behavior pre-held and the task hardened/pinned it.

- [ ] **Step 3: Harden `dispose()`** in `hierarchy.ts`

```ts
private disposed = false;

public dispose(): void
{
    if (this.disposed) return;
    this.disposed = true;
    this.contributorsSub.dispose();
    for (const comp of this.composition.values()) comp.teardown.dispose();
    this.composition.clear();
    this.internedByParent.clear();
    this.ownerProvider.clear();
    this.Selection.Clear();
    this.Roots.Clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-lifecycle.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/tests/hierarchy-lifecycle.test.ts
git commit -m "feat(hierarchy): idempotent disposal + leak-free collapse/expand lifecycle"
```

---

### Task 10: Command-driven actions (`BuildActions`, `HierarchyActionContext`, context scoping)

**Files:**
- Create: `src/framework/hierarchy/hierarchy-action-context.ts`
- Modify: `src/framework/hierarchy/hierarchy.ts` (command options on the ctor; real `BuildActions`); `src/framework/hierarchy/hierarchy-item.ts` (tighten `IHierarchyItemOwner.BuildActions` + `HierarchyItem.BuildActions` types)
- Test: `src/framework/hierarchy/tests/hierarchy-actions.test.ts`

**Interfaces:**
- Consumes: `CommandContext` (`../shell/commands/command-context.js`), `CommandDefinition` (`../shell/commands/command-definition.js`), `CommandRegistry` (`../shell/commands/command-registry.js`), `ICommandDispatcher` (`../shell/commands/command-dispatcher.js`), `CommandMenuBuilder` (`../menu/command-menu-builder.js`), `CommandViewModel` (`../shell/commands/command-view-model.js`), `ServiceToken`/`IServiceProvider`/`ServiceProvider` (`../../runtime/index.js`); `HierarchyItem` (T2).
- Produces:
  - `class HierarchyActionContext extends CommandContext { constructor(readonly Anchor: HierarchyItem, readonly Selection: readonly HierarchyItem[]) }`
  - `interface HierarchyCommandOptions { CommandRegistry?: CommandRegistry; Dispatcher?: ICommandDispatcher; CommandContexts?: ReadonlyMap<string, ServiceToken<unknown>>; Services?: IServiceProvider; }`
  - `Hierarchy` ctor gains an optional 3rd arg `options?: HierarchyCommandOptions` (so `new Hierarchy(registry, host)` still compiles). `BuildActions(item, context)` returns a fresh `ObservableCollection<CommandViewModel>` each call: the scoped roots (`CommandRegistry.Commands` filtered by `def.Context === commandContexts.get(item.Key)`, sorted by `Order`) each built via a per-call `CommandMenuBuilder`.
  - `IHierarchyItemOwner.BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>` and `HierarchyItem.BuildActions(context: HierarchyActionContext): ObservableCollection<CommandViewModel>` delegating to the owner.
  - `class NoOpCommandDispatcher implements ICommandDispatcher { Resolve(): undefined }` (module-scope in `hierarchy.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey, ServiceProvider, RelayCommand, type ICommand } from '../../../runtime/index.js';
import { Hierarchy } from '../hierarchy.js';
import { HierarchyContributorRegistry } from '../hierarchy-contributor-registry.js';
import { HierarchyContributorDefinition } from '../hierarchy-contributor-definition.js';
import { NodeContribution, type IHierarchyContributor, type HierarchyNodeSpec } from '../hierarchy-contribution.js';
import { HierarchyActionContext } from '../hierarchy-action-context.js';
import type { HierarchyItem } from '../hierarchy-item.js';
import type { HierarchyHost } from '../hierarchy-host.js';
import { CommandRegistry } from '../../shell/commands/command-registry.js';
import { CommandDefinition } from '../../shell/commands/command-definition.js';
import { CommandContext } from '../../shell/commands/command-context.js';
import type { ICommandDispatcher } from '../../shell/commands/command-dispatcher.js';

function noopHost(): HierarchyHost { return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} } as unknown as HierarchyHost; }
function spec(key: string, ext: unknown, caption: string): HierarchyNodeSpec { return { Key: key, ExtObject: ext, Caption: caption }; }

const ProjectContext = new ServiceKey<unknown>('project.commands');
const OtherContext = new ServiceKey<unknown>('other.commands');

describe('Hierarchy — command-driven actions', () =>
{
    function setup(): { h: Hierarchy; executed: string[] }
    {
        const kProj = new ServiceKey<IHierarchyContributor>('proj');
        const sp = new ServiceProvider();
        sp.registerInstance(kProj, { ParentKeys: ['solution'], Order: 0, Contribute: () => new NodeContribution([spec('project', {}, 'MyProj')]), Resolve: (_i: string, _c: CommandContext) => undefined } as IHierarchyContributor);
        const registry = new HierarchyContributorRegistry(sp);
        const d = new HierarchyContributorDefinition(); d.ParentKeys = ['solution']; d.Contributor = kProj; d.Order = 0; registry.Register(d);

        const commandRegistry = new CommandRegistry(new ServiceProvider());
        const rename = new CommandDefinition(); rename.Id = 'rename'; rename.Title = 'Rename'; rename.Context = ProjectContext; rename.Order = 10;
        const build = new CommandDefinition(); build.Id = 'build'; build.Title = 'Build'; build.Context = ProjectContext; build.Order = 20;
        const foreign = new CommandDefinition(); foreign.Id = 'x'; foreign.Title = 'X'; foreign.Context = OtherContext; foreign.Order = 0;
        commandRegistry.Commands.Add(rename); commandRegistry.Commands.Add(build); commandRegistry.Commands.Add(foreign);

        const executed: string[] = [];
        const dispatcher: ICommandDispatcher = { Resolve: (id: string, _ctx: CommandContext): ICommand | undefined => new RelayCommand(() => { executed.push(id); }) };

        const h = new Hierarchy(registry, noopHost(), {
            CommandRegistry: commandRegistry,
            Dispatcher: dispatcher,
            CommandContexts: new Map<string, ServiceKey<unknown>>([['project', ProjectContext]]),
            Services: new ServiceProvider(),
        });
        return { h, executed };
    }

    test('BuildActions returns only the roots scoped to the node key, in Order', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0];
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.deepEqual(menu.ToArray().map(vm => vm.Title), ['Rename', 'Build']);
    });

    test('resolved command executes through the injected dispatcher', () =>
    {
        const { h, executed } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0];
        const menu = project.BuildActions(new HierarchyActionContext(project, [project]));
        menu.ToArray()[0].Command.Execute(undefined);
        assert.deepEqual(executed, ['rename']);
    });

    test('BuildActions builds a fresh collection each call (per-open, no retained state)', () =>
    {
        const { h } = setup();
        h.SeedRoot('solution');
        const project = h.Roots.ToArray()[0];
        const first = project.BuildActions(new HierarchyActionContext(project, [project]));
        const second = project.BuildActions(new HierarchyActionContext(project, [project]));
        assert.notEqual(first, second);
        assert.notEqual(first.ToArray()[0], second.ToArray()[0]);
    });

    test('a node key with no context tag yields an empty menu', () =>
    {
        const { h } = setup();
        const root = h.SeedRoot('solution');
        const menu = root.BuildActions(new HierarchyActionContext(root, [root]));   // 'solution' has no tag
        assert.equal(menu.Count, 0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-actions.test.ts`
Expected: FAIL — cannot find `../hierarchy-action-context.js`; `BuildActions` returns an empty `ObservableCollection<unknown>` stub.

- [ ] **Step 3: Implement**

`hierarchy-action-context.ts`:

```ts
import { CommandContext } from '../shell/commands/command-context.js';
import type { HierarchyItem } from './hierarchy-item.js';

// The CommandContext a hierarchy node dispatches its commands against: the
// right-clicked item plus the current tree selection.
export class HierarchyActionContext extends CommandContext
{
    constructor(
        public readonly Anchor: HierarchyItem,
        public readonly Selection: readonly HierarchyItem[],
    )
    {
        super();
    }
}
```

In `hierarchy.ts`: add imports (`CommandDefinition`, `CommandRegistry`, `ICommandDispatcher`, `CommandMenuBuilder`, `CommandViewModel`, `ServiceToken`, `IServiceProvider`, `ServiceProvider`, `HierarchyActionContext`). Add the options type + ctor arg + a `NoOpCommandDispatcher`:

```ts
export interface HierarchyCommandOptions
{
    CommandRegistry?: CommandRegistry;
    Dispatcher?: ICommandDispatcher;
    CommandContexts?: ReadonlyMap<string, ServiceToken<unknown>>;
    Services?: IServiceProvider;
}

class NoOpCommandDispatcher implements ICommandDispatcher
{
    public Resolve(): undefined
    {
        return undefined;
    }
}
```

ctor:

```ts
constructor(
    private readonly registry: HierarchyContributorRegistry,
    private readonly host: HierarchyHost,
    private readonly commandOptions: HierarchyCommandOptions = {},
)
{
    super();
    this.contributorsSub = this.registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeAll());
}
```

Replace `BuildActions`:

```ts
public BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>
{
    const result = new ObservableCollection<CommandViewModel>();
    const token = this.commandOptions.CommandContexts?.get(item.Key);
    const registry = this.commandOptions.CommandRegistry;
    if (token === undefined || registry === undefined) return result;
    const roots = registry.Commands.ToArray()
        .filter(d => d.Context !== undefined && d.Context === token)
        .sort((a, b) => a.Order - b.Order);
    const dispatcher = this.commandOptions.Dispatcher ?? new NoOpCommandDispatcher();
    const services = this.commandOptions.Services ?? new ServiceProvider();
    const builder = new CommandMenuBuilder(dispatcher, services, context);
    for (const root of roots) result.Add(builder.Build(root));
    return result;
}
```

In `hierarchy-item.ts`: import `type { HierarchyActionContext }` from `./hierarchy-action-context.js` and `type { CommandViewModel }` from `../shell/commands/command-view-model.js`; retype `IHierarchyItemOwner.BuildActions(item: HierarchyItem, context: HierarchyActionContext): ObservableCollection<CommandViewModel>`; add `HierarchyItem.BuildActions`:

```ts
public BuildActions(context: HierarchyActionContext): ObservableCollection<CommandViewModel>
{
    return this.owner.BuildActions(this, context);
}
```

> Per-open disposal (DR6): the returned collection's `CommandViewModel`s are disposed by the *caller* (the C1 context-menu behavior) on menu close — `BuildActions` retains nothing, so a fresh call is independent (pinned by the "fresh collection each call" test).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/hierarchy/tests/hierarchy-actions.test.ts`
Expected: PASS (4 tests). Re-run T2 (`hierarchy-item.test.ts`) and T4–T9 suites — the owner-interface retype must keep them green (the T2 fake owner's `BuildActions` returns an empty `ObservableCollection`, still assignable).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-action-context.ts src/framework/hierarchy/hierarchy.ts src/framework/hierarchy/hierarchy-item.ts src/framework/hierarchy/tests/hierarchy-actions.test.ts
git commit -m "feat(hierarchy): command-driven BuildActions + HierarchyActionContext + context scoping"
```

---

### Task 11: Delete the action stack; wire compiler/shell/barrel; remove dissolved files; green suite

**Files:**
- Delete: `src/framework/hierarchy/hierarchy-node.ts`, `hierarchy-item-vm.ts`, `hierarchy-model.ts`, `hierarchy-tree-vm.ts`, `hierarchy-action.ts`, `hierarchy-action-contributor.ts`, `hierarchy-action-contributor-registry.ts`; and their test files `tests/hierarchy-node.test.ts`, `tests/hierarchy-model.test.ts`, `tests/hierarchy-model-observe.test.ts`, `tests/hierarchy-model-live.test.ts`, `tests/hierarchy-item-vm.test.ts`, `tests/hierarchy-tree-vm.test.ts`, `tests/hierarchy-action.test.ts`, `tests/hierarchy-action-contributor.test.ts`, `tests/hierarchy-action-contributor-registry.test.ts`; and `src/framework/shell/tests/module-hierarchy-actions.test.ts`.
- Modify: `src/framework/hierarchy/hierarchy-host.ts`, `src/framework/hierarchy/index.ts`, `src/framework/hierarchy/node-key-registry.ts` + `node-key.ts` + `hierarchy-drop.ts` (retype any `HierarchyItemVM` → `HierarchyItem`), `src/framework/shell/module.ts`, `src/compiler/symbol-table.ts`, `src/compiler/compiler.ts`.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a barrel exporting only the new module set; `ShellModule` without `HierarchyActions`; a compiler with no `HierarchyActionDefinition` symbol and no `.hierarchyActions` member-block; `HierarchyHost` typed on `HierarchyItem` without `ActionsFor`, structurally satisfying `IHierarchyItemHost`.

- [ ] **Step 1: Reshape `hierarchy-host.ts`**

```ts
import type { HierarchyItem } from './hierarchy-item.js';
import type { DropData } from './hierarchy-provider.js';

// The domain seam a Hierarchy is constructed with and passes to every item:
// routes activation, rename commit, delete, drop validation/apply, and removal.
// (Action resolution moved to the command machinery — see Hierarchy.BuildActions.)
export interface HierarchyHost
{
    Activate(item: HierarchyItem): void;
    CommitRename(item: HierarchyItem, newName: string): void;
    Delete(item: HierarchyItem): void;
    CanDrop(target: HierarchyItem, dragged: readonly HierarchyItem[]): boolean;
    Drop(target: HierarchyItem, dragged: readonly HierarchyItem[]): void;
    OnItemRemoved(item: HierarchyItem): void;
}
```

(If `node-key.ts`/`node-key-registry.ts`/`hierarchy-drop.ts` reference `HierarchyItemVM`, retype to `HierarchyItem`; `DropData` now lives in `hierarchy-provider.ts` — update `hierarchy-drop.ts`'s import accordingly.)

- [ ] **Step 2: Delete the dissolved sources + their tests**

```bash
git rm src/framework/hierarchy/hierarchy-node.ts src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/hierarchy-tree-vm.ts src/framework/hierarchy/hierarchy-action.ts src/framework/hierarchy/hierarchy-action-contributor.ts src/framework/hierarchy/hierarchy-action-contributor-registry.ts
git rm src/framework/hierarchy/tests/hierarchy-node.test.ts src/framework/hierarchy/tests/hierarchy-model.test.ts src/framework/hierarchy/tests/hierarchy-model-observe.test.ts src/framework/hierarchy/tests/hierarchy-model-live.test.ts src/framework/hierarchy/tests/hierarchy-item-vm.test.ts src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts src/framework/hierarchy/tests/hierarchy-action.test.ts src/framework/hierarchy/tests/hierarchy-action-contributor.test.ts src/framework/hierarchy/tests/hierarchy-action-contributor-registry.test.ts
git rm src/framework/shell/tests/module-hierarchy-actions.test.ts
```

- [ ] **Step 3: Rewrite the barrel `index.ts`**

```ts
export * from './item-id.js';
export * from './node-severity.js';
export * from './hierarchy-item.js';
export * from './hierarchy-provider.js';
export * from './hierarchy-contribution.js';
export * from './hierarchy.js';
export * from './hierarchy-action-context.js';
export * from './hierarchy-host.js';
export * from './hierarchy-contributor-registry.js';
export * from './hierarchy-contributor-definition.js';
export * from './node-key.js';
export * from './node-key-registry.js';
export * from './hierarchy-drop.js';
```

- [ ] **Step 4: Remove the `HierarchyActions` seam from the shell + compiler**

- `src/framework/shell/module.ts`: delete the `HierarchyActionDefinition` import (line ~85) and the `public readonly HierarchyActions = new ObservableCollection<HierarchyActionDefinition>()` member (line ~208). Keep `HierarchyContributors`.
- `src/compiler/symbol-table.ts`: delete the row `['HierarchyActionDefinition', '…/hierarchy-action-contributor.js']` (line ~132). Keep `HierarchyContributorDefinition` (line ~131).
- `src/compiler/compiler.ts`: delete the `: block.name === 'hierarchyActions' ? 'HierarchyActions'` arm (line ~3876) from `compileMemberBlock`. Keep the `hierarchyContributors` arm (line ~3875).

- [ ] **Step 5: Verify the compiler change with the kept member-block test**

Run: `npx tsx --conditions=development --test --test-force-exit src/framework/shell/tests/module-hierarchy-contributors.test.ts`
Expected: PASS (the `.hierarchyContributors:` lowering still works; it imports `HierarchyContributorDefinition` from the barrel, which still exports it).

- [ ] **Step 6: Typecheck + full hierarchy suite + demos**

```bash
npx tsc -p tsconfig.build.json --noEmit
npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/**/*.test.ts" "src/framework/shell/**/*.test.ts"
npm run build:templates && npx tsc -p demo/tsconfig.demos.json
```
Expected: typecheck exit 0; every hierarchy + shell test passes; demo typecheck exit 0. Fix any dangling import of a deleted type the typecheck surfaces (there should be none outside the four touchpoints — see the plan's Architecture note).

- [ ] **Step 7: Commit**

```bash
git add -A src/framework/hierarchy src/framework/shell/module.ts src/compiler/symbol-table.ts src/compiler/compiler.ts
git commit -m "refactor(hierarchy): delete node/model/tree/item-vm + action stack; rewire barrel, shell, compiler"
```

- [ ] **Step 8: Full suite + demo tests (whole-milestone gate)**

```bash
npm test
npm run build
npm run test:demo
```
Expected: `npm test` → all pass, 0 fail (only the pre-existing 3 skips); `npm run build` exit 0 (incl. `build:demos:ts`); `npm run test:demo` → all pass. This is the green gate for the breaking publish. **The publish + push are human-gated** (finishing-a-development-branch): push `main` first, then publish mural (minor bump). Do **not** publish autonomously.

---

## Self-Review

**1. Spec coverage.**
- B1 (two observable types): `HierarchyItem` (T2), `Hierarchy` (T4), both `extends Observable`. ✓
- B2 (integer ids): `ItemId`/`NoneId`/`ItemIdAllocator`, mint from 1 (T1); `CanonicalName` durable (T6/T8). ✓
- B3 (providers mutate `Children` via `Realize(item,ctx): IDisposable`): T3 (contract) + T5 (attachment + context) + T9 (teardown). Deltas/`ObserveChildren` deleted (T11). ✓
- B4 (multi-contribution, one owner, Integrate hook, disambiguation, non-destructive re-realization): T5 (process-all + Order slots), T6 (one-owner + Integrate + disambiguation), T7 (non-destructive re-realization). ✓
- B5 (actions via commands; delete action stack; `IHierarchyContributor extends ICommandDispatcher`; `HierarchyActionContext extends CommandContext`; `BuildActions` per-open): T3 (`IHierarchyContributor extends ICommandDispatcher`), T10 (`HierarchyActionContext`, `BuildActions`, scoping), T11 (delete stack). ✓
- B6 (preservation: selection, reveal/restore, lazy expand + Loading sentinel, disposal): T2 (Loading sentinel + edit lifecycle), T8 (selection + reveal), T9 (disposal). ✓
- Breaking release + green gates + push-main-first: T11 Step 8 + the Testing/verification note. Publish human-gated. ✓

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N". Every code step carries real code; every test step carries a runnable test; the one "if Step 1 is green on arrival" note in T9 gives an explicit alternative action (harden + pin), not a deferral.

**3. Type consistency.** Names checked across tasks: `ItemId`/`NoneId`/`ItemIdAllocator.Mint` (T1↔all); `HierarchyItem`/`HierarchyItemInit`/`IHierarchyItemOwner`/`IHierarchyItemHost`/`LoadingText` (T2↔T4,T10); `NodeContribution`/`ProviderContribution`/`HierarchyNodeSpec`/`IHierarchyContributor`(`.ParentKeys/.Order/.Contribute/.Resolve`) (T3↔T4–T7,T10); `IHierarchyProvider`(`ProviderId/Realize/Integrate/GetCanonicalName/ParseCanonicalName/CanAccept`)/`IRealizeContext`(`NewItem/InsertChild/RemoveChild`)/`DropData` (T3↔T5,T6,T11); `Hierarchy` members `Roots/Selection/Anchor/SeedRoot/NewItem/Realize/Collapse/CanonicalNameOf/BuildActions/Reveal/dispose` + internals `Segment`(`Order/items/contributor/provider/providerHandle`)/`ParentComposition`(`segments/teardown`)/`insertIntoSegment`/`removeFromSegment`/`applyContribution`/`segmentOf` (T4↔T5–T10); `HierarchyActionContext`(`Anchor/Selection`)/`HierarchyCommandOptions`/`NoOpCommandDispatcher` (T10); `HierarchyHost` reshaped (T11) stays assignable to `IHierarchyItemHost` (T2). `CompositeDisposable.add` (lowercase), `Disposable(cleanup)`, `Observable.RaisePropertyChanged(name,old,new)`, `ObservableCollection` (`Add/Insert/RemoveAt/Remove/IndexOf/ToArray/Count/Clear`), `Signal.subscribe` verified against the runtime. ✓

**4. Review Focus.** All five lines have an owning test: async Order-slot arrival (T5), canonical collision (T6), non-destructive re-realization (T7), leak-free collapse/expand baseline (T9), Reveal across provider boundary (T8). ✓
