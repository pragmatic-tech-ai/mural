import shapesDemo from '../../demos/shapes/shapes.descriptor.mjs';
// Static composition — the demos this group's rail item exposes. Replaces the
// old registry snapshot (allDemos() filtered by group). Order is irrelevant;
// DemoGroupService sorts by title.
export const shapeLibraryDescriptors = [
    shapesDemo,
];
