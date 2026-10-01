# Command Machinery — A1 (Command Stack) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CommandDefinition` hierarchical, replace `ICommandTarget` with a surface-agnostic `ICommandDispatcher.Resolve(id, context): ICommand`, add `ICommandContributor` for dynamic children, move toggle state onto the command (`IsChecked` via `ICheckableCommand`), and migrate the toolbar + editor-actions consumers and the command view-model onto the new stack — with the existing diagram toolbar unchanged in behavior.

**Architecture:** This is the first half of Milestone A (the command *stack*); A2 adds the hierarchical **menu rendering** on top. New command contracts are added alongside the old `ICommandTarget` so each task stays green; the old target is deleted only in the final task once both consumers have migrated. The unified command VM becomes `Observable` (not `MuralBase`). Executed on one branch with A2; a single mural publish happens at the end of Milestone A (not in A1).

**Tech Stack:** TypeScript (ESM), `tsx --test` (node:test), `tsc` build + typecheck, `.mu` markup compiled by Mural's own compiler. Package `@pragmatic-tech-ai/mural`, depends on `@pragmatic-tech-ai/todl-runtime@^0.6.0` (Phase 0, published).

**Spec:** `docs/superpowers/specs/2026-10-01-command-machinery-unification-design.md`

## Global Constraints

- **Allman braces** on every block; `else`/`catch`/`finally` on their own line. Object literals, inline arrows, one-liners stay inline.
- **OOP, no module-level free functions or mutable state** beyond compile-time `const`/enum/type. New behavior is methods on classes.
- **No inline string literals** for reused/user-facing text — hoist to `private static readonly` PascalCase constants. (Command Ids already live as enum/constant tokens; keep that.)
- **PascalCase** for all interfaces and public methods. `dispose()` stays lowercase (the `IDisposable` contract).
- **View-models extend `Observable`, not `MuralBase`** (this milestone migrates `CommandViewModel` accordingly).
- **Enums over string-literal unions.**
- **`IDisposable` rule:** teardown handles are typed `IDisposable`; wrap cleanup via `new Disposable(() => …)`; aggregate with `CompositeDisposable`. No bare `() => void` disposers in definitions.
- **Tests** live in a `tests/` subfolder beside source.
- **Fix ALL review findings including Minors in this milestone** — no deferral across milestones.
- **Dependency:** `@pragmatic-tech-ai/todl-runtime` at `^0.6.0` (adopt latest).
- **Additive, behavior-preserving for the toolbar:** the diagram toolbar's rendered output and command behavior must be unchanged; `Group`/`Presentation` responsive layout is untouched.
- Git commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Mural scripts: `npm run build` (templates + demos + tsc), `npm run typecheck`, `npm run typecheck:demos`, `npm test`, `npm run test:demo`. `pretest` builds templates automatically.

## Review Focus

- **Toggle checked-state tracks the live selection** after an active-document / selection change — the folded `IsChecked` path must update exactly where `RefreshActiveStates` did (Task 2 + Task 5 pin it).
- **A command referenced by `Id` that lives *nested*** under another command resolves via `CommandRegistry.GetById` at any depth (Task 4 pins it).
- **Both dispatch consumers** (toolbar *and* `documents-content-host-service`) invoke through `ICommandDispatcher.Resolve`, not the deleted `ICommandTarget` (Task 5 pins both).
- **A command with both static `Children` and a `ChildrenContributor`** composes declared-first (Task 3 pins the DP + merge contract; A2 exercises live expansion).
- **No `CanExecute` regression on the toolbar**: a resolved command's own `CanExecute`/`RaiseCanExecuteChanged` drives enablement; the requery pulse still fires (Task 5 pins it against the existing toolbar tests).

---

### Task 1: Adopt todl-runtime 0.6.0 + migrate Mural `Disposable` → `IDisposable`

**Files:**
- Modify: `package.json` (dep bump)
- Modify: `src/runtime/index.ts:63` (re-export)
- Modify: ~12 import sites + ~59 type-position usages across `src/**` (batch — enumerated by grep below)

**Interfaces:**
- Consumes: `@pragmatic-tech-ai/todl-runtime@0.6.0` exports `IDisposable` (type), `Disposable`, `CompositeDisposable` (classes); the old `type Disposable` export is gone.
- Produces: Mural compiles against 0.6.0; every `Disposable` *type* reference is `IDisposable`; `src/runtime/index.ts` re-exports `IDisposable` + the two classes.

- [ ] **Step 1: Bump the dependency**

