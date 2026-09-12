// bottom-sheet demo — M3 BottomSheet bottom-anchored over a page body.
// The sheet's Height binds to the VM's SheetHeight; TogglePosture flips
// between the peek and expanded stops so the posture is exercised live.
import { BottomSheetVM } from './bottom-sheet-vm.mjs';

let vmInstance;

export default {
    id:       'bottom-sheet',
    title:    'BottomSheet',
    subtitle: 'Bottom-anchored surface; toggle peek vs expanded posture via bound Height.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new BottomSheetVM();
        return vmInstance;
    },
};
