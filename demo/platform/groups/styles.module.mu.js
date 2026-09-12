import { DashboardDemo } from "../../demos/dashboard/dashboard.mu.js";
import { StylesService } from "./styles-service.mjs";
import { Capability, ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { DynamicResource, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const StylesModule = (() => {
    const _shellModule0 = new ShellModule();
    _shellModule0.set_property_value(ShellModule.NameKey, "Styles & Triggers");
    _shellModule0.AddRegistration(ServiceProvider.tokenFor(StylesService), (p) => new StylesService(p), 'singleton');
    const _rd1 = _shellModule0.Resources;
    for (const [_k, _v] of DashboardDemo.Clone().Entries()) _rd1.Set(_k, _v);
    const _capability2 = new Capability();
    _capability2.set_property_value(Capability.NameKey, "Styles & Triggers");
    _capability2.set_property_value(Capability.IconKey, DynamicResource(_capability2, "StylesIcon"));
    _capability2.set_property_value(Capability.ServiceKeyKey, StylesService);
    _shellModule0.AddChild(_capability2);
    return _shellModule0;
})();