In `package.json`, set `"@pragmatic-tech-ai/todl-runtime": "^0.6.0"` (currently `^0.5.x`). If the workspace uses a local symlink/`file:` for this dep, keep that form but ensure it points at the 0.6.0 build (do not silently downgrade — the 0.6.0 API is required).

- [ ] **Step 2: Fix the runtime barrel re-export**

`src/runtime/index.ts:63` currently:
```ts
export { Signal, type Disposable } from '@pragmatic-tech-ai/todl-runtime';
```
Replace with:
```ts
export { Signal, Disposable, CompositeDisposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime';
```

- [ ] **Step 3: Enumerate every stale reference**

Run:
```bash
grep -rn "type Disposable\|: Disposable\b\|Disposable\[\]\|<Disposable>\|Partial<Disposable>\|extends .*\bDisposable\b" src --include=*.ts | grep -v "IDisposable\|CompositeDisposable"
grep -rn "import .*\bDisposable\b" src --include=*.ts | grep -v "IDisposable\|CompositeDisposable"
```
Expected: the usage set (~59) and the import set (~12: `src/basic/documents/inlines.ts`, `src/framework/diagram/behaviors/format-painter-behavior.ts`, `src/framework/diagram/callout.ts`, `src/framework/diagram/collaborators/format-mirror.ts`, `selection-bounds-tracker.ts`, `selection-geometry-mirror.ts`, `src/framework/diagram/guides/persistent-guides-adorner.ts`, `src/framework/property-grid/property-item.ts`, `src/runtime/binding/effective-value.ts`, `src/runtime/index.ts`, `src/runtime/tests/observable.test.ts`, plus any direct `@pragmatic-tech-ai/todl-runtime` importers).

- [ ] **Step 4: Rewrite each site**

For every file in the import set, rename the imported `Disposable` type specifier to `IDisposable` (keep it a `type`-only import where it already is). For every usage site, rename the `Disposable` type annotation to `IDisposable`. This is a pure type rename — do **not** change any runtime behavior, and do **not** convert existing `() => void` disposer bodies here (that broad sweep is out of scope). Where a file already imports from Mural's `../runtime/index.js`, it now gets `IDisposable` from there (Step 2 re-exports it).

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: 0 errors (no dangling `Disposable` type).

Run: `grep -rn "type Disposable\|: Disposable\b\|Partial<Disposable>\|<Disposable>\|extends .*\bDisposable\b" src --include=*.ts | grep -v "IDisposable"`
Expected: no matches (the word-boundary pattern does not match `IDisposable`).

Run: `npm test`
Expected: full suite green, output pristine.

- [ ] **Step 6: Commit**

```bash
git add package.json src/
git commit -m "refactor(mural): adopt todl-runtime 0.6.0; migrate Disposable type refs to IDisposable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: New command contracts + DiagramDocument.Resolve (alongside the old target)

**Files:**
- Create: `src/framework/shell/commands/command-context.ts`
- Create: `src/framework/shell/commands/command-dispatcher.ts`
- Create: `src/framework/shell/commands/command-contributor.ts`
- Modify: `src/runtime/command.ts` (add `ICheckableCommand`)
- Modify: `src/framework/diagram/diagram-document.ts` (implement `Resolve`; keep its `ICommandTarget` methods for now)
- Test: `src/framework/diagram/tests/diagram-dispatcher.test.ts` (create)

**Interfaces:**
- Consumes: `ICommand` (`src/runtime/command.ts`), `CommandDefinition`, `ServiceToken` (todl-runtime), the diagram command id enum + `DIAGRAM_COMMAND_GETTERS`/`DIAGRAM_COMMAND_ACTIVE` maps.
- Produces:
  - `class CommandContext` (base dispatch context; `HierarchyActionContext` will extend it in Milestone B).
  - `interface ICommandDispatcher { Resolve(commandId: string, context: CommandContext): ICommand | undefined; }`
  - `interface ICommandContributor { Contribute(parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]; }`
  - `interface ICheckableCommand extends ICommand { readonly IsChecked: boolean; }` + `isCheckableCommand(c: ICommand): c is ICheckableCommand`.
  - `DiagramDocument` additionally `implements ICommandDispatcher` with `Resolve`.

- [ ] **Step 1: Write the failing test** — `src/framework/diagram/tests/diagram-dispatcher.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandContext } from '../../shell/commands/command-context.js';
import { isCheckableCommand } from '../../../runtime/command.js';
// Build a DiagramDocument with one shape selected (mirror the setup in
// diagram-command-routing.test.ts — reuse its harness/helpers).
import { makeDiagramDocumentWithSelection } from './helpers/diagram-command-harness.js';
import { DiagramCommandId } from '../diagram-command-contexts.js';

