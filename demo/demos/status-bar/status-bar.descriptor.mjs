// status-bar demo — exposes StatusBar / StatusBarItem / StatusBarSeparator.
// Cells dock left / right via DockPanel.Dock and a stretchy middle cell
// pulls the residue width.
import { StatusBarVM } from './status-bar-vm.mjs';

let vmInstance;

export default {
    id:       'status-bar',
    title:    'StatusBar',
    subtitle: 'Docked cells with separators; gated commands; LastChildFill stretchy middle.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new StatusBarVM();
        return vmInstance;
    },
};
