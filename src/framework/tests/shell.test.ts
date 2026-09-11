import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, type Visual } from '../../runtime/index.js';
import { initTestApp } from '../../basic/tests/test-app.js';

import { Border } from '../../basic/border.js';
import { ContentControl } from '../base/content-control.js';
import { EditorShell } from '../shell/editor-shell.js';
import { ViewerShell } from '../shell/viewer-shell.js';
import { NavigationService } from '../shell/services/navigation-service.js';
import { StatusService } from '../shell/services/status-service.js';
import { ApplicationSettings } from '../shell/services/application-settings-service.js';
import { NavigationRail } from '../navigation/navigation-rail.js';

// Depth-first search of a visual subtree for the first instance of a type.
function findByType<T>(root: Visual, ctor: new (...a: never[]) => T): T | undefined {
    if (root instanceof ctor) return root;
    for (const c of root.visualChildren) {
        const hit = findByType(c, ctor);
        if (hit !== undefined) return hit;
    }
    return undefined;
}

describe('EditorShell — full region set', () => {
    beforeEach(() => { initTestApp(); });

    test('template exposes every region host', () => {
        const root = new EditorShell().visualChildren[0];
        // The right-side inspector region was restructured into the nav-driven
        // PART_SidePane and the dockable PART_RightDockHost (which hosts inspectors
        // and other panels as tabs) — replacing the old single PART_InspectorHost.
        for (const part of ['PART_HeaderHost', 'PART_CommandHost', 'PART_StatusHost',
                            'PART_NavHost', 'PART_SidePane', 'PART_RightDockHost', 'PART_ContentHost']) {
            assert.ok(root.FindName(part) !== undefined, `${part} should be present`);
        }
    });
});

describe('ViewerShell — readonly subset', () => {
    beforeEach(() => { initTestApp(); });

    test('provides Header / Navigation / Content but no editor regions', () => {
        const root = new ViewerShell().visualChildren[0];
        assert.ok(root.FindName('PART_HeaderHost')  !== undefined);
        assert.ok(root.FindName('PART_NavHost')     !== undefined);
        assert.ok(root.FindName('PART_ContentHost') !== undefined);
        assert.equal(root.FindName('PART_CommandHost'),    undefined);
        assert.equal(root.FindName('PART_RightDockHost'),  undefined);
        assert.equal(root.FindName('PART_StatusHost'),     undefined);
    });
});

describe('Shell — region services', () => {
    beforeEach(() => {
        initTestApp();
        // Register the region services app-wide as `scoped`, so every
        // shell scope instantiates its own. registerScoped overwrites
        // idempotently on the process-shared app.
        Application.current.Services
            .registerScoped(NavigationService.Key, (p) => new NavigationService(p))
            .registerScoped(StatusService.Key,     (p) => new StatusService(p));
    });

    test('region hosts resolve their scoped service via the markup $service binding', async () => {
        const shell = new EditorShell();
        const navHost    = shell.visualChildren[0].FindName('PART_NavHost')    as ContentControl;
        const statusHost = shell.visualChildren[0].FindName('PART_StatusHost') as Border;
        // Let the ServiceBinding forward-ref retry settle on the published scope.
        await Promise.resolve(); await Promise.resolve();
        // The status host binds `DataContext = $service(StatusService)`; the nav
        // host binds `Content = $service(NavigationService)` (rendered by
        // DataTemplate[NavigationService] as an activity-bar rail). Both resolve
        // against the shell's published ServiceScope.
        assert.equal(statusHost.DataContext, shell.Services.get(StatusService.Key));
        assert.equal(navHost.Content,        shell.Services.get(NavigationService.Key));
        assert.ok(navHost.Content instanceof NavigationService);
    });

    test('Navigation host renders an activity-bar rail bound to the service destinations', async () => {
        const shell = new EditorShell();
        const navHost = shell.visualChildren[0].FindName('PART_NavHost') as ContentControl;
        await Promise.resolve(); await Promise.resolve();
        // The nav host presents the NavigationService; DataTemplate[NavigationService]
        // materialises a NavigationRail whose DataContext IS the service.
        const rail = findByType(navHost, NavigationRail);
        assert.ok(rail !== undefined, 'nav host materialised a NavigationRail');
        const svc = rail!.DataContext as NavigationService;
        assert.ok(svc instanceof NavigationService);
        // `ItemsSource = $Items` bound to the service's live destinations.
        assert.equal(rail!.ItemsSource, svc.Items);
    });

    test('EditorShell auto-provides ApplicationSettings (aggregates module settings)', () => {
        // No app-level registration — the shell supplies the default, like it does
        // for NavigationService / ContentHostService. Resolving it builds the
        // service (PopulateFromModules over Application.current.Modules).
        const shell = new EditorShell();
        const settings = shell.Services.get(ApplicationSettings.Key);
        assert.ok(settings instanceof ApplicationSettings);
    });

    test('each shell gets its own scoped service instance', () => {
        const a = new EditorShell();
        const b = new EditorShell();
        const navA = a.Services.get(NavigationService.Key);
        const navB = b.Services.get(NavigationService.Key);
        assert.ok(navA !== undefined && navB !== undefined);
        assert.notEqual(navA, navB);
    });

    test('Dispose tears down the scope, disposing its services', async () => {
        let disposed = false;
        class SpyNav extends NavigationService {
            public override dispose(): void { disposed = true; super.dispose(); }
        }
        // Register the spy at the root before constructing, so the shell's
        // scope resolves (and caches) it when the markup binding resolves.
        Application.current.Services.registerScoped(NavigationService.Key, () => new SpyNav());
        const shell = new EditorShell();
        const navHost = shell.visualChildren[0].FindName('PART_NavHost') as ContentControl;
        await Promise.resolve(); await Promise.resolve();
        const rail = findByType(navHost, NavigationRail);
        assert.ok(rail?.DataContext instanceof SpyNav, 'rail resolved the shell-scoped SpyNav');
        shell.dispose();
        assert.equal(disposed, true);
    });
});