test('Resolve returns the executor command for a known id', () =>
{
    const doc = makeDiagramDocumentWithSelection();
    const cmd = doc.Resolve(DiagramCommandId.AlignLeft, new CommandContext());
    assert.notEqual(cmd, undefined);
    assert.equal(typeof cmd!.Execute, 'function');
});

test('Resolve of a toggle id yields a checkable command whose IsChecked reflects the active predicate', () =>
{
    const doc = makeDiagramDocumentWithSelection({ bold: true });
    const cmd = doc.Resolve(DiagramCommandId.TextBold, new CommandContext());
    assert.ok(cmd !== undefined && isCheckableCommand(cmd));
    assert.equal((cmd as { IsChecked: boolean }).IsChecked, true);
});

test('Resolve of an unknown id returns undefined', () =>
{
    const doc = makeDiagramDocumentWithSelection();
    assert.equal(doc.Resolve('nope.not.a.command', new CommandContext()), undefined);
});
```

If no reusable harness exists, build a minimal `helpers/diagram-command-harness.ts` in the test folder that constructs a `DiagramDocument` with a selection the way `diagram-command-routing.test.ts` already does — do not invent a new document shape; mirror the existing test setup.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --conditions=development --test src/framework/diagram/tests/diagram-dispatcher.test.ts`
Expected: FAIL — `command-context.js` / `Resolve` / `isCheckableCommand` do not exist.

- [ ] **Step 3: Add the contracts**

`src/framework/shell/commands/command-context.ts`:
```ts
// The dispatch context handed to ICommandDispatcher.Resolve. The base carries
// nothing surface-specific; concrete surfaces subtype it (the toolbar/main menu
// pass the active document + selection; Milestone B's HierarchyActionContext adds
// the anchor item + tree selection).
export class CommandContext
{
}
```

`src/framework/shell/commands/command-dispatcher.ts`:
```ts
import type { ICommand } from '../../../runtime/index.js';
import type { CommandContext } from './command-context.js';

// Resolves a command id (in some CommandContext) to the ICommand that executes
// it, already bound to that context. Replaces ICommandTarget: Execute + CanExecute
// + change-notification all travel on the returned command, and there is one
// mechanism for every surface (toolbar, main menu, hierarchy node menus).
export interface ICommandDispatcher
{
    Resolve(commandId: string, context: CommandContext): ICommand | undefined;
}
```

`src/framework/shell/commands/command-contributor.ts`:
```ts
import type { CommandDefinition } from './command-definition.js';
import type { CommandContext } from './command-context.js';

// Supplies a command's dynamic children at build time, merged AFTER its statically
// declared Children. Named by a CommandDefinition.ChildrenContributor ServiceToken;
// resolved lazily (on submenu expand) and may recurse (a produced child may carry
// its own ChildrenContributor).
export interface ICommandContributor
{
    Contribute(parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[];
}
```

In `src/runtime/command.ts`, add after the `ICommand` interface:
```ts
// A command that also carries a checked/active state (toolbar toggles, checkable
// menu items). The state is read off the command itself — it replaces
// ICommandTarget.IsActive(def). Change is signalled through the same
// CanExecuteChanged channel (consumers re-read IsChecked on that pulse).
export interface ICheckableCommand extends ICommand
{
    readonly IsChecked: boolean;
}

export function isCheckableCommand(command: ICommand): command is ICheckableCommand
{
    return typeof (command as Partial<ICheckableCommand>).IsChecked === 'boolean';
}
```

- [ ] **Step 4: Add a checkable RelayCommand + DiagramDocument.Resolve**

Add a small concrete checkable command to `src/runtime/command.ts` so the dispatcher can wrap a toggle:
```ts
// A RelayCommand that also reports a checked state via a pull predicate. IsChecked
// is re-read on demand; callers refresh on the CanExecuteChanged pulse (as the
// toolbar already does for toggle state).
export class CheckableRelayCommand extends RelayCommand implements ICheckableCommand
{
    private readonly isChecked: () => boolean;

    constructor(
        execute:    (parameter?: unknown) => void,
        canExecute: ((parameter?: unknown) => boolean) | undefined,
        isChecked:  () => boolean,
        metadata?:  CommandMetadataInit,
    )
    {
        super(execute, canExecute, metadata);
        this.isChecked = isChecked;
    }

    public get IsChecked(): boolean
    {
        return this.isChecked();
    }
}
```

