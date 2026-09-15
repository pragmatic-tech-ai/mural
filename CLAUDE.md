# CLAUDE.md

## Work tracking

All work — tasks, features, bugs, and design notes — is tracked in the GitHub
Project **Architecture Agentic Suite** (org `pragmatic-tech-ai`, project number
`1`). Work descriptions, backlogs, and TODO lists are **not** stored in local
files anymore. Read and update the backlog with the `gh` CLI:

- List items: `gh project item-list 1 --owner pragmatic-tech-ai`
- Add an item: `gh project item-create 1 --owner pragmatic-tech-ai --title "…" --body "…"`

When you finish or pick up work, reflect it in the Project rather than a local
note.

**Specs & plans too.** Design specs and implementation plans (superpowers
`brainstorming` / `writing-plans` output) live in the Project, not under
`docs/superpowers/`. Create each as an item with the **Kind** field
(`PVTSSF_lADOE0Zc984Biu4ozhhmtQM`) set to `Spec` or `Plan`. The CLI `--body`
overflows Windows' arg limit on large docs — create via GraphQL, reading the
body from a file:
`gh api graphql -f query='mutation($p:ID!,$t:String!,$b:String!){addProjectV2DraftIssue(input:{projectId:$p,title:$t,body:$b}){projectItem{id}}}' -f p=PVT_kwDOE0Zc984Biu4o -f t="[Repo] title" -F b=@file.md`.

## Workflow

- The `superpowers` skills are enabled here. Use brainstorming,
  writing-plans, executing-plans, systematic-debugging, etc. as they apply.

## Testing

- **Every test file lives in a `tests/` subfolder next to the code it
  exercises** — `src/basic/tests/text-box.test.ts`, never
  `src/basic/text-box.test.ts`. The runner globs `src/**/*.test.ts` either way,
  so this is organizational: keep source directories free of test files.

## Architecture

- **List-based controls descend from `ItemsControl`.** Use its overrides
  (`GetContainerForItemOverride`, `PrepareContainerForItemOverride`,
  `ClearContainerForItemOverride`) for control-specific containers and
  behavior. `ListBox`, `TreeView`, `ComboBox` are grandfathered.

- **Every control MUST have a default Style.** No
  `Application.ResolveDefaultResource(stringKey)` or `resolveXxxTemplate`
  helpers from a control's ctor. Every template a control needs is a
  `ControlTemplate` DP (`Template`, `RowTemplate`, `TriggerTemplate`, …)
  set on the control's default Style block in a `*.template.mu` file.
  The ctor calls `applyDefaultStyle()` then reads the DPs. Undefined at
  use time means the surface theme wasn't registered — fix the bundle
  wiring, don't paper over with a string lookup.

## Enums over string-literal unions

- **A fixed set of named string values MUST be a TypeScript `enum`, never a
  string-literal union type and never bare string literals at use sites.**
  `Strategy: 'tunnel' | 'bubble'` → `enum RoutingStrategy { Tunnel = 'tunnel',
  Bubble = 'bubble' }` and `Strategy: RoutingStrategy`. This covers every
  option / mode / strategy / lifetime / variant / kind type. No
  `type X = 'a' | 'b'`, no `param: 'a' | 'b'`, no `x === 'a'` against a raw
  literal — reference `X.A`.

- **Enum shape.** Members are PascalCase. Give explicit string values (usually
  the old literal: `Tunnel = 'tunnel'`) so the wire form is stable and
  debuggable, and so an existing string-keyed call site keeps working during
  migration. The enum lives next to the API that consumes it.

- **Markup-facing enums** (authors write the member in `.mu`) must also be
  registered in the compiler's `ENUM_MEMBERS` + `DEFAULT_SYMBOLS`
  ([symbol-table.ts](src/compiler/symbol-table.ts)) — same as
  `HorizontalAlignment`, `Orientation`, etc. Internal-only enums don't need
  that wiring.

- This is the value-level sibling of the no-string-type-proxies rule (type
  references are real class `Function` values; option values are real enum
  members) — strings never stand in for either.

## Cross-class internals

Tool of last resort. Reach for the architectural fix first: promote the
method to real `public` API, restructure the caller into the class
hierarchy so `protected` is enough, or inject the capability through a
collaborator. Only if all three are genuinely impossible does the
internals-access escape hatch apply.

- **If you must reach in, declare an interface and cast through it.**
  Bracket access (`Other['_method']`) bypasses the typechecker and
  silently breaks on rename. A named interface gives the call typed
  shape and turns each access site into something greppable.

