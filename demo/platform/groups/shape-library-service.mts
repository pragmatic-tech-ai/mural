import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { shapeLibraryDescriptors } from './shape-library.descriptors.mjs';

// The "Shape library" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(ShapeLibraryService) and its capability's
// ServiceKey = ShapeLibraryService resolves the same token.
export class ShapeLibraryService extends DemoGroupService {
    static readonly Key = new ServiceKey<ShapeLibraryService>('ShapeLibraryService');
    constructor(provider: IServiceProvider) { super(provider, shapeLibraryDescriptors); }
}
