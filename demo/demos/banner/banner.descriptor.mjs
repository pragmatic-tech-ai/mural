// banner demo — M3 Banner in the document flow, exercising its Content
// (message), Leading (icon), and Actions (trailing button) slots. The
// action Button dismisses the Banner; a Restore button brings it back.
import { BannerVM } from './banner-vm.mjs';

let vmInstance;

export default {
    id:       'banner',
    title:    'Banner',
    subtitle: 'In-flow alert strip; Leading icon, Content message, and trailing Actions slot.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new BannerVM();
        return vmInstance;
    },
};
