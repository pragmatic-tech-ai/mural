// animation-named demo — AnimationNamedVM is empty; the .mu file
// declares a DataTemplate keyed on AnimationNamedVM with an implicit
// Button style (scoped to the template root) that drives Begin /
// Pause / Resume / Stop via named storyboards.
import { AnimationNamedVM } from './animation-named-vm.mjs';

let vmInstance;

export default {
    id:       'animation-named',
    title:    'Named storyboards',
    subtitle: '`BeginStoryboard[Name=loop]` + Pause / Resume / Stop on hover and click — markup-only.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new AnimationNamedVM();
        return vmInstance;
    },
};
