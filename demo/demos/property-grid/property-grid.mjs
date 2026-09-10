// Bootstrap for the property-grid demo.
//
// Registers a PropertyGridVM instance in the demo registry. The platform
// resolves the DataTemplate (authored in property-grid.mu) by matching
// PropertyGridVM's constructor name against the template's DataType.
import { PropertyGridVM } from './property-grid-vm.mjs';
import { register } from '../../platform/registry.mjs';

let vmInstance;

register({
    id:       'property-grid',
    group:    'Controls',
    title:    'Property grid',
    subtitle: 'DpPropertyBag + MapPropertyBag — categorised key/value editor with per-kind dispatch.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new PropertyGridVM();
        return vmInstance;
    },
});
