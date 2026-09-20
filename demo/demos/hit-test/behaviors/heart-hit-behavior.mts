// heart-hit-behavior — the click leg the Heart shape can't do itself. A
// Shape is an Element with no Command, so this adds the MouseLeftButtonDown
// listener and translates it into a VM write (flip IsToggled). Because the
// Heart publishes its own silhouette as HitTestGeometry (Shape.ArrangeOverride),
// only clicks INSIDE the outline reach the shape — the behavior never sees a
// bounding-box-corner click. Fill (orange↔white) is swapped by a
// `when ($IsToggled)` trigger in the view. Returns a mandatory detach thunk.
import { type Visual } from '@pragmatic-tech-ai/mural/runtime';
import type { HitTestVM } from '../hit-test-vm.mjs';

export function attachHeartHit(heart: Visual, vm: HitTestVM): () => void
{
    const onDown = (): void => { vm.IsToggled = !vm.IsToggled; };
    heart.AddRoutedEventListener('MouseLeftButtonDown', onDown);

    return function detach(): void
    {
        heart.RemoveRoutedEventListener('MouseLeftButtonDown', onDown);
    };
}