In `src/framework/diagram/diagram-document.ts`, add `ICommandDispatcher` to the `implements` list and a `Resolve` method that reuses the existing getter/active maps. The underlying diagram command (`DIAGRAM_COMMAND_GETTERS.get(id)(view)`) is the executor; for a toggle id (present in `DIAGRAM_COMMAND_ACTIVE`) wrap it so `IsChecked` reads the predicate:
```ts
public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
{
    const view = this.ActiveView;
    if (view === undefined) return undefined;
    const base = DIAGRAM_COMMAND_GETTERS.get(commandId)?.(view);
    if (base === undefined) return undefined;
    const active = DIAGRAM_COMMAND_ACTIVE.get(commandId);
    if (active === undefined) return base;
    return new CheckableRelayCommand(
        (p) => base.Execute(p),
        (p) => base.CanExecute(p),
        () => active(view));
}
```
Leave the existing `Execute`/`CanExecute`/`IsActive`/`CommandContexts` methods in place (Task 5 migrates the consumers; Task 6 removes the dead target methods). Import `CommandContext`, `ICommandDispatcher`, `CheckableRelayCommand`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx --conditions=development --test src/framework/diagram/tests/diagram-dispatcher.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Full gate + commit**

Run: `npm test` and `npm run typecheck` — green / 0 errors.
```bash
git add src/framework/shell/commands/command-context.ts src/framework/shell/commands/command-dispatcher.ts src/framework/shell/commands/command-contributor.ts src/runtime/command.ts src/framework/diagram/diagram-document.ts src/framework/diagram/tests/
git commit -m "feat(mural): ICommandDispatcher/ICommandContributor/ICheckableCommand contracts + DiagramDocument.Resolve

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Hierarchical CommandDefinition (Children + ChildrenContributor)

**Files:**
- Modify: `src/framework/shell/commands/command-definition.ts`
- Modify: `src/compiler/symbol-table.ts` (`DEFAULT_SLOT_INFO`)
- Test: `src/compiler/tests/command-nesting.test.ts` (create)

**Interfaces:**
- Consumes: `ObservableCollection`, `ServiceToken`, `ICommandContributor` (Task 2), `MuralBase`.
- Produces: `CommandDefinition.Children: ObservableCollection<CommandDefinition>`, `CommandDefinition.AddChild(child)`, `CommandDefinition.ChildrenContributor: ServiceToken<ICommandContributor> | undefined`; the compiler lowers a `CommandDefinition { CommandDefinition [...] … }` body into `Children`.

- [ ] **Step 1: Write the failing test** — `src/compiler/tests/command-nesting.test.ts`

Model it on the existing `.commands:` compile fixtures in `src/compiler/tests/compile.test.ts` (reuse that harness/compile entrypoint). Compile a module whose `.commands:` block declares a parent `CommandDefinition` with a nested `CommandDefinition` body, run the emitted module, and assert the parent's `Children` holds the child and `GetById`-style flat lookup is not yet involved:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndRunModule } from './helpers/compile-harness.js'; // mirror compile.test.ts

test('a nested CommandDefinition body lowers into the parent Children collection', async () =>
{
    const mod = await compileAndRunModule(`
        module M [ Name = "M" ] {
            .commands: {
                CommandDefinition [ Id = "build", Title = "Build" ] {
                    CommandDefinition [ Id = "build.default", Title = "Build (Default)" ]
                }
            }
        }
    `);
    const parent = [...mod.Commands][0];
    assert.equal(parent.Id, 'build');
    assert.equal(parent.Children.length ?? parent.Children.Count, 1);
    assert.equal([...parent.Children][0].Id, 'build.default');
});
```
(Use the collection's real length accessor as the compile harness exposes it — check `ObservableCollection`'s surface and match it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/compiler/tests/command-nesting.test.ts`
Expected: FAIL — `Children` undefined / the body has nowhere to lower (no `DEFAULT_SLOT_INFO` entry, no `AddChild`).

- [ ] **Step 3: Add `Children` + `AddChild` + `ChildrenContributor` to CommandDefinition**

In `src/framework/shell/commands/command-definition.ts`, add imports for `ObservableCollection` and `type ServiceToken`, `type ICommandContributor`, then add to the class:
```ts
// Nested child commands — a menu/submenu tree. Populated from a `.commands:` or
// Hierarchy-DSL body (the markup content collection) and merged at build time with
// any ChildrenContributor output. Orthogonal to Group/Presentation (responsive
// toolbar layout); these are structural submenu children.
public readonly Children: ObservableCollection<CommandDefinition> =
    new ObservableCollection<CommandDefinition>();

// The markup content collection: a `CommandDefinition { … }` body lowers to
// AddChild per nested element (see DEFAULT_SLOT_INFO['CommandDefinition']).
public AddChild(child: CommandDefinition): void
{
    this.Children.Add(child);
}

// Names an ICommandContributor that supplies this command's children at build
// time (merged after Children). A ServiceToken DP — same precedent as
// HierarchyContributorDefinition.Contributor; resolved lazily on submenu expand.
public static readonly ChildrenContributorKey = MuralBase.RegisterProperty<ServiceToken<ICommandContributor> | undefined>(
    CommandDefinition, 'ChildrenContributor', undefined, MetaData.None);

public get ChildrenContributor(): ServiceToken<ICommandContributor> | undefined  { return this.get_property_value(CommandDefinition.ChildrenContributorKey); }
public set ChildrenContributor(v: ServiceToken<ICommandContributor> | undefined) { this.set_property_value(CommandDefinition.ChildrenContributorKey, v); }
```

- [ ] **Step 4: Register the content collection in the compiler**

In `src/compiler/symbol-table.ts`, add to `DEFAULT_SLOT_INFO` (near the other `kind: 'list'` entries):
```ts
['CommandDefinition', { name: 'Children', kind: 'list' }],
```
No other compiler change is needed: `kind: 'list'` emits `parent.AddChild(child)` generically, and `ChildrenContributor = SomeContributor` compiles through the existing bare-class-reference ident path (a class constructor already satisfies `ServiceToken`). Confirm the referenced contributor class, when used in a real `.mu`, is in `DEFAULT_SYMBOLS` — but no symbol change is required for `CommandDefinition` itself (already registered).

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/compiler/tests/command-nesting.test.ts`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

Run: `npm test` (runs `pretest` build:templates first), `npm run typecheck` — green / 0.
```bash
git add src/framework/shell/commands/command-definition.ts src/compiler/symbol-table.ts src/compiler/tests/
git commit -m "feat(mural): CommandDefinition.Children + ChildrenContributor (hierarchical commands)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: CommandRegistry indexes every node by Id at any depth

**Files:**
- Modify: `src/framework/shell/commands/command-registry.ts`
- Test: `src/framework/shell/tests/command-registry-nesting.test.ts` (create)

**Interfaces:**
- Consumes: `CommandDefinition.Children` (Task 3).
- Produces: `CommandRegistry.GetById(id)` resolves a command at any depth; the top-level `Commands` collection still holds only roots; dedupe-by-Id spans the whole tree.

- [ ] **Step 1: Write the failing test** — `src/framework/shell/tests/command-registry-nesting.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRegistry } from '../commands/command-registry.js';
import { CommandDefinition } from '../commands/command-definition.js';
// Build a registry over a fake module exposing a Commands collection with one
// parent that has a nested child. Mirror the module-stub pattern in
// command-registry's existing tests if present; otherwise construct minimally.
import { makeRegistryOver } from './helpers/command-registry-harness.js';

