// Binding — the data-binding pipeline. The core Binding class plus its
// specialised subtypes (DataContextBinding, ElementNameBinding,
// AncestorBinding, TemplateBinding, MultiBinding, PriorityBinding,
// DynamicResource), the Validation framework that runs inside that
// pipeline, and the EffectiveValueDescriptor that resolves
// binding/local/animated/inherited source priority on a per-DP basis.
//
// Export order is load-bearing. effective-value.ts is listed FIRST so
// model.ts's transitive load (model → binding/binding → ../model cycle)
// finds effective-value.ts already in-flight rather than triggering a
// fresh load that would chain through validation.ts and hit MuralBase
// before its `class MuralBase { … }` declaration has run.
export {
    EffectiveValueDescriptor,
    PropertyValueSource,
    type PropertyChangedEventArgs,
} from './effective-value.js';
export {
    Binding,
    BindingMode,
    composeConverters,
    type BindingOptions,
    type ValueConverter,
} from './binding.js';
export {
    Validation,
    type ValidationError,
    type ValidationResult,
    type ValidationRule,
} from './validation.js';
export { DataContextBinding } from './data-context-binding.js';
export { ElementNameBinding, ServiceBinding } from './element-name-binding.js';
export { MultiBinding, PriorityBinding } from './multi-binding.js';
export { AncestorBinding } from './ancestor-binding.js';
export { SelfBinding } from './self-binding.js';
export { TemplateBinding } from './template-binding.js';
export { MultiTemplateBinding } from './multi-template-binding.js';
export { DynamicResource } from './dynamic-resource.js';
export {
    Lighten,
    Darken,
    Mix,
    Saturate,
    Desaturate,
    Alpha,
} from './color-modifiers.js';
export { Is, ToVisibility } from './value-converters.js';
