import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { patternsDescriptors } from './patterns.descriptors.mjs';

// The "Patterns" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(PatternsService) and its capability's
// ServiceKey = PatternsService resolves the same token.
export class PatternsService extends DemoGroupService {
    static readonly Key = new ServiceKey<PatternsService>('PatternsService');
    constructor(provider: IServiceProvider) { super(provider, patternsDescriptors); }
}
