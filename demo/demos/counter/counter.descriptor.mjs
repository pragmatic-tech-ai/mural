// counter demo — registers the CounterVM's DataTemplate into the
// Application's resources and returns a CounterVM instance to the
// platform. The platform sets PageView.Content = vm; ContentControl
// auto-resolves the template by matching the VM's constructor name
// against the template's DataType.
import { CounterVM } from './counter-vm.mjs';

let vmInstance;

export default {
    id:       'counter',
    title:    'Counter',
    subtitle: 'Button + ICommand + ComboBox. Increment.CanExecute gates the button at 10.',
    factory: () => {
        // Merge the demo's resource dictionary into the application
        // on first activation. After this, ContentControl finds the
        // template by walking Application.current.Resources.
        // The "demo content" is now the VM, not a Visual. The platform
        // PageView's ContentControl resolves the matching DataTemplate
        // and slots the produced Visual.
        if (vmInstance === undefined) vmInstance = new CounterVM();
        return vmInstance;
    },
};
