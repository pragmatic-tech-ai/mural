// menu demo — MenuButton + MenuItem + MenuSeparator showcase. The
// hamburger button opens a fly-out menu with File / Edit / View
// groups (separators between), plus two checkable items demonstrating
// IsCheckable + IsChecked.
import { MenuVM } from './menu-vm.mjs';

let vmInstance;

export default {
    id:       'menu',
    title:    'Menu',
    subtitle: 'Hamburger MenuButton with grouped MenuItems, separators, gesture text, and checkable items.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new MenuVM();
        return vmInstance;
    },
};
