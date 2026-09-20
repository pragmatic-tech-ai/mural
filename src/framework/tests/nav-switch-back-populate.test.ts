import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application, MuralBase, ServiceProvider, type Visual } from '../../runtime/index.js';
import { initTestApp } from '../../basic/tests/test-app.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { Border } from '../../basic/border.js';
import { EditorShell } from '../shell/editor-shell.js';
import { NavigationService } from '../shell/services/navigation-service.js';
import { NavigationRail } from '../navigation/navigation-rail.js';
import { NavigationItem } from '../navigation/navigation-item.js';
import { Capability, ShellModule } from '../shell/module.js';
import { ModifierKeys } from '../../runtime/index.js';

class SvcA extends MuralBase {}
class SvcB extends MuralBase {}

function collect<T>(root: Visual, ctor: new (...a: never[]) => T, out: T[] = []): T[]
{
    if (root instanceof ctor) out.push(root);
    for (const c of root.visualChildren) collect(c, ctor, out);
    return out;
}
function findWhere(root: Visual, pred: (v: Visual) => boolean): Visual | undefined
{
    if (pred(root)) return root;
    for (const c of root.visualChildren)
    {
        const hit = findWhere(c, pred);
        if (hit !== undefined) return hit;
    }
    return undefined;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Navigation — switch back with shell-default PopulateFromModules (Plexus path)', () => {
    beforeEach(() => {
        const app = initTestApp();
        // Compose a module with two capabilities — like DiagramModule's ToolBox /
        // Layers. The shell's DEFAULT NavigationService flattens these via
        // PopulateFromModules and lands on the first (SelectedItem = capA) during
        // its async, forward-ref resolution.
        const svcA = new SvcA();
        const svcB = new SvcB();
        app.Services
            .register(ServiceProvider.tokenFor(SvcA), () => svcA, 'singleton')
            .register(ServiceProvider.tokenFor(SvcB), () => svcB, 'singleton');
        const capA = new Capability(); capA.Name = 'A'; capA.ServiceKey = SvcA;
        const capB = new Capability(); capB.Name = 'B'; capB.ServiceKey = SvcB;
        const mod = new ShellModule();
        mod.Capabilities.Add(capA);
        mod.Capabilities.Add(capB);
        app.Modules.Add(mod);
        Application.current.Resources.Set(SvcA, new DataTemplate((s) => { const b = new Border(); b.DataContext = s; return b; }, SvcA));
        Application.current.Resources.Set(SvcB, new DataTemplate((s) => { const b = new Border(); b.DataContext = s; return b; }, SvcB));
    });

    test('rail starts on A, switch to B, switch BACK to A re-activates', async () => {
        const shell = new EditorShell();
        const root  = shell.visualChildren[0]!;
        await settle();
        const nav  = shell.Services.get(NavigationService.Key) as NavigationService;
        const rail = collect(root, NavigationRail)[0];
        assert.ok(rail !== undefined, 'rail materialised');
        const items = collect(rail!, NavigationItem);
        assert.equal(items.length, 2, 'a rail item per capability');

        const svcA = shell.Services.get(ServiceProvider.tokenFor(SvcA)) as SvcA;
        const svcB = shell.Services.get(ServiceProvider.tokenFor(SvcB)) as SvcB;
        const mounted = (): unknown =>
            (findWhere(root, (v) => v instanceof Border && (v.DataContext === svcA || v.DataContext === svcB)) as Border | undefined)?.DataContext;
        const click = (i: number) =>
            (rail as unknown as { HandleContainerClick(c: Visual, m: ModifierKeys): void })
                .HandleContainerClick(items[i]!, ModifierKeys.None);

        // Shell lands on the first capability by default.
        assert.equal(nav.ActiveService, svcA, 'initial: ActiveService is SvcA');
        assert.equal(mounted(), svcA, 'initial: side pane shows SvcA');

        click(1); await settle();                     // → B
        assert.equal(nav.ActiveService, svcB, 'B: ActiveService is SvcB');
        assert.equal(mounted(), svcB, 'B: side pane shows SvcB');

        click(0); await settle();                     // → back to A
        assert.equal(nav.SelectedItem, nav.Items.Get(0), 'switch back: SelectedItem is A');
        assert.equal(nav.ActiveService, svcA, 'switch back: ActiveService is SvcA');
        assert.equal(mounted(), svcA, 'switch back: side pane RE-MOUNTS SvcA');
    });
});
