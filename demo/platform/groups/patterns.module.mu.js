import { CounterDemo } from "../../demos/counter/counter.mu.js";
import { PatternsService } from "./patterns-service.mjs";
import { Capability, ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { DynamicResource, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const PatternsModule = (() => {
    const _shellModule0 = new ShellModule();
    _shellModule0.set_property_value(ShellModule.NameKey, "Patterns");
    _shellModule0.AddRegistration(ServiceProvider.tokenFor(PatternsService), (p) => new PatternsService(p), 'singleton');
    const _rd1 = _shellModule0.Resources;
    for (const [_k, _v] of CounterDemo.Clone().Entries()) _rd1.Set(_k, _v);
    const _capability2 = new Capability();
    _capability2.set_property_value(Capability.NameKey, "Patterns");
    _capability2.set_property_value(Capability.IconKey, DynamicResource(_capability2, "PatternsIcon"));
    _capability2.set_property_value(Capability.ServiceKeyKey, PatternsService);
    _shellModule0.AddChild(_capability2);
    return _shellModule0;
})();
