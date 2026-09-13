// The application's self-service: a singleton the DI container hands out so
// any service (or VM / behavior) can reach the running Application instance and
// — the headline use — the set of modules composed onto it. Other services
// bootstrap themselves from that module information (e.g. NavigationService
// flattening every module's capabilities into the root navigation layer).
//
// Registered against `ApplicationService.Key` when an Application first creates
// its `Services` container (see Application.Services), so it's present for the
// whole provider subtree from the moment services exist. `Modules` is the LIVE
// collection — empty at registration, populated synchronously as the app IIFE's
// `.modules:` block runs `Modules.Add(...)`. Any service resolved afterwards
// (shell activation, region scopes) sees the full set; a service that wants to
// react to later changes subscribes to the collection itself.
//
// Layering: this lives in runtime alongside `Application`, so exposing the
// concrete `Application` instance is in-layer. `Modules` is typed against the
// runtime `IShellModule` contract; framework consumers up-cast each entry to
// the concrete ShellModule / Capability to read view-facing fields (Icon,
// Panel) — the same seam Application.Modules uses.

import { ServiceKey } from '@pragmatic-tech-ai/todl-runtime';
import type { Application } from '../application.js';
import type { IShellModule } from '../shell-modules.js';
import type { IReadOnlyObservableCollection } from '../observable-collection.js';

export interface IApplicationService
{
    // The running Application instance this service fronts.
    readonly Instance: Application;

    // The modules composed onto the Application — the live collection, so a
    // consumer both reads the current set and may subscribe to changes.
    readonly Modules: IReadOnlyObservableCollection<IShellModule>;

    // Mirrors Application.IsInitialized (theme activated / lifecycle ready).
    readonly IsInitialized: boolean;
}

export class ApplicationService implements IApplicationService
{
    // Interface-shaped token (no class to key by at the consumer): a real
    // object, resolved as `provider.getRequired(ApplicationService.Key)`.
    public static readonly Key = new ServiceKey<IApplicationService>('ApplicationService');

    constructor(private readonly _app: Application) { }

    public get Instance(): Application { return this._app; }

    public get Modules(): IReadOnlyObservableCollection<IShellModule>
    {
        return this._app.Modules;
    }

    public get IsInitialized(): boolean { return this._app.IsInitialized; }
}
