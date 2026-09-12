import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { demosDescriptors } from './demos.descriptors.mjs';
// The "Demos" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(DemosService) and its capability's
// ServiceKey = DemosService resolves the same token.
export class DemosService extends DemoGroupService {
    static Key = new ServiceKey('DemosService');
    constructor(provider) { super(provider, demosDescriptors); }
}
