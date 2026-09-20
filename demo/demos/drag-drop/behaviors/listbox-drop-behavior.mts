// listbox-drop-behavior — turns a ListBox into a drop target for
// items dragged FROM the other ListBox. Sets AllowDrop=true,
// subscribes to DragOver/Drop, and dispatches to the VM's MoveTo*
// methods.
//
// `side` is 'left' or 'right' — matches which collection on the VM
// receives the dropped item.

import { DragDropEffects, type DragEventArgs, type Visual } from '@pragmatic-tech-ai/mural/runtime';
import { FMT_ITEM, type DragDropVM } from '../drag-drop-vm.mjs';

export function attachListBoxDrop(listBox: Visual, vm: DragDropVM, side: 'left' | 'right'): () => void
{
    listBox.AllowDrop = true;

    const isAlreadyHere = (itemId: string): boolean =>
        side === 'left' ? vm.IsInLeft(itemId) : vm.IsInRight(itemId);

    const onDragOver = (raw: unknown): void => {
        // Routed-event listeners are typed `(args: unknown)`; narrow once.
        const args = raw as DragEventArgs;
        if (!args.Data.Has(FMT_ITEM)) return;
        // Drag payload carries the item id under FMT_ITEM (string).
        const itemId = args.Data.Get<string>(FMT_ITEM) as string;
        // Don't accept drop on the source list — the gesture is a
        // no-op, and surfacing it as 'not-allowed' gives clearer
        // feedback than silently accepting Move with no effect.
        if (isAlreadyHere(itemId)) return;
        args.Effect = DragDropEffects.Move;
    };

    const onDrop = (raw: unknown): void => {
        const args = raw as DragEventArgs;
        if (!args.Data.Has(FMT_ITEM)) return;
        const itemId = args.Data.Get<string>(FMT_ITEM) as string;
        if (side === 'left') vm.MoveToLeft(itemId);
        else                 vm.MoveToRight(itemId);
    };

    listBox.AddRoutedEventListener('DragOver', onDragOver);
    listBox.AddRoutedEventListener('Drop',     onDrop);

    return function detach()
    {
        listBox.AllowDrop = false;
        listBox.RemoveRoutedEventListener('DragOver', onDragOver);
        listBox.RemoveRoutedEventListener('Drop',     onDrop);
    };
}