- **Example pattern** ([input-manager.ts:583-590](src/framework/input-manager.ts#L583-L590)):
  ```ts
  interface VisualWithDp {
      _set_property_value_by_name(name: string, value: unknown): void;
  }
  function setIsMouseOver(v: Visual, value: boolean): void {
      (v as unknown as VisualWithDp)._set_property_value_by_name('IsMouseOver', value);
  }
  ```
  The cast is the cost of using the hatch — visible, greppable, easy to
  audit out later.

- **Share within mural, never export from the package.** Multiple
  internal modules MAY import the same interface — better than each
  re-declaring a slightly-different shape. What's forbidden is the
  interface reaching mural's published API: not in any barrel
  re-export, not under any [package.json](package.json) `exports`
  entry. Library consumers must not see it.

## View models extend Observable

New view-model classes derive from `Observable` (the lightweight INPC root),
not `MuralBase`. Reserve `MuralBase` for the few things that genuinely need the
dependency-property system. Default a VM to `Observable` unless told otherwise.

## MVVM

Apply to `*-vm.mts` files under `demo/demos/` (any remaining `*-vm.mjs`
too). Not framework, controls, or behaviors.

Demo logic (view-models, services, behaviors, helpers) is authored in
**TypeScript** as `.mts` and compiled in place to `.mjs` by
`npm run build:demos:ts` (config: [demo/tsconfig.json](demo/tsconfig.json),
which type-checks against the library's published `dist/**/*.d.ts`). The
emitted `.mjs` is what the browser / `.mu` / bootstrap load — keep import
specifiers pointing at `.mjs`. Thin bootstrap `*.mjs` entry files stay
plain JS. Run `npm run typecheck:demos` to check demos without a full build.

- **No view-tree reads.** No `view.FindName`, `visualChildren[N]`,
  `Generator.ContainerFromItem`, `templatedParent`. View publishes state
  via bindings / routed events the VM subscribes to from outside the
  tree.
- **No view-layer imports.** Permitted: `mural/runtime`
  (DPs, bindings, ICommand, ObservableCollection, primitives, routed
  event TYPES). Forbidden: `Basic`, `visual-engine`, any host target. No
  `Border`, `Canvas`, `Line`, `SolidColorBrush`, `Color` in VM code.
- **View-observable state lives on DPs.** No closure variables, no
  plain fields for state a view might read or react to. Plain fields
  only for genuinely view-invisible state (timers, IDs, unsubscribes,
  caches).
- **No Visual mutation, no routed-event listeners on Visuals.** View
  reactions go through Style triggers, DataTemplate triggers, Storyboards.
  Input goes through markup routed-event triggers wired to VM ICommands
  or methods. Can't express it that way → Behavior.
- **No host globals.** No `document`, `window`, `navigator`, no
  `setTimeout` outliving one function call. Keyboard → markup
  triggers → commands. Persistence / network → injected service.
- **No Visual construction.** No `new Border()`, `canvas.AddChild`. State
  the view needs goes on the VM as DPs; the view declares the Visual and
  binds it. Dynamic shape that won't fit templates → Behavior.

**Escape hatch.** If a rule blocks the task, STOP and flag the framework
gap (missing Behavior system, service abstraction, trigger type). Don't
silently break a rule.

## Behaviors

Third leg of MVVM (V / VM / B). Absorb view-layer concerns that don't
fit markup triggers or bindings.

- **Location.** Demo-local: `demo/demos/<demo>/behaviors/*-behavior.mts`.
  Promote to `src/Basic/behaviors/` only when ≥ 2 demos need it.
- **Shape.** Export `attachThing(visual, vmOrConfig)` returning a
  mandatory `detach` thunk.
- **MAY do what VMs CAN'T.** `FindName`, `visualChildren[N]`,
  `AddRoutedEventListener`, Visual mutation, Visual construction — all
  fair game.
- **MUST NOT hold domain state.** Selection, items, mode flags belong
  on the VM. Behaviors hold view-only transient state.
- **Translate view events into VM writes.** Output is VM DP updates or
  command invocations. Business logic belongs on the VM.
- **MUST be detachable.** `detach` removes every listener, clears every
  timer.
- **Wired from the bootstrap.** Demo's `*.mjs` entry point calls
  `attachFoo` after view materialization. The VM never imports a
  behavior.

**Promote vs. extend the framework.** Same pattern in 3 demos →
candidate for a framework primitive (trigger action, attached property,
Control) or a shared behavior in `src/Basic/behaviors/`. Copy-pasted
behavior across demos is a framework-gap signal.
