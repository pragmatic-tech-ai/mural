import type { DemoDescriptor } from '../demo-descriptor.mjs';
import dashboardDemo from '../../demos/dashboard/dashboard.descriptor.mjs';

// Static composition — the demos this group's rail item exposes. Replaces the
// old registry snapshot (allDemos() filtered by group). Order is irrelevant;
// DemoGroupService sorts by title.
export const stylesDescriptors: readonly DemoDescriptor[] = [
    dashboardDemo,
];
