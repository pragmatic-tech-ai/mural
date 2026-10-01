// context-menu demo — three coloured panels, each wired to a
// CommandContextMenu (command-driven path) in OnViewMounted. The
// DemoCommandDispatcher (built by the VM) resolves every leaf's stable
// Id to the VM's own command catalogue; RecentCommandContributor (the
// dynamic "Recent" submenu under the Blue/File menu) is registered into
// Application.current.Services so CommandMenuBuilder.RealizeChildren can
// resolve it by its ChildrenContributor token.
import { Application } from '@pragmatic-tech-ai/mural/runtime';
import { CommandContextMenu } from '@pragmatic-tech-ai/mural/framework/surface.js';
import { ContextMenuVM, RecentCommandContributor } from './context-menu-vm.mjs';

let vmInstance;

function attachBehaviors(view, vm) {
    const provider = Application.current?.Services;
    provider.registerInstance(RecentCommandContributor.Token, new RecentCommandContributor());

    const redPanel   = view.FindName('redPanel');
    const greenPanel = view.FindName('greenPanel');
    const bluePanel  = view.FindName('bluePanel');
    if (redPanel === undefined || greenPanel === undefined || bluePanel === undefined) {
        throw new Error('context-menu.mu missing an x:name on a coloured panel');
    }

    redPanel.ContextMenu   = new CommandContextMenu(vm.RedMenuRoots,   vm.Dispatcher, provider);
    greenPanel.ContextMenu = new CommandContextMenu(vm.GreenMenuRoots, vm.Dispatcher, provider);
    bluePanel.ContextMenu  = new CommandContextMenu(vm.BlueMenuRoots,  vm.Dispatcher, provider);

    return function detachAll() {
        redPanel.ContextMenu   = undefined;
        greenPanel.ContextMenu = undefined;
        bluePanel.ContextMenu  = undefined;
    };
}

export default {
    id:       'context-menu',
    title:    'ContextMenu',
    subtitle: 'Right-click any coloured panel — command-driven ContextMenu, including a live "Recent" submenu.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ContextMenuVM();
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
};
