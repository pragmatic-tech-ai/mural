// drag-drop-extended demo bootstrap. The VM exposes Rows / DroppedFiles
// and the bound Status fields; the markup attaches the ListReorderBehavior
// declaratively via the Behaviors{} block and wires the per-row drag
// source via a ContentPresenter container Style. This file glues the
// remaining pieces:
//
//   * Sets InsertionAdornerTemplate on the reorder behavior — DataTemplate
//     authoring inside markup binds the template to a DataType key,
//     and the platform's resource dictionary already carries the
//     "insertion-line" template (lookup-by-string).
//   * Attaches the OS-file-drop behavior to the right zone.
//   * Listens for Shift keydown/keyup at the window level to drive
//     the VM's _shiftFlag (read by OnContinueQuery).
//
// The reorder behavior + auto-scroll work the moment the view
// materializes — no extra wiring needed for 8.4 (ScrollViewer reads
// the session's OnMove itself) or 8.5 (the behavior wires the adorner
// internally once InsertionAdornerTemplate is set).

import { DataTemplate } from '@pragmatic-tech-ai/mural/basic';
import { DragDropExtendedVM } from './drag-drop-extended-vm.mjs';
import { attachOsFileDrop } from './behaviors/os-file-drop-behavior.mjs';

let vmInstance;

// Inline DataTemplate that produces the insertion line. Built
// imperatively because the .mu compiler keys DataTemplates by DataType
// class; the behavior wants a Visual factory, not a class lookup.
// Kept tiny — a 2px-tall colored Border that the framework positions
// via Canvas.SetTop / Canvas.SetLeft.
function buildInsertionLineTemplate() {
    // Use a fresh DataTemplate per session so cross-session state
    // can't leak. The factory body imports Border + Color + Brush
    // lazily so this module stays MVVM-clean.
    return new DataTemplate(() => {
        // Lazy ESM import — the runtime / Controls modules are already
        // loaded by the time this fires (the platform shell imports
        // them at startup).
        const { Border } = importControls();
        const { Color } = importRuntime();
        const { SolidColorBrush } = importVisualEngine();
        const line = new Border();
        line.Height = 2;
        line.Fill = new SolidColorBrush(Color.FromHex('#2563eb'));
        return line;
    });
}

// Top-of-module sync access to the already-loaded module objects.
// Avoids re-importing inside the factory closure (which would create a
// pending Promise rather than a synchronous value).
let _controls, _runtime, _visualEngine;
function importControls()      { return (_controls      ??= controlsRef); }
function importRuntime()       { return (_runtime       ??= runtimeRef); }
function importVisualEngine()  { return (_visualEngine  ??= visualEngineRef); }

import * as controlsRef from '@pragmatic-tech-ai/mural/basic';
import * as runtimeRef from '@pragmatic-tech-ai/mural/runtime';
import * as visualEngineRef from '@pragmatic-tech-ai/mural/visual-engine';

function attachExtras(view, vm) {
    // 8.5 — install the insertion-line template on the reorder behavior.
    // The reorder behavior is the markup-attached one (via the
    // Behaviors{} block); pull it off the ItemsControl's Behaviors
    // collection and write the DP.
    const reorderList = view.FindName('reorderList');
    if (reorderList === undefined) throw new Error('drag-drop-extended.mu missing x:name="reorderList"');
    const behaviors = reorderList.Behaviors;
    for (const b of behaviors) {
        if (b.constructor.name === 'ListReorderBehavior') {
            b.InsertionAdornerTemplate = buildInsertionLineTemplate();
            break;
        }
    }

    // 8.1 — attach the OS file-drop behavior to the right zone. The
    // markup uses x:name="filesList" on the inner ItemsControl, but
    // the drop target is the OUTER Border the user actually sees.
    // Walk up from filesList to find that ancestor (or just bind to
    // the root and let DragOver bubble — simpler).
    const detachOsDrop = attachOsFileDrop(view, vm);

    // 8.3 — Shift listener. Bound to the host window so a Shift held
    // during a drag flips the VM's _shiftFlag; OnContinueQuery reads
    // it and returns false to cancel.
    const onKeyDown = (e) => { if (e.key === 'Shift') vm.SetShiftHeld(true); };
    const onKeyUp   = (e) => { if (e.key === 'Shift') vm.SetShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    return function detachAll() {
        detachOsDrop();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup',   onKeyUp);
    };
}

export default {
    id:       'drag-drop-extended',
    title:    'Drag & drop extended',
    subtitle: 'Reorder + OS file drops + auto-scroll + insertion adorner + source-side hooks.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new DragDropExtendedVM();
        vmInstance.OnViewMounted = (view) => attachExtras(view, vmInstance);
        return vmInstance;
    },
};
