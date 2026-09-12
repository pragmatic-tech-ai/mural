// time-picker demo — M3 analog TimePicker: an hour/minute clock dial with
// AM/PM, its Hour/Minute bound TwoWay onto the VM and echoed as a label.
import { TimePickerVM } from './time-picker-vm.mjs';

let vmInstance;

export default {
    id:       'time-picker',
    title:    'Time Picker',
    subtitle: 'M3 analog clock dial — hour / minute rings + AM/PM.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new TimePickerVM();
        return vmInstance;
    },
};