test('GetById resolves a nested child command', () =>
{
    const parent = new CommandDefinition(); parent.Id = 'build'; parent.Title = 'Build';
    const child  = new CommandDefinition(); child.Id = 'build.default'; child.Title = 'Default';
    parent.AddChild(child);
    const registry = makeRegistryOver([parent]);
    registry.PopulateFromModules();
    assert.equal(registry.GetById('build.default')?.Id, 'build.default');
    assert.equal(registry.GetById('build')?.Id, 'build');
});

test('the flat Commands collection holds only roots, not nested children', () =>
{
    const parent = new CommandDefinition(); parent.Id = 'build';
    const child  = new CommandDefinition(); child.Id = 'build.default';
    parent.AddChild(child);
    const registry = makeRegistryOver([parent]);
    registry.PopulateFromModules();
    const roots = [...registry.Commands].map(c => c.Id);
    assert.deepEqual(roots, ['build']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test src/framework/shell/tests/command-registry-nesting.test.ts`
Expected: FAIL — `GetById('build.default')` is `undefined` (registry indexes only top-level defs today).

- [ ] **Step 3: Make `addDefinition` recurse into Children (index all; collection = roots)**

In `src/framework/shell/commands/command-registry.ts`, keep `PopulateFromModules` iterating `module.Commands` but split indexing from the roots collection:
```ts
private addDefinition(definition: CommandDefinition): void
{
    this.indexTree(definition);           // index this node + every descendant by Id
    if (this._byId.get(definition.Id) === definition)
    {
        this.Commands.Add(definition);    // only a winning ROOT enters the flat collection
    }
}

// Index a definition and all its Children by Id (first writer wins, matching the
// existing top-level dedupe). Nested ids become GetById-resolvable at any depth.
private indexTree(definition: CommandDefinition): void
{
    if (definition.Id !== '' && !this._byId.has(definition.Id))
    {
        this._byId.set(definition.Id, definition);
    }
    for (const child of definition.Children)
    {
        this.indexTree(child);
    }
}
```
Note: the old guard `if (definition.Id === '' || this._byId.has(definition.Id)) return;` is replaced — a root with an empty Id or a duplicate root must still not enter `Commands`, which the `=== definition` check preserves (an already-present id means `_byId.get` returns the earlier instance, so this root is skipped). Keep `GetById` unchanged (flat `Map.get`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test src/framework/shell/tests/command-registry-nesting.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Full gate + commit**

Run: `npm test`, `npm run typecheck` — green / 0.
```bash
git add src/framework/shell/commands/command-registry.ts src/framework/shell/tests/
git commit -m "feat(mural): CommandRegistry indexes nested command ids; roots-only in Commands

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Migrate both dispatch consumers to ICommandDispatcher.Resolve

**Files:**
- Modify: `src/framework/shell/commands/toolbar-service.ts`
- Modify: `src/framework/shell/services/documents-content-host-service.ts`
- Test: existing `src/framework/shell/tests/toolbar-service.test.ts`, `src/framework/diagram/tests/diagram-toolbar-command-e2e.test.ts`, `diagram-command-routing.test.ts`, `diagram-toolbar-composition.test.ts` must stay green; add one dispatcher-path assertion to `toolbar-service.test.ts`.

**Interfaces:**
- Consumes: `ICommandDispatcher`, `CommandContext`, `isCheckableCommand` (Task 2).
- Produces: both consumers resolve the executor via the active document as `ICommandDispatcher` and bind it; toggle checked-state reads `ICheckableCommand.IsChecked`. `ICommandTarget` is still referenced only by the about-to-be-deleted guard (removed in Task 6).

- [ ] **Step 1: Toolbar — resolve instead of forward-to-target**

In `toolbar-service.ts`:
- Add a private `ActiveDispatcher(): ICommandDispatcher | undefined` mirroring `ActiveTarget()` but duck-typing on a `Resolve` method, and a private `Context(): CommandContext` returning a `new CommandContext()` (the toolbar's context is the active document; the base context suffices until Milestone B enriches it).
- Change `VmFor` (lines 493-508) so the cached command resolves through the dispatcher. Keep a stable forwarding `RelayCommand` (the VM is long-lived while the active document changes), but forward to `Resolve`:
```ts
const command = new RelayCommand(
    () => this.ActiveDispatcher()?.Resolve(def.Id, this.Context())?.Execute(),
    () => this.ActiveDispatcher()?.Resolve(def.Id, this.Context())?.CanExecute() ?? false,
    { Text: def.Title });
```
- Delete `Invoke`/`CanInvoke` (lines 510-518) — now inlined above.
- Change `RefreshActiveStates` (lines 480-487) to read checked-state from the resolved command rather than the target's `IsActive`:
```ts
private RefreshActiveStates(): void
{
    const dispatcher = this.ActiveDispatcher();
    const ctx = this.Context();
    for (const vm of this._vmById.values())
    {
        const resolved = dispatcher?.Resolve(vm.Definition.Id, ctx);
        vm.IsActive = resolved !== undefined && isCheckableCommand(resolved) ? resolved.IsChecked : false;
    }
}
```
(The VM property is still named `IsActive` until Task 6 renames it to `IsChecked`.)

- [ ] **Step 2: Editor-actions consumer — same switch**

In `documents-content-host-service.ts`, `rebuildExtendedCommands` (lines 161-173) and `commandTarget` (176-182): replace the `commandTarget()?.Execute(def)` / `CanExecute(def)` forwarding with dispatcher resolution. Rename `commandTarget()` to `activeDispatcher()` returning the active document when it has a `Resolve` method, and:
```ts
const command = new RelayCommand(
    () => this.activeDispatcher()?.Resolve(def.Id, new CommandContext())?.Execute(),
    () => this.activeDispatcher()?.Resolve(def.Id, new CommandContext())?.CanExecute() ?? false,
    { Text: def.Title });
```
Import `CommandContext`, `type ICommandDispatcher`. Drop the `isCommandTarget` import here.

- [ ] **Step 3: Add a dispatcher-path assertion**

In `toolbar-service.test.ts`, add a test: with a fake active document exposing `Resolve(id, ctx)` returning a spy `RelayCommand`, building the toolbar and invoking a command VM's `Command.Execute()` calls through `Resolve` (not the old `Execute(def)`), and a `CheckableRelayCommand` with `IsChecked=true` makes the VM's `IsActive` true after `RefreshActiveStates`. Model the fake-document setup on the existing toolbar-service test fakes.

- [ ] **Step 4: Run to verify RED then GREEN**

Run the new assertion first (expect it to fail before Steps 1-2 are complete if written first; otherwise run after). Then:
Run: `npx tsx --conditions=development --test src/framework/shell/tests/toolbar-service.test.ts src/framework/diagram/tests/diagram-toolbar-command-e2e.test.ts src/framework/diagram/tests/diagram-command-routing.test.ts src/framework/diagram/tests/diagram-toolbar-composition.test.ts`
Expected: all green — the diagram toolbar's behavior is unchanged (it now dispatches via `Resolve`, but `DiagramDocument.Resolve` returns the same commands its `Execute(def)` forwarded to).

- [ ] **Step 5: Full gate + commit**

Run: `npm test`, `npm run typecheck`, `npm run typecheck:demos` — green / 0.
```bash
git add src/framework/shell/commands/toolbar-service.ts src/framework/shell/services/documents-content-host-service.ts src/framework/shell/tests/
git commit -m "refactor(mural): toolbar + editor-actions dispatch via ICommandDispatcher.Resolve

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Unified Observable CommandViewModel + delete ICommandTarget

**Files:**
- Modify: `src/framework/shell/commands/command-view-model.ts`
- Modify: `src/framework/shell/shell.template.mu` (toggle template binding)
- Modify: `src/framework/shell/commands/toolbar-service.ts` (`IsActive` → `IsChecked` rename at the one call site)
- Modify: `src/framework/shell/commands/command-target.ts` (delete) + its imports
- Modify: `src/framework/diagram/diagram-document.ts` (remove dead `Execute`/`CanExecute`/`IsActive`/`CommandContexts`-as-target)
- Test: existing suites stay green; add a VM test.

**Interfaces:**
- Consumes: `Observable`, `ICheckableCommand`, resolved commands.
- Produces: `CommandViewModel extends Observable` with `Definition`, `Command`, `Children: ObservableCollection<CommandViewModel>`, `IsToggle: boolean`, `IsChecked: boolean`, implementing `IDisposable`; `CommandToggleViewModel extends CommandViewModel {}` (thin marker, template-selection only — see ruling); `ICommandTarget`/`isCommandTarget` deleted.

- [ ] **Step 1: Rewrite CommandViewModel on Observable** — `src/framework/shell/commands/command-view-model.ts`

```ts
import { Observable, type IDisposable, CompositeDisposable } from '../../../runtime/index.js';
import type { ICommand } from '../../../runtime/index.js';
import type { Geometry } from '../../../visual-engine/index.js';
import type { CommandDefinition } from './command-definition.js';
import { ObservableCollection } from '../../../runtime/index.js';

// One bindable command view-model for every surface (toolbar button, menu row).
// Observable (not MuralBase) — a menu rebuilds this per open and a tree can be
// deep. Children is empty for a flat toolbar item, populated for a menu node.
export class CommandViewModel extends Observable implements IDisposable
{
    private readonly subscriptions = new CompositeDisposable();
    private checked = false;

    public readonly Children: ObservableCollection<CommandViewModel> = new ObservableCollection<CommandViewModel>();

    constructor(
        public readonly Definition: CommandDefinition,
        public readonly Command: ICommand,
        public readonly IsToggle: boolean = false,
    )
    {
        super();
    }

    public get Title(): string { return this.Definition.Title; }
    public get Icon(): Geometry | undefined { return this.Definition.Icon; }
    public get SeparatorBefore(): boolean { return this.Definition.SeparatorBefore; }
    public get HasChildren(): boolean { return this.Children.length > 0 || this.Definition.ChildrenContributor !== undefined; }

    public get IsChecked(): boolean { return this.checked; }
    public set IsChecked(v: boolean)
    {
        if (this.checked === v) return;
        this.checked = v;
        this.RaisePropertyChanged('IsChecked');
    }

    public dispose(): void
    {
        for (const child of this.Children) child.dispose();
        this.Children.Clear();
        this.subscriptions.dispose();
    }
}

// RULING (see plan handoff): kept as a thin marker ONLY so shell.template.mu can
// select the toggle template by DataType. Carries no logic; the toggle STATE lives
// in CommandViewModel.IsChecked. Removable later via an ItemTemplateSelector.
export class CommandToggleViewModel extends CommandViewModel { }
```
Match `Observable`'s actual `RaisePropertyChanged` signature (check `src/runtime/observable.ts` / how `HierarchyItemVM` raises) — use the same form the codebase uses (the property-name string overload). Use `this.Children.length` or `.Count` to match `ObservableCollection`'s real accessor.

- [ ] **Step 2: Keep the `VmFor` toggle construction, rename the state write**

In `toolbar-service.ts`, `VmFor` still builds `CommandToggleViewModel` vs `CommandViewModel` by `isToggle` and now passes `isToggle` to the ctor's third arg too:
```ts
vm = isToggle
    ? new CommandToggleViewModel(def, command, true)
    : new CommandViewModel(def, command, false);
```
In `RefreshActiveStates`, the write `vm.IsActive = …` becomes `vm.IsChecked = …`.

- [ ] **Step 3: Update the toggle template binding** — `shell.template.mu:277-281`

Change `IsChecked = $IsActive` to `IsChecked = $IsChecked`:
```
DataTemplate [DataType = CommandToggleViewModel] {
    ToolBarToggleButton [ Command = $Command, IsChecked = $IsChecked ] {
        Shape [ Geometry = $Definition.Icon, Width = 16, Height = 16 ]
    }
}
```
Leave the `DataType = CommandViewModel` / `CommandMenuRowTemplate` / `CommandGridButtonTemplate` templates as-is.

- [ ] **Step 4: Delete the dead target contract**

- Delete `src/framework/shell/commands/command-target.ts`.
- Remove `ICommandTarget` from `DiagramDocument`'s `implements` list and delete its now-unused `Execute(definition)`, `CanExecute(definition)`, `IsActive(definition)` methods and the target-only `get CommandContexts()` IF nothing else reads it (grep: `DIAGRAM_COMMAND_CONTEXTS`/`CommandContexts` — the toolbar no longer calls `target.CommandContexts`; confirm the context-filter in `toolbar-service` still has a source. If the toolbar's context filter relied on `target.CommandContexts`, preserve that read by exposing the contexts through a small `CommandContexts` getter the toolbar reads directly from the active document, or keep `CommandContexts` on the document as a plain getter — do NOT break the context filter. Resolve this concretely: keep `DiagramDocument.CommandContexts` as a plain getter the toolbar reads; only the `Execute/CanExecute/IsActive` target methods are deleted.)
- Remove `isCommandTarget` imports/usages (toolbar-service `ActiveTarget` is replaced by `ActiveDispatcher` from Task 5; delete the leftover `ActiveTarget` + `isCommandTarget` import).
- Grep `grep -rn "ICommandTarget\|isCommandTarget" src` → only test fakes may remain; update those fakes to expose `Resolve` instead (the toolbar-service/content-host test fakes).

- [ ] **Step 5: VM test**

Add `src/framework/shell/tests/command-view-model.test.ts`: a `CommandViewModel` is an `Observable`; `IsChecked` raises property-changed; `dispose()` disposes children recursively and is idempotent; `HasChildren` reflects `Children`/`ChildrenContributor`.

- [ ] **Step 6: Run RED→GREEN + full gate**

Run the VM test (RED before Step 1, GREEN after). Then:
Run: `npm test`, `npm run typecheck`, `npm run typecheck:demos`, `npm run test:demo` — all green / 0.
Run: `grep -rn "ICommandTarget\|isCommandTarget\|\.IsActive(" src` — no production matches remain.

- [ ] **Step 7: Commit**

```bash
git add src/framework/shell/commands/ src/framework/shell/shell.template.mu src/framework/diagram/diagram-document.ts src/framework/shell/tests/ src/framework/shell/services/
git commit -m "refactor(mural): unified Observable CommandViewModel; delete ICommandTarget

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes (controller)

- **Spec coverage (A1 portion of the A spec):** A1 (Disposable) → Task 1; A2 (hierarchical CommandDefinition) → Task 3; A3 (ICommandDispatcher replaces ICommandTarget) → Tasks 2,5,6; A4 (ICommandContributor) → Task 2 (interface) + Task 3 (ChildrenContributor DP); A5 (toggle → IsChecked) → Tasks 2,5,6; A6 (unified Observable VM) → Task 6; A7 (toolbar migration) → Tasks 5,6. **A8 (menu rendering) + A9 compiler nesting-for-menus authoring + main-menu demo are A2, not this plan.** The registry recursion (needed for Id-resolution at depth) is Task 4.
- **Deferred to A2:** the `HierarchicalDataTemplate` menu glue, `ContextMenu`/`MenuItem` rendering a `CommandViewModel` tree, live `ChildrenContributor` expansion on submenu open, and the main-menu demo.
- **Open ruling for the handoff:** `CommandToggleViewModel` kept as a thin marker (Task 6) rather than deleted — overturnable with an `ItemTemplateSelector`.
