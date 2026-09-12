import { AnimationDeclarativeDemo } from "../../demos/animation-declarative/animation-declarative.mu.js";
import { AnimationNamedDemo } from "../../demos/animation-named/animation-named.mu.js";
import { AnimationTriggersDemo } from "../../demos/animation-triggers/animation-triggers.mu.js";
import { AnimationDemo } from "../../demos/animation/animation.mu.js";
import { AnimationsService } from "./animations-service.mjs";
import { Capability, ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { DynamicResource, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const AnimationsModule = (() => {
    const _shellModule0 = new ShellModule();
    _shellModule0.set_property_value(ShellModule.NameKey, "Animation");
    _shellModule0.AddRegistration(ServiceProvider.tokenFor(AnimationsService), (p) => new AnimationsService(p), 'singleton');
    const _rd1 = _shellModule0.Resources;
    for (const [_k, _v] of AnimationDemo.Clone().Entries()) _rd1.Set(_k, _v);
    for (const [_k, _v] of AnimationDeclarativeDemo.Clone().Entries()) _rd1.Set(_k, _v);
    for (const [_k, _v] of AnimationNamedDemo.Clone().Entries()) _rd1.Set(_k, _v);
    for (const [_k, _v] of AnimationTriggersDemo.Clone().Entries()) _rd1.Set(_k, _v);
    const _capability2 = new Capability();
    _capability2.set_property_value(Capability.NameKey, "Animation");
    _capability2.set_property_value(Capability.IconKey, DynamicResource(_capability2, "AnimationIcon"));
    _capability2.set_property_value(Capability.ServiceKeyKey, AnimationsService);
    _shellModule0.AddChild(_capability2);
    return _shellModule0;
})();
