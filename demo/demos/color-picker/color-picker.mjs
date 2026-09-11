// Bootstrap for the color-picker demo.
//
// Four Office-style ColorPickers ride on VM hex DPs; a thin behaviour
// walks each linked preview Border and writes a fresh SolidColorBrush as
// the hex changes. Partial hex strings (e.g. mid-typing) throw inside
// Color.FromHex — we swallow those so the preview stays at its last
// good value until a full hex lands.

import { Border } from '@pragmatic-tech-ai/mural/basic';
import { Color, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine';

import { ColorPickerVM } from './color-picker-vm.mjs';
import { register } from '../../platform/registry.mjs';

function attachBehaviors(view, vm) {
    const wires = [
        ['SurfacePreview', 'SurfaceHex', ColorPickerVM.SurfaceHexKey],
        ['AccentPreview',  'AccentHex',  ColorPickerVM.AccentHexKey],
        ['InkPreview',     'InkHex',     ColorPickerVM.InkHexKey],
        ['OverlayPreview', 'OverlayHex', ColorPickerVM.OverlayHexKey],
    ];

    const cleanups = [];
    for (const [partName, hexProp, key] of wires) {
        const preview = view.FindName(partName);
        if (!(preview instanceof Border)) continue;

        const apply = () => {
            try {
                preview.Fill = new SolidColorBrush(Color.FromHex(vm[hexProp]));
            } catch { /* partial hex during typing */ }
        };
        apply();
        const sub = vm.PropertyChanged(key).subscribe(apply);
        cleanups.push(() => sub.dispose());
    }

    return function detach() {
        for (const c of cleanups) c();
    };
}

let vmInstance;

register({
    id:       'color-picker',
    group:    'Demos',
    title:    'Color picker',
    subtitle: 'Office-style picker — theme colors + tints, standard colors, recents, More Colors dialog.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new ColorPickerVM();
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
});
