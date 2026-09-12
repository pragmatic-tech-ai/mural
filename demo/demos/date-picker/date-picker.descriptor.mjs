// date-picker demo — M3 Docked DatePicker: a paging calendar whose day
// selection binds TwoWay onto the VM and echoes as a label.
import { DatePickerVM } from './date-picker-vm.mjs';

let vmInstance;

export default {
    id:       'date-picker',
    title:    'Date Picker',
    subtitle: 'M3 Docked calendar — month paging + day selection.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new DatePickerVM();
        return vmInstance;
    },
};
