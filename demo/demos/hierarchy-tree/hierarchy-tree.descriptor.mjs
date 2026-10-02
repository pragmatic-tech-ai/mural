// hierarchy-tree demo — HierarchyTreeVM owns the Hierarchy {} DSL's
// registry-backed Hierarchy; hierarchy-tree.mu binds both TreeViews against
// it with zero TS-side wiring (see that file + hierarchy-tree.module.mu).
import { HierarchyTreeVM } from './hierarchy-tree-vm.mjs';

let vmInstance;

export default {
    id: 'hierarchy-tree',
    title: 'Hierarchy',
    subtitle: 'Hierarchy{} DSL + the default TreeView (out-of-box) vs. an item-template override by key.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new HierarchyTreeVM();
        return vmInstance;
    },
};
