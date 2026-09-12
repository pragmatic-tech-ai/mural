// badge demo — M3 Badge in its two BadgeVariant values (Dot / Numeric).
// The Numeric badge's Count DP is bound to the VM and driven live by the
// Increment / Reset commands.
import { BadgeVM } from './badge-vm.mjs';

let vmInstance;

export default {
    id:       'badge',
    title:    'Badge',
    subtitle: 'Variant DP picks Dot vs Numeric; Count drives the numeric pill live.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new BadgeVM();
        return vmInstance;
    },
};
