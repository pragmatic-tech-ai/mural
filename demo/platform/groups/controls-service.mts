import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { controlsDescriptors } from './controls.descriptors.mjs';

// The "Controls" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(ControlsService) and its capability's
// ServiceKey = ControlsService resolves the same token.
export class ControlsService extends DemoGroupService
{
    static readonly Key = new ServiceKey<ControlsService>('ControlsService');
    constructor(provider: IServiceProvider) { super(provider, controlsDescriptors); }
}
