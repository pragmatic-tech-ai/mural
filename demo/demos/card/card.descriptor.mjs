// card demo — three M3 Card variants side by side (Filled / Elevated /
// Outlined). Each has a title, body, and a Text Button action so the
// dynamic-binding chain through CardVM is visible.
import { CardVM } from './card-vm.mjs';

let vmInstance;

export default {
    id:       'card',
    title:    'Card',
    subtitle: 'Three M3 variants; Variant DP drives container colour, border, and resting elevation.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new CardVM();
        return vmInstance;
    },
};
