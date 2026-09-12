import { ShapesDemo } from "../../demos/shapes/shapes.mu.js";
import { ShapeLibraryService } from "./shape-library-service.mjs";
import { Capability, ShellModule } from "@pragmatic-tech-ai/mural/framework/shell/module.js";
import { DynamicResource, ServiceProvider } from "@pragmatic-tech-ai/mural/runtime";

export const ShapeLibraryModule = (() => {
    const _shellModule0 = new ShellModule();
    _shellModule0.set_property_value(ShellModule.NameKey, "Shape library");
    _shellModule0.AddRegistration(ServiceProvider.tokenFor(ShapeLibraryService), (p) => new ShapeLibraryService(p), 'singleton');
    const _rd1 = _shellModule0.Resources;
    for (const [_k, _v] of ShapesDemo.Clone().Entries()) _rd1.Set(_k, _v);
    const _capability2 = new Capability();
    _capability2.set_property_value(Capability.NameKey, "Shape library");
    _capability2.set_property_value(Capability.IconKey, DynamicResource(_capability2, "ShapeLibraryIcon"));
    _capability2.set_property_value(Capability.ServiceKeyKey, ShapeLibraryService);
    _shellModule0.AddChild(_capability2);
    return _shellModule0;
})();
