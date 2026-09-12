import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { patternsDescriptors } from './patterns.descriptors.mjs';
// The "Patterns" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(PatternsService) and its capability's
// ServiceKey = PatternsService resolves the same token.
export class PatternsService extends DemoGroupService {
    static Key = new ServiceKey('PatternsService');
    constructor(provider) { super(provider, patternsDescriptors); }
}
