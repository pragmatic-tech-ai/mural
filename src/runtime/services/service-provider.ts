// Application-services composition. A small, explicit DI container:
// register service implementations against tokens, resolve them by
// token, compose deps through factories, and layer per-scope overrides
// via child providers. No reflection / decorators / auto-wiring — TS
// has no runtime type metadata, so factories name their own deps. This
// keeps wiring greppable and the no-string-type-proxies rule intact
// (tokens are real objects, never strings).
//
// Three lifetimes (mirroring the .NET container vocabulary):
//   * singleton — one instance, cached at the provider where it was
//     REGISTERED, shared by that provider and every scope beneath it.
//   * transient — a fresh instance on every resolve; never cached.
//   * scoped    — one instance per resolving scope (per provider in the
//     parent/child chain); each createScope() gets its own.
//
// Resolution walks the parent chain to find a registration, then
// applies the lifetime caching rule. Child providers may shadow a
// parent's registration (Angular-style hierarchical injectors).

import type { Disposable } from '@pragmatic-tech-ai/todl-runtime';

// A typed token for interface-shaped contracts that have no runtime
// class to key by (e.g. the DiagramStorage duck-type). The generic is
// phantom — it threads the resolved type through register/get so call
// sites stay type-safe at zero runtime cost. A real exported object,
// never a string.
export class ServiceKey<T>
{
    // Phantom marker — never read at runtime; exists only so TypeScript
    // can carry T from the token to register()/get() call sites.
    declare readonly __service_type__: T;

    constructor(public readonly description: string) { }

    public toString(): string { return `ServiceKey(${this.description})`; }
}

// A class reference usable directly as a token: the class is both the
// key and (typically) the resolved type. Abstract or concrete.
export type ServiceConstructor<T> = abstract new (...args: never[]) => T;

// Either token form — both are object identities, so they key a Map.
export type ServiceToken<T> = ServiceKey<T> | ServiceConstructor<T>;

// Builds a service, resolving its own dependencies from the provider it
// is handed (the owner for singletons, the resolving scope otherwise).
export type ServiceFactory<T> = (provider: ServiceProvider) => T;

// The consumer-facing slice of the container — resolve only. This is the
// contract every service constructor receives (`new Impl(provider)`): a
// service resolves its own collaborators but cannot re-register or spawn
// scopes through it. ServiceProvider implements it; the narrow type keeps
// service code from reaching back into container mutation.
export interface IServiceProvider
{
    get<T>(token: ServiceToken<T>): T | undefined;
    getRequired<T>(token: ServiceToken<T>): T;
    has(token: ServiceToken<unknown>): boolean;
}

// The composition-facing slice of the container — register + lifecycle.
// This is the surface used to BUILD a provider: register implementations
// against tokens, derive a child scope, tear a scope down. Orthogonal to
// IServiceProvider's resolve surface — ServiceProvider implements BOTH, so
// the same object both composes and resolves, but a collaborator can ask
// for just the half it needs. Registration methods return IServiceContainer
// so calls chain (`c.register(a, …).registerInstance(b, …)`).
export interface IServiceContainer
{
    register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>, lifetime?: ServiceLifetime): IServiceContainer;
    registerInstance<T>(token: ServiceToken<T>, instance: T): IServiceContainer;
    registerScoped<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): IServiceContainer;
    registerTransient<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): IServiceContainer;
    addInstance<T extends object>(instance: T): IServiceContainer;
    // A child scope — itself a full container (register scoped overrides) and
    // provider (resolve). The concrete return is a ServiceProvider, so a
    // caller holding the class keeps both halves.
    createScope(): IServiceContainer;
    // Tear down THIS scope: dispose() every instance it owns, then clear.
    dispose(): void;
}

export enum ServiceLifetime
{
    Singleton = 'singleton',
    Transient = 'transient',
    Scoped    = 'scoped',
}

interface Registration
{
    lifetime: ServiceLifetime;
    factory:  ServiceFactory<unknown>;
}

export class ServiceProvider implements IServiceProvider, IServiceContainer
{
    // token identity → registration / cached instance. Kept on each
    // provider so a child can both shadow registrations and own its own
    // scoped/singleton instances.
    private readonly _registrations = new Map<object, Registration>();
    private readonly _cache         = new Map<object, unknown>();
    private readonly _parent:        ServiceProvider | undefined;

    constructor(parent?: ServiceProvider)
    {
        this._parent = parent;
    }

    // ── Registration ────────────────────────────────────────────────

    // Register a factory under a token. Default lifetime is singleton
    // (the common case for app services). Returns `this` for chaining.
    public register<T>(
        token:     ServiceToken<T>,
        factory:   ServiceFactory<T>,
        lifetime:  ServiceLifetime = ServiceLifetime.Singleton,
    ): this
    {
        this._registrations.set(token, { lifetime, factory: factory as ServiceFactory<unknown> });
        return this;
    }

