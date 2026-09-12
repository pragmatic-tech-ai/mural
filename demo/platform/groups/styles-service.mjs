import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime';
import { DemoGroupService } from '../demo-group-service.mjs';
import { stylesDescriptors } from './styles.descriptors.mjs';
// The "Styles & Triggers" group's content service. Class-as-token: the .module.mu
// registers it under ServiceProvider.tokenFor(StylesService) and its capability's
// ServiceKey = StylesService resolves the same token.
export class StylesService extends DemoGroupService {
    static Key = new ServiceKey('StylesService');
    constructor(provider) { super(provider, stylesDescriptors); }
}
