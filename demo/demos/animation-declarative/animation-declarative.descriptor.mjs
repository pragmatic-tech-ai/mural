// animation-declarative demo — AnimationDeclarativeVM is empty; the
// .mu file declares a DataTemplate keyed on AnimationDeclarativeVM and
// carries an implicit Button style scoped to that template's root.
// The factory hands the platform a VM instance; the demo's view
// dictionary is merged app-global in platform.mu (§ 27).
import { AnimationDeclarativeVM } from './animation-declarative-vm.mjs';

let vmInstance;

export default {
    id:       'animation-declarative',
    title:    'Declarative trigger actions',
    subtitle: '`on Click { BeginStoryboard { DoubleAnimation[...] } }` inside a style — no host-side JS.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new AnimationDeclarativeVM();
        return vmInstance;
    },
};
