// list-box demo — ListBoxVM holds the demo state; its OnViewMounted
// resolves x:named buttons / status line / bound ListBox inside the
// freshly-applied template and wires Sort/Filter + CollectionView
// subscription. The factory hands the platform a VM instance; the
// demo's view dictionary is merged app-global in platform.mu (§ 27).
import { ListBoxVM } from './list-box-vm.mjs';

let vmInstance;

export default {
    id:       'list-box',
    title:    'ListBox',
    subtitle: 'Declarative · Items=[…] convenience · ItemsSource + CollectionView with Sort / Filter toggles.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ListBoxVM();
        return vmInstance;
    },
};
