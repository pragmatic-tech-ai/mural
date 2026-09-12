// drag-drop demo bootstrap — wires the listbox-drop-behavior onto
// each ListBox after view materialization. The VM is pure data +
// methods; the .mu wires drag-source declaratively via IsDraggable +
// OnDragStart; this file is the glue.

import { ListBox } from '@pragmatic-tech-ai/mural/framework';
import { DragDropVM } from './drag-drop-vm.mjs';
import { attachListBoxDrop } from './behaviors/listbox-drop-behavior.mjs';

let vmInstance;

function attachBehaviors(view, vm) {
    const left  = view.FindName('leftList');
    const right = view.FindName('rightList');
    if (!(left  instanceof ListBox)) throw new Error('drag-drop.mu missing x:name="leftList"');
    if (!(right instanceof ListBox)) throw new Error('drag-drop.mu missing x:name="rightList"');

    const detachLeft  = attachListBoxDrop(left,  vm, 'left');
    const detachRight = attachListBoxDrop(right, vm, 'right');

    return function detachAll() {
        detachLeft();
        detachRight();
    };
}

export default {
    id:       'drag-drop',
    title:    'Drag & drop between lists',
    subtitle: 'Drag any item from one list to the other to move it.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new DragDropVM();
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
};
