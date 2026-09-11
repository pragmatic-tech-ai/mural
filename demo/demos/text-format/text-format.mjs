// Bootstrap for the text-format demo.
//
// The editors bind to the VM's pure primitives (family string, size
// number, bold/italic/underline bools, colour hex). The sample paragraph
// binds Family / FontSize straight through, but FontWeight / FontStyle /
// TextDecorations / Foreground are visual-engine types the MVVM VM can't
// hold — so this bridge maps the primitives onto the paragraph on every
// change. A partial hex mid-typing throws inside Color.FromHex; we swallow
// it so the colour holds at its last good value.

import { TextBlock } from '@pragmatic-tech-ai/mural/basic';
import {
    Color,
    SolidColorBrush,
    FontWeight,
    FontStyle,
    TextDecorations,
} from '@pragmatic-tech-ai/mural/visual-engine';

import { TextFormatVM } from './text-format-vm.mjs';
import { register } from '../../platform/registry.mjs';

function attachFormatBridge(view, vm) {
    const sample = view.FindName('SamplePara');
    if (!(sample instanceof TextBlock)) return function detach() {};

    const apply = () => {
        sample.FontWeight = vm.Bold ? FontWeight.Bold : FontWeight.Normal;
        sample.FontStyle = vm.Italic ? FontStyle.Italic : FontStyle.Normal;
        sample.TextDecorations = vm.Underline ? TextDecorations.Underline : TextDecorations.None;
        try {
            sample.Foreground = new SolidColorBrush(Color.FromHex(vm.ColorHex));
        } catch { /* partial hex mid-typing — keep last good colour */ }
    };
    apply();

    const keys = [
        TextFormatVM.BoldKey,
        TextFormatVM.ItalicKey,
        TextFormatVM.UnderlineKey,
        TextFormatVM.ColorHexKey,
    ];
    const disposers = keys.map(k => vm.PropertyChanged(k).subscribe(apply));

    return function detach() {
        for (const d of disposers) d.dispose();
    };
}

let vmInstance;

register({
    id:       'text-format',
    group:    'Demos',
    title:    'Text format editors',
    subtitle: 'Font family / size (editable combos), font colour, and bold / italic / underline — bound to a live sample paragraph.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new TextFormatVM();
        vmInstance.OnViewMounted = (view) => attachFormatBridge(view, vmInstance);
        return vmInstance;
    },
});
