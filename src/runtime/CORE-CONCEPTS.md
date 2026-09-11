# Core concepts — what they are and where they live

The single source of truth for the foundational types shared across the stack.
Before defining a new base type, check here: if a concept already exists in a
lower layer, **import or re-export it — never redefine it**. (The `Disposable`
duplication that shipped a `Dispose()`/`dispose()` split is exactly what this
registry exists to prevent.)

## Layering

```
todl-runtime  (zero-dep primitives)  ←  Mural  (runtime foundation)  ←  Plexus / TODL-app
```

A concept defined in a lower layer must not be re-declared in a higher one.
The dependency arrow points left: Mural depends on todl-runtime, never the
reverse. todl-runtime pulls in neither Mural nor the `@pragmatic-tech-ai/todl`
compiler.

## Layer 0 — todl-runtime primitives (canonical, zero-dep)

Defined once in `todl-runtime`. `mural/runtime` re-exports every one of these
purely so a Mural consumer needs a single import path — the **canonical source
is always `@pragmatic-tech-ai/todl-runtime`**.

| Concept | Defined in | Import from |
|---|---|---|
| `Observable` | `todl-runtime/src/observable.ts` | `@pragmatic-tech-ai/todl-runtime` · or `@pragmatic-tech-ai/mural/runtime` |
| `PropertyChangedEventArgs` | `todl-runtime/src/observable.ts` | same |
| `Signal<T>` | `todl-runtime/src/signal.ts` | same |
| `Disposable` (`{ dispose(): void }`) | `todl-runtime/src/signal.ts` | same |
| `IStorage`, `StorageEntry`, `ILocalFileAccess`, `isLocalFileAccess`, `compareStorageEntries` | `todl-runtime/src/storage/storage.ts` | same |
| `FakeStorage` | `todl-runtime/src/storage/fake-storage.ts` | same |
| `copyTree` | `todl-runtime/src/storage/copy-tree.ts` | same |

`Observable` is the shared `INotifyPropertyChanged` root: TODL's emitter emits
`class <Concept> extends Observable`, and `MuralBase extends Observable`, so a
generated TODL node and a Mural visual share **one** `Observable` identity.

`Disposable` is the one teardown/subscription handle for the whole stack —
`Signal.subscribe()` returns it, and the DI container's structural teardown
calls `dispose()` on it. There is no PascalCase `Dispose()`.

## Layer 1 — Mural runtime foundation

Built on Layer 0; defined in Mural and exported from
`@pragmatic-tech-ai/mural/runtime` (barrel: [`index.ts`](index.ts)).

| Concept | Defined in | Import from |
|---|---|---|
| `MuralBase`, `PropertyKey` | `Mural/src/runtime/model.ts` | `@pragmatic-tech-ai/mural/runtime` |
| `MetaData` (+ `affectsMeasure`/`affectsArrange`/`affectsRender`/`inherits`/…) | `Mural/src/runtime/metadata.ts` | `@pragmatic-tech-ai/mural/runtime` |
| `PropertyDescriptor`, `PropertyMetadata`, `CoerceValue`, `ValidateValue`, `ValidateTarget` | `Mural/src/runtime/property-descriptor.ts` | `@pragmatic-tech-ai/mural/runtime` |
| Binding family — `Binding`, `BindingMode`, `EffectiveValueDescriptor`, `SelfBinding`, `AncestorBinding`, `DataContextBinding`, `ElementNameBinding`, `MultiBinding`, `MultiTemplateBinding`, `TemplateBinding`, `ServiceBinding`, `PriorityBinding`, `DynamicResource`, converters (`Is`/`ToVisibility`/`Lighten`/…) | `Mural/src/runtime/binding/*` | `@pragmatic-tech-ai/mural/runtime` |
| `ObservableCollection`, `IReadOnlyObservableCollection` | `Mural/src/runtime/observable-collection.ts` | `@pragmatic-tech-ai/mural/runtime` |
| `ServiceProvider`, `ServiceKey`, `IServiceProvider` | `Mural/src/runtime/services/service-provider.ts` | `@pragmatic-tech-ai/mural/runtime` |
| `ServiceBase` | `Mural/src/runtime/services/service-base.ts` | `@pragmatic-tech-ai/mural/runtime` |
| `Freezable`, `cloneFreezableValue` | `Mural/src/runtime/freezable.ts` | `@pragmatic-tech-ai/mural/runtime` |

### Notes on a few relationships

- **`MuralBase` vs `Observable`.** `MuralBase` adds the dependency-property
  system (registration, coercion, validation, inheritance) on top of
  `Observable`'s plain-property INPC. New view models default to `Observable`;
  reserve `MuralBase` for things that genuinely need the DP system.
- **Change notification is Signal-only.** `Observable.PropertyChanged(name)`
  and `MuralBase.PropertyChanged(nameOrKey)` return a
  `Signal<PropertyChangedEventArgs>`; subscribe and keep the `Disposable`.
- **Services are structural.** `ServiceProvider` disposes a cached instance by
  duck-typing `dispose()`; a service need not extend `ServiceBase` to be torn
  down, it just needs the method.
