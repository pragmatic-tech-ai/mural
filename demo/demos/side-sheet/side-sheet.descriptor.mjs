// side-sheet demo — M3 Modal SideSheet: a trailing-edge sheet over a
// dismissable scrim, opened by a button and closed by its ✕ / the scrim.
import { SideSheetVM } from './side-sheet-vm.mjs';

let vmInstance;

export default {
    id:       'side-sheet',
    title:    'Side Sheet',
    subtitle: 'M3 lateral sheet — a Modal, scrim-backed trailing-edge surface.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new SideSheetVM();
        return vmInstance;
    },
};
