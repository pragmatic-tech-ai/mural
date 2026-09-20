// os-file-drop-behavior — receiver-side glue for OS-level file drops
// (backlog 8.1). Wires the host Visual as a drop target for sessions
// whose `Source` is undefined (the framework's marker for "this came
// from outside the app") and whose DataObject carries the synthetic
// `Files` key the HtmlTarget populates from `dataTransfer.files`.
//
// Dispatches each dropped FileList entry to the VM's OnFileDropped
// method, accepting Copy effect during DragOver so the OS cursor
// renders the right glyph. Optionally accepts text/plain and
// text/uri-list drops too — useful for cross-window text/url drags.

import { DragDropEffects, type DragEventArgs, type Visual } from '@pragmatic-tech-ai/mural/runtime';
import type { DragDropExtendedVM } from '../drag-drop-extended-vm.mjs';

export function attachOsFileDrop(visual: Visual, vm: DragDropExtendedVM): () => void
{
    visual.AllowDrop = true;

    const onDragOver = (raw: unknown): void => {
        // Routed-event listeners are typed `(args: unknown)`; narrow once.
        const args = raw as DragEventArgs;
        // Source === undefined → OS-level (the framework synthesizes the
        // session with no in-tree origin). Bail otherwise so this
        // behavior doesn't intercept in-app drags.
        if (args.Session?.Source !== undefined) return;
        // Accept any OS-level drag that carries files OR plain text.
        if (args.Data.Has('Files') || args.Data.Has('text/plain') || args.Data.Has('text/uri-list'))
        {
            args.Effect = DragDropEffects.Copy;
        }
    };

    const onDrop = (raw: unknown): void => {
        const args = raw as DragEventArgs;
        if (args.Session?.Source !== undefined) return;
        // FileList — iterate as a real array. The HtmlTarget stores the
        // raw DataTransfer FileList under the synthetic 'Files' key.
        const files = args.Data.Get<FileList>('Files');
        if (files !== undefined)
        {
            for (let i = 0; i < files.length; i++)
            {
                const f = files.item(i) ?? files[i];
                vm.OnFileDropped(f.name, f.size);
            }
            return;
        }
        // URI list — one URL per line (the spec format).
        const urls = args.Data.Get<string>('text/uri-list');
        if (typeof urls === 'string' && urls.length > 0)
        {
            for (const line of urls.split('\n'))
            {
                const trimmed = line.trim();
                if (trimmed.length > 0 && !trimmed.startsWith('#'))
                {
                    vm.OnFileDropped(trimmed, 0);
                }
            }
            return;
        }
        // Plain text — log as a single entry. Useful for drags from a
        // browser address bar / text selection.
        const text = args.Data.Get<string>('text/plain');
        if (typeof text === 'string' && text.length > 0)
        {
            vm.OnFileDropped(`text: ${text.slice(0, 64)}`, text.length);
        }
    };

    visual.AddRoutedEventListener('DragOver', onDragOver);
    visual.AddRoutedEventListener('Drop',     onDrop);

    return function detach()
    {
        visual.AllowDrop = false;
        visual.RemoveRoutedEventListener('DragOver', onDragOver);
        visual.RemoveRoutedEventListener('Drop',     onDrop);
    };
}
