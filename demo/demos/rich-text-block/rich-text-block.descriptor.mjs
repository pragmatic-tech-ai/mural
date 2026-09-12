// rich-text-block demo — a read-only RichTextBlock typography showcase:
// mixed inline text styles (bold / italic / underline / colour / size) and
// baseline-aligned inline chips, all over one FlowDocument authored in
// rich-text-block.mu. No editable state, so the VM is empty; the factory
// just returns it so the shell resolves the DataTemplate by class identity.
import { RichTextBlockVM } from './rich-text-block-vm.mjs';

let vmInstance;

export default {
    id:       'rich-text-block',
    title:    'Rich text block',
    subtitle: 'Mixed inline styles and baseline-aligned chips over one read-only FlowDocument.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new RichTextBlockVM();
        return vmInstance;
    },
};
