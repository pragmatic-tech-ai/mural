import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { animationsDescriptors } from './animations.descriptors.mjs';

// The "Animation" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(AnimationsService) and its capability's
// ServiceKey = AnimationsService resolves the same token.
export class AnimationsService extends DemoGroupService {
    static readonly Key = new ServiceKey<AnimationsService>('AnimationsService');
    constructor(provider: IServiceProvider) { super(provider, animationsDescriptors); }
}
