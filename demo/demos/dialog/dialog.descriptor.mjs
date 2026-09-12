// dialog demo — an M3 Dialog surface drawn INLINE in the example area (over a
// dim scrim, centred) rather than mounted as a popup on the OverlayLayer, so its
// Title / Content / Actions structure is visible in place. Cancel / Delete
// dismiss and record a result; "Show dialog" re-opens it.
import { DialogDemoVM } from './dialog-vm.mjs';

let vmInstance;

export default {
    id:       'dialog',
    title:    'Dialog',
    subtitle: 'M3 modal surface (Title / Content / Actions) drawn inline over a scrim — no popup. Open/close via bound Observable state.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new DialogDemoVM();
        return vmInstance;
    },
};
