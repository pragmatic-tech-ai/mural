import animationDemo from '../../demos/animation/animation.descriptor.mjs';
import animationDeclarativeDemo from '../../demos/animation-declarative/animation-declarative.descriptor.mjs';
import animationNamedDemo from '../../demos/animation-named/animation-named.descriptor.mjs';
import animationTriggersDemo from '../../demos/animation-triggers/animation-triggers.descriptor.mjs';
// Static composition — the demos this group's rail item exposes. Replaces the
// old registry snapshot (allDemos() filtered by group). Order is irrelevant;
// DemoGroupService sorts by title.
export const animationsDescriptors = [
    animationDemo,
    animationDeclarativeDemo,
    animationNamedDemo,
    animationTriggersDemo,
];
