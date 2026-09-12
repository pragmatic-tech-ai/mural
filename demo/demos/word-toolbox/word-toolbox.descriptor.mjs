// word-toolbox demo bootstrap. The VM owns Toolbox + ListBox
// collections + per-tile drag closures; the markup attaches
// ListReorderBehavior to the right pane and wires per-tile
// IsDraggable / OnDragStart through a container Style. The only
// extra wiring this file does is:
//
//   * Install the InsertionAdornerTemplate on the reorder behavior
//     (the indicator visual the behavior positions during a drag).
//   * Attach a tiny drop receiver on the right-pane ItemsControl
//     that accepts the FMT_WORD_COPY format the toolbox tiles
//     publish, and forwards each drop into the VM's OnWordCopied.
//
// The reorder behavior's vertical-vs-wrap mode is auto-detected from
// the host's ItemsPanel — no flag needed; VirtualizingWrapPanel
// triggers wrap mode.

import { DragDropEffects } from '@pragmatic-tech-ai/mural/runtime';
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic';
import { WordToolboxVM, FMT_WORD_COPY } from './word-toolbox-vm.mjs';

import * as controlsRef from '@pragmatic-tech-ai/mural/basic';
import * as runtimeRef from '@pragmatic-tech-ai/mural/runtime';
import * as visualEngineRef from '@pragmatic-tech-ai/mural/visual-engine';

let vmInstance;

// Insertion-line indicator factory. The behavior writes Width/Height
// and Canvas.Top/Left on the produced visual each move sample, so
// the template here just paints a 2-px blue Border at (0, 0). The
// behavior takes care of orientation (horizontal bar in vertical
// mode, vertical bar in wrap mode) by setting Width/Height.
function buildInsertionLineTemplate() {
    return new DataTemplate(() => {
        const { Border } = controlsRef;
        const { Thickness } = runtimeRef;
        const { Color } = runtimeRef;
        const { SolidColorBrush } = visualEngineRef;
        const line = new Border();
        line.Fill = new SolidColorBrush(Color.FromHex('#2563eb'));
        return line;
    });
}

// Right-pane drop receiver for toolbox-→-listbox copies. Mirrors the
// shape of the os-file-drop-behavior in drag-drop-extended: a thin
// DragOver / Drop pair that accepts a specific format and forwards
// the payload to the VM. Returns a detach thunk so the bootstrap
// can unwire on demo unload.
function attachToolboxCopyReceiver(targetVisual, vm) {
    targetVisual.AllowDrop = true;
    const onDragOver = (args) => {
        if (!args.Data.Has(FMT_WORD_COPY)) return;
        args.Effect = DragDropEffects.Copy;
    };
    const onDrop = (args) => {
        if (!args.Data.Has(FMT_WORD_COPY)) return;
        const word = args.Data.Get(FMT_WORD_COPY);
        if (typeof word === 'string' && word.length > 0) {
            vm.OnWordCopied(word);
        }
    };
    targetVisual.AddRoutedEventListener('DragOver', onDragOver);
    targetVisual.AddRoutedEventListener('Drop',     onDrop);
    return function detach() {
        targetVisual.AllowDrop = false;
        targetVisual.RemoveRoutedEventListener('DragOver', onDragOver);
        targetVisual.RemoveRoutedEventListener('Drop',     onDrop);
    };
}

function attachExtras(view, vm) {
    const listBox = view.FindName('listBox');
    if (listBox === undefined) throw new Error('word-toolbox.mu missing x:name="listBox"');

    // Install the insertion-line template on the reorder behavior.
    const behaviors = listBox.Behaviors;
    for (const b of behaviors) {
        if (b.constructor.name === 'ListReorderBehavior') {
            b.InsertionAdornerTemplate = buildInsertionLineTemplate();
            break;
        }
    }

    // Toolbox → listbox copy receiver, attached on the right-pane
    // ListBox so DragOver/Drop bubble up from the tile rects and land
    // on a single handler. The selection-chrome + cell-stretching
    // wiring that used to live here moved to declarative `.mu`:
    // WordTileItemStyle/WordTileItemTemplate with a
    // `when(IsSelected) { PART_Border.Fill = … }` trigger
    // applies via ItemContainerStyle and covers freshly-realized
    // tiles automatically (including virtualized ones).
    const detachCopy = attachToolboxCopyReceiver(listBox, vm);

    return function detachAll() {
        detachCopy();
    };
}

export default {
    id:       'word-toolbox',
    title:    'Word toolbox',
    subtitle: 'Drag tiles between a 100-word toolbox and a 2000-tile virtualized wrap-panel listbox.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new WordToolboxVM();
        vmInstance.OnViewMounted = (view) => attachExtras(view, vmInstance);
        return vmInstance;
    },
};
