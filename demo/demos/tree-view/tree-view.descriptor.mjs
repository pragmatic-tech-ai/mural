// tree-view demo — TreeViewVM holds the data tree + the
// HierarchicalDataTemplate wiring; OnViewMounted resolves the bound
// TreeView by name and sets its ItemTemplate / ItemsSource.
import { TreeViewVM } from './tree-view-vm.mjs';

let vmInstance;

export default {
    id:       'tree-view',
    title:    'TreeView',
    subtitle: 'Composed markup (left) vs. HierarchicalDataTemplate over a recursive data tree (right).',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new TreeViewVM();
        return vmInstance;
    },
};