    // Register an already-built instance (eager singleton). The same
    // object is returned for every resolve at this provider and below.
    public registerInstance<T>(token: ServiceToken<T>, instance: T): this
    {
        return this.register(token, () => instance, ServiceLifetime.Singleton);
    }

    // Register an already-built instance under a token DERIVED from the
    // instance — its constructor's static `Key` (the ServiceBase
    // convention) when present, else the constructor itself as a
    // class-token. The eager-singleton form the `.services:` markup block
    // lowers a bare entry (`StatusService`) to; equivalent to
    // `registerInstance(StatusService.Key ?? StatusService, instance)`.
    // A subclass that inherits its base's static `Key` registers under
    // that base token (so `addInstance(new SpyNav())` shadows the
    // NavigationService registration), matching the scoped-override path.
    public addInstance<T extends object>(instance: T): this
    {
        return this.registerInstance(
            ServiceProvider.tokenFor(instance.constructor as Function) as ServiceToken<T>,
            instance);
    }

    // The token a service class registers under by convention: its static
    // `Key` (ServiceBase) when defined, else the class itself
    // (class-as-token). Shared by addInstance and the compiler's
    // `.services:` lowering so markup and code agree on the token.
    public static tokenFor(ctor: Function): ServiceToken<unknown>
    {
        const key = (ctor as { Key?: unknown }).Key;
        return (key ?? ctor) as ServiceToken<unknown>;
    }

    public registerTransient<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): this
    {
        return this.register(token, factory, ServiceLifetime.Transient);
    }

    public registerScoped<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): this
    {
        return this.register(token, factory, ServiceLifetime.Scoped);
    }

    // ── Resolution ──────────────────────────────────────────────────

    // Resolve a service, or undefined when no registration is reachable.
    public get<T>(token: ServiceToken<T>): T | undefined
    {
        const found = this.findOwner(token);
        if (found === undefined) return undefined;
        const { reg, owner } = found;

        switch (reg.lifetime)
        {
            case ServiceLifetime.Transient:
                // Fresh every time; deps resolve from the requesting
                // scope; nothing cached.
                return reg.factory(this) as T;

            case ServiceLifetime.Singleton:
            {
                // One instance, cached at the owner (provider where
                // registered) so the whole subtree shares it. Deps
                // resolve from the owner — a root singleton must not
                // capture a child scope's instance.
                if (owner._cache.has(token)) return owner._cache.get(token) as T;
                const inst = reg.factory(owner);
                owner._cache.set(token, inst);
                return inst as T;
            }

            case ServiceLifetime.Scoped:
            {
                // One instance per resolving scope (this provider). Deps
                // resolve from this scope, so a chain of scoped services
                // all land in the same scope.
                if (this._cache.has(token)) return this._cache.get(token) as T;
                const inst = reg.factory(this);
                this._cache.set(token, inst);
                return inst as T;
            }
        }
    }

    // Resolve a service or throw — for required dependencies where a
    // missing registration is a composition bug, not an optional miss.
    public getRequired<T>(token: ServiceToken<T>): T
    {
        const value = this.get(token);
        if (value === undefined)
        {
            throw new Error(`ServiceProvider: no service registered for ${describeToken(token)}.`);
        }
        return value;
    }

    // True when the token resolves anywhere in this provider's chain.
    public has(token: ServiceToken<unknown>): boolean
    {
        return this.findOwner(token) !== undefined;
    }

    // A child scope: resolves locally first, then falls back to this
    // provider. May shadow registrations and owns its own scoped /
    // locally-registered singleton instances.
    public createScope(): ServiceProvider
    {
        return new ServiceProvider(this);
    }

    // Dispose this scope: call dispose() on every instance THIS provider
    // owns (its own cache — scoped services plus singletons registered
    // here), then clear the cache. Does NOT touch the parent chain or any
    // child scopes — dispose the scope you created. Idempotent: a second
    // call finds an empty cache. Structural Disposable check keeps the
    // container decoupled from ServiceBase / MuralBase.
    public dispose(): void
    {
        for (const inst of this._cache.values())
        {
            if (isDisposable(inst)) inst.dispose();
        }
        this._cache.clear();
    }

    // Walk the parent chain to find the registration and the provider
    // that owns it (needed for singleton caching at the owner).
    private findOwner(token: ServiceToken<unknown>): { reg: Registration; owner: ServiceProvider } | undefined
    {
        for (let cur: ServiceProvider | undefined = this; cur !== undefined; cur = cur._parent)
        {
            const reg = cur._registrations.get(token);
            if (reg !== undefined) return { reg, owner: cur };
        }
        return undefined;
    }
}

// Anything carrying a dispose() method — ServiceBase implements it. The
// Disposable shape is todl-runtime's shared handle; the check stays
// structural so the container needn't know ServiceBase concretely.
function isDisposable(v: unknown): v is Disposable
{
    return typeof (v as Partial<Disposable> | null)?.dispose === 'function';
}

function describeToken(token: ServiceToken<unknown>): string
{
    if (token instanceof ServiceKey) return token.toString();
    return (token as { name?: string }).name ?? 'anonymous service';
}
