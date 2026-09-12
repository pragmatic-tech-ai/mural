import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { shapeLibraryDescriptors } from './shape-library.descriptors.mjs';
// The "Shape library" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(ShapeLibraryService) and its capability's
// ServiceKey = ShapeLibraryService resolves the same token.
export class ShapeLibraryService extends DemoGroupService {
    static Key = new ServiceKey('ShapeLibraryService');
    constructor(provider) { super(provider, shapeLibraryDescriptors); }
}
